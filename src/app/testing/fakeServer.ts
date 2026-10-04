// A stand-in for the game server, for tests of the new shell: the three core routes (session,
// life, action) answered by the real rules engine, in process. It keeps the server's promises the
// client depends on — a session cookie is not needed, an action id is applied once and a repeat
// returns the first outcome, every answer carries `serverTime` — and lets a test break things on
// purpose: go offline, lose the session, fail to save. A life it creates is made the way the real
// server makes one for a session opened with `onboarding: true`: a guest of the quick start, held
// until its look is confirmed (server/life-service.ts settleCity).
import { advanceLife, createLife, dispatch } from '../../life.ts'
import type { LifeState } from '../../types/life.ts'

interface Outcome { ok: boolean; code: string; state: LifeState; reason?: string }
const engine = {
  createLife: createLife as unknown as (saved: unknown, ctx: { now: number; cityId: string; isNew?: boolean; quickStart?: boolean }) => LifeState,
  dispatch: dispatch as unknown as (state: LifeState, body: { type: string; payload?: unknown; actionId?: string }, ctx: { now: number; cityId: string }) => Outcome,
  advanceLife: advanceLife as unknown as (state: LifeState, dt: number, ctx: { now: number; cityId: string }) => Outcome,
}

export const ONBOARDING: readonly (readonly [string, Record<string, unknown>])[] = [
  ['onboarding.look', { look: { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' } }],
  ['onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }],
  ['onboarding.dream', { dream: 'yaba-unicorn' }],
  ['onboarding.lottery', {}],
  ['onboarding.home', { house: 'yaba' }],
]

export interface FakeServerOptions {
  /** Server time. Advance it with `tick()`. */
  now?: number
  /** Start with a session and a life that has finished character creation. */
  onboarded?: boolean
  name?: string
}
export interface SentRequest { method: string; path: string; body: Record<string, unknown> | null }

export function createFakeServer({ now: start = Date.UTC(2026, 0, 5, 9), onboarded = true, name = 'Kunle' }: FakeServerOptions = {}) {
  let now = start
  let session: { id: string; name: string } | null = null
  let state: LifeState | null = null
  const receipts = new Map<string, { ok: boolean; code: string }>()
  const requests: SentRequest[] = []
  /** What the next requests do instead of being answered. */
  const fault = { offline: false, storageFailing: false, status: 0 }
  const routes = new Map<string, (request: SentRequest) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>>()
  const ctx = (): { now: number; cityId: string } => ({ now, cityId: 'lagos' })

  function settle(): LifeState {
    const life = state ?? engine.createLife(null, { ...ctx(), isNew: true, quickStart: true })
    const dt = (now - life.t) / 1000
    if (dt > 0) engine.advanceLife(life, dt, ctx())
    state = life
    return life
  }
  function startSession(nickname: string): void {
    session = { id: `pub-${nickname.toLowerCase()}`, name: nickname }
    state = engine.createLife(null, { ...ctx(), isNew: true, quickStart: true })
    state.name = nickname
  }
  if (onboarded) {
    startSession(name)
    for (const [type, payload] of ONBOARDING) {
      const result = engine.dispatch(settle(), { type, payload, actionId: `${now}:seed-${type}` }, ctx())
      if (!result.ok) throw new Error(`Fake server could not onboard: ${type} → ${result.code}`)
    }
  }

  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), 'http://game.test')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    const request: SentRequest = { method, path: `${url.pathname}${url.search}`, body }
    requests.push(request)
    if (fault.offline) throw new TypeError('fetch failed')
    if (fault.status) return json(fault.status, { error: 'internal_error', serverTime: now })
    const envelope = { serverTime: now, ...(fault.storageFailing ? { storage: 'failing', reason: 'The server cannot save right now.' } : {}) }
    const custom = routes.get(`${method} ${url.pathname}`)
    if (custom) { const answer = await custom(request); return json(answer.status, { ...envelope, ...(answer.body as object) }) }

    if (url.pathname === '/api/session') {
      if (method === 'POST') {
        const wanted = String(body?.name ?? '').trim()
        if (wanted.length < 3) return json(400, { ...envelope, error: 'invalid_name' })
        startSession(wanted)
      }
      return session ? json(200, { ...envelope, session }) : json(401, { ...envelope, error: 'device_session_required' })
    }
    if (!session) return json(401, { ...envelope, error: 'device_session_required' })
    if (url.pathname === '/api/life') return json(200, { ...envelope, state: structuredClone(settle()) })
    if (url.pathname === '/api/action' && method === 'POST') {
      const life = settle()
      const id = String(body?.actionId ?? '')
      const before = receipts.get(id)
      if (before) return json(200, { ...envelope, ...before, state: structuredClone(life), replayed: true })
      let result: Outcome
      try { result = engine.dispatch(life, { type: String(body?.type), payload: body?.payload, actionId: id }, ctx()) } catch { return json(400, { ...envelope, error: 'invalid_action' }) }
      receipts.set(id, { ok: result.ok, code: result.code })
      return json(200, { ...envelope, ok: result.ok, code: result.code, state: structuredClone(result.state) })
    }
    return json(404, { ...envelope, error: 'not_found' })
  }

  return {
    fetch: fetch as typeof globalThis.fetch,
    requests, fault,
    /** Answer one more route: `route('GET /api/support/reports', () => ({ status: 200, body: {...} }))`. */
    route(key: string, handler: (request: SentRequest) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>): void { routes.set(key, handler) },
    now: (): number => now,
    /** Let server time pass. */
    tick(ms: number): void { now += ms },
    /** The life as the server holds it. */
    life: (): LifeState => settle(),
    /** Forget the session, as a server whose data was reset does. */
    dropSession(): void { session = null; state = null },
    session: (): { id: string; name: string } | null => session,
  }
}
export type FakeServer = ReturnType<typeof createFakeServer>

/** A localStorage stand-in. */
export function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)) } }
}
