// What the civic screens decide that needs no DOM: the wording of a server error, the countdowns,
// the keys and paths of the cache, which reason disables which button, the radio schedule, the
// rules text. Pure, so `node --test` reaches it (civicModel.test.ts).
import type { LifeState } from '../../../types/life.ts'
import type {
  AdColour, Ad, AdsResponse, CivicNotice, ElectionPhase, GovResponse, GovRules, GovYou, PulseResponse, RadioEntry, RadioView, RichRow,
} from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import { ELECTION, RADIO } from './civicContent.ts'
import { explain, pulseKey, unseenNews } from './civicBasics.ts'

export { explain, pulseKey, unseenNews }

// ---- words and numbers ---------------------------------------------------------------------

/** "2d 4h", "3h 12m", "5m" until a server time. */
export function until(at: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((at - now) / 60000))
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}
const DATE = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
/** A server time as a Lagos date and time, e.g. "Sun, 11 Oct, 5:28 am". */
export const dateTime = (at: number): string => DATE.format(new Date(at))
export const count = (value: unknown): string => Math.round(Number(value) || 0).toLocaleString('en-NG')
/** "1 vote", "3 votes". */
export const votes = (n: number): string => `${count(n)} vote${n === 1 ? '' : 's'}`

/**
 * The notices the chip has not shown yet, remembering what it showed. The first visit on a browser
 * shows nothing: a week of old news is not replayed.
 */
export function unseenNotices(notices: readonly CivicNotice[], store: Pick<Storage, 'getItem' | 'setItem'> | null, storageKey = 'joinallworld-civic-seen'): CivicNotice[] {
  let seen: unknown = null
  try { seen = JSON.parse(store?.getItem(storageKey) ?? 'null') } catch { /* nothing seen */ }
  const known = new Set(Array.isArray(seen) ? seen : [])
  const fresh = notices.filter((item) => !known.has(item.id))
  try { store?.setItem(storageKey, JSON.stringify(notices.map((item) => item.id).slice(0, 40))) } catch { /* shown for this visit only */ }
  return Array.isArray(seen) ? fresh : []
}

// ---- cache keys and paths ------------------------------------------------------------------

export const govKey = (cityId: string): string => `gov:${cityId}`
export const govPath = (cityId: string): string => `/api/civic/gov?city=${cityId}`
export const pulsePath = (cityId: string): string => `/api/civic/pulse?city=${cityId}`
export const hoodKey = (cityId: string): string => `hood:${cityId}`
export const hoodPath = (cityId: string): string => `/api/civic/neighbours?city=${cityId}`
export const adsKey = (cityId: string): string => `ads:${cityId}`
export const adsPath = (cityId: string): string => `/api/civic/ads?city=${cityId}`
export const richKey = (cityId: string): string => `rich:${cityId}`
export const richPath = (cityId: string): string => `/api/civic/richlist?city=${cityId}`
export const radioKey = (cityId: string, venue: string): string => `radio:${cityId}:${venue}`
export const radioPath = (cityId: string, venue: string): string => `/api/civic/radio?city=${cityId}&venue=${venue}`

// ---- the election --------------------------------------------------------------------------

export const PHASES: Readonly<Record<ElectionPhase, string>> = { nominations: 'Nominations are open', voting: 'Polls are open', results: 'Results day' }
export const NEXT: Readonly<Record<ElectionPhase, string>> = { nominations: 'voting opens', voting: 'polls close', results: 'nominations open' }
export const CYCLE: readonly { id: ElectionPhase; label: string; days: string }[] = [
  { id: 'nominations', label: 'Nominations', days: 'Mon–Wed' },
  { id: 'voting', label: 'Voting', days: 'Thu–Sat' },
  { id: 'results', label: 'Results', days: 'Sunday' },
]
export const REFUSAL_TITLES: Readonly<Record<string, string>> = { address_vote_limit: 'This network connection has reached its vote limit' }
export const refusalTitle = (code: string): string => REFUSAL_TITLES[code] ?? 'Your vote was not counted'

/** What the State House sheet's button offers for each phase. */
export const houseButton = (phase: ElectionPhase): string => (phase === 'voting' ? 'Vote for Governor' : phase === 'nominations' ? 'Run for office' : 'See the election')

