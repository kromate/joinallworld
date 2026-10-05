// The always-loaded part of Ping: it keeps a join link the page was opened with, listens on the social socket, and says
// when the notices (PingNotices.vue, fetched then) have something to show. Until a ping arrives or a link is opened, Ping
// costs this one small file.
//
// KEPT ON THIS DEVICE   allworld-ping-join  { token, at }   the token of a join link (/j/<token>), until it has been
//                       answered or is an hour old. It is not a credential: the server honours it only for the signed-in
//                       player it was made for, and opening it signs nobody in.
import { reactive, watch } from 'vue'
import { onCallFrame, social } from '../social/useSocial.ts'
import type { PingServerFrame } from '../../../types/ping.ts'

const KEY = 'allworld-ping-join'
/** A join link is good for an hour (src/game/ping.ts PING.liveMinutes); one kept longer is dropped unread. */
const KEEP_MS = 60 * 60000
const TOKEN = /^\/j\/([A-Za-z0-9_-]{95})\/?$/

export const pingUi = reactive<{ /** There is something to show: the notices are fetched. */ wanted: boolean; /** Frames not yet taken by the notices. */ frames: PingServerFrame[]; /** A join is moving the player: the city's own arrival sheet stays closed. */ arriving: boolean }>({ wanted: false, frames: [], arriving: false })

/** The token of a join link in an address path, or null. */
export const tokenFrom = (pathname: unknown): string | null => TOKEN.exec(String(pathname ?? ''))?.[1] ?? null

function store(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }
let memory: { token: string; at: number } | null = null
/** The join link this device is holding, or null. */
export function keptToken(now = Date.now()): string | null {
  let kept = memory
  try { const text = store()?.getItem(KEY); if (text) kept = JSON.parse(text) as { token: string; at: number } } catch { /* what is in memory */ }
  if (!kept || typeof kept.token !== 'string' || !(now - Number(kept.at) < KEEP_MS) || tokenFrom(`/j/${kept.token}`) === null) { if (kept) forgetToken(); return null }
  return kept.token
}
export function forgetToken(): void { memory = null; try { store()?.removeItem(KEY) } catch { /* nothing was kept */ } }
/** Read the address once: a join link is kept and the address goes back to '/', so a reload does not open it twice. */
export function captureToken(address: { pathname: string } | undefined = globalThis.location, now = Date.now()): string | null {
  const token = tokenFrom(address?.pathname)
  if (!token) return null
  memory = { token, at: now }
  try { store()?.setItem(KEY, JSON.stringify(memory)) } catch { /* kept in memory for this visit */ }
  try { globalThis.history?.replaceState(null, '', '/') } catch { /* the address stays as it was */ }
  return token
}
captureToken()

const isPingFrame = (frame: { type: string }): frame is PingServerFrame => frame.type === 'ping-incoming' || frame.type === 'ping-joined' || frame.type === 'ping-ended'
let listening = false
/** Start listening. Idempotent. */
export function startPing(): void {
  if (listening) return
  listening = true
  if (keptToken() !== null) pingUi.wanted = true
  onCallFrame((frame) => { if (isPingFrame(frame)) { pingUi.frames.push(frame); pingUi.wanted = true } })
  // Back after a ping, or after a friend came through the player's link: the line in Updates says so, and the notices then ask the server what is still live.
  watch(() => social.me?.updates, (updates) => {
    const hour = Date.now() - KEEP_MS
    if (!pingUi.wanted && (updates ?? []).some((update) => !update.read && (update.kind === 'ping' || update.kind === 'invite-joined') && update.at > hour)) pingUi.wanted = true
  })
}
