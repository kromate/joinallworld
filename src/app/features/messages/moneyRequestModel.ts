// A request for money in a chat, as plain functions (no DOM, no network): the amount and note a form may send, the state a card
// shows at a given time, the buttons each side gets, and the sentence for a refusal. Tested in moneyRequestModel.test.ts.
import { MONEY_REQUEST, moneyRequestStateAt } from '../../../moneyRequest.ts'
import { money } from '../../ui/format.ts'
import type { MoneyRequestState, MoneyRequestView } from '../../../types/social.ts'

/** What an amount may be: the smallest and largest one gift (the same numbers the gift form shows), when known. */
export interface AmountLimits { min?: number; max?: number }

/** The request a form would send, or the sentence that says what to fix. */
export function checkRequest(amountText: string, noteText: string, limits: AmountLimits = {}): { ok: true; amount: number; note?: string } | { ok: false; reason: string } {
  const text = amountText.trim()
  const amount = /^\d{1,13}$/.test(text) ? Number(text) : NaN
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, reason: 'Enter a whole amount in naira.' }
  if (limits.min !== undefined && amount < limits.min) return { ok: false, reason: `The smallest amount is ${money(limits.min)}.` }
  if (limits.max !== undefined && amount > limits.max) return { ok: false, reason: `The largest amount is ${money(limits.max)}.` }
  const note = noteText.trim()
  if (Array.from(note).length > MONEY_REQUEST.noteMax) return { ok: false, reason: `Keep the note to ${MONEY_REQUEST.noteMax} characters.` }
  return { ok: true, amount, ...(note ? { note } : {}) }
}

/** The state a card shows at `at`: an open request past its time reads as expired even before the server says so. */
export const cardState = (request: Pick<MoneyRequestView, 'state' | 'expiresAt'>, at: number): MoneyRequestState =>
  request.state === 'expired' ? 'expired' : moneyRequestStateAt({ state: request.state, expires: request.expiresAt }, at)

export const STATE_WORDS: Readonly<Record<MoneyRequestState, string>> = { open: 'Open', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' }

export type RequestOp = 'pay' | 'decline' | 'cancel'
/** The buttons a card has: the friend asked can pay or decline, the one who asked can cancel, and a closed card has none. */
export function cardButtons(request: Pick<MoneyRequestView, 'state' | 'expiresAt' | 'mine' | 'payable'>, at: number): RequestOp[] {
  if (cardState(request, at) !== 'open') return []
  return request.mine ? ['cancel'] : request.payable ? ['pay', 'decline'] : ['decline']
}

/** The line above a card's amount: `name` is the other person (the friend asked, or the one asking). */
export const cardTitle = (mine: boolean, name: string): string => (mine ? `You asked ${name}` : `${name} asked you`)
/** Who the other person is on a card: the asker's own message is from them, so their card names the friend of the chat; the friend's names the sender. */
export const otherParty = (mine: boolean, sender: string | null | undefined, partner: string | null | undefined): string => (mine ? partner : sender) || 'your friend'

/** The sentence for a refused request: the server's own wording (the one a gift shows) when it gave one, else a plain one for the code. */
const REFUSALS: Readonly<Record<string, string>> = {
  request_open: 'You already have a request waiting for this friend. Cancel it, or wait for their answer.',
  request_limit: 'You have asked for money as often as you can today. Try again tomorrow.',
  requests_full: 'Too many requests are open right now. Try again later.',
  rate_limited: 'Too many requests in a minute. Wait, then try again.',
  friends_only: 'You can only deal in money with friends.',
  request_expired: 'That request has expired.',
  request_paid: 'That request was already paid.',
  request_declined: 'That request was already declined.',
  request_cancelled: 'That request was already cancelled.',
  unknown_request: 'That request was not found.',
  network: 'Connection lost. Reconnect to check the latest state.',
}
export const refusalText = (code: string, reason?: string): string => (reason && reason.trim() ? reason : REFUSALS[code] ?? 'That could not be done. Nothing was changed.')

/** What a success says in a toast. */
export const doneText = (op: RequestOp, amount: number, name: string): string =>
  op === 'pay' ? `Paid ${money(amount)} to ${name}` : op === 'decline' ? 'Request declined' : 'Request cancelled'
