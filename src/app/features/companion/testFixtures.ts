// Crafted game snapshots for the companion's tests: a settled player in Lagos by default, changed per case.
import type { CompanionContext, PlaceFact } from './types.ts'

const place = (id: string, label: string, district: string, category: string, extra: Partial<PlaceFact> = {}): PlaceFact => ({ id, label, district, category, open: true, status: 'Open now', here: false, activities: [], description: '', ...extra })

export const PLACES: PlaceFact[] = [
  place('park', 'Freedom Park', 'Lagos Island', 'fun', { here: true, activities: ['Play Ayo', 'Chill Under the Trees'] }),
  place('amala-shitta', 'Amala Shitta', 'Surulere', 'food', { activities: ['Amala and ewedu'] }),
  place('cchub', 'CcHub', 'Yaba', 'work', { activities: ['Code for a client'] }),
  place('hospital', 'General Hospital', 'Gbagada', 'care'),
  place('market', 'Market', 'Lagos Island', 'work', { description: 'Stalls and trade' }),
  place('office', 'Office', 'Marina', 'work'),
  place('quilox', 'Quilox', 'Victoria Island', 'nightlife', { open: false, status: 'Closed · opens 9PM' }),
  place('beach', 'Beach', 'Lekki', 'fun'),
  place('church', 'Church', 'Lagos Island', 'care'),
  place('police', 'Police Station', 'Lagos Island', 'civic'),
]

export function ctx(over: Partial<CompanionContext> = {}): CompanionContext {
  return {
    name: 'Ada', hour: 11, cityId: 'lagos', cityName: 'Lagos', location: 'park', locationLabel: 'Freedom Park', cash: 8000,
    needs: { hunger: 80, energy: 80, fun: 70, social: 60, hygiene: 80, bladder: 80 },
    busy: false, travelling: false, guest: false, newPlayer: false, away: false, rideDebt: 0, stuck: false,
    goal: null, missions: { locked: null, claimable: 0, open: [] },
    places: PLACES,
    cities: [
      { id: 'lagos', name: 'Lagos', open: true, here: true, home: true },
      { id: 'abuja', name: 'Abuja', open: true, here: false, home: false },
      { id: 'ibadan', name: 'Ibadan', open: true, here: false, home: false },
      { id: 'kano', name: 'Kano', open: true, here: false, home: false },
      { id: 'port-harcourt', name: 'Port Harcourt', open: true, here: false, home: false },
    ],
    friends: [], unread: 0, employed: false, jobRole: null, stallsOpened: 0, stallAlert: null, rentArrears: 0, rentDueSoon: false,
    signedIn: true, picturesOn: false, soundOn: true, marketCloseHour: 20, inCall: false, online: 40,
    mode: 'venue', friendCount: 0, sales: 0, jobLevel: 0, trips: 0, activities: 12, joined: 0, pingsWaiting: 0,
    ...over,
  }
}