const lagosDays = (n: number): string => `${n} Lagos day${Number(n) === 1 ? '' : 's'}`
/** Every election rule, one line each: the body of "How elections work". */
export function electionRules(rules: GovRules): string[] {
  const work = rules.minWorkDays ?? ELECTION.minWorkDays
  const workText = work === 1 ? 'one Lagos day' : `${work} different Lagos days`
  return [
    'Every week: nominations Monday–Wednesday, voting Thursday–Saturday, and on Sunday the winner takes office for seven days (Lagos time).',
    rules.pollingVenue ? 'Votes are cast at the Polling Unit.' : 'The Polling Unit is not built in this city yet, so for now you vote from this app.',
    `To run: live here ${lagosDays(rules.minDaysToRun)} and be paid for work on ${workText}.`,
    `To vote: live here ${lagosDays(rules.minDaysToVote)} and be paid for work on ${workText}.`,
    `Running costs a ${money(rules.filingFee)} in-game filing fee that is not refunded. At most ${rules.maxCandidates} candidates; ties go to whoever declared first.`,
    `One vote per player; it cannot be changed.${rules.votesPerAddress > 0 ? ` At most ${rules.votesPerAddress} votes are counted from one network connection.` : ''}`,
    'A device session is not a verified person, so treat results as a game, not a poll.',
    'Updates appear in the game only; there are no push notifications.',
    'The election cycle and these rules are original to this game (beta).',
  ]
}

/** The line under the ballot on results day. */
export function lastResultLine(result: NonNullable<GovResponse['lastResult']>): string {
  if (result.winner) return `${result.winner.name} won with ${count(result.winner.votes)} of ${count(result.totalVotes)} votes.`
  return result.candidates ? 'Nobody voted, so nobody took office.' : 'Nobody stood, so the seat stays empty.'
}

/** A candidate's bar, 0–100, against the leader. */
export function barWidth(votesFor: number, top: number): number { return Math.round((votesFor / Math.max(1, top)) * 100) }

/** The slogan as the server counts it (characters, not UTF-16 units). */
export const lengthOf = (text: string): number => [...text.trim()].length
export const sloganTooShort = (slogan: string): boolean => lengthOf(slogan) < ELECTION.sloganMin
export const announcementTooShort = (text: string): boolean => lengthOf(text) < ELECTION.announcement.min

// ---- reasons a control is off (each is '' when it is on; the server checks everything again) --

export const voteWhy = (offline: string | null, you: GovYou | null): string => offline ?? (!you ? 'Connect to vote.' : you.vote.ok ? '' : you.vote.reason)
export const runWhy = (offline: string | null, you: GovYou): string => offline ?? (you.run.ok ? '' : you.run.reason)
export const announceWhy = (offline: string | null, you: GovYou): string => offline ?? (you.announce.ok ? '' : you.announce.reason)
export function rentWhy(offline: string | null, cash: number, price: number, owned: number, limit: number, noun: string): string {
  if (offline) return offline
  if (owned >= limit) return `You already rent ${limit} ${noun}, the most allowed at once.`
  if (cash < price) return `Costs ${money(price)}; you have ${money(cash)}.`
  return ''
}
export function huntSearchWhy(offline: string | null, travelling: boolean, found: number, total: number): string {
  return offline ?? (travelling ? 'You are on the road. Arrive first.' : found === total ? 'You have found every gem today.' : '')
}
export function huntClaimWhy(offline: string | null, hunt: { claimed: boolean; found: number; total: number }): string {
  return offline ?? (hunt.claimed ? 'Already claimed today. New gems at midnight, Lagos time.' : hunt.found < hunt.total ? `Find all ${hunt.total} gems first (${hunt.found} so far).` : '')
}

// ---- billboards and sea plots --------------------------------------------------------------

export const colourOf = (colours: readonly AdColour[], id: string): AdColour => colours.find((item) => item.id === id) ?? colours[0] ?? { id, label: id, bg: '#ffffff', ink: '#20232c' }
export const seaSlot = (row: number, col: number): string => `sea-${row}-${col}`
export const roadside = (cityId: string, road: string, slot: string): string => (cityId === 'lagos' ? road : `Roadside ${slot.slice(3)}`)
export const ownedAds = (ads: readonly { ad?: Pick<Ad, 'mine'> | null; mine?: boolean }[]): number => ads.filter((item) => item.ad?.mine || item.mine).length
export const seaPrice = (sea: AdsResponse['sea'], row: number): number => (row < sea.shoreRows ? sea.shorePrice : sea.price)
export const previewText = (text: string): string => text.trim() || 'Your ad text'
export const adTooShort = (text: string, min: number): boolean => lengthOf(text) < min

