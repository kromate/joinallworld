// The buttons a hosted language model may suggest. The model never invents an action: it can only name an id from this
// fixed list, the server checks every id against the live game, and the client turns a checked id into an ordinary
// companion action here. Pure and shared by the server and the app, so both sides read the same list.
import type { CompanionAction, CompanionContext, TourId } from './types.ts'

/** The ids that stand alone. Three more kinds take a value: `open-map-venue:<venue>`, `start-trip:<city>`, `show-tour:<tour>`. */
export const SUGGEST_IDS = ['open-jobs', 'open-business', 'open-invite', 'open-relief', 'call-friend', 'open-messages', 'open-missions', 'open-bank', 'open-people', 'open-settings', 'report-problem'] as const
export type SuggestId = typeof SUGGEST_IDS[number]
export const SUGGEST_TOURS: readonly TourId[] = ['basics', 'travel', 'money', 'friends', 'business']
export const SUGGEST_VENUE = 'open-map-venue:', SUGGEST_TRIP = 'start-trip:', SUGGEST_TOUR = 'show-tour:'
/** Buttons offered with one reply. */
export const SUGGEST_MAX = 3

/** What a suggestion is checked against. The server builds it from the stored life; the app from its own snapshot. */
export interface SuggestFacts {
  /** The city the player is in. */
  cityId: string
  /** The venues of that city. */
  venues: readonly { id: string; label: string }[]
  /** Cities a trip can start to. */
  openCities: readonly string[]
  /** Friends who are online right now. */
  onlineFriends: number
}

export const factsOf = (context: CompanionContext): SuggestFacts => ({
  cityId: context.cityId,
  venues: context.places.map((place) => ({ id: place.id, label: place.label })),
  openCities: context.cities.filter((city) => city.open).map((city) => city.id),
  onlineFriends: context.friends.filter((friend) => friend.online).length,
})

const PANELS: Readonly<Record<string, { id: string; label: string }>> = {
  'open-jobs': { id: 'jobs', label: 'Open Jobs' }, 'open-business': { id: 'business', label: 'Open Business' },
  'open-messages': { id: 'messages', label: 'Open Messages' }, 'open-missions': { id: 'missions', label: 'Open Missions' },
  'open-bank': { id: 'bank', label: 'Open Bank' }, 'open-people': { id: 'people', label: 'Open People' }, 'open-settings': { id: 'settings', label: 'Open Settings' },
}
const PLAIN: ReadonlySet<string> = new Set(SUGGEST_IDS)
const TOUR_LABEL: Readonly<Record<TourId, string>> = { basics: 'Show me the basics', travel: 'Show me travel', money: 'Show me money', friends: 'Show me friends', business: 'Show me business' }

const valueOf = (id: string, prefix: string): string | null => (id.startsWith(prefix) ? id.slice(prefix.length) : null)

/** Is this one id on the list, and true in the game described by `facts`? */
export function suggestOk(id: unknown, facts: SuggestFacts): id is string {
  if (typeof id !== 'string' || id.length > 80) return false
  if (id === 'call-friend') return facts.onlineFriends > 0
  if (PLAIN.has(id)) return true
  const venue = valueOf(id, SUGGEST_VENUE)
  if (venue !== null) return facts.venues.some((item) => item.id === venue)
  const city = valueOf(id, SUGGEST_TRIP)
  if (city !== null) return city !== facts.cityId && facts.openCities.includes(city)
  const tour = valueOf(id, SUGGEST_TOUR)
  return tour !== null && SUGGEST_TOURS.some((item) => item === tour)
}

/** The ids that are on the list and true now, each once, in the order given, at most SUGGEST_MAX. Anything else is dropped. */
export function validateSuggest(ids: unknown, facts: SuggestFacts): string[] {
  if (!Array.isArray(ids)) return []
  const kept: string[] = []
  for (const id of ids) if (suggestOk(id, facts) && !kept.includes(id)) kept.push(id)
  return kept.slice(0, SUGGEST_MAX)
}

/** The action a checked id stands for in this snapshot, or null when it no longer holds (the button is then not shown). */
export function suggestToAction(id: string, context: CompanionContext): CompanionAction | null {
  const facts = factsOf(context)
  if (!suggestOk(id, facts)) return null
  const panel = PANELS[id]
  if (panel) return { kind: 'open', id: panel.id, label: panel.label }
  if (id === 'open-invite') return { kind: 'invite', label: 'Invite a friend' }
  if (id === 'open-relief') return { kind: 'relief', label: 'What can I do now?' }
  if (id === 'report-problem') return { kind: 'report', label: 'Report a problem' }
  if (id === 'call-friend') {
    const friend = context.friends.find((item) => item.online)
    return friend ? { kind: 'call', friend: friend.id, name: friend.name, label: `Call ${friend.name}` } : null
  }
  const venue = valueOf(id, SUGGEST_VENUE)
  if (venue !== null) { const place = context.places.find((item) => item.id === venue); return place ? { kind: 'map', venue, label: `Show ${place.label}` } : null }
  const city = valueOf(id, SUGGEST_TRIP)
  if (city !== null) return { kind: 'world', city, label: 'Take me there' }
  const tour = SUGGEST_TOURS.find((item) => id === `${SUGGEST_TOUR}${item}`)
  return tour ? { kind: 'tour', tour, label: TOUR_LABEL[tour] } : null
}
