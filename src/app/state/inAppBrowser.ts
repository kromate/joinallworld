// Instagram, Facebook, TikTok, Snapchat and other apps open links in their own small browser. Those often block or wipe storage, so a guest can lose their place.
// When we are inside one and something we need is actually blocked, a short tip asks the player to open the link in their own browser. Nothing is blocked or changed otherwise.
// The tip only appears when BOTH are true (an in-app browser and a blocked feature): a working in-app browser is left alone.
export type InAppName = 'Instagram' | 'Facebook' | 'TikTok' | 'Snapchat' | 'LinkedIn' | 'Twitter' | 'webview'
export type DegradedFeature = 'localStorage' | 'sessionStorage' | 'cookies'
export const TIP_KEY = 'joinallworld-inapp-tip'
export const TIP_WORDS = {
  title: 'Open in your browser for the best experience.',
  detail: 'This app\'s built-in browser may not save your progress. Use its menu to open this page in Chrome or Safari.',
  dismiss: 'Got it',
} as const

const PATTERNS: readonly [InAppName, RegExp][] = [
  ['Instagram', /Instagram/i],
  ['Facebook', /FBAN|FBAV|FB_IAB|FBIOS/],
  ['TikTok', /musical_ly|BytedanceWebview|TikTok/i],
  ['Snapchat', /Snapchat/i],
  ['LinkedIn', /LinkedInApp/],
  ['Twitter', /Twitter/i],
]

/** The app a link was opened in, 'webview' for an unnamed embedded browser, or null for an ordinary browser. */
export function detectInAppBrowser(ua: string, options: { standalone?: boolean } = {}): InAppName | null {
  for (const [name, pattern] of PATTERNS) if (pattern.test(ua)) return name
  if (/; wv\)/.test(ua)) return 'webview'
  // An iPhone browser always says Safari/ in its user agent; an embedded one does not. A home-screen app also does not, and is not embedded.
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && !options.standalone) return 'webview'
  return null
}

type Keeper = Pick<Storage, 'setItem' | 'removeItem'>
export interface InAppEnv {
  /** Each is read lazily because merely touching window.localStorage can throw when storage is blocked. */
  localStorage?: () => Keeper | null | undefined
  sessionStorage?: () => Keeper | null | undefined
  cookiesEnabled?: () => boolean | undefined
}

function canKeep(open: (() => Keeper | null | undefined) | undefined): boolean {
  if (!open) return true
  try {
    const store = open()
    if (!store) return false
    store.setItem('joinallworld-probe', '1')
    store.removeItem('joinallworld-probe')
    return true
  } catch { return false }
}

/** What this browser is not letting the page use. An empty list means everything we need works. */
export function degradedFeatures(env: InAppEnv): DegradedFeature[] {
  const found: DegradedFeature[] = []
  if (!canKeep(env.localStorage)) found.push('localStorage')
  if (!canKeep(env.sessionStorage)) found.push('sessionStorage')
  try { if (env.cookiesEnabled?.() === false) found.push('cookies') } catch { found.push('cookies') }
  return found
}

/** The tip to show, or null. */
export function inAppTip(ua: string, env: InAppEnv, options: { standalone?: boolean } = {}): { app: InAppName; features: DegradedFeature[]; title: string; detail: string; dismiss: string } | null {
  const app = detectInAppBrowser(ua, options)
  if (!app) return null
  const features = degradedFeatures(env)
  return features.length ? { app, features, ...TIP_WORDS } : null
}

/** Lets styles and support see that the page is inside another app's browser (data-inapp="Instagram"). */
export function markInAppBrowser(root: { setAttribute(name: string, value: string): void }, ua: string, options: { standalone?: boolean } = {}): InAppName | null {
  const app = detectInAppBrowser(ua, options)
  if (app) root.setAttribute('data-inapp', app)
  return app
}

/** Whether the player already closed the tip. Storage that is broken (the usual case here) counts as not closed: the tip then lasts until the page is left. */
export function tipDismissed(store: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try { return store?.getItem(TIP_KEY) === '1' } catch { return false }
}

export function dismissTip(store: Pick<Storage, 'setItem'> | null | undefined): void {
  try { store?.setItem(TIP_KEY, '1') } catch { /* the tip is closed for this visit only */ }
}

/** The real browser's facts; every access is guarded because blocked storage throws. */
export function liveInAppEnv(): InAppEnv {
  return {
    localStorage: () => window.localStorage,
    sessionStorage: () => window.sessionStorage,
    cookiesEnabled: () => navigator.cookieEnabled,
  }
}

export const isStandalone = (): boolean => {
  try { return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches } catch { return false }
}
