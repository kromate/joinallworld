// The few civic rules the panel registry needs before any panel has loaded (the Governor badge, the
// wording of a failed request): kept apart from civicModel.ts so the first download stays small.
import type { CivicNotice } from '../../../types/civic.ts'

const MESSAGES: Readonly<Record<string, string>> = {
  civic_rate_limited: 'You are doing that too quickly. Wait a minute and try again.',
  rate_limited: 'Too many requests from this network. Wait a minute and try again.',
  device_session_required: 'Your device session is missing or expired. Reconnect first.',
  invalid_city: 'That city is not available.',
  body_too_large: 'That is too much text.',
}
/** The sentence for a failed request: the server's own reason, else ours by code, else the error's message. */
export function explain(error: unknown): string {
  const item = (typeof error === 'object' && error !== null ? error : {}) as { reason?: unknown; code?: unknown; message?: unknown }
  const code = typeof item.code === 'string' ? item.code : ''
  return (typeof item.reason === 'string' && item.reason) || MESSAGES[code] || (typeof item.message === 'string' && item.message) || 'The server could not be reached. Try again.'
}

/**
 * City news that is new to THIS life and that the player has not opened the Governor app for yet.
 * News from before the life began in the city (`since`) never counts, so a brand-new life starts with no badge.
 */
export function unseenNews(notices: readonly Pick<CivicNotice, 'at'>[] | null | undefined, { readAt = 0, since = null }: { readAt?: number; since?: number | null } = {}): number {
  if (!Array.isArray(notices) || since === null || !Number.isFinite(since)) return 0
  const read = Number(readAt) || 0
  return notices.filter((item) => Number.isFinite(item?.at) && item.at >= since && item.at > read).length
}

export const pulseKey = (cityId: string): string => `pulse:${cityId}`
