// The snapshot the brain reads, built from the live game: the rules engine's view of the life, the city registry and the social client.
// Nothing here is sent anywhere. It is read each time the companion answers or the director looks.
import { cachedCityContent, cityRules, playableCityIds } from '../../../game/cities/registry.ts'
import { helpNow } from '../relief/reliefModel.ts'
import { callStore } from '../calls/callState.ts'
import { social } from '../social/useSocial.ts'
import { unreadChats } from '../messages/messagesModel.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import type { App } from '../../state/app.ts'
import type { CompanionContext, MissionFact, PlaceFact, StepFact } from './types.ts'

const lagosHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false })
const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })
export const hourOf = (ms: number): number => Number(lagosHour.format(new Date(ms))) % 24
export const dayOf = (ms: number): string => lagosDay.format(new Date(ms))

export function contextFromGame(app: App): CompanionContext {
  const { game } = app
  const view = game.view.value, state = game.state.value
  const goal = view.goals?.chip
  const step: StepFact | null = goal && goal.kind !== 'create' ? { title: goal.title, hint: goal.hint, ...(goal.go ? { go: goal.go as [string, string?] } : {}), ...(goal.open ? { open: goal.open } : {}), ...(goal.kind === 'goal' && goal.params ? { params: goal.params } : {}) } : null
  const kinds = cachedCityContent(game.cityId.value)?.venues
  const places: PlaceFact[] = (view.travel?.destinations ?? []).filter((item) => item.kind !== 'soon').map((item) => ({
    id: item.id, label: item.label, district: item.district, category: item.category, open: item.open, status: item.status, here: item.here, activities: item.preview ?? [], description: item.description,
    ...(kinds?.find((venue) => venue.id === item.id)?.kind === 'market' ? { market: true } : {}),
  }))
  const missions: MissionFact[] = (view.missions?.daily ?? []).filter((row) => !row.claimed).map((row) => ({ label: row.label, hint: row.hint, done: row.done, claimed: row.claimed, ...(row.go && row.go[0] ? { go: [row.go[0], row.go[1]] as [string, string?] } : {}), ...(row.open ? { open: row.open } : {}) }))
  const me = social.me
  const updates = me?.updates ?? []
  const rent = view.economy?.rent
  const now = game.serverNow()
  const here = game.cityId.value
  return {
    name: view.name || 'friend', hour: hourOf(now), cityId: here, cityName: cityRules(here)?.name ?? view.estate?.cityName ?? here,
    location: state.location, locationLabel: view.venues.find((venue) => venue.id === state.location)?.label ?? state.location,
    cash: state.cash, needs: { hunger: state.needs.hunger, energy: state.needs.energy, fun: state.needs.fun, social: state.needs.social, hygiene: state.needs.hygiene, bladder: state.needs.bladder },
    busy: Boolean(state.activeAction), travelling: Boolean(view.travel?.active) || state.activeAction?.kind === 'intercity',
    guest: Boolean(view.onboarding?.guest), newPlayer: (view.onboarding?.activities ?? 0) === 0 && view.onboarding?.timing?.firstAt == null,
    away: Boolean(view.estate?.visiting), rideDebt: view.estate?.ride?.debt ?? 0, stuck: helpNow(state, here) !== null,
    goal: step, missions: { locked: view.missions?.locked ?? null, claimable: view.missions?.claimable ?? 0, open: missions },
    places,
    cities: playableCityIds().flatMap((id) => { const rules = cityRules(id); return rules ? [{ id, name: rules.name, open: rules.status === 'open', here: id === here, home: view.estate?.home?.city === id }] : [] }),
    friends: (me?.friends ?? []).map((friend) => ({ id: friend.id, name: friend.name, online: friend.status === 'online', ...(friend.founder ? { founder: true } : {}) })),
    unread: unreadChats(me), employed: Boolean(view.career?.employed), jobRole: view.career?.role ?? null,
    stallsOpened: state.business?.opened ?? 0, stallAlert: updates.find((update) => update.kind === 'business' && !update.read)?.text ?? null,
    rentArrears: rent?.arrears ?? 0, rentDueSoon: Boolean(rent && rent.amount > 0 && rent.nextDue - now < 36 * 3_600_000 && state.cash < rent.amount),
    signedIn: Boolean(useAccountLite().state.account), picturesOn: me?.limits.pictures.on === true, soundOn: true, marketCloseHour: 20, inCall: callStore.view.phase !== 'idle' || callStore.confirm !== null,
    online: Object.keys(social.live ?? {}).length, mode: game.mode.value, friendCount: (me?.friends ?? []).filter((friend) => !friend.founder).length,
    sales: state.business?.sales ?? 0, jobLevel: view.career?.level ?? 0, trips: view.travel?.trips ?? 0, activities: view.onboarding?.activities ?? 0,
    joined: updates.filter((update) => update.kind === 'invite-joined').length, pingsWaiting: updates.filter((update) => update.kind === 'ping' && !update.read).length,
  }
}
