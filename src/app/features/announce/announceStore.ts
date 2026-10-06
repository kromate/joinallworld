// Announcements from the people who run the game (src/types/announce.ts), as this page keeps them. Fetched only when the first one
// arrives (AnnounceHost.vue) or when Messages is opened. What has been received and what has been seen is kept in this browser only: the
// server holds one copy of each announcement and writes nothing per player.
import { reactive } from 'vue'
import { useApp } from '../../state/app.ts'
import type { AnnounceFrame, AnnounceItem } from '../../../types/announce.ts'

const KEY = 'allworld.announce.v1', KEEP = 20
interface Saved { items: AnnounceItem[]; seen: string[] }
function load(): Saved {
  try { const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as Partial<Saved> | null; return { items: Array.isArray(raw?.items) ? raw.items.slice(-KEEP) : [], seen: Array.isArray(raw?.seen) ? raw.seen.slice(-KEEP * 2) : [] } } catch { return { items: [], seen: [] } }
}
export const announceUi = reactive<Saved & { banner: AnnounceItem | null }>({ ...load(), banner: null })
const save = (): void => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ items: announceUi.items, seen: announceUi.seen })) } catch { /* storage is full or off: they are simply shown again next time */ } }

/** An announcement frame arrived. `city` is the city this page is in: one for another city is ignored. `now` is the server's clock. */
export function receiveAnnounce(frame: AnnounceFrame, city: string, now: number): void {
  for (const item of frame.items) {
    if (item.city !== null && item.city !== city) continue
    if (item.expiresAt <= now) continue
    if (!announceUi.items.some((known) => known.id === item.id)) announceUi.items = [...announceUi.items, item].slice(-KEEP)
    if (!announceUi.seen.includes(item.id)) announceUi.banner = item
  }
  save()
}
export function dismissAnnounce(): void {
  const item = announceUi.banner
  if (item && !announceUi.seen.includes(item.id)) announceUi.seen = [...announceUi.seen, item.id]
  announceUi.banner = null
  save()
}
/** From the socket (AnnounceHost): the city and the clock are the page's own. */
export function receive(frame: { type: string }): void { const { view } = useApp().game; receiveAnnounce(frame as AnnounceFrame, view.value.cityId, view.value.now) }
/** The lines Messages → Updates shows for announcements, newest first. */
export interface AnnounceLine { key: string; at: number; text: string; fresh: boolean; kind: 'update'; id: string; player?: string }
export const announceLines = (items: readonly AnnounceItem[], seen: readonly string[]): AnnounceLine[] => items.map((item) => ({ key: `a${item.id}`, at: item.at, text: `${item.title}: ${item.body}`, fresh: !seen.includes(item.id), kind: 'update' as const, id: 'announcement' }))
export function resetAnnounce(): void { announceUi.items = []; announceUi.seen = []; announceUi.banner = null; save() }
