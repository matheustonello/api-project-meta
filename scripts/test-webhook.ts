// Simulador local do POST que o Meta faria.
// Monta um payload fake de leadgen, calcula a assinatura HMAC com o
// META_APP_SECRET do .env.local e bate no endpoint local.
//
// Uso:
//   npx tsx scripts/test-webhook.ts
//   npx tsx scripts/test-webhook.ts http://localhost:3000   # custom URL
//
// IMPORTANTE: ele NÃO chama a Graph API real — então o `processarLead` vai
// rodar com erro no fetch (a menos que você mocke). O objetivo do script é
// validar a etapa de assinatura + parsing + roteamento de changes.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { signMetaPayload } from '../lib/crypto'

function loadEnvLocal(): void {
  // Carregamento mínimo de .env.local (sem dotenv pra não inflar deps).
  // Aceita linhas KEY=VALUE, ignora comentários (#) e linhas em branco.
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // .env.local opcional — script ainda roda se as vars já estiverem no ambiente.
  }
}

async function main() {
  loadEnvLocal()

  const baseUrl = process.argv[2] ?? 'http://localhost:3000'
  const url = `${baseUrl.replace(/\/$/, '')}/api/webhooks/meta-leads`

  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('[erro] META_APP_SECRET ausente. Coloque no .env.local antes de rodar.')
    process.exit(1)
  }

  // Payload no formato real que o Meta envia (object=page, entry[].changes[]).
  const payload = {
    object: 'page',
    entry: [
      {
        id: '999999999999999',
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'leadgen',
            value: {
              ad_id: '111111111111111',
              form_id: '222222222222222',
              leadgen_id: 'TEST_LEAD_' + Date.now(),
              created_time: Math.floor(Date.now() / 1000),
              page_id: '333333333333333',
            },
          },
        ],
      },
    ],
  }

  const rawBody = JSON.stringify(payload)
  const signature = signMetaPayload(rawBody, appSecret)

  console.log('[test] POST', url)
  console.log('[test] signature:', signature)
  console.log('[test] body:', rawBody)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    },
    body: rawBody,
  })

  console.log('[test] status:', res.status)
  console.log('[test] response:', await res.text())

  if (res.status !== 200) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
