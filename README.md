# Previna API — Webhook Meta Lead Ads

Backend Next.js que recebe leads do **Meta Lead Ads** (Facebook/Instagram) em
tempo real, valida a assinatura HMAC do Meta, busca os dados completos do lead
na Graph API e dispara um pipeline de processamento (`processarLead`) que
futuramente vai integrar com WhatsApp e banco de dados.

- **Domínio principal:** `previnatratamento.com.br`
- **Domínio da API:** `api.previnatratamento.com.br`
- **Hospedagem:** Vercel
- **Stack:** Next.js 15 (App Router) + TypeScript + Node runtime

---

## Estrutura

```
previna-api/
├── app/
│   ├── api/webhooks/meta-leads/route.ts  # endpoint do webhook
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── crypto.ts        # HMAC SHA-256 (validação + assinatura pra testes)
│   ├── logger.ts        # log JSON estruturado pra stdout
│   └── meta.ts          # Graph API client + processarLead (stub)
├── types/
│   └── meta.ts          # tipos do payload do Meta + lead normalizado
├── scripts/
│   └── test-webhook.ts  # simulador local (POST + assinatura)
├── .env.example
├── .gitignore
├── next.config.ts
├── package.json
├── README.md
└── tsconfig.json
```

---

## Setup local

```bash
# 1) Instalar deps
npm install

# 2) Copiar template de env
cp .env.example .env.local

# 3) Preencher as 3 variáveis (instruções abaixo) e rodar:
npm run dev
```

A API sobe em `http://localhost:3000` e o webhook fica em
`http://localhost:3000/api/webhooks/meta-leads`.

---

## Variáveis de ambiente

### `META_VERIFY_TOKEN`

Token arbitrário (qualquer string) que VOCÊ define e cola no painel do Meta
durante a configuração do webhook. O Meta vai mandar essa string num GET
inicial e você precisa devolver o `hub.challenge` se bater.

Gere uma string aleatória segura:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Já gerei um valor durante o setup — está em `.env.local.generated`
> (gitignored). Copie pro `.env.local` e pro painel do Meta.

### `META_APP_SECRET`

Segredo do seu App no Meta for Developers. É usado pra validar a assinatura
HMAC SHA-256 que o Meta envia no header `x-hub-signature-256`.

**Como obter:**
1. Acesse https://developers.facebook.com/apps
2. Selecione seu App
3. Menu lateral: **Configurações → Básico**
4. Campo **Chave Secreta do App** → clique em **Mostrar** (vai pedir senha)
5. Copie o valor

### `META_PAGE_ACCESS_TOKEN`

Token que dá acesso à Graph API em nome da Página do Facebook conectada ao
formulário de Lead Ads.

**Como obter um token "never expire" (recomendado pra produção):**

1. Acesse https://developers.facebook.com/tools/explorer/
2. Em **Meta App**, selecione seu App
3. Em **User or Page**, escolha **Get Page Access Token**
4. Clique em **Add a Permission** e adicione:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_metadata`
   - `leads_retrieval`
   - `pages_manage_ads`
   - `ads_management`
5. Clique em **Generate Access Token** e autorize
6. Selecione a Página correta
7. Copie o token gerado (esse é de curto prazo — ~1h)
8. Vá pro **Access Token Debugger**: https://developers.facebook.com/tools/debug/accesstoken/
9. Cole o token e clique em **Debug**
10. Clique em **Extend Access Token** → vai gerar um de longo prazo (~60 dias)
11. Cole o estendido novamente no Debugger e clique em **Debug** — vai aparecer
    um campo **Access Token** com `Expires: Never` se for um Page Token derivado
    de um User Token de longo prazo. Use ESSE.

> Se aparecer expiração, repita o ciclo: o token de Página derivado de um
> User Token de longa duração herda "never expire" automaticamente.

---

## Testando localmente

### 1. Verificação GET (handshake do Meta)

```bash
curl "http://localhost:3000/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=teste123"
```

**Esperado:** body `teste123`, status 200, content-type `text/plain`.

### 2. Simular POST com assinatura válida

```bash
npm run test:webhook
```

Esse script (`scripts/test-webhook.ts`):
- carrega `.env.local`
- monta um payload fake de leadgen
- calcula HMAC SHA-256 com `META_APP_SECRET`
- bate em `http://localhost:3000/api/webhooks/meta-leads`

**Esperado:** status 200 e logs estruturados no terminal do `npm run dev`.
O `processarLead` vai logar erro porque o `leadgen_id` é fake e a Graph API
não vai achar — isso é esperado (mostra que o pipeline foi até a chamada real).

Pra testar com URL custom (ex: deploy na Vercel):

```bash
npx tsx scripts/test-webhook.ts https://api.previnatratamento.com.br
```

---

## Deploy no Vercel

1. **Push pro GitHub:**
   ```bash
   git init
   git add .
   git commit -m "feat: webhook Meta Lead Ads inicial"
   git branch -M main
   git remote add origin https://github.com/matheustonello/api-project-meta.git
   git push -u origin main
   ```

