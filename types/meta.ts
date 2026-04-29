// Tipos baseados na documentação oficial do Meta Lead Ads Webhook (v21.0).
// Referência: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving

/**
 * Cada item de `field_data` retornado pela Graph API ao consultar um lead.
 * `values` quase sempre tem 1 elemento (o Meta entrega array por compatibilidade
 * histórica com campos multi-valor, mas Lead Ads modernos usam apenas o primeiro).
 */
export interface LeadFieldData {
  name: string
  values: string[]
}

/**
 * Resposta da Graph API ao GET `/{leadgen_id}?access_token=...`
 */
export interface GraphLeadResponse {
  id: string
  created_time: string
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  form_id?: string
  is_organic?: boolean
  platform?: string
  field_data: LeadFieldData[]
}

/**
 * Conteúdo de `change.value` quando `change.field === 'leadgen'`.
 * Esses são os IDs que o Meta entrega no POST do webhook — os dados completos
 * precisam ser buscados na Graph API usando `leadgen_id`.
 */
export interface LeadgenChangeValue {
  ad_id?: string
  form_id: string
  leadgen_id: string
  created_time: number
  page_id: string
  adgroup_id?: string
}

export interface LeadgenChange {
  field: 'leadgen'
  value: LeadgenChangeValue
}

/**
 * Outros valores de `field` podem aparecer (mensagens, feed, etc.) — ignoramos.
 * Modelamos como union pra deixar explícito que filtramos por field.
 */
export interface UnknownChange {
  field: string
  value: unknown
}

export type WebhookChange = LeadgenChange | UnknownChange

export interface WebhookEntry {
  id: string
  time: number
  changes: WebhookChange[]
}

/**
 * Envelope completo do POST que o Meta envia. `object` é sempre 'page' pra Lead Ads.
 */
export interface LeadgenWebhookPayload {
  object: 'page' | string
  entry: WebhookEntry[]
}

/**
 * Lead já normalizado — `field_data[]` foi achatado em um objeto plano.
 * Esse é o formato que `processarLead` recebe.
 */
export interface NormalizedLead {
  leadgen_id: string
  page_id: string
  form_id: string
  created_time: string
  ad_id?: string
  ad_name?: string
  campaign_id?: string
  campaign_name?: string
  platform?: string
  is_organic?: boolean
  fields: Record<string, string>
}

/**
 * Type guard pra filtrar apenas changes do tipo leadgen.
 */
export function isLeadgenChange(change: WebhookChange): change is LeadgenChange {
  return change.field === 'leadgen'
}
