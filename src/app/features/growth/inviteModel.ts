// What the invite share sheet says about the link and about what the inviter gets, worked out from
// the referral rules the server reports (server/growth/referral.ts; numbers: src/game/content/growth.ts).
// Pure, so it is tested without a browser. Rewards are in-game only, and each condition is stated.
// The sheet's own lines are in inviteLines.ts, fetched with it.

/** The surfaces a share sheet is opened from (telemetry: share_opened). */
export type ShareSurface = 'hud' | 'prompt' | 'phone' | 'table' | 'other'
export const SHARE_SURFACES: readonly ShareSurface[] = Object.freeze(['hud', 'prompt', 'phone', 'table', 'other'])
/** The channels the sheet offers (telemetry: share_channel). */
export type ShareChannel = 'copy' | 'native' | 'whatsapp' | 'x' | 'telegram' | 'qr'

/** The surface a share was opened from, or 'other'. */
export const surfaceOf = (value: unknown): ShareSurface => SHARE_SURFACES.find((surface) => surface === value) ?? 'other'
