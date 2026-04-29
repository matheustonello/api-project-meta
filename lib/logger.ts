// Logger estruturado — uma linha JSON por evento, escrita em stdout.
// Vercel/CloudWatch indexam JSON automaticamente, então isso facilita pesquisa
// (filtrar por `event`, `leadgen_id`, etc.) sem precisar de lib externa.

type Level = 'debug' | 'info' | 'warn' | 'error'

type LogPayload = Record<string, unknown>

function emit(level: Level, event: string, payload?: LogPayload): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  }
  // Usamos stdout pra todos os níveis (incluindo error) porque a Vercel
  // captura ambos com timestamp próprio; misturar stderr quebraria a ordem.
  process.stdout.write(JSON.stringify(line) + '\n')
}

export const logger = {
  debug: (event: string, payload?: LogPayload) => emit('debug', event, payload),
  info: (event: string, payload?: LogPayload) => emit('info', event, payload),
  warn: (event: string, payload?: LogPayload) => emit('warn', event, payload),
  error: (event: string, payload?: LogPayload) => emit('error', event, payload),
}
