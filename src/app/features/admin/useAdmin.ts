// The admin app's one way to talk to the server: reads, and writes that each carry a client id which is kept until the write is answered, so
// pressing again after a lost answer repeats the SAME request (the server applies it once).
import { reactive } from 'vue'
import { adminTransport } from './transport.ts'
import type { AdminJson, AdminMe } from '../../../types/admin.ts'

export interface Failure { status: number; code: string; reason: string }
export type Reply<T> = { ok: true; data: T } | { ok: false; error: Failure }
const failureOf = (error: unknown): Failure => {
  const e = error as { status?: number; code?: string; reason?: string; message?: string }
  return { status: e.status ?? 0, code: e.code ?? 'network', reason: e.reason || (e.code === 'rate_limited' ? 'Too many requests. Wait a minute.' : e.message || 'Something went wrong.') }
}
export const admin = reactive<{ me: AdminMe | null }>({ me: null })

export function useAdmin() {
  const transport = adminTransport()
  const fetchJson = transport.fetchJson
  const pending = new Map<string, string>()
  const q = (query: Record<string, string | number | undefined>): string => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : '' }
  return {
    get: async <T = AdminJson>(path: string, query: Record<string, string | number | undefined> = {}): Promise<Reply<T>> => {
      try { return { ok: true, data: await fetchJson<T>(path + q(query)) } } catch (error) { return { ok: false, error: failureOf(error) } }
    },
    /** `intent` names what the admin is doing; its client id is reused until the server has answered for good. */
    post: async <T = AdminJson>(path: string, body: Record<string, unknown>, intent: string): Promise<Reply<T>> => {
      const clientId = pending.get(intent) ?? transport.newId()
      pending.set(intent, clientId)
      try {
        const data = await fetchJson<T>(path, { method: 'POST', body: { ...body, clientId } })
        const code = (data as { code?: string }).code
        if (code !== 'confirmation_required') pending.delete(intent)
        return { ok: true, data }
      } catch (error) {
        const failure = failureOf(error)
        if (failure.status >= 400 && failure.status < 500) pending.delete(intent)
        return { ok: false, error: failure }
      }
    },
    forget: (intent: string): void => { pending.delete(intent) },
    now: (): number => transport.now(),
  }
}
