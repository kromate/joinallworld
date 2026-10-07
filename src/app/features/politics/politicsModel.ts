// Politics: the keys and paths of what the app reads, and the sentences it shows. Pure: no application code, so the tests load it alone.
import type { GovResponse } from '../../../types/civic.ts'
import type { RecordEntryView, RecordKind } from '../../../types/records.ts'
import { entryHash, verifyChain } from '../../../records/chain.ts'
import type { ChainEntry } from '../../../records/chain.ts'
import type { AssemblyView, AuditFlag, BillView, CaseView, JusticeResponse, JusticeSeatView, LeverView, OffenceView, PartyView, PoliticsResponse, SeatView, TierId, Verdict } from '../../../types/politics.ts'
import { PARTY } from '../../../game/content/politics.ts'
import { govKey } from '../civic/civicModel.ts'

export type TabId = TierId | 'parties' | 'justice' | 'records'
export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'city', label: 'City' }, { id: 'state', label: 'State' }, { id: 'nation', label: 'Nation' }, { id: 'parties', label: 'Parties' }, { id: 'justice', label: 'Justice' }, { id: 'records', label: 'Records' },
]
export const overviewKey = (cityId: string): string => `politics:${cityId}`
export const overviewPath = (cityId: string): string => `/api/politics/overview?city=${cityId}`
/** The city's own ballot is the one the Governor app reads, so they share one cached copy. */
export const ballotKey = (cityId: string, tier: TierId): string => (tier === 'city' ? govKey(cityId) : `gov:${cityId}:${tier}`)
export const ballotPath = (cityId: string, tier: TierId): string => (tier === 'city' ? `/api/civic/gov?city=${cityId}` : `/api/civic/gov?city=${cityId}&tier=${tier}`)

export const seatOf = (data: PoliticsResponse | null | undefined, tier: TierId): SeatView | null => data?.seats.find((seat) => seat.tier === tier) ?? null
export const partyName = (data: PoliticsResponse | null | undefined, id: string | null | undefined): PartyView | null => (id ? data?.parties.find((party) => party.id === id) ?? null : null)

/** "5%": the value of a lever as a player reads it. */
const naira = (value: number): string => `₦${value.toLocaleString('en-NG')}`
const withUnit = (value: number, unit: LeverView['unit']): string => (unit === '₦' ? naira(value) : unit === '%' ? `${value}%` : `${value} ${unit}`)
export const leverText = (lever: Pick<LeverView, 'unit'>, value: number): string => withUnit(value, lever.unit)
export const leverRange = (lever: Pick<LeverView, 'min' | 'max' | 'unit'>): string => (lever.unit === '₦' ? `${naira(lever.min)}–${naira(lever.max)}` : `${lever.min}–${withUnit(lever.max, lever.unit)}`)

/** Why a lever cannot be set to `value`, as a sentence, or '' when it can. */
export function leverWhy(lever: Pick<LeverView, 'min' | 'max' | 'unit' | 'label'>, value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'Enter a whole number.'
  return value < lever.min || value > lever.max ? `${lever.label} can be ${leverRange(lever)}.` : ''
}

export const quorumLine = (seat: Pick<SeatView, 'quorum'>): string => `An election needs at least ${seat.quorum} votes to count. With fewer, nobody takes office and the seat stays empty.`

/** Who holds the seat, in one line. */
export function officeLine(seat: Pick<SeatView, 'title' | 'name'>, gov: Pick<GovResponse, 'governor'> | null | undefined, party: string | null): string {
  if (!gov) return ''
  return gov.governor ? `${gov.governor.name} is ${seat.title} of ${seat.name}${party ? ` · ${party}` : ''}` : `${seat.title} of ${seat.name}: nobody holds the seat this week.`
}

/** What the ledger line says in a few words. */
export const ledgerKind = (kind: SeatView['treasury']['ledger'][number]['kind']): string => (kind === 'levy' ? 'Levy' : kind === 'fee' ? 'Filing fee' : 'Salary')

export const partyNameWhy = (name: string): string => {
  const length = [...name.trim()].length
  return length < PARTY.nameMin ? `Name the party (${PARTY.nameMin}–${PARTY.nameMax} characters).` : ''
}
export const partyMottoWhy = (motto: string): string => ([...motto.trim()].length < PARTY.mottoMin ? `Write a motto (${PARTY.mottoMin}–${PARTY.mottoMax} characters).` : '')

// ---- justice -----------------------------------------------------------------------------------------

export const justiceKey = (cityId: string): string => `justice:${cityId}`
export const justicePath = (cityId: string): string => `/api/politics/justice/overview?city=${cityId}`

