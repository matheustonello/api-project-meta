import { createHmac, timingSafeEqual } from 'node:crypto'

// Valida a assinatura HMAC SHA-256 que o Meta envia no header `x-hub-signature-256`.
// O header tem o formato: `sha256=<hex>` — extraímos o hex, calculamos o nosso
// HMAC sobre o RAW body (string exata recebida, sem reparsear) e comparamos
// usando `timingSafeEqual` pra evitar timing attacks (comparação byte a byte
// que vaza informação se feita com `===`).

export function validateMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false

  // O header sempre vem prefixado com "sha256=". Se vier diferente, rejeita.
  const [scheme, providedHex] = signatureHeader.split('=')
  if (scheme !== 'sha256' || !providedHex) return false

  const expectedHex = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  // Buffers precisam ter o mesmo tamanho pro timingSafeEqual não jogar erro
  // (que vaza informação). Se diferem, já é inválido.
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const providedBuf = Buffer.from(providedHex, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false

  return timingSafeEqual(expectedBuf, providedBuf)
}

// Util pros testes/script: gera o header pronto pra um body arbitrário.
export function signMetaPayload(rawBody: string, appSecret: string): string {
  const hex = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return `sha256=${hex}`
}
