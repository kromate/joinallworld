// What the admin app decides without a screen: the action forms, the typed confirmations, time and money wording, and the CSV of the audit log.
// Pure functions, so they are tested without a browser.
import { money } from '../../ui/format.ts'
import type { AuditView } from '../../../types/admin.ts'

export const naira = (value: unknown): string => money(value)
const LAGOS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
/** "12 Oct 14:05" in Lagos time. */
export const absolute = (at: number): string => (at > 0 ? LAGOS.format(new Date(at)).replace(',', '') : '-')
/** "3 min ago", "in 2 h", "just now". */
export function relative(at: number, now: number): string {
  if (!(at > 0)) return 'never'
  const seconds = Math.round((at - now) / 1000), span = Math.abs(seconds)
  if (span < 45) return 'just now'
  const [n, unit] = span < 3600 ? [Math.round(span / 60), 'min'] : span < 86400 ? [Math.round(span / 3600), 'h'] : [Math.round(span / 86400), 'd']
  return seconds < 0 ? `${n} ${unit} ago` : `in ${n} ${unit}`
}
export const bytes = (chars: number): string => (chars < 1024 ? `${chars} B` : chars < 1048576 ? `${(chars / 1024).toFixed(1)} kB` : `${(chars / 1048576).toFixed(2)} MB`)
export const uptime = (ms: number): string => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d` }

export interface Field { key: string; label: string; kind: 'number' | 'text' | 'select' | 'long'; options?: readonly (readonly [string, string])[]; min?: number; max?: number; placeholder?: string; initial?: string | number }
export interface ActionDef { id: string; label: string; help: string; fields: readonly Field[]; reason: 'required' | 'optional' | 'none'; danger?: boolean; /** The word the admin types to confirm a destructive action. */ typed?: string; group: 'money' | 'life' | 'sanction' | 'contact' }
const NEEDS: readonly (readonly [string, string])[] = [['hunger', 'Hunger'], ['energy', 'Energy'], ['fun', 'Fun'], ['social', 'Social'], ['hygiene', 'Hygiene'], ['bladder', 'Bladder']]
export const PLAYER_ACTIONS: readonly ActionDef[] = [
  { id: 'credit', label: 'Credit ₦', group: 'money', help: 'Adds cash with the ledger line "Admin credit: reason". Not counted as earned from work.', fields: [{ key: 'amount', label: 'Amount (₦)', kind: 'number', min: 1, placeholder: '5000' }], reason: 'required' },
  { id: 'debit', label: 'Debit ₦', group: 'money', danger: true, typed: 'DEBIT', help: 'Takes cash with the ledger line "Admin debit: reason". Never below zero: it takes what the balance holds.', fields: [{ key: 'amount', label: 'Amount (₦)', kind: 'number', min: 1 }], reason: 'required' },
  { id: 'heal', label: 'Heal', group: 'life', help: 'Lifts every need that is below 80 up to 80.', fields: [], reason: 'optional' },
  { id: 'need', label: 'Set a need', group: 'life', help: 'Sets one need to a value from 0 to 100.', fields: [{ key: 'need', label: 'Need', kind: 'select', options: NEEDS, initial: 'hunger' }, { key: 'value', label: 'Value', kind: 'number', min: 0, max: 100, initial: 80 }], reason: 'optional' },
  { id: 'teleport', label: 'Move', group: 'life', help: 'Stands the player at the city’s arrival venue or at home, and ends a stuck timed action.', fields: [{ key: 'to', label: 'Where', kind: 'select', options: [['arrival', 'Arrival venue'], ['home', 'Home']], initial: 'arrival' }], reason: 'optional' },
  { id: 'rename', label: 'Rename', group: 'life', help: 'Sets a new name. It must pass the same name filter as any player’s.', fields: [{ key: 'name', label: 'New name', kind: 'text' }], reason: 'optional' },
  { id: 'mute', label: 'Mute chat', group: 'sanction', help: 'Stops the player posting text for a while. They can keep playing.', fields: [{ key: 'minutes', label: 'Minutes', kind: 'number', min: 1, max: 43200, initial: 60 }], reason: 'required' },
  { id: 'unmute', label: 'Lift mute', group: 'sanction', help: 'Ends a mute now.', fields: [], reason: 'none' },
  { id: 'suspend', label: 'Suspend', group: 'sanction', help: 'Switches off sending pictures, or placing calls, for a while.', fields: [{ key: 'kind', label: 'What', kind: 'select', options: [['pictures', 'Sending pictures'], ['calls', 'Placing calls']], initial: 'pictures' }, { key: 'minutes', label: 'Minutes', kind: 'number', min: 1, max: 43200, initial: 1440 }], reason: 'required' },
  { id: 'unsuspend', label: 'Lift suspension', group: 'sanction', help: 'Ends a suspension now.', fields: [{ key: 'kind', label: 'What', kind: 'select', options: [['pictures', 'Sending pictures'], ['calls', 'Placing calls']], initial: 'pictures' }], reason: 'none' },
  { id: 'ban', label: 'Ban', group: 'sanction', danger: true, typed: 'BAN', help: 'The account (or guest session) is refused with a plain message and signed out everywhere. 0 minutes = no end date.', fields: [{ key: 'minutes', label: 'Minutes (0 = permanent)', kind: 'number', min: 0, max: 525600, initial: 10080 }], reason: 'required' },
  { id: 'unban', label: 'Unban', group: 'sanction', help: 'Lifts a ban.', fields: [], reason: 'none' },
  { id: 'signout', label: 'Sign out everywhere', group: 'sanction', danger: true, typed: 'SIGN OUT', help: 'Ends every browser of the account (a guest session is ended). Their sockets close at once.', fields: [], reason: 'optional' },
  { id: 'message', label: 'Message as founder', group: 'contact', help: 'A direct message from the founder character. It goes through the text filter.', fields: [{ key: 'text', label: 'Message', kind: 'long' }], reason: 'optional' },
  { id: 'note', label: 'Private note', group: 'contact', help: 'Only admins see it.', fields: [{ key: 'text', label: 'Note', kind: 'long' }], reason: 'none' },
]
export const actionDef = (id: string): ActionDef | undefined => PLAYER_ACTIONS.find((item) => item.id === id)

/** Why the form cannot be sent yet, or null. The server checks everything again. */
export function formWhy(def: ActionDef, values: Record<string, string | number>, reason: string, typed: string): string | null {
  for (const field of def.fields) {
    const value = values[field.key]
    if (value === undefined || value === '') return `${field.label} is needed.`
    if (field.kind === 'number') { const n = Number(value); if (!Number.isInteger(n) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) return `${field.label} must be a whole number${field.min !== undefined ? ` from ${field.min}` : ''}${field.max !== undefined ? ` to ${field.max}` : ''}.` }
  }
  if (def.reason === 'required' && reason.trim().length < 3) return 'A reason is needed (at least 3 characters).'
  if (def.typed && typed.trim().toUpperCase() !== def.typed) return `Type ${def.typed} to confirm.`
  return null
}
/** The request body for an action: numbers as numbers, text trimmed. */
export function bodyOf(def: ActionDef, values: Record<string, string | number>, reason: string): Record<string, unknown> {
  const body: Record<string, unknown> = { action: def.id }
  for (const field of def.fields) body[field.key] = field.kind === 'number' ? Number(values[field.key]) : String(values[field.key] ?? '').trim()
  if (reason.trim()) body.reason = reason.trim()
  return body
}

const cell = (value: unknown): string => { const text = String(value ?? ''); return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` : text }
/** The audit log as CSV (a cell that starts like a formula is quoted with a leading apostrophe, so a spreadsheet does not run it). */
export function auditCsv(lines: readonly AuditView[]): string {
  const rows = [['n', 'time_utc', 'admin', 'action', 'target', 'target_name', 'amount', 'summary', 'reason', 'params']]
  for (const line of lines) rows.push([String(line.n), new Date(line.at).toISOString(), line.adminName || line.admin, line.action, line.target, line.targetName, line.amount === undefined ? '' : String(line.amount), line.summary, line.reason, JSON.stringify(line.params)])
  return rows.map((row) => row.map(cell).join(',')).join('\r\n')
}
