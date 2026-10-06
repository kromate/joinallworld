// The ONE table of what the guide's buttons do and where they land. The deterministic answers (answers.ts, knowledge.ts, director.ts) build their
// buttons with the `route` functions here, a hosted model's suggested ids are turned into buttons by the same entries (`entryFor`, used by
// suggest.ts), and `whyNot` says, for any button, why it cannot work right now, so a button that cannot work says so instead of doing nothing.
// A model suggestion therefore can never land somewhere other than the answer the brain would give. Pure (no Vue, no game): the server imports suggest.ts.
import type { CompanionAction, CompanionContext, PlaceFact, TourId } from './types.ts'

const open = (id: string, label: string, params?: Record<string, unknown>): CompanionAction => ({ kind: 'open', id, label, ...(params ? { params } : {}) })

/** The market of the city nearest the top of the list that is open, or the one the player stands in. */
const marketHere = (ctx: CompanionContext): PlaceFact | null => ctx.places.find((place) => place.market === true && place.here) ?? null
const nearestMarket = (ctx: CompanionContext): PlaceFact | null => ctx.places.find((place) => place.market === true && place.open) ?? ctx.places.find((place) => place.market === true) ?? null

export type GameId = 'oro' | 'chess' | 'weave'
export const GAMES: readonly GameId[] = ['oro', 'chess', 'weave']
const GAME_LABEL: Readonly<Record<GameId, string>> = { oro: 'Play today’s word', chess: 'Play chess', weave: 'Play Weave' }
export const TOUR_LABEL: Readonly<Record<TourId, string>> = { basics: 'Show me the basics', travel: 'Show me travel', money: 'Show me money', friends: 'Show me friends', business: 'Show me business' }

/** Where each kind of button lands: the builders of every button the guide can show. */
export const route = {
  /** Phone -> Jobs, scrolled to the list of jobs. */
  jobs: (): CompanionAction => open('jobs', 'Open Jobs', { section: 'list' }),
  business: (): CompanionAction => open('business', 'Open Business'),
  /** Renting a stall: at a market, the Business app at the rent-a-stall form; elsewhere the Map on the nearest market. */
  stall: (ctx: CompanionContext): CompanionAction => {
    const here = marketHere(ctx), near = nearestMarket(ctx)
    if (here) return open('business', 'Rent a stall here', { venue: here.id, section: 'rent' })
    return near ? { kind: 'map', venue: near.id, label: `Go to ${near.label}` } : route.business()
  },
  messages: (): CompanionAction => open('messages', 'Open Messages'),
  /** Messages with the new-group form open. */
  newGroup: (): CompanionAction => open('messages', 'New group', { new: 'group' }),
  people: (): CompanionAction => open('people', 'Open People'),
  /** A friend's card with the gift form open. */
  sendMoney: (friend: { id: string; name: string }): CompanionAction => open('person', `Send money to ${friend.name}`, { player: friend.id, name: friend.name, gift: true }),
  /** The Games app: Oro opens on today's word; chess and Weave are brought into view. */
  game: (game: GameId): CompanionAction => open('games', GAME_LABEL[game], { game }),
  games: (): CompanionAction => open('games', 'Open Games'),
  /** Settings at the Sound section. */
  sound: (): CompanionAction => open('settings', 'Open sound settings', { section: 'sound' }),
  settings: (): CompanionAction => open('settings', 'Open Settings'),
  /** The sign-up sheet (a signed-in player is told so, and can open the account section of Settings). */
  signUp: (): CompanionAction => open('account-sign-in', 'Sign up free', { intent: 'save', mode: 'create', where: 'guide' }),
  account: (): CompanionAction => open('settings', 'Open my account', { section: 'account' }),
  bank: (): CompanionAction => open('bank', 'Open Bank'),
  missions: (label = 'Open Missions'): CompanionAction => open('missions', label),
  /** The "What you can do now" card. */
  relief: (label = 'What can I do now?'): CompanionAction => ({ kind: 'relief', label }),
  report: (): CompanionAction => ({ kind: 'report', label: 'Report a problem' }),
  invite: (): CompanionAction => ({ kind: 'invite', label: 'Invite a friend' }),
  /** The atlas at the country level with a city's travel card open. */
  city: (city: string, label = 'Take me there'): CompanionAction => ({ kind: 'world', city, label }),
  venue: (place: { id: string; label: string }, label = `Show ${place.label}`): CompanionAction => ({ kind: 'map', venue: place.id, label }),
  tour: (id: TourId, label = TOUR_LABEL[id]): CompanionAction => ({ kind: 'tour', tour: id, label }),
  call: (friend: { id: string; name: string }, label = `Call ${friend.name}`): CompanionAction => ({ kind: 'call', friend: friend.id, name: friend.name, label }),
}

