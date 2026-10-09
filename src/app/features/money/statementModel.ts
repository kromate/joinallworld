// What the Statement app says, worked out from view.wallet and the server's own statement. Pure,
// so it is tested without a browser. Nothing here changes anything.
import { WEEKDAYS, lagosDayStart } from '../../../game/clock.ts'
import type { WalletStatement } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A Lagos day as 'Mon 5 Oct'. */
export function dayLabel(day: number): string {
  const local = new Date(lagosDayStart(day) + 3600000)
  return `${(WEEKDAYS[local.getUTCDay()] ?? '').slice(0, 3)} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()] ?? ''}`
}

export const changes = (count: number): string => `${count} change${count === 1 ? '' : 's'}`

/** The server and local statement summaries agree; this does not compare retained line history. */
export function sameStatement(server: Pick<WalletStatement, 'reconciled' | 'closing' | 'opening' | 'totals'>, mine: Pick<WalletStatement, 'reconciled' | 'opening' | 'totals'>, cash: number): boolean {
  return server.reconciled
    && mine.reconciled
    && server.closing === cash
    && server.opening.balance === mine.opening.balance
    && server.opening.day === mine.opening.day
    && server.totals.in === mine.totals.in
    && server.totals.out === mine.totals.out
    && server.totals.changes === mine.totals.changes
    && server.totals.net === mine.totals.net
}

export interface Verdict { cityId: string; ok: boolean; text: string }

/** The sentence under the check button once the server has answered. */
export function verdictOf(cityId: string, server: Pick<WalletStatement, 'closing' | 'totals'>, same: boolean): Verdict {
  return { cityId, ok: same, text: same
    ? `The server’s own statement agrees: closing balance ${money(server.closing)}, ${changes(server.totals.changes)}, reconciled.`
    : `The server’s statement closes at ${money(server.closing)}. If what you see here differs, wait a moment for this screen to catch up and check again.` }
}

/** The sentence when the check could not be made. */
export const failedVerdict = (cityId: string, status: unknown): Verdict => ({ cityId, ok: false, text: status === 429 ? 'You have checked several times this minute. Try again shortly.' : 'The server could not be reached. Nothing changed; try again.' })

/** The rules under "How this statement works". */
export const statementRules = (kept: { lines: number; days: number }): string[] => [
  `The last ${kept.lines} changes are kept line by line and the last ${kept.days} days with activity are kept as daily totals, so older changes stay explained after their lines scroll away.`,
  'Rent and the loan are collected on Saturdays, Nigerian time, even while you are away — they appear here with the date they were due.',
  '“Check with the server” compares this page with the statement the server computes from its own copy. It changes nothing.',
]
