import type { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { validateMetaSignature } from '@/lib/crypto'
import { buildNormalizedLead, processarLead, requireEnv } from '@/lib/meta'
import {
  isLeadgenChange,
  type LeadgenWebhookPayload,
} from '@/types/meta'

// Forçamos Node runtime — Edge não expõe `node:crypto` nativo, e precisamos
// de `createHmac` + `timingSafeEqual` pra validar assinaturas do Meta.
export const runtime = 'nodejs'

// Webhook não deve ser cacheado nem regenerado estaticamente.
export const dynamic = 'force-dynamic'

/**
 * GET — verificação inicial que o Meta faz quando você cadastra/atualiza o
 * webhook no painel. Esperamos `hub.mode=subscribe`, `hub.verify_token=<nosso>`
 * e `hub.challenge=<eco>`. A resposta DEVE ser exatamente o challenge em
 * text/plain pra o Meta aceitar.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  let verifyToken: string
  try {
    verifyToken = requireEnv('META_VERIFY_TOKEN')
  } catch (err) {
    logger.error('webhook.verify.config_missing', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new Response('Server misconfigured', { status: 500 })
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    logger.info('webhook.verify.success', { challenge_length: challenge.length })
    return new Response(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  logger.warn('webhook.verify.rejected', {
    mode,
    has_token: Boolean(token),
    token_match: token === verifyToken,
    has_challenge: Boolean(challenge),
  })
  return new Response('Forbidden', { status: 403 })
}

/**
 * POST — entrega real do lead pelo Meta.
 *
 * Ordem de validação importa:
 *   1) ler raw body (precisa ser a string EXATA pra HMAC bater)
 *   2) validar assinatura (rejeita ataques antes de qualquer parsing)
 *   3) parsear JSON (rejeita malformados)
 *   4) processar leads — erros aqui NÃO devem virar 4xx/5xx, porque o Meta
 *      reenviaria e isso é pior que perder/atrasar (leads ficam 90 dias
 *      disponíveis na Graph API pra reprocessar manualmente).
 */
export async function POST(req: NextRequest) {
  // 1) Raw body — Next.js dá `req.text()` com o conteúdo cru.
  const rawBody = await req.text()

  // 2) Assinatura — falha aqui é 401 (segurança).
  let appSecret: string
  let pageAccessToken: string
  try {
    appSecret = requireEnv('META_APP_SECRET')
    pageAccessToken = requireEnv('META_PAGE_ACCESS_TOKEN')
  } catch (err) {
    logger.error('webhook.lead.config_missing', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new Response('Server misconfigured', { status: 500 })
  }

  const signatureHeader = req.headers.get('x-hub-signature-256')
  const signatureValid = validateMetaSignature(rawBody, signatureHeader, appSecret)

  if (!signatureValid) {
    logger.warn('webhook.lead.signature_invalid', {
      has_header: Boolean(signatureHeader),
      body_length: rawBody.length,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  // 3) Parse — falha aqui é 400 (cliente mandou lixo, mas autenticado).
  let payload: LeadgenWebhookPayload
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload = JSON.parse(rawBody) as LeadgenWebhookPayload
  } catch (err) {
    logger.warn('webhook.lead.invalid_json', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new Response('Bad Request', { status: 400 })
  }

  // 4) Processamento — defensivo: nunca propaga erro pro Meta.
  const entries = payload.entry ?? []
  let leadCount = 0
  let errorCount = 0

  for (const entry of entries) {
    const changes = entry.changes ?? []
    for (const change of changes) {
      if (!isLeadgenChange(change)) continue

      leadCount++
      const { leadgen_id, page_id, form_id } = change.value

      try {
        logger.info('webhook.lead.received', { leadgen_id, page_id, form_id })
        const lead = await buildNormalizedLead(change.value, pageAccessToken)
        await processarLead(lead)
      } catch (err) {
        errorCount++
        // Logamos e seguimos — devolver 5xx faria o Meta reenviar,
        // o que é pior que perder este envio (lead ainda está acessível
        // via Graph API por 90 dias pra reprocessar).
        logger.error('webhook.lead.processing_failed', {
          leadgen_id,
          page_id,
          form_id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      }
    }
  }

  logger.info('webhook.lead.batch_complete', {
    total: leadCount,
    errors: errorCount,
  })

  return new Response('OK', { status: 200 })
}
