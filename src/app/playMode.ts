// A Play Store visit is named by the Android shell's referrer or its launch address. The answer is kept for this tab so later navigation
// cannot turn the app mode off. Add-to-Home-Screen and other standalone browser visits do not carry either signal and stay ordinary web.
export const PLAY_MODE_KEY = 'allworld-app-source'
const PLAY_MODE = 'play'
const WEB_MODE = 'web'
let browserDecisionWithoutStorage: boolean | null = null

interface SessionStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PlayModeEnvironment {
  readonly href: string
  readonly referrer: string
  readonly storage: SessionStore | null
}

function browserEnvironment(): PlayModeEnvironment {
  let href = '', referrer = ''
  let storage: SessionStore | null = null
  // The address this tab was opened with (the game rewrites the address bar later), else the current one.
  try { href = (globalThis.performance?.getEntriesByType?.('navigation')[0]?.name ?? globalThis.location?.href) || '' } catch { /* no browser address */ }
  try { referrer = globalThis.document?.referrer ?? '' } catch { /* no document */ }
  try { storage = globalThis.sessionStorage ?? null } catch { /* storage is unavailable */ }
  return { href, referrer, storage }
}

function playAddress(href: string): boolean {
  try { return new URL(href).searchParams.get('utm_source') === PLAY_MODE } catch { return false }
}

function playReferrer(referrer: string): boolean {
  try {
    const url = new URL(referrer)
    return url.protocol === 'android-app:' && url.hostname === 'com.joinallworld.app'
  } catch { return false }
}

function markPage(play: boolean): void {
  try { globalThis.document?.documentElement?.setAttribute('data-allworld-app', play ? PLAY_MODE : WEB_MODE) } catch { /* no document */ }
}

/** True only for this tab's Play-shell launch. Safe in Node, private browsing and browsers that refuse storage. */
export function isPlayApp(environment?: PlayModeEnvironment): boolean {
  const browserCall = environment === undefined
  const current = environment ?? browserEnvironment()
  let remembered: string | null = null
  let storageWorks = current.storage !== null
  try { remembered = current.storage?.getItem(PLAY_MODE_KEY) ?? null } catch { storageWorks = false }
  if (remembered === PLAY_MODE || remembered === WEB_MODE) {
    const play = remembered === PLAY_MODE
    markPage(play)
    return play
  }
  if (browserCall && !storageWorks && browserDecisionWithoutStorage !== null) {
    markPage(browserDecisionWithoutStorage)
    return browserDecisionWithoutStorage
  }
  const play = playAddress(current.href) || playReferrer(current.referrer)
  try { current.storage?.setItem(PLAY_MODE_KEY, play ? PLAY_MODE : WEB_MODE) } catch { storageWorks = false }
  if (browserCall && !storageWorks) browserDecisionWithoutStorage = play
  markPage(play)
  return play
}

/** The server's second guard: every app-mode API request carries this header. */
export function playRequestHeaders(environment?: PlayModeEnvironment): Record<string, string> {
  return isPlayApp(environment) ? { 'X-Allworld-App': PLAY_MODE } : {}
}

const wrapped = new WeakSet<typeof fetch>()

/**
 * Called once the game is up (startExtras.ts): marks the page, then wraps this window's fetch for the site's own API paths (the game
 * client looks fetch up on every request, src/client.ts).
 * Inside the Play app every API request carries the app header (the server's second guard). When the server refuses a sharing action
 * because this player has not agreed to the rules yet (server/sharing-policy.ts), the agree sheet opens once and, if they agree, the
 * same request is sent again. Everything else passes through untouched, so the core client stays out of the first download's way.
 */
export function startPlayMode(target: { fetch?: typeof fetch } = globalThis): void {
  isPlayApp()
  const original = target.fetch
  if (!original || wrapped.has(original)) return
  const send = (input: string, init: RequestInit | undefined): Promise<Response> => {
    if (!isPlayApp()) return original.call(target, input, init)
    const headers = new Headers(init?.headers)
    headers.set('X-Allworld-App', PLAY_MODE)
    return original.call(target, input, { ...init, headers })
  }
  const api: typeof fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) return original.call(target, input, init)
    const response = await send(input, init)
    if (response.status !== 403 || input.startsWith('/api/sharing/terms') || (typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream)) return response
    let code: unknown
    try { code = ((await response.clone().json()) as { code?: unknown }).code } catch { return response }
    if (code !== 'sharing_terms_required') return response
    const actor = new Headers(init?.headers).get('X-Allworld-Actor') ?? ''
    const { agreeToShare } = await import('./features/terms/agree.ts')
    const agreed = await agreeToShare(async (path, options) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(actor ? { 'X-Allworld-Actor': actor } : {}) }
      const answer = await send(path, { method: options?.method ?? 'GET', credentials: 'same-origin', headers, ...(options?.body ? { body: JSON.stringify(options.body) } : {}) })
      const body: unknown = await answer.json()
      if (!answer.ok || body === null || typeof body !== 'object') throw Error('Your agreement could not be checked. Try again.')
      return body
    }, actor)
    // The first request's time limit may have run out while the sheet was open, so the repeat goes without it.
    return agreed ? send(input, { ...init, signal: null }) : response
  }
  wrapped.add(api)
  target.fetch = api
}
