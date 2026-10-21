// The installed app (the Play Store app, or Add to Home Screen) registers the service worker (public/sw.js) so that a page load with no
// network shows Allworld's own "you are offline" page instead of the browser's error screen. An ordinary browser tab is left without a
// worker, as before (it still gets one when the player switches notifications on). Fetched as a lazy chunk once the game is up.

/** The parts of `window` this touches, so a test can hand in a stand-in. */
export type OfflineWindow = { navigator?: Pick<Navigator, 'serviceWorker'> | undefined; matchMedia?: ((query: string) => { matches: boolean }) | undefined; document?: { referrer: string } | undefined }

/** True inside an installed app: display mode standalone (or fullscreen), or opened by an Android app (the Play Store build). */
export function installedApp(win: OfflineWindow = globalThis): boolean {
  const display = (mode: string): boolean => { try { return win.matchMedia?.(`(display-mode: ${mode})`).matches === true } catch { return false } }
  return display('standalone') || display('fullscreen') || (win.document?.referrer ?? '').startsWith('android-app://')
}

/** Register the worker in an installed app. Never throws; a browser without service workers simply goes without. */
export async function startOfflineWorker(win: OfflineWindow = globalThis): Promise<boolean> {
  const workers = win.navigator?.serviceWorker
  if (!workers || !installedApp(win)) return false
  try { await workers.register('/sw.js', { scope: '/' }); return true } catch { return false }
}
