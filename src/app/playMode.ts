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
  try { href = globalThis.location?.href ?? '' } catch { /* no browser address */ }
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
