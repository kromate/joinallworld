// The admin address's own way to reach the server: plain fetch with the host-only session cookie, JSON in and out, the server's clock kept
// so a change's client id carries the server's time (the server refuses an id that is far from its own clock).
import type { ApiError, FetchJson } from '../app/types/client.ts'
import type { AdminTransport } from '../app/features/admin/transport.ts'

let offset = 0
const uuid = (): string => globalThis.crypto.randomUUID?.() ?? [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const fetchJson: FetchJson = async <T = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(path, { method: options.method ?? 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers },
      ...(options.body !== undefined ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}), signal: globalThis.AbortSignal?.timeout?.(15000) })
  } catch { throw Object.assign(Error('The server did not answer. Check the connection and try again.'), { code: 'network' }) as ApiError }
  let payload: Record<string, unknown>
  try { payload = await response.json() as Record<string, unknown> } catch { throw Object.assign(Error('The server sent an unreadable answer.'), { status: response.status, code: 'unreadable' }) as ApiError }
  if (typeof payload.serverTime === 'number' && Number.isFinite(payload.serverTime)) offset = payload.serverTime - Date.now()
  if (!response.ok) {
    const failure: ApiError = Error(String(payload.error ?? payload.message ?? 'Connection failed'))
    failure.status = response.status; failure.code = String(payload.code ?? payload.error ?? ''); if (typeof payload.reason === 'string') failure.reason = payload.reason
    throw failure
  }
  return payload as T
}

export const transport: AdminTransport = { fetchJson, newId: () => `${Math.round(Date.now() + offset)}:${uuid()}`, now: () => Math.round(Date.now() + offset) }
