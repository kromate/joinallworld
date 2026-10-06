// Friends on the maps, from what the live frames and the friends list already hold: the model the country map draws its badges from, and
// "Show on map" (a friend's card, the People list, the Map's list of friends). Fetched with the map; nothing here asks the server for more.
import { friendsModel, routeToFriend } from '../../../map3d/geo/friends.ts'
import type { FriendsModel, MapRoute } from '../../../map3d/geo/friends.ts'
import { liveNow, social } from './useSocial.ts'

/** The friends the live frames place, as they stand now, judged against the player's own city. */
export const currentFriends = (cityId: string): FriendsModel => friendsModel({ friends: social.me?.friends ?? [], table: social.live, now: liveNow(), viewerCity: cityId })

/** What "Show on map" would do for a friend, or null when there is no place to show (offline, or not placed). */
export const mapRouteOf = (cityId: string, friendId: string): MapRoute => routeToFriend(currentFriends(cityId), friendId, cityId)

/** The two things the entry needs of the app. */
interface Hands {
  shell: { open(id: string, params?: unknown): boolean | void }
  showMapLayer(layer: 'city' | 'world', at?: { level?: number; city?: string; friends?: boolean }): void
}
/** Open the Map where the friend is: the city map at their venue, or the country map at their city with the list of friends there open. False when there is no place. */
export function showOnMap(hands: Hands, cityId: string, friendId: string): boolean {
  const route = mapRouteOf(cityId, friendId)
  if (!route) return false
  if (route.layer === 'city') hands.shell.open('map', { destination: route.destination })
  else hands.showMapLayer('world', { level: 2, city: route.city, friends: true })
  return true
}
