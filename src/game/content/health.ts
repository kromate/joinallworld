/**
 * OWNER: world
 * Weather, illness, their feelings and treatments.
 *
 * Provenance: the two feelings — "Soaked by Rain" −8 and "Very Sick" −35 — and the fact that
 * the hospital and roadside agbo treat illness were observed in the reference game. A trek
 * costing a sick, rain-soaked character 12 Energy and 9 Hygiene (2 more of each than a
 * healthy one) was also observed. Causes, chances, durations, prices and the weather cycle
 * were not, and are original beta values.
 */
export const HEALTH = {
  feelings: {
    soaked: { id: 'soaked', label: 'Soaked by Rain', value: -8, duration: 600, text: 'The rain gave no warning.' },
    sick: { id: 'very-sick', label: 'Very Sick', value: -35, text: 'You need a doctor. Go to the General Hospital.' },
    recovered: { id: 'recovered', label: 'On the Mend', value: 5, duration: 600, text: 'Feeling like yourself again.', beta: true },
  },
  /** Extra need cost of a trek while sick. */
  sickTrek: { energy: -2, hygiene: -2 },

  weather: {
    beta: true,
    /** The sky is decided once per block for the whole city, from the block's index. */
    blockMinutes: 20,
    rainChance: 0.2,
    kinds: {
      clear: { id: 'clear', label: 'Dry', icon: '🌤️', text: 'Dry weather. Any way of getting around is fine.' },
      rain: { id: 'rain', label: 'Raining', icon: '🌧️', text: 'It is raining. Trek or ride an okada and you will arrive soaked.' },
    },
  },

  illness: {
    beta: true,
    /** Chance of falling sick each time rain soaks you. */
    soakedChance: 0.12,
    /** A need under this counts as neglected. */
    neglectBelow: 15,
    neglectNeeds: ['hygiene', 'hunger'],
    /** Seconds of neglect (while playing) before you fall sick. Recovers twice as fast once you wash and eat. */
    neglectSeconds: 1200,
    /** Time counted per settlement, so a long absence cannot make you sick on its own. */
    maxStepSeconds: 90,
    /** Show the "run down" warning from this fraction of the way to falling sick. */
    warnAt: 0.5,
    /** Illness passes on its own after this long. */
    selfHealSeconds: 6 * 3600,
    /** After a cure (or agbo, or vitamins) you cannot fall sick again for this long. */
    immunitySeconds: { cure: 1800, agbo: 1800, vitamins: 7200 },
  },

  /** Listed in the Health app. `activity` ids live in content/venues.js; agbo is a roadside event. */
  cures: [
    { id: 'doctor', label: 'See the Doctor', where: 'hospital', spot: 'clinic', activity: 'hospital-doctor', text: 'Quick and certain.' },
    { id: 'free-clinic', label: 'Queue at the Free Clinic', where: 'hospital', spot: 'ward', activity: 'hospital-free', text: 'Costs nothing but a long wait. Always available.' },
    { id: 'agbo', label: 'Agbo from the roadside seller', where: null, cost: 600, text: 'She finds you when you trek while sick.' },
    { id: 'rest', label: 'Wait it out', where: null, cost: 0, text: 'Illness passes by itself after about six hours.' },
  ],
};