/** The id each stand-alone suggestion stands for, and the button it builds in this game; null when the game cannot offer it now. */
const PLAIN: Readonly<Record<string, (ctx: CompanionContext) => CompanionAction | null>> = {
  'open-jobs': () => route.jobs(), 'open-business': () => route.business(), 'open-stall': (ctx) => route.stall(ctx),
  'open-messages': () => route.messages(), 'new-group': () => route.newGroup(), 'open-missions': () => route.missions(), 'open-bank': () => route.bank(),
  'open-people': () => route.people(), 'open-settings': () => route.settings(), 'open-sound': () => route.sound(), 'sign-up': () => route.signUp(),
  'open-invite': () => route.invite(), 'open-relief': () => route.relief(), 'report-problem': () => route.report(),
  'call-friend': (ctx) => { const friend = ctx.friends.find((item) => item.online); return friend ? route.call(friend) : null },
}
/** The ids that stand alone (a hosted model may name these). */
export const PLAIN_IDS: readonly string[] = Object.keys(PLAIN)

/** The button for a suggestion id (`open-jobs`, `open-map-venue:<venue>`, `start-trip:<city>`, `show-tour:<id>`, `play-game:<game>`), or null. */
export function entryFor(id: string, ctx: CompanionContext): CompanionAction | null {
  const plain = PLAIN[id]
  if (plain) return plain(ctx)
  const at = id.indexOf(':'), kind = at < 0 ? '' : id.slice(0, at), value = at < 0 ? '' : id.slice(at + 1)
  if (kind === 'open-map-venue') { const place = ctx.places.find((item) => item.id === value); return place ? route.venue(place) : null }
  if (kind === 'start-trip') return ctx.cities.some((city) => city.id === value) ? route.city(value) : null
  if (kind === 'show-tour') { const tour = (Object.keys(TOUR_LABEL) as TourId[]).find((item) => item === value); return tour ? route.tour(tour) : null }
  if (kind === 'play-game') { const game = GAMES.find((item) => item === value); return game ? route.game(game) : null }
  return null
}

const naira = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`
const hourWord = (hour: number): string => `${hour % 12 || 12}${hour < 12 ? 'AM' : 'PM'}`

/** Why this button cannot work right now (said in the chat in place of doing nothing), or null when it can. */
export function whyNot(action: CompanionAction, ctx: CompanionContext): string | null {
  switch (action.kind) {
    case 'open': {
      const params = action.params
      if (action.id === 'business' && params?.section === 'rent') {
        const place = ctx.places.find((item) => item.id === params.venue)
        if (place && !place.open) return `${place.label} is closed right now (${place.status.replace(/^Closed · /, '').toLowerCase()}). Stalls can only be rented while the market is open.`
        if (ctx.stallsOpened > 0) return 'You already run a stall. Open Business to manage it.'
        if (ctx.guest) return 'Settle in first: choose your look and tap Play, then you can rent a stall.'
      }
      if (action.id === 'person' && params?.gift === true && ctx.cash <= 0) return `You have ${naira(ctx.cash)}, so there is nothing to send yet.`
      if (action.id === 'account-sign-in' && ctx.signedIn) return 'You are signed in already. Your character is kept.'
      return null
    }
    case 'map': return ctx.places.some((place) => place.id === action.venue) ? null : 'That place is not in the city you are in.'
    case 'world': {
      const city = ctx.cities.find((item) => item.id === action.city)
      if (!city) return 'That city is not on the map yet.'
      if (!city.open) return `${city.name} is not open yet.`
      if (ctx.travelling) return 'You are on a trip right now. The map is open once you arrive.'
      return null
    }
    case 'go': return ctx.travelling ? 'You are on a trip right now. Ask me again once you arrive.' : null
    case 'call': {
      if (ctx.inCall) return 'You are in a call already.'
      const friend = ctx.friends.find((item) => item.id === action.friend)
      return friend && !friend.online ? `${friend.name} is offline right now.` : null
    }
    case 'relief': return ctx.stuck || ctx.rideDebt > 0 ? null : 'You are not short of money right now, so there is no help card to show.'
    case 'invite': return ctx.guest ? 'Sign up first: your invite link is kept with your account.' : null
    default: return null
  }
}

/** Panel ids a button opens (for the test that each exists). */
export function panelsOf(action: CompanionAction): string[] {
  switch (action.kind) {
    case 'open': return [action.id]
    case 'map': case 'world': return ['map']
    case 'sim': return [action.tab]
    case 'report': return ['support']
    case 'chat': return ['messages']
    case 'relief': return ['bank']
    default: return []
  }
}
export { hourWord }