/** "12 minutes", "1 h 30 min": how long is left of a sentence. */
export function timeLeft(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minute${minutes === 1 ? '' : 's'}`
}
export const jailLine = (jail: NonNullable<NonNullable<JusticeResponse['you']>['jail']>, now: number): string =>
  `You are in jail for ${timeLeft(jail.until, now)} more, arrested by ${jail.by.name}. You cannot travel or work, but you can message and call people.`

/** Why the Fight button is off, as a sentence, or '' when it can be pressed. */
export function fightWhy(offline: string | null, you: JusticeResponse['you'], together: boolean, now: number): string {
  if (offline) return offline
  if (!you) return 'Connect to fight.'
  if (you.jail) return `You are in jail for ${timeLeft(you.jail.until, now)} more.`
  return together ? '' : 'You can only fight someone in the same place as you.'
}
/** Why an officer cannot arrest this offender now, or ''. */
export const arrestWhy = (offline: string | null, offence: Pick<OffenceView, 'here' | 'by'>): string => offline ?? (offence.here ? '' : `${offence.by.name} is not here with you. Find them first.`)
/** The seats whose officeholder the caller is. */
export const enrolSeats = (justice: Pick<JusticeResponse, 'seats'> | null | undefined): JusticeSeatView[] => justice?.seats.filter((seat) => seat.canEnrol) ?? []
export const judgeOf = (seat: Pick<JusticeSeatView, 'judges'>, id: string): boolean => seat.judges.some((judge) => judge.id === id)
export const officerOf = (seat: Pick<JusticeSeatView, 'officers'>, id: string): boolean => seat.officers.some((officer) => officer.id === id)
export const offenceLine = (offence: Pick<OffenceView, 'by' | 'against' | 'venue'>): string => `${offence.by.name} attacked ${offence.against.name} at ${offence.venue}`

// ---- courts ------------------------------------------------------------------------------------------

export const VERDICTS: readonly { id: Verdict; label: string; about: string }[] = [
  { id: 'upheld', label: 'Uphold', about: 'The arrest and the sentence stand.' },
  { id: 'reduced', label: 'Reduce', about: 'Half of the time left is taken off.' },
  { id: 'quashed', label: 'Quash', about: 'The arrest was wrong: the player goes free.' },
]
export const verdictText = (verdict: Verdict): string => (verdict === 'upheld' ? 'upheld' : verdict === 'reduced' ? 'reduced' : 'quashed')
export const courtName = (tier: TierId): string => (tier === 'city' ? 'city court' : tier === 'state' ? 'state court' : 'federal court')
/** The court an appeal goes up to, or null from the top. */
export const higherCourt = (tier: TierId): string | null => (tier === 'city' ? courtName('state') : tier === 'state' ? courtName('nation') : null)
/** Whether the defendant may still take their case up: decided, not already appealed, not quashed, not from the top court. */
export const canEscalate = (found: Pick<CaseView, 'status' | 'appeals' | 'tier' | 'ruling'>): boolean => found.status === 'decided' && found.appeals < 1 && found.tier !== 'nation' && found.ruling?.verdict !== 'quashed'

export const statementWhy = (offline: string | null, statement: string): string => offline ?? ([...statement.trim()].length < 3 ? 'Write your statement first (at least 3 characters).' : '')
export const noteWhy = (offline: string | null, note: string): string => offline ?? ([...note.trim()].length < 3 ? 'Give your reasons first (at least 3 characters). They are public.' : '')
export const caseLine = (found: Pick<CaseView, 'defendant' | 'officer'>): string => `${found.defendant.name}, arrested by ${found.officer.name}`
export const rulingLine = (found: Pick<CaseView, 'ruling'>): string => (found.ruling ? `${found.ruling.by.name} ${verdictText(found.ruling.verdict)} it: ${found.ruling.note}` : '')

// ---- accountability ----------------------------------------------------------------------------------

export const FLAG_TEXT: Readonly<Record<AuditFlag, string>> = {
  concentration: 'Most of the money granted went to one person.',
  party_favour: 'Most of the money granted went to the officeholder’s own party.',
  drained: 'Salary and grants took almost everything that came in.',
}
/** The audit in a sentence: what came in and where it went, and whether anything stood out. */
export function auditLine(audit: NonNullable<SeatView['audit']>): string {
  return `This term ${naira(audit.income)} came in; ${naira(audit.salary)} was drawn as salary and ${naira(audit.granted)} granted in ${audit.grants} grant${audit.grants === 1 ? '' : 's'}.`
}
/** Why the petition cannot be signed now, or ''. */
export function petitionWhy(offline: string | null, petition: NonNullable<SeatView['petition']>, signedIn: boolean): string {
  if (offline) return offline
  if (!signedIn) return 'Connect to sign.'
  if (petition.mine) return 'You have signed.'
  return petition.open ? '' : 'An impeachment needs an audit of this term that found something. Ask for an audit first.'
}
/** Why a grant cannot be paid yet, or ''. */
export function grantWhy(offline: string | null, amount: unknown, purpose: string, room: number): string {
  if (offline) return offline
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) return 'Enter a whole number of naira.'
  if (amount > room) return room > 0 ? `A grant can be at most ${naira(room)} now.` : 'The treasury has nothing to give.'
  return [...purpose.trim()].length < 3 ? 'Say what the grant is for (at least 3 characters). It is public.' : ''
}

// ---- the public record --------------------------------------------------------------------------------

export const RECORD_FILTERS: readonly { id: RecordKind | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' }, { id: 'term', label: 'Elections' }, { id: 'law', label: 'Laws' }, { id: 'ruling', label: 'Rulings' }, { id: 'impeachment', label: 'Removals' }, { id: 'party', label: 'Parties' }, { id: 'operator', label: 'The operator' },
]
export const recordsPath = (kind: RecordKind | 'all', before: number | null): string => `/api/world/records?limit=30${kind === 'all' ? '' : `&kind=${kind}`}${before === null ? '' : `&before=${before}`}`
export const kindLabel = (kind: RecordKind): string => RECORD_FILTERS.find((item) => item.id === kind)?.label.replace(/s$/, '') ?? kind
/** An entry's date, as a short Lagos-time day. */
export const recordDate = (at: number): string => new Date(at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })

export interface RecordCheck { ok: boolean; line: string }
/**
 * What the page can say it checked. A whole run of the chain (an unfiltered list) is checked link by link; a filtered list is not
 * consecutive, so each entry's own seal is checked instead. Entries arrive newest first and are checked oldest first.
 */
export function checkRecords(entries: readonly RecordEntryView[], whole: boolean): RecordCheck {
  if (!entries.length) return { ok: true, line: 'Nothing has been recorded yet.' }
  const ordered: ChainEntry[] = [...entries].reverse().map((entry) => ({ ...entry }))
  if (whole) {
    const result = verifyChain(ordered)
    return result.ok ? { ok: true, line: `Checked in your browser: ${ordered.length} entries, each sealed by the one before.` } : { ok: false, line: `Entry ${result.brokenAt} does not match its seal. This record has been changed.` }
  }
  const broken = ordered.find((entry) => entryHash(entry, entry.prev) !== entry.hash)
  return broken ? { ok: false, line: `Entry ${broken.n} does not match its seal. This record has been changed.` } : { ok: true, line: `Checked in your browser: the seal of each of these ${ordered.length} entries holds.` }
}
export const shortHash = (hash: string): string => `${hash.slice(0, 8)}…${hash.slice(-6)}`

// ---- assemblies --------------------------------------------------------------------------------------

export const assemblyName = (tier: TierId, seatName: string): string => (tier === 'city' ? `${seatName} council` : tier === 'state' ? `${seatName} assembly` : 'National Assembly')
/** "Sales tax 5%": what a bill would set. */
export const billLine = (bill: Pick<BillView, 'label' | 'value' | 'unit'>): string => `${bill.label} ${leverText(bill, bill.value)}`
export const BILL_STATUS: Readonly<Record<BillView['status'], string>> = { open: 'Open for votes', passed: 'Passed: now law for the week', failed: 'Failed', vetoed: 'Vetoed' }
/** Where the vote stands, and what it still needs. */
export const tallyLine = (bill: Pick<BillView, 'yes' | 'no' | 'needed' | 'byOffice' | 'signed' | 'status'>): string => {
  const base = `${bill.yes} for · ${bill.no} against`
  if (bill.status !== 'open') return base
  return `${base} · needs ${bill.needed}${bill.byOffice ? '' : bill.signed ? ' (signed)' : ' (or a majority and the officeholder’s signature)'}`
}
/** Why the caller cannot vote on this bill, or ''. */
export const billVoteWhy = (offline: string | null, bill: Pick<BillView, 'status' | 'yourVote'>, assembly: Pick<AssemblyView, 'you'>): string => {
  if (offline) return offline
  if (!assembly.you?.member) return 'Only a member of the assembly votes.'
  if (bill.status !== 'open') return 'This bill is decided.'
  return bill.yourVote === null ? '' : 'You have voted.'
}
/** Why a bill cannot be proposed with this value, or ''. */
export const proposeWhy = (offline: string | null, lever: Pick<LeverView, 'min' | 'max' | 'unit' | 'label'>, value: unknown, assembly: Pick<AssemblyView, 'you'>): string => {
  if (offline) return offline
  if (!assembly.you?.canPropose) return 'Only the officeholder or a member of the assembly can propose a bill.'
  return leverWhy(lever, value)
}
