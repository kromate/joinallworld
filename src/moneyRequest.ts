/**
 * Requests for money in a direct chat. Shared by the server (server/social/service.ts) and the messages feature
 * (src/app/features/messages/); it is deliberately not part of src/game, which ships in the first download.
 *
 * A request asks a friend for naira. Paying one is an ordinary gift (the same transfer path, caps and daily limits), so
 * nothing here raises or skips a limit; these numbers only bound how many requests can be made and how long one lives.
 */
import type { MoneyRequestState } from './types/social.ts'

export const MONEY_REQUEST = Object.freeze({
  /** How long a request can be paid after it is made. */
  expiresMs: 24 * 3600000,
  /** The longest note, in characters. */
  noteMax: 60,
  /** Open requests from one player to one friend at a time. */
  openPerPair: 1,
  /** Requests from one player to one friend in a rolling day. */
  perPairPerDay: 3,
  /** Requests from one player in a rolling day, to anyone. */
  perDay: 10,
  /** Requests made in a minute by one player. */
  perMinute: 5,
  /** Requests kept on the server at once; a closed or expired one is forgotten after `keepMs` from when it was made. */
  stored: 500,
  keepMs: 2 * 24 * 3600000,
});

/** The state a request is in at `at`: an open request past its time is expired, whether or not anything has been written. */
export const moneyRequestStateAt = (request: { state: Exclude<MoneyRequestState, 'expired'>; expires: number }, at: number): MoneyRequestState =>
  request.state === 'open' && at >= request.expires ? 'expired' : request.state;
