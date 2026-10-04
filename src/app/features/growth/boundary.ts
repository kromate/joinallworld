// The typed boundary of the growth screens to the JavaScript they still run on: the share module
// (fetched the first time something is shared, never with the first download), the web-push
// client, the events calendar, the away-card rule and the device token. Every cast for these
// modules is here; a module that becomes TypeScript loses its lines here.
import { EMAIL_CONSENT as EMAIL_CONSENT_JS, PUSH_CONSENT as PUSH_CONSENT_JS } from '../../../game/outreach.ts'
import { deviceToken as deviceTokenJs } from '../../../quick-start/entry.js'
import type { PushSubscriptionLike, ShareFacts } from '../../../types/growth.ts'

// ---- the share module (src/ui/share.js) ----------------------------------------------------
/** Everything a share needs, prepared once: the text, the link and the picture. */
export interface PreparedShare {
  text: string
  link: string
  file: File | null
  /** A blob URL of the picture: revoke it when it is replaced or the session changes. */
  url: string | null
  whatsapp: string
  x: string
}
export type SystemShareOutcome = 'shared' | 'cancelled' | 'unavailable'
export interface ShareModule {
  prepareShare(facts: ShareFacts, link: string): Promise<PreparedShare>
  systemShare(prepared: PreparedShare): Promise<SystemShareOutcome>
  copyText(text: string): Promise<boolean>
}
/** The canvas painter and the share calls are fetched the first time something is shared. */
export const loadShareModule = (): Promise<ShareModule> => import('../../../ui/share.js') as unknown as Promise<ShareModule>

// ---- web push (src/ui/push-client.js) ------------------------------------------------------
export type PushKind = 'ready' | 'unsupported' | 'needs-install' | 'blocked'
export type EnablePushResult = { ok: true; subscription: PushSubscriptionLike } | { ok: false; code: 'declined' | 'blocked' | 'unsupported' | 'failed' }
export interface PushModule {
  pushState(): PushKind
  enablePush(publicKey: string): Promise<EnablePushResult>
  disablePush(): Promise<string | null>
}
/** Fetched on the first tap on a notification control, not with the screen. */
export const loadPushModule = (): Promise<PushModule> => import('../../../ui/push-client.js') as unknown as Promise<PushModule>

export { upcomingEvents, eventIcs, awayCard } from './rulesBoundary.ts'
export type { AwayCard, AwayLine } from './rulesBoundary.ts'

// ---- consent wording (src/game/outreach.js) ------------------------------------------------
export const EMAIL_CONSENT: string = EMAIL_CONSENT_JS
export const PUSH_CONSENT: string = PUSH_CONSENT_JS

// ---- this device -----------------------------------------------------------------------------
/** A random token made once per browser (localStorage 'allworld-device'); the server keeps only a salted hash. */
export const deviceToken = deviceTokenJs as unknown as () => string
