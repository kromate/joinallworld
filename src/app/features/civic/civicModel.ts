// What the civic screens decide that needs no DOM: the wording of a server error, the countdowns,
// the keys and paths of the cache, which reason disables which button, the radio schedule, the
// rules text. Pure, so `node --test` reaches it (civicModel.test.ts).
import type { LifeState } from '../../../types/life.ts'
import type {
  AdColour, Ad, AdsResponse, BoardMeasure, BoardScope, BoardYou, BoardsResponse, CivicNotice, ElectionPhase, GovResponse, GovRules, GovYou, PulseResponse, RadioEntry, RadioView, RichRow,
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

/** How many shown notices a browser remembers, across every city it has been in. */
const SEEN_KEPT = 120
/**
 * The notices the chip has not shown yet, remembering what it showed. The first look at a city shows nothing: a week of
 * old news is not replayed. What was shown is remembered PER CITY (`cityId`) and across cities: every city numbers its
 * notices alike, and a player who travels and comes back must not be told a city's old news again as if it were new.
 * (A list kept before cities were told apart holds bare ids; they still count as shown, wherever they were seen.)
 */
export function unseenNotices(notices: readonly CivicNotice[], store: Pick<Storage, 'getItem' | 'setItem'> | null, cityId = '', storageKey = 'joinallworld-civic-seen'): CivicNotice[] {
  let seen: unknown = null
  try { seen = JSON.parse(store?.getItem(storageKey) ?? 'null') } catch { /* nothing seen */ }
  const before: string[] = Array.isArray(seen) ? seen.filter((id): id is string => typeof id === 'string') : []
  const known = new Set(before)
  const mark = (id: string): string => (cityId ? `${cityId}:${id}` : id), visited = mark('')
  // Looked at before: this city has its mark, or the list is from before cities were told apart.
  const looked = Array.isArray(seen) && (!cityId || known.has(visited) || !before.some((id) => id.endsWith(':')))
  const fresh = notices.filter((item) => !known.has(mark(item.id)) && !known.has(item.id))
  const now = [...(cityId ? [visited] : []), ...notices.map((item) => mark(item.id))]
  // The marks of the cities come first, so a long list of notices never pushes a city's "looked at" out.
  const kept = [...now, ...before.filter((id) => !now.includes(id))].sort((a, b) => Number(b.endsWith(':')) - Number(a.endsWith(':')))
  try { store?.setItem(storageKey, JSON.stringify(kept.slice(0, SEEN_KEPT))) } catch { /* shown for this visit only */ }
  return looked ? fresh : []
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
export const houseButton = (phase: ElectionPhase, title = 'Chairman'): string => (phase === 'voting' ? `Vote for ${title}` : phase === 'nominations' ? 'Run for office' : 'See the election')

const lagosDays = (n: number): string => `${n} day${Number(n) === 1 ? '' : 's'}`
/** Every election rule, one line each: the body of "How elections work". */
export function electionRules(rules: GovRules): string[] {
  const work = rules.minWorkDays ?? ELECTION.minWorkDays
  const workText = work === 1 ? 'one day' : `${work} different days`
  return [
    'Every week: nominations Monday–Wednesday, voting Thursday–Saturday, and on Sunday the winner takes office for seven days (Nigerian time).',
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
  return offline ?? (hunt.claimed ? 'Already claimed today. New gems at midnight, Nigerian time.' : hunt.found < hunt.total ? `Find all ${hunt.total} gems first (${hunt.found} so far).` : '')
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

// ---- places: cities, states and countries ranked against each other -------------------------

export const BOARD_SEGMENTS: readonly { id: BoardScope; label: string; noun: string }[] = [
  { id: 'city', label: 'Cities', noun: 'city' }, { id: 'state', label: 'States', noun: 'state' }, { id: 'country', label: 'Countries', noun: 'country' },
]
export const BOARD_MEASURES: readonly { id: BoardMeasure; label: string }[] = [
  { id: 'pride', label: 'Pride (naira per player)' }, { id: 'earned', label: 'Total earned this week' },
  { id: 'active', label: 'Active this week' }, { id: 'residents', label: 'Players' },
]
export const boardsKey = (scope: BoardScope, by: BoardMeasure): string => `boards:${scope}:${by}`
export const boardsPath = (scope: BoardScope, by: BoardMeasure): string => `/api/civic/boards?scope=${scope}&by=${by}`
/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tail = n % 100, suffix = tail >= 11 && tail <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}
/** ₦950, ₦1,200, ₦1.2m, ₦3.5bn: a large total in a few characters. */
export function compactMoney(value: number): string {
  const trim = (n: number): string => String(Math.round(n * 10) / 10)
  return value >= 1e9 ? `₦${trim(value / 1e9)}bn` : value >= 1e6 ? `₦${trim(value / 1e6)}m` : money(value)
}
/** A place's figure in the measure it is ranked by. */
export const boardAmount = (by: BoardMeasure, value: number): string => (by === 'pride' ? money(value) : by === 'earned' ? compactMoney(value) : count(value))
const gapWords = (by: BoardMeasure, amount: number): string =>
  by === 'pride' ? `${money(amount)} a player` : by === 'earned' ? compactMoney(amount) : `${count(amount)} ${by === 'active' ? 'active ' : ''}${amount === 1 ? 'player' : 'players'}`
/** Where the viewer's own place stands, in a sentence: "Ibadan is 2nd, ₦1.2m behind Abuja this week." */
export function standingLine(you: BoardYou | null, by: BoardMeasure, min: number): string {
  if (!you) return 'Play in a city to see where it stands.'
  if (you.rank === null) return `${you.name} needs ${min} players, ${min} of them active this week, to be ranked.`
  if (you.rank === 1 || !you.behind) return `${you.name} is ${ordinal(you.rank)} this week.`
  return you.behind.amount === 0 ? `${you.name} is ${ordinal(you.rank)}, level with ${you.behind.name} this week.` : `${you.name} is ${ordinal(you.rank)}, ${gapWords(by, you.behind.amount)} behind ${you.behind.name} this week.`
}
/** The line a player can send: plain text, no link. Null while the place is not ranked. */
export function placeShareLine(you: BoardYou | null, scope: BoardScope): string | null {
  if (!you || you.rank === null) return null
  return scope === 'city' ? `${you.name} is #${you.rank} in Allworld this week.` : `${you.name} is the #${you.rank} ${scope} in Allworld this week.`
}
/** "Last week: Kano", or null when no place was ranked. */
export const lastWeekLine = (last: BoardsResponse['lastWeek']): string | null => (last.winner ? `Last week: ${last.winner.name}` : null)

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
  if (data.usedToday >= data.perDay) return `You have used all ${data.perDay} shout-outs today. They reset at midnight, Nigerian time.`
  if (queued + (playing ? 1 : 0) >= data.queueMax) return 'The queue is full. Try again in a few minutes.'
  if (cash < data.price) return `Costs ${money(data.price)}; you have ${money(cash)}.`
  return ''
}
/** The field a shout-out is still missing, or null. */
export const shoutoutMissing = (draft: { title: string; artist: string }): 'title' | 'artist' | null => (!draft.title.trim() ? 'title' : !draft.artist.trim() ? 'artist' : null)
export const radioRules = (): string[] => [
  'A shout-out is text only — a song title and an artist. No audio is played and links are not allowed.',
  `It costs ${money(RADIO.price)} of in-game naira and plays for ${RADIO.slotSeconds} seconds on the club banner.`,
  `Each player gets ${RADIO.perPlayerPerDay} a day; they reset at midnight, Nigerian time.`,
  'Club radio plays inside clubs only. These are original beta values.',
]

// ---- the gem hunt chip ---------------------------------------------------------------------

/** The two small lines of the HUD chip. `pulse` is null until the city counters have loaded: then no number is shown. */
export function huntChipLines(hunt: { found: number; total: number; claimed: boolean; prize: number }, pulse: Pick<PulseResponse, 'hunt' | 'counters'> | null, online?: number | null): { first: string; second: string } {
  const found = pulse ? `${count(pulse.hunt.found)} found · ` : ''
  const prize = hunt.claimed ? 'prize claimed today' : `next prize ${money(hunt.prize)}`
  // The number is the header pill's own when the page has one (it is pushed as it changes); the city's answer can be a minute old.
  const people = pulse ? ` · ${count(online ?? Math.max(1, pulse.counters.online))} online` : ''
  return { first: `${found}${prize}`, second: `You: ${hunt.found}/${hunt.total} today${people}` }
}
/** The toast for one more gem found since the chip last looked ('' when none). `last` is where it looked last. */
export function gemToast(last: { key: string; found: number } | null, key: string, hunt: { found: number; total: number }): string {
  if (last?.key !== key || hunt.found <= last.found) return ''
  return hunt.found === hunt.total ? `Gem found — that is all ${hunt.total}. Claim your prize from the gem hunt chip.` : `Gem found: ${hunt.found} of ${hunt.total} today.`
}
/** A civic notice as the one-line toast the chip raises. */
export const noticeToast = (notice: Pick<CivicNotice, 'title' | 'kind' | 'text'>): string => `${notice.title}${notice.kind === 'announcement' ? `: ${notice.text}` : ''}`
