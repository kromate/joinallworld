// The page's side of the "update is coming" notice (server/notice.ts, noticeModel.ts): the frame is kept, a clock ticks only while
// there is something to show, and when the socket comes back after a drop the host's build is compared with the one that announced
// the update. Always loaded and small; the banner itself (NoticeBanner.vue) is fetched when there is something to show.
import { reactive, watch } from 'vue'
import { onSocketClose, onSocketOpen } from '../social/useSocial.ts'
import { callActive, callStore } from '../calls/callState.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import type { NoticeFrame } from '../../../types/notice.ts'
import { AFTER_MS, noticeOf, wasUpdated } from './noticeModel.ts'
import type { NoticeState } from './noticeModel.ts'

export const noticeUi = reactive<NoticeState & { now: number }>({ notice: null, dismissedId: '', updated: null, now: Date.now() })

/** Keep a notice frame (the same id again changes nothing the player did, such as dismissing it). */
export function takeNotice(frame: NoticeFrame, now = Date.now()): void {
  if (frame.type !== 'notice' || frame.kind !== 'update' || !Number.isFinite(frame.until) || !Number.isFinite(frame.serverTime) || typeof frame.id !== 'string') return
  noticeUi.now = now
  if (noticeUi.notice?.id !== frame.id) noticeUi.notice = noticeOf(frame, now)
  else noticeUi.notice = { ...noticeOf(frame, now), build: noticeUi.notice.build }
}
export function dismissNotice(): void {
  if (noticeUi.updated) noticeUi.updated = null
  else if (noticeUi.notice) noticeUi.dismissedId = noticeUi.notice.id
}
/** The player's call was cut: the update has happened. */
export function markUpdated(cut: PlayerRef | null, now = Date.now()): void {
  noticeUi.updated = { at: now, cut }
  noticeUi.notice = null
  noticeUi.now = now
}

let last: { peer: PlayerRef; active: boolean; at: number } | null = null
/** Who the player was talking to when the connection dropped (a call that ended in the last few seconds counts: the drop ended it). */
export function cutCall(now = Date.now()): PlayerRef | null { return last && (last.active || now - last.at < 3000) ? last.peer : null }
let cut: PlayerRef | null = null

/** Ask the host which build it runs. Once more after a short wait when the first answer is not readable (a host still starting). */
export async function checkBuild(fetcher: typeof fetch = globalThis.fetch.bind(globalThis), now: () => number = Date.now, wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<void> {
  const notice = noticeUi.notice
  if (!notice || now() >= notice.endsAt + AFTER_MS) return
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher('/api/health', { cache: 'no-store' })
      const body = response.ok ? await response.json() as { build?: unknown } : null
      if (body && typeof body.build === 'string') { if (wasUpdated(notice, body.build, now())) markUpdated(cut, now()); return }
    } catch { /* try again once */ }
    await wait(3000)
  }
}

let clock: ReturnType<typeof setInterval> | null = null
function keepClock(): void {
  if (clock) return
  clock = setInterval(() => {
    noticeUi.now = Date.now()
    if (noticeUi.notice && noticeUi.now >= noticeUi.notice.endsAt + AFTER_MS) noticeUi.notice = null
    if (!noticeUi.notice && !noticeUi.updated && clock) { clearInterval(clock); clock = null }
  }, 10000)
}

/** A `notice` frame from the socket, passed on by NoticeHost.vue; the first one starts the listening below. */
export function receiveNotice(frame: { type: string }): void {
  start()
  takeNotice(frame as NoticeFrame)
  keepClock()
}

let listening = false
function start(): void {
  if (listening) return
  listening = true
  onSocketClose(() => { cut = noticeUi.notice ? cutCall() : null })
  onSocketOpen((again) => { if (again && noticeUi.notice) { void checkBuild().then(() => { if (noticeUi.updated) keepClock() }) } })
  // Sync: the call's view changes in the same turn that the socket closes, before anything else can look.
  const see = (view: typeof callStore.view): void => {
    if (callActive(view) && view.peer) last = { peer: { id: view.peer.id, name: view.peer.name }, active: true, at: Date.now() }
    else if (last?.active) last = { ...last, active: false, at: Date.now() }
  }
  see(callStore.view) // a call already under way when the first notice arrived
  watch(() => callStore.view, see, { flush: 'sync' })
}
