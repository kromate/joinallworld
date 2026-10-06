// What every admin screen shares and a screen of its own cannot keep: the toasts that say how a change went, the list of what this admin just
// did (with Undo for the changes that can be reversed), the route (which screen, which player) and the saved searches. Plain reactive state.
import { reactive } from 'vue'

export type ViewId = 'dashboard' | 'players' | 'announce' | 'world' | 'moderation' | 'audit'
export const VIEWS: readonly { id: ViewId; label: string; short: string; key: string; title: string }[] = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', key: 'd', title: 'Dashboard' },
  { id: 'players', label: 'Players', short: 'Players', key: 'p', title: 'Players' },
  { id: 'announce', label: 'Announcements', short: 'News', key: 'a', title: 'Announcements' },
  { id: 'world', label: 'World tools', short: 'World', key: 'w', title: 'World tools' },
  { id: 'moderation', label: 'Moderation', short: 'Mod', key: 'm', title: 'Moderation queue' },
  { id: 'audit', label: 'Audit log', short: 'Audit', key: 'l', title: 'Audit log' },
]

export interface Route { view: ViewId; player: string | null; tab: string | null }
/** `#/players/<id>/<tab>` and the like, for the admin address (where a link can be shared with another admin). */
export function parseRoute(hash: string): Route {
  const [, first = '', second = '', third = ''] = hash.replace(/^#/, '').split('/')
  const view = VIEWS.find((item) => item.id === first)?.id ?? 'dashboard'
  return { view, player: view === 'players' && /^[0-9a-f-]{8,40}$/i.test(second) ? second.toLowerCase() : null, tab: view === 'players' && /^[a-z]{3,12}$/.test(third) ? third : null }
}
export const hashOf = (route: Route): string => `#/${route.view}${route.player ? `/${route.player}${route.tab ? `/${route.tab}` : ''}` : ''}`

export interface Toast { id: number; kind: 'ok' | 'error' | 'info'; text: string }
export interface Done { id: number; at: number; text: string; ok: boolean; undo?: { label: string; run: () => Promise<{ ok: boolean; text: string }> }; undone?: boolean }

export const ui = reactive<{ toasts: Toast[]; done: Done[]; drawer: boolean; help: boolean; recent: string[]; route: Route; crumb: string }>({ toasts: [], done: [], drawer: false, help: false, recent: [], route: { view: 'dashboard', player: null, tab: null }, crumb: '' })
let seq = 0
export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const made: Toast = { id: ++seq, kind, text }
  ui.toasts.push(made)
  setTimeout(() => { const at = ui.toasts.indexOf(made); if (at >= 0) ui.toasts.splice(at, 1) }, kind === 'error' ? 9000 : 4500)
}
/** Note one change in "what just happened" (the last 30 of this visit), and say how it went. */
export function recordDone(text: string, ok: boolean, undo?: Done['undo']): Done {
  const made: Done = { id: ++seq, at: Date.now(), text, ok, ...(undo ? { undo } : {}) }
  ui.done.unshift(made); ui.done.length = Math.min(ui.done.length, 30)
  toast(text, ok ? 'ok' : 'error')
  return made
}
export async function undo(entry: Done): Promise<void> {
  if (!entry.undo || entry.undone) return
  const result = await entry.undo.run()
  if (result.ok) entry.undone = true
  recordDone(result.text, result.ok)
}

const RECENT_KEY = 'jaw-admin-recent'
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }
export function loadRecent(): void { try { const raw = JSON.parse(storage()?.getItem(RECENT_KEY) ?? '[]') as unknown; ui.recent = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(0, 8) : [] } catch { ui.recent = [] } }
/** A search that was run: kept (on this browser only) for next time. */
export function rememberSearch(text: string): void {
  const clean = text.trim().slice(0, 64)
  if (clean.length < 2) return
  ui.recent = [clean, ...ui.recent.filter((item) => item !== clean)].slice(0, 8)
  try { storage()?.setItem(RECENT_KEY, JSON.stringify(ui.recent)) } catch { /* kept for this visit */ }
}
