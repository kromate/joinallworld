// What the page does when the server closes its social socket because the session changed under it (signed out on another
// device, or the account now plays another character). Fetched only then: nothing here is needed before it happens.
import { STORAGE_KEY } from '../../storage-key.ts'
import type { Game } from './game.ts'

/** What it says before it starts again because its session changed under it (server/routes/auth.ts closes its socket with 4401). */
export const SIGNED_OUT_TEXT = 'You were signed out on another device.'
export const CHARACTER_CHANGED_TEXT = 'Your account is playing another character now.'
let leaving = false
/** Ask the server which session this is; when it is not the one the page holds, say so, drop the saved life and start again. */
export async function sessionMoved(game: Game): Promise<void> {
  if (leaving) return
  const held = game.session.value?.id ?? null
  let now: string | null
  try { now = (await game.fetchJson<{ session: { id: string } }>('/api/session')).session.id }
  catch (error) { if ((error as { status?: number }).status !== 401) return; now = null }
  if (now === held || leaving) return
  leaving = true
  game.stop()
  game.toast(now === null ? SIGNED_OUT_TEXT : CHARACTER_CHANGED_TEXT)
  globalThis.setTimeout(() => {
    try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* nothing was kept */ }
    try { globalThis.location?.reload() } catch { /* the next request says so */ }
  }, 1800)
}
