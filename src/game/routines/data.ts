// The routine of every kind of regular, in Lagos hours. See types.ts for how to read a row.
//
// Where the rows come from: how a Lagos day runs, written from common knowledge of it (stalls open at first light, offices keep
// Monday to Friday, nurses work in rotating shifts, the bars empty before the first call to prayer). Nobody measured these hours.
// A person's own start is moved a little (the early riser, the late riser, the daily wobble) by resolve.ts, so a whole market does not
// arrive in the same minute.
import type { Archetype, Routine } from './types.ts'

export const ROUTINES: Readonly<Record<Archetype, Routine>> = {
  trader: {
    note: 'Opens the stall at first light and packs up at dusk; closed for service on the day of rest. Waits out heavy rain a little later.',
    exposure: 'covered', staff: true, service: true,
    days: { any: [[7, 18.5]], sat: [[7, 19]] },
    rain: { any: [[8.5, 17.5]] },
  },
  cook: {
    note: 'The pot is on before the first customer; the last plate goes out at suppertime.',
    exposure: 'covered', staff: true, service: true,
    days: { any: [[5.5, 19.5]] },
  },
  maker: {
    note: 'Salon chairs, tailors and dyers: a long working day, shut for service.',
    exposure: 'covered', staff: true, service: true,
    days: { any: [[8.5, 19]] },
  },
  diner: {
    note: 'Comes for breakfast, lunch and supper rather than all day.',
    exposure: 'indoor',
    days: { weekday: [[7, 9], [12, 14.5], [17.5, 20]], weekend: [[9.5, 14], [17, 21]] },
  },
  shopper: {
    note: 'Shops in the daylight; the weekend market is fuller.',
    exposure: 'venue',
    days: { weekday: [[9, 17]], weekend: [[8, 19]] },
    rain: { weekday: [[11, 15.5]], weekend: [[11, 16]] },
  },
  visitor: {
    note: 'Visiting hours: late morning to the end of the afternoon.',
    exposure: 'venue',
    days: { weekday: [[10, 17.5]], weekend: [[10, 19]] },
  },
  resident: {
    note: 'The neighbour who is out in the cool of the morning and again after the heat.',
    exposure: 'venue',
    days: { weekday: [[6.5, 9], [16.5, 20]], weekend: [[8, 12.5], [15, 20.5]] },
  },
  walker: {
    note: 'Jogs at first light or strolls at dusk. Goes home when it rains.',
    exposure: 'outdoor',
    days: { weekday: [[5.5, 7.5], [17, 19.5]], weekend: [[6, 9], [16.5, 19.5]] },
  },
  fan: {
    note: 'Turns up for the evening kick-about and stays late on match weekends.',
    exposure: 'venue',
    days: { weekday: [[16.5, 20.5]], weekend: [[13.5, 20.5]] },
  },
  creative: {
    note: 'Hubs, studios and radio: a late start and a late finish.',
    exposure: 'indoor',
    days: { any: [[10, 21]], sun: [[14, 19]] },
    rain: { any: [[10, 22]] },
  },
  clerk: {
    note: 'Counters and desks keep office hours, Monday to Friday, and close earlier on Friday.',
    exposure: 'indoor', staff: true,
    days: { weekday: [[8, 17]], fri: [[8, 16]] },
  },
  teacher: {
    note: 'Lectures and lessons on weekdays, a half day on Saturday.',
    exposure: 'indoor', staff: true,
    days: { weekday: [[8, 17.5]], sat: [[10, 14]] },
  },
  student: {
    note: 'In class on weekdays, around the library on Saturday, at home on Sunday.',
    exposure: 'venue',
    days: { weekday: [[8, 17]], sat: [[10, 15]] },
  },
  medic: {
    note: 'Nurses and ward staff work a rotating shift (morning, afternoon or night) and have one day off a week.',
    exposure: 'indoor', staff: true, rota: true,
    days: {},
    shifts: [[[7, 15]], [[14, 22]], [[21, 31]]],
  },
  duty: {
    note: 'Gate, counter and tanker duty: a day shift or a night shift, with one day off a week.',
    exposure: 'venue', staff: true, rota: true,
    days: {},
    shifts: [[[6, 18]], [[18, 30]]],
  },
  transit: {
    note: 'Parks, stations and terminals run from before the first bus to after the last.',
    exposure: 'covered', staff: true,
    days: { any: [[5, 21]] },
  },
  guide: {
    note: 'Guides and attendants keep visiting hours every day of the week.',
    exposure: 'venue', staff: true,
    days: { any: [[9, 17.5]], weekend: [[10, 18]] },
  },
  keeper: {
    note: 'The caretaker unlocks early and locks up in the evening.',
    exposure: 'venue', staff: true,
    days: { any: [[6.5, 18]] },
  },
  worshipper: {
    note: 'Comes for the services of the house of worship; the days and prayers are those of its faith (see WORSHIP).',
    exposure: 'indoor',
    days: {},
  },
  nightlife: {
    note: 'Out after dark and gone before the first call to prayer. The closing hour is pinned: nobody is at the bar at dawn.',
    exposure: 'indoor',
    days: { any: [[21, 28, true]], mon: [[22, 26, true]], tue: [[22, 26, true]], wed: [[21, 27, true]], fri: [[19.5, 28, true]], sat: [[19.5, 28, true]] },
  },
  athlete: {
    note: 'Trains before work and after it; a long Saturday morning.',
    exposure: 'indoor',
    days: { weekday: [[5.5, 8], [17, 21]], weekend: [[7, 12]] },
  },
}

/** The prayers and services of a house of worship, by faith. The worshipper's `days` are these. */
export const WORSHIP: Readonly<Record<'church' | 'mosque', Routine['days']>> = {
  church: { weekday: [[6, 7.5], [17.5, 19]], wed: [[17.5, 20]], fri: [[17.5, 20.5]], sat: [[10, 13]], sun: [[7, 13.5]] },
  mosque: { any: [[5, 6.25], [13, 14], [16.25, 17.25], [18.5, 19.5], [20, 21]], fri: [[5, 6.25], [12.75, 14.5], [16.25, 17.25], [18.5, 19.5], [20, 21]] },
}

/** The hours of the service that the day of rest is kept for: the windows in which a person who keeps it is at church or at the mosque. */
export const SERVICE = {
  church: { weekday: 0, from: 7.25, to: 12.5 },
  mosque: { weekday: 5, from: 12.75, to: 14.5 },
} as const
