// Display formatting shared by the Vue components. Pure, so it is tested without a browser.

/** Whole naira with the sign and thousands separators: ₦5,000. */
export const money = (value: unknown): string => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`
/** A signed amount for a ledger line: +₦1,200 or −₦300 (a real minus sign). */
export const signedMoney = (amount: number): string => `${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}`
export const cap = (id: string): string => (id ? `${id.charAt(0).toUpperCase()}${id.slice(1)}` : '')
/** "1 item", "3 items". */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
/** A stable hue (0–359) from an id, so one person keeps one avatar colour. */
export function hueOf(seed: unknown): number {
  let hash = 0
  for (const char of String(seed ?? '')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return hash
}
/** The first letter of a name for an avatar, or '?'. */
export const initialOf = (name: unknown): string => ([...String(name ?? '').trim()][0] ?? '?').toUpperCase()
