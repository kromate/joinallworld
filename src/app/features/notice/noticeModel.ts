// What the "update is coming" banner says and when. Pure: the page's own wording is here, so a server frame can only choose the
// number of minutes (server/notice.ts). The reactive state and the socket are in noticeStore.ts.
import type { NoticeFrame } from '../../../types/notice.ts'
import type { PlayerRef } from '../../../types/protocol.ts'

/** A reconnection this long after the window ended still counts as the update the notice announced. */
export const AFTER_MS = 10 * 60000
/** "Allworld has been updated" stays this long unless it is dismissed. */
export const UPDATED_SHOWN_MS = 2 * 60000

/** A running notice, on this page's own clock. */
export interface UpdateNotice { id: string; build: string; endsAt: number; minutes: number }
/** The update happened; `cut` is who the player was talking to when it cut the call. */
export interface UpdatedNotice { at: number; cut: PlayerRef | null }
export interface NoticeState { notice: UpdateNotice | null; dismissedId: string; updated: UpdatedNotice | null }

export type NoticeView =
  | { kind: 'none' }
  | { kind: 'updating'; minutes: number; text: string; callLine: string | null; id: string }
  | { kind: 'updated'; text: string; callAgain: PlayerRef | null }

export const CALL_LINE = 'Calls end when it updates — you can call again right after.'
export const UPDATED_TEXT = 'Allworld has been updated.'

/** The frame's end placed on this page's clock (the page's clock and the server's need not agree). */
export function noticeOf(frame: Pick<NoticeFrame, 'id' | 'minutes' | 'until' | 'serverTime' | 'build'>, now: number): UpdateNotice {
  return { id: frame.id, build: frame.build, minutes: frame.minutes, endsAt: now + Math.max(0, frame.until - frame.serverTime) }
}
/** Whole minutes left, at least 1 while the notice runs. */
export const minutesLeft = (endsAt: number, now: number): number => Math.max(1, Math.ceil((endsAt - now) / 60000))
export const updatingText = (minutes: number): string => `Allworld is updating in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. You will stay signed in and reconnect on your own.`

/** Is the notice still the one to show (a window that passed, or one dismissed, shows nothing)? */
export const running = (state: NoticeState, now: number): boolean => Boolean(state.notice) && state.notice !== null && now < state.notice.endsAt && state.dismissedId !== state.notice.id
export const updatedShowing = (state: NoticeState, now: number): boolean => state.updated !== null && now - state.updated.at < UPDATED_SHOWN_MS
/** Whether anything of the banner is on screen: the page fetches the banner itself only then. */
export const shown = (state: NoticeState, now: number): boolean => updatedShowing(state, now) || running(state, now)

/** What the banner shows. `busy`: the player is in a call or has a ping waiting, which the update would end. */
export function noticeView(state: NoticeState, now: number, busy: boolean): NoticeView {
  if (state.updated && updatedShowing(state, now)) return { kind: 'updated', text: UPDATED_TEXT, callAgain: state.updated.cut }
  if (!state.notice || !running(state, now)) return { kind: 'none' }
  const minutes = minutesLeft(state.notice.endsAt, now)
  return { kind: 'updating', minutes, text: updatingText(minutes), callLine: busy ? CALL_LINE : null, id: state.notice.id }
}

/** After a reconnection: is the host running another build than the one that announced the update? An unreadable answer is "not known". */
export function wasUpdated(notice: UpdateNotice | null, freshBuild: unknown, now: number): boolean {
  if (!notice || typeof freshBuild !== 'string' || !freshBuild) return false
  return now < notice.endsAt + AFTER_MS && freshBuild !== notice.build
}
