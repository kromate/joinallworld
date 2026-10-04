/**
 * OWNER: world
 * Venue catalogue: venue → district, opening hours, spots → activities, scene description.
 *
 * Shape (see systems/activities.js for the full activity definition format):
 *   VENUES[id] = {
 *     id, label, district, icon?, description?,
 *     hours?: { open, close, days? },          // Lagos time; omitted = always open
 *     travelMode?: 'trek',                     // restrict travel here to one mode
 *     scene: { kind, ... },                    // read by src/scene/venue-scenes.js
 *     spots: { [spotId]: { id, label, icon?, caption?, activities: [activityDef, ...] } },
 *   }
 * The first spot of a venue is where a player stands on arrival. Other systems (jobs, home
 * furniture) attach their own activities to these spots by id, so keep spot ids stable.
 * CITY_LABELS overrides display names per city; ids and rules are shared between cities.
 *
 * Provenance: `beta: true` marks an original beta value. Entries without it follow what was
 * observed in the reference game. `unavailable: true` entries are listed in the reference
 * game but their outcome is unverified, so they cannot be started.
 */

const unverified = 'Listed in the reference game; outcome unverified.';

export const VENUES = {
  park: {
    id: 'park', label: 'Freedom Park', district: 'Lagos Island', icon: '🌳',
    description: 'A place to relax, enjoy art and meet your city.',
    scene: { kind: 'park' },
    spots: {
      amphitheatre: { id: 'amphitheatre', label: 'Amphitheatre', icon: '🎭', caption: 'Poets warming up by the stage', activities: [
        { id: 'stage-play', label: 'Stage Play', icon: '🎭', duration: 14, cost: 400, tags: ['fun'], unavailable: true, note: unverified },
        { id: 'comedy', label: 'Comedy', icon: '😂', duration: 11, cost: 500, tags: ['fun', 'social'], unavailable: true, note: unverified },
        { id: 'spoken-word', label: 'Spoken Word', icon: '🗣️', duration: 9, cost: 0, unavailable: true, note: unverified },
        { id: 'perform-comedy', label: 'Perform Comedy', icon: '🎙️', duration: 11, requiresSkill: { id: 'comedy', level: 3 }, unavailable: true, note: unverified },
      ] },
      art: { id: 'art', label: 'Art gallery', icon: '🖼️', caption: 'Art in the heart of the city', activities: [] },
      trees: { id: 'trees', label: 'Under the trees', icon: '🌳', caption: 'Cool breeze under the trees', activities: [
        { id: 'chill', label: 'Chill Under the Trees', icon: '🌳', duration: 11, cost: 0, effects: { energy: 4, fun: 10 },
          note: 'Duration and effects as observed in the reference game.' },
        { id: 'play-ayo', label: 'Play Ayo', icon: '🎲', duration: 7, cost: 0, tags: ['fun', 'social'], unavailable: true, note: unverified },
      ] },
      drinks: { id: 'drinks', label: 'Drinks kiosk', icon: '🍹', caption: 'A quiet stop by the kiosk', activities: [] },
      people: { id: 'people', label: 'People', icon: '👥', caption: 'Meet your city community', activities: [] },
      work: { id: 'work', label: 'Community desk', icon: '💼', caption: 'Lend a hand at the Community desk', beta: true, activities: [] },
    },
  },
  library: {
    id: 'library', label: 'The Library', district: 'Victoria Island', icon: '📚',
    description: 'Books, music and a quiet place to unwind.',
    scene: { kind: 'library' },
    spots: {},
  },
  home: {
    id: 'home', label: 'Home', district: 'Local beta home', icon: '🏠', beta: true,
    description: 'Your beta home: eat, wash and rest. Free travel home.',
    travelLabel: 'Free beta travel', travelMode: 'trek',
    scene: { kind: 'home' },
    spots: {
      kitchen: { id: 'kitchen', label: 'Kitchen', icon: '🥣', activities: [
        { id: 'garri', label: 'Eat Garri', icon: '🥣', duration: 5, cost: 0, effects: { hunger: 20 }, tags: ['food'], beta: true,
          note: 'Duration observed in the reference game; the +20 hunger amount is an original beta value.' },
      ] },
      bathroom: { id: 'bathroom', label: 'Bathroom', icon: '🛁', activities: [
        { id: 'bath', label: 'Take a Bath', icon: '🛁', duration: 6, cost: 0, effects: { hygiene: 25 }, tags: ['hygiene'], beta: true,
          note: 'Duration observed in the reference game; the +25 hygiene amount is an original beta value.' },
      ] },
      bedroom: { id: 'bedroom', label: 'Bedroom', icon: '🛏️', activities: [
        { id: 'nap', label: 'Take a Nap', icon: '🛏️', duration: 15, cost: 0, effects: {}, effectsPerSecond: { energy: 2 }, tags: ['sleep'], beta: true,
          note: 'Original beta rate: +2 energy per second; accrued energy survives an early stop.' },
      ] },
    },
  },
};

/** Per-city display overrides. Rules, ids and activities are shared. */
export const CITY_LABELS = {
  ibadan: {
    park: { label: 'Agodi Gardens', district: 'Ibadan' },
    library: { label: 'City Reading Room', district: 'Ibadan' },
  },
};

export const venueLabel = (venueId, cityId) => CITY_LABELS[cityId]?.[venueId]?.label ?? VENUES[venueId]?.label ?? venueId;
export const venueDistrict = (venueId, cityId) => CITY_LABELS[cityId]?.[venueId]?.district ?? VENUES[venueId]?.district ?? '';
