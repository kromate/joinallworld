// What each city changes in the shared routines (data.ts): the faith most of its people keep and a few local habits.
// A city that is not listed uses the shared table and counts as mixed, so a new city needs nothing here to work.
import type { CityRoutine, Faith } from './types.ts'

/** The faith most people of each city keep. 'mixed' cities close their stalls on Sunday morning too: the Christian day of rest is the one the whole country takes off. */
export const FAITH: Readonly<Record<string, Faith>> = {
  kano: 'muslim', katsina: 'muslim', sokoto: 'muslim', 'birnin-kebbi': 'muslim', gusau: 'muslim', dutse: 'muslim', bauchi: 'muslim',
  gombe: 'muslim', damaturu: 'muslim', maiduguri: 'muslim', minna: 'muslim', ilorin: 'muslim',
  'port-harcourt': 'christian', enugu: 'christian', 'benin-city': 'christian', calabar: 'christian', uyo: 'christian', umuahia: 'christian',
  owerri: 'christian', yenagoa: 'christian', awka: 'christian', asaba: 'christian', makurdi: 'christian', abakaliki: 'christian',
  'ado-ekiti': 'christian', akure: 'christian', jos: 'christian',
}

/** The share of a city's people (out of 100) who keep the Christian faith; the rest keep the Muslim one. */
export const CHRISTIAN_SHARE: Readonly<Record<Faith, number>> = { christian: 88, muslim: 8, mixed: 55 }

export const faithOf = (city: string): Faith => FAITH[city] ?? 'mixed'

export const CITY_ROUTINES: Readonly<Record<string, CityRoutine>> = {
  lagos: {
    note: 'Traders and cooks start in the dark to beat the traffic, and the bars close later than anywhere.',
    tweaks: {
      trader: { days: { any: [[6.5, 19]] } },
      cook: { days: { any: [[5, 20]] } },
      transit: { days: { any: [[4.5, 22]] } },
    },
    archetypes: { kunle: 'student' },
  },
  abuja: {
    note: 'A civil-service city: the offices keep their hours and the markets are quiet in the evening.',
    tweaks: { trader: { days: { any: [[8, 18]] } } },
  },
  'port-harcourt': {
    note: 'The nightlife starts earlier and the refinery never sleeps.',
    tweaks: { nightlife: { days: { thu: [[20, 28, true]] } } },
  },
  kano: {
    note: 'The market day starts before dawn prayer, offices keep a short Friday and the weekend is as busy as any other day.',
    tweaks: {
      trader: { days: { any: [[6, 19]] } },
      clerk: { days: { fri: [[8, 12.5]] } },
      teacher: { days: { fri: [[8, 12.5]] } },
    },
  },
  calabar: {
    note: 'The carnival city keeps its evenings long.',
    tweaks: { diner: { days: { weekend: [[10, 22]] } } },
  },
}
