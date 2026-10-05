/**
 * The "update is coming" notice (server/notice.ts): the one announcement that can be made, and the frame that carries it.
 * It names a number of minutes and nothing else: the wording is the page's own.
 */
import type { HostErrorCode, JsonBodyErrorCode, Ok } from './protocol.ts'

/** What an announcer signs and sends. The signature covers every other field (server/notice.ts noticeText). */
export interface NoticeBody { kind: 'update'; minutes: number; issuedAt: number; nonce: string; sig: string }
/** To every open socket when a notice is accepted, and to a socket that opens while one is running. */
export interface NoticeFrame {
  type: 'notice'
  kind: 'update'
  /** The announcement's nonce: the same id is the same notice. */
  id: string
  minutes: number
  /** Server ms the notice ends. */
  until: number
  /** Server ms when the frame was made, so a page can place `until` on its own clock. */
  serverTime: number
  /** The build the server was running when it announced. */
  build: string
}
export interface NoticeResponse { ok: true; minutes: number; until: number }
export interface NoticeHttpRoutes {
  'POST /api/notice': {
    body: NoticeBody
    response: Ok<NoticeResponse>
    errors: HostErrorCode | JsonBodyErrorCode | 'invalid_notice' | 'notice_stale' | 'notice_replayed' | 'notice_unverified' | 'notice_rate_limited'
  }
}