// ---- the rich list -------------------------------------------------------------------------

/** The top three of a board on a podium (second, first, third), then everyone else as a ranked list. */
export function podium(rows: readonly RichRow[]): { steps: [RichRow | undefined, RichRow | undefined, RichRow | undefined]; rest: RichRow[] } {
  return { steps: [rows[1], rows[0], rows[2]], rest: rows.slice(3) }
}

// ---- club radio ----------------------------------------------------------------------------

export const inClub = (state: Pick<LifeState, 'location' | 'activeAction'>, radioVenueIds: readonly string[]): boolean => radioVenueIds.includes(state.location) && state.activeAction?.kind !== 'travel'
/** What is on air at `now`, from the cached schedule. */
export function schedule(data: Pick<RadioView, 'playing' | 'queue'> | null | undefined, now: number): { playing: RadioEntry | null; queue: RadioEntry[] } {
  const all = [...(data?.playing ? [data.playing] : []), ...(data?.queue ?? [])].filter((item) => item.endsAt > now)
  const playing = all.find((item) => item.startsAt <= now) ?? null
  return { playing, queue: all.filter((item) => item !== playing) }
}
export const song = (item: Pick<RadioEntry, 'title' | 'artist'>): string => `${item.title} — ${item.artist}`
export function radioWhy(offline: string | null, data: RadioView, queued: number, playing: boolean, cash: number): string {
  if (offline) return offline
  if (data.usedToday >= data.perDay) return `You have used all ${data.perDay} shout-outs today. They reset at midnight, Lagos time.`
  if (queued + (playing ? 1 : 0) >= data.queueMax) return 'The queue is full. Try again in a few minutes.'
  if (cash < data.price) return `Costs ${money(data.price)}; you have ${money(cash)}.`
  return ''
}
/** The field a shout-out is still missing, or null. */
export const shoutoutMissing = (draft: { title: string; artist: string }): 'title' | 'artist' | null => (!draft.title.trim() ? 'title' : !draft.artist.trim() ? 'artist' : null)
export const radioRules = (): string[] => [
  'A shout-out is text only — a song title and an artist. No audio is played and links are not allowed.',
  `It costs ${money(RADIO.price)} of in-game naira and plays for ${RADIO.slotSeconds} seconds on the club banner.`,
  `Each player gets ${RADIO.perPlayerPerDay} a day; they reset at midnight, Lagos time.`,
  'Club radio plays inside clubs only. These are original beta values.',
]

// ---- the gem hunt chip ---------------------------------------------------------------------

/** The two small lines of the HUD chip. `pulse` is null until the city counters have loaded: then no number is shown. */
export function huntChipLines(hunt: { found: number; total: number; claimed: boolean; prize: number }, pulse: Pick<PulseResponse, 'hunt' | 'counters'> | null): { first: string; second: string } {
  const found = pulse ? `${count(pulse.hunt.found)} found · ` : ''
  const prize = hunt.claimed ? 'prize claimed today' : `next prize ${money(hunt.prize)}`
  const people = pulse ? ` · ${count(pulse.counters.online)} online` : ''
  return { first: `${found}${prize}`, second: `You: ${hunt.found}/${hunt.total} today${people}` }
}
/** The toast for one more gem found since the chip last looked ('' when none). `last` is where it looked last. */
export function gemToast(last: { key: string; found: number } | null, key: string, hunt: { found: number; total: number }): string {
  if (last?.key !== key || hunt.found <= last.found) return ''
  return hunt.found === hunt.total ? `Gem found — that is all ${hunt.total}. Claim your prize from the gem hunt chip.` : `Gem found: ${hunt.found} of ${hunt.total} today.`
}
/** A civic notice as the one-line toast the chip raises. */
export const noticeToast = (notice: Pick<CivicNotice, 'title' | 'kind' | 'text'>): string => `${notice.title}${notice.kind === 'announcement' ? `: ${notice.text}` : ''}`
