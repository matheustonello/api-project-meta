import type {
  GraphLeadResponse,
  LeadgenChangeValue,
  NormalizedLead,
} from '@/types/meta'
import { logger } from '@/lib/logger'

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

// Meta tem timeout de ~5s pro webhook responder. Reservamos 1s pra overhead
// (parsing, log, retorno HTTP) e damos no máximo 4s pro fetch da Graph API.
const GRAPH_FETCH_TIMEOUT_MS = 4_000

class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = 'GraphApiError'
  }
}

/**
 * Busca os dados completos do lead na Graph API.
 *
 * O webhook do Meta entrega só o `leadgen_id` — os campos preenchidos pelo
 * usuário (nome, telefone, etc.) ficam disponíveis por 90 dias via Graph API,
 * então mesmo se este fetch falhar, podemos reprocessar depois.
 */
async function fetchLeadFromGraph(
  leadgenId: string,
  accessToken: string,
): Promise<GraphLeadResponse> {
  const url = `${GRAPH_API_BASE}/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(accessToken)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // cache: 'no-store' — leads são one-shot, sem sentido cachear.
      cache: 'no-store',
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>')
      throw new GraphApiError(
        `Graph API respondeu ${response.status}`,
        response.status,
        body,
      )
    }

    return (await response.json()) as GraphLeadResponse
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Achata `field_data: [{name, values: [v]}]` em `{ name: v }` pra facilitar
 * o consumo downstream. Se algum campo vier sem valor, vira string vazia
 * (preferível a `undefined` pra schemas de banco com NOT NULL DEFAULT '').
 */
function flattenFieldData(fieldData: GraphLeadResponse['field_data']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fieldData) {
    out[field.name] = field.values[0] ?? ''
  }
  return out
}

/**
 * Pipeline: a partir do `change.value` do webhook, busca os dados completos
 * e devolve um lead normalizado pronto pra processarLead().
 */
export async function buildNormalizedLead(
  changeValue: LeadgenChangeValue,
  accessToken: string,
): Promise<NormalizedLead> {
  const graphLead = await fetchLeadFromGraph(changeValue.leadgen_id, accessToken)

  return {
    leadgen_id: graphLead.id,
    page_id: changeValue.page_id,
    form_id: graphLead.form_id ?? changeValue.form_id,
    created_time: graphLead.created_time,
    ad_id: graphLead.ad_id,
    ad_name: graphLead.ad_name,
    campaign_id: graphLead.campaign_id,
    campaign_name: graphLead.campaign_name,
    platform: graphLead.platform,
    is_organic: graphLead.is_organic,
    fields: flattenFieldData(graphLead.field_data),
  }
}

/**
 * Stub de processamento. Por ora só loga o lead recebido.
 *
 * TODO: persistir em banco com `leadgen_id` UNIQUE pra garantir idempotência
 *       (Meta pode reentregar o mesmo lead em caso de timeout do nosso lado).
 *       Esquema sugerido:
 *         CREATE TABLE leads (
 *           leadgen_id   TEXT PRIMARY KEY,
 *           page_id      TEXT NOT NULL,
 *           form_id      TEXT NOT NULL,
 *           created_time TIMESTAMPTZ NOT NULL,
 *           fields       JSONB NOT NULL,
 *           received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *         );
 *       Em INSERT, usar `ON CONFLICT (leadgen_id) DO NOTHING`.
 *
 * TODO: enfileirar (Redis/SQS/Upstash) o processamento pesado (envio de
 *       WhatsApp, gravação em CRM) pra não travar a resposta do webhook.
 *       O endpoint deve responder em <5s; integrações lentas vão pra fila.
 *
 * TODO: integração WhatsApp Business — disparar mensagem inicial assim que
 *       o lead chega, usando o `phone_number` do `fields`.
 */
export async function processarLead(lead: NormalizedLead): Promise<void> {
  logger.info('webhook.lead.processed', {
    leadgen_id: lead.leadgen_id,
    page_id: lead.page_id,
    form_id: lead.form_id,
    campaign_id: lead.campaign_id,
    platform: lead.platform,
    is_organic: lead.is_organic,
    field_keys: Object.keys(lead.fields),
  })
}

/**
 * Lê env var obrigatória. Falha alto e cedo (no boot do route handler) se faltar
 * — preferível a silenciar e descobrir só quando o webhook der 500 em produção.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${name}`)
  }
  return value
}

export { GraphApiError }