2. **Importar na Vercel:**
   - Acesse https://vercel.com/new
   - Selecione o repo `api-project-meta`
   - Framework: **Next.js** (auto-detect)
   - Não precisa mudar build/output

3. **Configurar Environment Variables** (Settings → Environment Variables):
   - `META_VERIFY_TOKEN` → o valor de `.env.local.generated`
   - `META_APP_SECRET` → o do passo de obtenção acima
   - `META_PAGE_ACCESS_TOKEN` → o never-expire do passo acima
   - Marque: **Production**, **Preview**, **Development**

4. **Custom domain** (Settings → Domains):
   - Adicione `api.previnatratamento.com.br`
   - A Vercel vai pedir um CNAME — vá no painel DNS do
     `previnatratamento.com.br` (Registro.br, Cloudflare, etc.) e crie:
     ```
     Type:   CNAME
     Name:   api
     Value:  cname.vercel-dns.com
     TTL:    3600
     ```
   - Aguarde propagação (geralmente <10min) e a Vercel emite SSL automático.

5. **Redeploy** (Deployments → ⋯ → Redeploy) pra aplicar as env vars.

---

## Configurar webhook no painel do Meta

1. Acesse https://developers.facebook.com/apps → seu App
2. Adicione o produto **Webhooks** (se ainda não tiver)
3. Em **Webhooks → Page**, clique em **Subscribe to this object**
4. Preencha:
   - **Callback URL:** `https://api.previnatratamento.com.br/api/webhooks/meta-leads`
   - **Verify Token:** o valor de `META_VERIFY_TOKEN`
5. Clique em **Verify and Save** — o Meta vai bater no GET; se passar, salva.
6. De volta na lista, marque o checkbox em **`leadgen`** → **Subscribe**

### Vincular a Página ao webhook (passo que muita gente esquece)

Mesmo com o webhook configurado no App, cada **Página** precisa estar
explicitamente inscrita no campo `leadgen` do App. Faça isso uma vez:

```bash
curl -X POST \
  "https://graph.facebook.com/v21.0/{PAGE_ID}/subscribed_apps?subscribed_fields=leadgen&access_token={PAGE_ACCESS_TOKEN}"
```

Substitua `{PAGE_ID}` pelo ID numérico da Página (você acha em
**Configurações da Página → Sobre → ID da Página**) e `{PAGE_ACCESS_TOKEN}`
pelo token gerado.

**Esperado:** `{"success": true}`.

Pra confirmar:

```bash
curl "https://graph.facebook.com/v21.0/{PAGE_ID}/subscribed_apps?access_token={PAGE_ACCESS_TOKEN}"
```

Deve listar seu App com `subscribed_fields` incluindo `leadgen`.

---

## Testando com Lead Ads do Meta

Use a ferramenta oficial: https://developers.facebook.com/tools/lead-ads-testing

1. Selecione **Page** e **Form**
2. Clique em **Create lead** → preenche um lead fake
3. O Meta dispara o webhook em produção (não funciona com `localhost`)
4. Veja os logs no painel da Vercel (**Project → Logs**) — deve aparecer
   `webhook.lead.received` e `webhook.lead.processed`

---

## Próximos passos (TODOs)

- [ ] **Banco de dados** com `leadgen_id` UNIQUE pra idempotência
      (Meta pode reentregar em caso de timeout do nosso lado).
      Esquema sugerido em `lib/meta.ts`.
- [ ] **Fila** (Upstash Redis / SQS / QStash) pra desacoplar o processamento
      pesado da resposta do webhook (Meta exige <5s).
- [ ] **Integração WhatsApp Business** — disparar mensagem inicial assim que
      o lead chega.
- [ ] **App Review** no Meta pra sair do modo Development e aceitar leads
      reais de qualquer Página (no modo Dev, só Páginas vinculadas ao App
      conseguem disparar webhooks).
- [ ] **Alerting** — Sentry/BetterStack pra capturar `webhook.lead.processing_failed`.

---

## Arquitetura: por que essas decisões

- **Node runtime, não Edge** → precisamos do `node:crypto` nativo
  (`createHmac`, `timingSafeEqual`) que não existe no Edge runtime.
- **Raw body antes de parse** → assinatura HMAC só bate se for calculada
  sobre a string EXATA recebida, sem reparsear (JSON.stringify reordena keys).
- **`timingSafeEqual` em vez de `===`** → comparação byte-a-byte em tempo
  constante evita timing attacks na validação da assinatura.
- **200 OK mesmo em erro de processamento** → retornar 5xx faz o Meta reenviar,
  e isso é pior que perder/atrasar (leads ficam disponíveis 90 dias na Graph
  API pra reprocessamento manual ou via `leadgen_id`).
- **401/400 em assinatura/JSON inválidos** → aqui é seguro retornar erro:
  request inválido nunca deveria ter chegado, e bloqueia ataques.
- **Logs JSON estruturados** → Vercel indexa automaticamente; permite filtrar
  por `event=webhook.lead.processed` ou `leadgen_id=...` nos logs.
