// The companion's vocabulary: what it knows about the game (a plain snapshot), what it can say, and what a button can do.
// Everything the brain, the director and the tours decide is a pure function of these, so it is tested without a browser.

export type NeedKey = 'hunger' | 'energy' | 'fun' | 'social' | 'hygiene' | 'bladder'
export type TourId = 'basics' | 'travel' | 'money' | 'friends' | 'business'

export interface PlaceFact {
  id: string
  label: string
  district: string
  /** The venue category: food, fun, nightlife, work, care, civic (or home). */
  category: string
  open: boolean
  /** "Open now · closes 10PM" and the like, as the Map says it. */
  status: string
  here: boolean
  /** Labels of what can be done there. */
  activities: string[]
  description: string
}
export interface CityFact { id: string; name: string; open: boolean; here: boolean; home: boolean }
export interface FriendFact { id: string; name: string; online: boolean; founder?: boolean }
export interface StepFact { title: string; hint: string; go?: [string, string?]; open?: string; params?: Record<string, unknown> }
export interface MissionFact { label: string; hint: string; done: boolean; claimed: boolean; go?: [string, string?]; open?: string }

/** A snapshot of the game, small and plain. The adapter (contextFromGame.ts) builds it; tests craft it. */
export interface CompanionContext {
  name: string
  /** 0-23, the hour of the day in the city the player is in. */
  hour: number
  cityId: string
  cityName: string
  location: string
  locationLabel: string
  cash: number
  needs: Record<NeedKey, number>
  /** An activity or a trip is running. */
  busy: boolean
  travelling: boolean
  /** A guest of the quick start who has not settled in. */
  guest: boolean
  /** No activity finished yet in this life. */
  newPlayer: boolean
  /** In a city that is not the player's home city. */
  away: boolean
  rideDebt: number
  /** "What you can do now" would be offered: money is short in a way that needs help. */
  stuck: boolean
  /** The goal chip under the needs bars, or null. */
  goal: StepFact | null
  missions: { locked: string | null; claimable: number; open: MissionFact[] }
  places: PlaceFact[]
  cities: CityFact[]
  friends: FriendFact[]
  unread: number
  employed: boolean
  jobRole: string | null
  stallsOpened: number
  /** The newest unread word about the player's stall (rent, closing), or null. */
  stallAlert: string | null
  /** House rent overdue (arrears, naira). */
  rentArrears: number
  rentDueSoon: boolean
  signedIn: boolean
  /** Pictures in chat are switched on for this player (the social overview's limits). */
  picturesOn: boolean
  soundOn: boolean
  /** The market (stalls) trades between these hours in this city; null when unknown. */
  marketCloseHour: number | null
  inCall: boolean
  /** Players online in the whole world right now. */
  online: number
  /** The nav view in front: venue, map, or another nav panel. */
  mode: string
  friendCount: number
  /** Shop sales so far, for the "first sale" moment. */
  sales: number
  jobLevel: number
  trips: number
  activities: number
  /** Friends who joined through the player's link, and pings waiting for an answer. */
  joined: number
  pingsWaiting: number
}

export type CompanionAction =
  /** Open a panel (a phone app, the Map, a nav panel); `id` is a registered panel id. */
  | { kind: 'open'; id: string; label: string; params?: Record<string, unknown> }
  /** The Map, focused on a place in the current city. */
  | { kind: 'map'; venue: string; label: string }
  /** The world map, with a city's card open. */
  | { kind: 'world'; city: string; label: string }
  /** Walk to a venue (and a spot) if the player is already there, otherwise the Map's trip card. */
  | { kind: 'go'; venue: string; spot?: string; label: string }
  /** The "What you can do now" help (Bank shows it). */
  | { kind: 'relief'; label: string }
  | { kind: 'call'; friend: string; name: string; label: string }
  | { kind: 'chat'; friend: string; name: string; label: string }
  | { kind: 'invite'; label: string }
  | { kind: 'tour'; tour: TourId; label: string }
  /** A quick reply: asks the companion this. */
  | { kind: 'ask'; text: string; label: string }
  /** The companion's own setting on this device. */
  | { kind: 'mode'; mode: 'lively' | 'quiet' | 'off'; label: string }
  | { kind: 'sim'; tab: string; label: string }
  | { kind: 'report'; label: string }
  | { kind: 'dismiss'; label: string }

export interface CompanionReply {
  /** The intent that answered, for the memory ("explained") and for tests. */
  topic: string
  /** One to three short sentences. */
  text: string
  actions: CompanionAction[]
  /** The pose the character takes while saying it. */
  mood?: 'happy' | 'think' | 'wave' | 'nod' | 'celebrate' | 'point'
}

/** What a hosted language model would receive: a summary of the game, never an address, a private message or a real-world place. */
export interface AskInput { context: CompanionContext; message: string; memory: CompanionMemoryView }
export interface CompanionMemoryView { explained: readonly string[]; asked: number }
export interface AskResult { text: string; actions: CompanionAction[]; topic?: string; mood?: CompanionReply['mood'] }
