/**
 * OWNER: world
 * Venue catalogue: venue → district, opening hours, map position, spots → activities, scene.
 *
 * Shape (see systems/activities.ts for the full activity definition format):
 *   VENUES[id] = {
 *     id, label, district, icon, description,
 *     category,                                // key of VENUE_CATEGORIES (map filter bar)
 *     hours?: { open, close, days? },          // Lagos time; omitted = always open
 *     zone: 'mainland' | 'island' | 'east',    // landmass; crossing the lagoon is a long trip
 *     map: { x, y },                           // position in percent of the city map (1000 × 700 units)
 *     ambient: [line, ...],                    // rotating one-liners for the venue card
 *     scene: { kind, variant?, anchors? },     // read by src/scene/venue-scenes.ts. `variant` picks the look where one kind has
 *                                              // several (club: speakeasy; worship: church | mosque). `anchors` pins a spot id —
 *                                              // including spots other systems add, such as 'work' — to a landmark of the scene.
 *     spots: { [spotId]: { id, label, icon?, caption?, activities: [activityDef, ...] } },
 *   }
 * The first spot of a venue is where a player stands on arrival. Other systems (jobs, home
 * furniture, people) attach their own activities to these spots by id, so spot ids are stable.
 * Other cities supply their own venue definitions through their city modules.
 *
 * Extra activity fields understood by the world systems (any owner may use them):
 *   cooldown         seconds before the same activity can be started again (systems/travel.ts)
 *   requiresMoodlet  id of a feeling the player must currently have; requiresReason is the text shown otherwise (systems/travel.ts)
 *   clears           [moodletId, ...] removed on completion (systems/travel.ts)
 *   requiresIllness  true = only while sick (systems/health.ts)
 *   tags 'cure' / 'checkup' / 'immunity' are acted on by systems/health.ts
 *
 * Provenance: `beta: true` marks an entry whose numbers are original beta values. Where a
 * `note` says so, the name, duration or price is fixed and only the effect amounts are
 * provisional. Entries without `beta` are fixed. Opening hours
 * are original beta values except where a comment says otherwise. Earning activities are
 * bounded three ways, so none of them can be repeated without limit: a cooldown, a need cost,
 * and GIG_DAILY_LIMIT paid gigs per Lagos day across the whole city (systems/travel.ts).
 */
import { AIRPORT, REFINERY } from '../../content/venues-transport.ts';
import { UNILAG_VENUE } from '../../../campus/unilag/content.ts';
import type { VenueDefinition, HomeMapSpot } from '../../../types/content.ts';
import type { HouseId } from '../../../types/life.ts';
const seenCard = 'Duration and price are fixed; effect amounts are original beta values.';
const seenName = 'Name is fixed; duration, price and effects are original beta values.';

const VENUES_DATA = {
  park: {
    id: 'park', label: 'Freedom Park', district: 'Lagos Island', icon: '🌳', category: 'fun',
    description: 'A place to relax, enjoy art and meet your city.',
    zone: 'island', map: { x: 45, y: 82 }, scene: { kind: 'park' },
    ambient: ['A poet is testing the microphone', 'The breeze is doing the Lord’s work under the trees', 'Fresh canvases just went up in the gallery', 'Ushers are sweeping the stage for tonight'],
    spots: {
      amphitheatre: { id: 'amphitheatre', label: 'Amphitheatre', icon: '🎭', caption: 'Poets warming up by the stage', activities: [
        { id: 'stage-play', label: 'Watch a Stage Play', icon: '🎭', duration: 14, cost: 400, effects: { fun: 18 }, tags: ['fun', 'show'], beta: true, note: seenCard },
        { id: 'comedy-show', label: 'Watch a Comedy Show', icon: '😂', duration: 11, cost: 500, effects: { fun: 16, social: 6 }, xp: { comedy: 6 }, tags: ['fun', 'social', 'show'], beta: true, note: seenCard },
        { id: 'spoken-word', label: 'Spoken Word Open Mic', icon: '🗣️', duration: 9, cost: 0, effects: { fun: 6, social: 8 }, xp: { charisma: 10 }, tags: ['fun', 'social'], beta: true, note: seenCard },
        { id: 'open-mic-jokes', label: 'Test Jokes at the Open Mic', icon: '🎤', duration: 9, cost: 0, effects: { energy: -3, social: 5 }, xp: { comedy: 22 }, tags: ['training'], beta: true },
        { id: 'perform-comedy', label: 'Perform at Comedy Night', icon: '🎙️', duration: 11, requiresSkill: { id: 'comedy', level: 3 }, reward: 900, minimumNeeds: { energy: 20 },
          effects: { energy: -8, fun: 10, social: 10 }, xp: { comedy: 25 }, cooldown: 600, tags: ['performance'], beta: true,
          note: 'Duration and the Comedy 3 requirement are fixed; pay, effects and cooldown are original beta values.' },
      ] },
      art: { id: 'art', label: 'Art gallery', icon: '🖼️', caption: 'Art in the heart of the city', activities: [
        { id: 'see-art', label: 'See the Exhibition', icon: '🖼️', duration: 10, cost: 200, effects: { fun: 12 }, xp: { photography: 6 }, tags: ['fun', 'art'], beta: true },
        { id: 'park-shoot-sculptures', label: 'Photograph the Sculptures', icon: '📷', duration: 9, cost: 0, effects: { fun: 5 }, xp: { photography: 20 }, tags: ['training', 'art'], beta: true },
        { id: 'park-sell-prints', label: 'Sell Your Prints', icon: '🖨️', duration: 12, requiresSkill: { id: 'photography', level: 3 }, reward: 700, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 20, hustle: 8 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      trees: { id: 'trees', label: 'Under the trees', icon: '🌳', caption: 'Cool breeze under the trees', activities: [
        { id: 'chill', label: 'Chill Under the Trees', icon: '🌳', duration: 11, cost: 0, effects: { energy: 4, fun: 10 },
          note: 'Duration and effects are fixed.' },
        { id: 'play-ayo', label: 'Play Ayo', icon: '🎲', duration: 7, cost: 0, effects: { fun: 8, social: 8 }, tags: ['fun', 'social'], beta: true, note: seenCard },
      ] },
      drinks: { id: 'drinks', label: 'Drinks kiosk', icon: '🍹', caption: 'A quiet stop by the kiosk', activities: [
        { id: 'park-zobo', label: 'Chilled Zobo', icon: '🥤', duration: 5, cost: 200, effects: { hunger: 8, fun: 6, bladder: -6 }, tags: ['food', 'drink'], beta: true },
        { id: 'park-palmwine', label: 'Palm Wine & Suya', icon: '🍢', duration: 8, cost: 600, effects: { hunger: 25, fun: 12, social: 4, bladder: -8 }, tags: ['food'], beta: true },
        { id: 'park-kiosk-gist', label: 'Gist with the Kiosk Lady', icon: '💬', duration: 7, cost: 0, effects: { social: 10 }, xp: { charisma: 8 }, tags: ['social'], beta: true },
      ] },
      people: { id: 'people', label: 'People', icon: '👥', caption: 'Meet your city community', activities: [] },
      work: { id: 'work', label: 'Community desk', icon: '💼', caption: 'Lend a hand at the Community desk', beta: true, activities: [] },
    },
  },
  library: {
    id: 'library', label: 'The Library', district: 'Victoria Island', icon: '📚', category: 'nightlife',
    description: 'A lounge hidden behind a wall of books: low lights, cocktails and a dance floor that never closes.',
    // it stays open round the clock
    zone: 'island', map: { x: 64, y: 82 }, scene: { kind: 'club', variant: 'speakeasy' },
    ambient: ['Somebody just found the right book', 'The DJ is easing into amapiano', 'Candles flicker along the shelves', 'A birthday crew is filling the lounge'],
    spots: {
      bookcase: { id: 'bookcase', label: 'Secret bookcase', icon: '📚', caption: 'One of these books is a door handle', activities: [
        { id: 'lib-bookcase', label: 'Find the Secret Bookcase', icon: '🔎', duration: 8, cost: 0, effects: { fun: 10 }, tags: ['fun'], beta: true, note: seenName },
        { id: 'lib-read', label: 'Read by Candlelight', icon: '🕯️', duration: 12, cost: 0, effects: { energy: 4, fun: 6 }, xp: { charisma: 6 }, tags: ['rest'], beta: true, note: seenName },
      ] },
      lounge: { id: 'lounge', label: 'Lounge', icon: '🛋️', caption: 'Deep sofas, deeper gist', activities: [
        { id: 'lib-lounge', label: 'Chill in the Lounge', icon: '🛋️', duration: 11, cost: 0, effects: { energy: 5, fun: 8 }, tags: ['rest'], beta: true, note: seenName },
        { id: 'lib-selfies', label: 'Selfies for the ’Gram', icon: '🤳', duration: 8, cost: 0, effects: { fun: 6, social: 4 }, xp: { photography: 18 }, tags: ['training', 'social'], beta: true, note: seenName },
        { id: 'lib-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
      bar: { id: 'bar', label: 'Cocktail bar', icon: '🍸', caption: 'The bartender remembers your order', activities: [
        { id: 'lib-cocktails', label: 'Cocktails with the Crew', icon: '🍸', duration: 9, cost: 2500, effects: { fun: 18, social: 14, bladder: -10 }, tags: ['drink', 'social'], beta: true, note: seenName },
        { id: 'lib-gold-bottle', label: 'Order the Gold Bottle', icon: '🍾', duration: 10, cost: 30000, effects: { fun: 30, social: 25, bladder: -10 },
          moodlets: [{ id: 'big-spender', label: 'Big Spender', value: 10, duration: 1800 }], tags: ['status', 'broadcast'], beta: true, note: seenName },
      ] },
      dance: { id: 'dance', label: 'Dance floor', icon: '🪩', caption: 'Shoulders are already moving', activities: [
        { id: 'lib-dance', label: 'Dance to the DJ', icon: '🪩', duration: 10, cost: 0, effects: { fun: 14, energy: -6 }, xp: { dance: 20 }, tags: ['training', 'fun'], beta: true, note: seenName },
        { id: 'lib-shoutout', label: 'Pay the DJ for a Shout-out', icon: '📣', duration: 6, cost: 2000, effects: { fun: 8, social: 12 },
          moodlets: [{ id: 'name-on-the-mic', label: 'Name on the Mic', value: 4, duration: 900 }], tags: ['status', 'broadcast'], beta: true, note: seenName },
      ] },
    },
  },
  home: {
    id: 'home', label: 'Home', district: 'Your place', icon: '🏠', category: 'home', beta: true,
    description: 'Your own place: eat, wash and rest. Always open, and every transport option goes there.',
    zone: 'mainland', map: { x: 53, y: 29 }, scene: { kind: 'home' },
    ambient: ['The neighbour’s generator hums', 'Somewhere a pot of stew is frying'],
    spots: {
      kitchen: { id: 'kitchen', label: 'Kitchen', icon: '🥣', activities: [
        // The free fallback behind the cooler's Soak Garri & Sugar: listed only when that cannot be made
        // (systems/home.ts), so nobody is ever stuck hungry with an empty kitchen. The id is kept for old saves.
        { id: 'garri', label: 'Eat Dry Garri', icon: '🥣', duration: 5, cost: 0, effects: { hunger: 20 }, tags: ['food'], beta: true,
          note: 'Original beta fallback: free, no ingredients, +20 hunger. Duration for soaking garri is fixed.' },
      ] },
      bathroom: { id: 'bathroom', label: 'Bathroom', icon: '🛁', activities: [
        { id: 'bath', label: 'Take a Bath', icon: '🛁', duration: 6, cost: 0, effects: { hygiene: 25 }, tags: ['hygiene'], beta: true,
          note: 'Duration is fixed; the +25 hygiene amount is an original beta value.' },
      ] },
      bedroom: { id: 'bedroom', label: 'Bedroom', icon: '🛏️', activities: [
        { id: 'nap', label: 'Take a Nap', icon: '🛏️', duration: 15, cost: 0, effects: {}, effectsPerSecond: { energy: 2 }, tags: ['sleep'], beta: true,
          note: 'Original beta rate: +2 energy per second; accrued energy survives an early stop.' },
      ] },
    },
  },
  radio: {
    id: 'radio', label: 'Naija Radio', district: 'Ikeja', icon: '📻', category: 'work',
    description: 'The station the whole city argues with. Walk in, call in, or get on air.',
    zone: 'mainland', map: { x: 16, y: 27 }, scene: { kind: 'radio', anchors: { reception: 'lounge', studio: 'studio', booth: 'control', newsroom: 'news' } },
    ambient: ['The ON AIR light is red', 'A caller is shouting about traffic', 'Jingle rehearsal down the corridor', 'The newsroom printer has jammed again'],
    spots: {
      reception: { id: 'reception', label: 'Reception', icon: '🛎️', caption: 'Sign the visitors’ book', activities: [
        { id: 'radio-tour', label: 'Take the Studio Tour', icon: '🎧', duration: 9, cost: 0, effects: { fun: 8 }, tags: ['fun'], beta: true },
        { id: 'radio-request', label: 'Request a Song', icon: '🎶', duration: 5, cost: 200, effects: { fun: 8 }, xp: { music: 4 }, tags: ['fun'], beta: true },
      ] },
      studio: { id: 'studio', label: 'Live studio', icon: '🎙️', caption: 'Mind the cables', activities: [
        { id: 'radio-callin', label: 'Call In to the Morning Show', icon: '📞', duration: 8, cost: 0, effects: { social: 8 }, xp: { charisma: 18, comedy: 6 }, tags: ['training', 'social'], beta: true },
        { id: 'radio-guest', label: 'Guest on a Talk Show', icon: '🗣️', duration: 12, requiresSkill: { id: 'charisma', level: 3 }, reward: 800, minimumNeeds: { energy: 20 },
          effects: { energy: -6, social: 10 }, xp: { charisma: 24 }, cooldown: 900, tags: ['performance'], beta: true },
        { id: 'radio-skit', label: 'Perform a Radio Skit', icon: '🎭', duration: 12, requiresSkill: { id: 'comedy', level: 4 }, reward: 1000, minimumNeeds: { energy: 20 },
          effects: { energy: -8, fun: 6 }, xp: { comedy: 28 }, cooldown: 900, tags: ['performance'], beta: true },
      ] },
      booth: { id: 'booth', label: 'Recording booth', icon: '🎚️', caption: 'Foam walls, honest playback', activities: [
        { id: 'radio-demo', label: 'Record a Demo', icon: '🎚️', duration: 13, cost: 1500, effects: { fun: 6, energy: -4 }, xp: { music: 45 }, tags: ['training'], beta: true },
        { id: 'radio-jingle', label: 'Voice a Jingle', icon: '🎵', duration: 12, requiresSkill: { id: 'music', level: 5 }, reward: 1800, minimumNeeds: { energy: 20 },
          effects: { energy: -8 }, xp: { music: 30 }, cooldown: 1200, tags: ['performance'], beta: true },
      ] },
      newsroom: { id: 'newsroom', label: 'Newsroom', icon: '📰', caption: 'Deadline in ten minutes', activities: [
        { id: 'radio-headlines', label: 'Practise Reading the Headlines', icon: '📰', duration: 9, cost: 0, effects: { fun: 2 }, xp: { charisma: 10 }, tags: ['training'], beta: true },
        { id: 'radio-errands', label: 'Run Errands for the Newsroom', icon: '🏃', duration: 13, reward: 250, minimumNeeds: { energy: 20 },
          effects: { energy: -8, hunger: -4 }, xp: { hustle: 10 }, cooldown: 300, tags: ['gig'], beta: true },
      ] },
    },
  },
  shrine: {
    id: 'shrine', label: 'Afrika Shrine', district: 'Ikeja', icon: '🎷', category: 'nightlife',
    description: 'Afrobeat’s home ground. Horns, drums, yabis and a dance floor that never empties.',
    hours: { open: 16, close: 5 },
    zone: 'mainland', map: { x: 26, y: 13 }, scene: { kind: 'shrine', anchors: { yard: 'grill', work: 'backstage' } },
    ambient: ['The horn section is tuning up', 'Somebody is preaching about the government', 'The drums have started a call and response', 'Suya smoke is drifting over the yard'],
    spots: {
      stage: { id: 'stage', label: 'Main stage', icon: '🎷', caption: 'The band never really stops', activities: [
        { id: 'shrine-live', label: 'Watch the Live Band', icon: '🎷', duration: 12, cost: 1000, effects: { fun: 20, social: 6 }, xp: { music: 6 }, tags: ['fun', 'show'], beta: true },
        { id: 'shrine-jam', label: 'Join the Open Jam', icon: '🎸', duration: 11, cost: 0, effects: { energy: -5, fun: 8 }, xp: { music: 28 }, tags: ['training'], beta: true },
        { id: 'shrine-perform', label: 'Perform a Set', icon: '🎤', duration: 14, requiresSkill: { id: 'music', level: 3 }, reward: 1200, minimumNeeds: { energy: 25 },
          effects: { energy: -12, fun: 8 }, xp: { music: 30, charisma: 8 }, cooldown: 600, tags: ['performance'], beta: true },
        { id: 'shrine-headline', label: 'Headline the Night', icon: '🌟', duration: 16, requiresSkill: { id: 'music', level: 7 }, reward: 2500, minimumNeeds: { energy: 35 },
          effects: { energy: -18, fun: 14, social: 14 }, xp: { music: 50 }, cooldown: 1800, tags: ['performance'], beta: true },
      ] },
      floor: { id: 'floor', label: 'Dance floor', icon: '💃', caption: 'Waists are working overtime', activities: [
        { id: 'shrine-dance', label: 'Dance to Afrobeat', icon: '💃', duration: 10, cost: 0, effects: { fun: 14, energy: -6 }, xp: { dance: 22 }, tags: ['training', 'fun'], beta: true },
        { id: 'shrine-backup', label: 'Dance Backup for the Band', icon: '🕺', duration: 12, requiresSkill: { id: 'dance', level: 4 }, reward: 900, minimumNeeds: { energy: 25 },
          effects: { energy: -14, hygiene: -5 }, xp: { dance: 28 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      bar: { id: 'bar', label: 'Palm wine bar', icon: '🥥', caption: 'Calabashes lined up on the counter', activities: [
        { id: 'shrine-palmwine', label: 'Calabash of Palm Wine', icon: '🥥', duration: 6, cost: 400, effects: { fun: 10, social: 5, bladder: -10 }, tags: ['drink'], beta: true },
        { id: 'shrine-suya', label: 'Suya & Onions', icon: '🍢', duration: 7, cost: 700, effects: { hunger: 30, fun: 5 }, tags: ['food'], beta: true },
      ] },
      yard: { id: 'yard', label: 'Drum circle', icon: '🥁', caption: 'Talking drums are talking', activities: [
        { id: 'shrine-drums', label: 'Learn the Talking Drum', icon: '🥁', duration: 12, cost: 300, effects: { fun: 5 }, xp: { music: 34 }, tags: ['training'], beta: true },
        { id: 'shrine-yabis', label: 'Join the Yabis Session', icon: '😆', duration: 9, cost: 0, effects: { social: 10, fun: 6 }, xp: { comedy: 14 }, tags: ['social', 'training'], beta: true },
      ] },
    },
  },
  'viewing-centre': {
    id: 'viewing-centre', label: 'Viewing Centre', district: 'Ojuelegba', icon: '⚽', category: 'fun',
    description: 'Plastic chairs, one giant screen and two hundred head coaches.',
    hours: { open: 10, close: 2 },
    zone: 'mainland', map: { x: 35, y: 28 }, scene: { kind: 'viewing', anchors: { screen: 'benches', benches: 'banter', pitch: 'gate', kiosk: 'snacks', work: 'gate' } },
    ambient: ['The generator just kicked in — the match is safe', 'Someone is insisting it was offside', 'A late goal just sent chairs flying', 'The kiosk boy is weaving through with cold drinks'],
    spots: {
      screen: { id: 'screen', label: 'Big screen', icon: '📺', caption: 'Front row or nothing', activities: [
        { id: 'view-match', label: 'Watch the Big Match', icon: '⚽', duration: 14, cost: 300, effects: { fun: 20, social: 8 }, tags: ['fun', 'show'], beta: true },
        { id: 'view-argue', label: 'Argue About the Line-up', icon: '🗯️', duration: 8, cost: 0, effects: { social: 12, fun: 5 }, xp: { charisma: 10 }, tags: ['social'], beta: true },
      ] },
      benches: { id: 'benches', label: 'Back benches', icon: '🪑', caption: 'Where the real commentary happens', activities: [
        { id: 'view-banter', label: 'Crack Jokes at Half-time', icon: '😂', duration: 9, cost: 0, effects: { fun: 8, social: 6 }, xp: { comedy: 20 }, tags: ['training', 'social'], beta: true },
        { id: 'view-commentary', label: 'Do the Live Commentary', icon: '🎙️', duration: 12, requiresSkill: { id: 'comedy', level: 2 }, reward: 600, minimumNeeds: { energy: 20 },
          effects: { energy: -6, social: 8 }, xp: { comedy: 22, charisma: 8 }, cooldown: 480, tags: ['performance'], beta: true },
      ] },
      pitch: { id: 'pitch', label: 'Five-a-side pitch', icon: '🥅', caption: 'Monkey post, rubber ball', activities: [
        { id: 'view-kickabout', label: 'Five-a-side Kickabout', icon: '🏃', duration: 12, cost: 0, minimumNeeds: { energy: 20 }, effects: { energy: -10, hygiene: -6, fun: 12 }, xp: { fitness: 26 }, tags: ['training', 'fun'], beta: true },
        { id: 'view-setpiece', label: 'Win the Set-piece Challenge', icon: '🏆', duration: 12, requiresSkill: { id: 'fitness', level: 3 }, reward: 700, minimumNeeds: { energy: 25 },
          effects: { energy: -12, hygiene: -6 }, xp: { fitness: 24 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      kiosk: { id: 'kiosk', label: 'Snack kiosk', icon: '🥤', caption: 'Cold drinks, hot arguments', activities: [
        { id: 'view-gala', label: 'Sausage Roll & Soft Drink', icon: '🥤', duration: 5, cost: 350, effects: { hunger: 18, fun: 3, bladder: -4 }, tags: ['food'], beta: true },
        { id: 'view-run-drinks', label: 'Run Drinks for the Kiosk', icon: '🧊', duration: 12, reward: 250, minimumNeeds: { energy: 20 },
          effects: { energy: -8, hunger: -3 }, xp: { hustle: 12 }, cooldown: 300, tags: ['gig'], beta: true },
      ] },
    },
  },
  'amala-shitta': {
    id: 'amala-shitta', label: 'Amala Shitta', district: 'Surulere', icon: '🍲', category: 'food',
    description: 'A famous Surulere buka: amala, gbegiri and ewedu, and a queue that is half the fun.',
    // it never closes
    zone: 'mainland', map: { x: 44, y: 13 }, scene: { kind: 'buka', anchors: { work: 'wash' } },
    ambient: ['“Add extra pepper” — a regular, loudly', 'A new pot of ewedu has just landed', 'Fuji is playing on a small radio', 'The line is long, but it is moving'],
    spots: {
      counter: { id: 'counter', label: 'Buka counter', icon: '🍲', caption: 'Point at what you want', activities: [
        { id: 'buka-amala', label: 'Amala & Ewedu', icon: '🍲', duration: 8, cost: 300, effects: { hunger: 40 }, tags: ['food'], beta: true, note: seenCard },
        { id: 'buka-jollof', label: 'Jollof, Dodo & Chicken', icon: '🍛', duration: 8, cost: 550, effects: { hunger: 50, fun: 10 },
          moodlets: [{ id: 'party-jollof', label: 'Party Jollof', value: 5, duration: 600 }], tags: ['food'], beta: true,
          note: 'Duration, price, +10 Fun and the Party Jollof feeling are fixed; the hunger amount and the feeling’s value are original beta values.' },
        { id: 'buka-peppersoup', label: 'Pepper Soup & Cold Drink', icon: '🥣', duration: 7, cost: 400, effects: { hunger: 30, fun: 10, bladder: -5 }, tags: ['food'], beta: true, note: seenCard },
        { id: 'buka-efo', label: 'Efo Riro, Ponmo & Semo', icon: '🥬', duration: 8, cost: 650, effects: { hunger: 55, fun: 8 }, tags: ['food'], beta: true, note: seenCard },
        { id: 'buka-ofada', label: 'Ofada Rice & Smoked Fish', icon: '🐟', duration: 8, cost: 600, effects: { hunger: 50, fun: 6 }, tags: ['food'], beta: true, note: seenName },
        { id: 'buka-zobo', label: 'Cup of Chilled Zobo', icon: '🥤', duration: 5, cost: 150, effects: { hunger: 6, fun: 5, bladder: -5 }, tags: ['food', 'drink'], beta: true, note: seenName },
      ] },
      kitchen: { id: 'kitchen', label: 'Mama’s kitchen', icon: '👩🏾‍🍳', caption: 'Firewood, big pots, bigger opinions', activities: [
        { id: 'buka-gist', label: 'Gist with Mama', icon: '💬', duration: 8, cost: 0, effects: { social: 12, fun: 4 }, xp: { charisma: 8 }, tags: ['social'], beta: true, note: seenName },
        { id: 'buka-learn', label: 'Learn Mama’s Ewedu Secret', icon: '📖', duration: 12, cost: 300, effects: { fun: 4 }, xp: { cooking: 30 }, tags: ['training'], beta: true, note: seenName },
        { id: 'buka-help', label: 'Help at the Buka', icon: '🧽', duration: 15, reward: 350, minimumNeeds: { energy: 20 },
          effects: { energy: -10, hygiene: -6 }, xp: { cooking: 12, hustle: 6 }, cooldown: 300, tags: ['gig'], beta: true, note: seenName },
        { id: 'buka-special', label: 'Cook the Sunday Special', icon: '🍳', duration: 14, requiresSkill: { id: 'cooking', level: 3 }, reward: 900, minimumNeeds: { energy: 25 },
          effects: { energy: -10, hygiene: -5 }, xp: { cooking: 30 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      wash: { id: 'wash', label: 'Wash bowl', icon: '🫧', caption: 'Soap, water, one shared towel', activities: [
        { id: 'buka-wash', label: 'Wash Hands', icon: '🫧', duration: 4, cost: 0, effects: { hygiene: 8 }, tags: ['hygiene'], beta: true, note: seenName },
      ] },
    },
  },
  cchub: {
    id: 'cchub', label: 'CcHub', district: 'Yaba', icon: '💻', category: 'work',
    description: 'The centre of Yaba’s tech scene: quick Wi-Fi and even quicker founders.',
    hours: { open: 8, close: 22 }, // 8AM opening is fixed; closing time is an original beta value
    zone: 'mainland', map: { x: 62, y: 13 }, scene: { kind: 'hub', anchors: { stage: 'pitch', 'pitch-room': 'pitch', cafe: 'coffee', work: 'whiteboard' } },
    ambient: ['Someone just shipped to production on a Friday', 'A founder is drawing boxes on the whiteboard', 'The Wi-Fi is flying today', 'Demo day posters are going up'],
    spots: {
      desks: { id: 'desks', label: 'Hot desks', icon: '💻', caption: 'Find a socket, claim a chair', activities: [
        { id: 'hub-hack', label: 'Hack on Side Project', icon: '⌨️', duration: 12, cost: 0, effects: { energy: -5, fun: 3 }, xp: { coding: 30 }, tags: ['training'], beta: true, note: seenName },
        { id: 'hub-wifi', label: 'Free Wi-Fi & Chill', icon: '📶', duration: 10, cost: 0, effects: { fun: 10, energy: 3 }, tags: ['rest'], beta: true, note: seenName },
        { id: 'hub-freelance', label: 'Freelance Gig', icon: '🧑🏾‍💻', duration: 15, requiresSkill: { id: 'coding', level: 2 }, reward: 1200, minimumNeeds: { energy: 25 },
          effects: { energy: -12, fun: -4 }, xp: { coding: 20, hustle: 10 }, cooldown: 600, tags: ['gig'], beta: true, note: seenName },
        { id: 'hub-hack-atm', label: 'Hack an ATM', icon: '🏧', duration: 12, requiresSkill: { id: 'coding', level: 6 }, minimumNeeds: { energy: 20 },
          effects: { energy: -8 }, xp: { coding: 20 }, cooldown: 1200, tags: ['risky'], beta: true,
          note: 'Name is fixed. The gamble (see ACTIVITY_OUTCOMES in content/events.ts) is an original beta rule.' },
      ] },
      stage: { id: 'stage', label: 'Pitch stage', icon: '📈', caption: 'Three minutes, one slide deck', activities: [
        { id: 'hub-meetup', label: 'Attend Tech Meetup', icon: '🤝', duration: 11, cost: 0, effects: { social: 12 }, xp: { coding: 12, charisma: 6 }, tags: ['social', 'training'], beta: true, note: seenName },
        { id: 'hub-pitch', label: 'Pitch Your Startup', icon: '📈', duration: 14, cost: 1000, requiresSkill: { id: 'coding', level: 4 }, minimumNeeds: { energy: 20 },
          effects: { energy: -8 }, xp: { charisma: 20, hustle: 20 }, cooldown: 900, tags: ['pitch', 'startup'], beta: true,
          note: 'Name is fixed. The outcome roll (see ACTIVITY_OUTCOMES in content/events.ts) is an original beta rule.' },
        { id: 'hub-hackathon', label: 'Weekend Hackathon', icon: '🏁', duration: 20, requiresSkill: { id: 'coding', level: 3 }, reward: 2500, minimumNeeds: { energy: 35 },
          hours: { open: 8, close: 22, days: [0, 6] }, effects: { energy: -20, hunger: -8 }, xp: { coding: 60 }, cooldown: 3600, tags: ['performance'], beta: true, note: seenName },
      ] },
      cafe: { id: 'cafe', label: 'Café corner', icon: '☕', caption: 'Coffee is a food group here', activities: [
        { id: 'hub-coffee', label: 'Coffee & Puff-puff', icon: '☕', duration: 6, cost: 500, effects: { hunger: 15, energy: 10, bladder: -6 }, tags: ['food'], beta: true, note: seenName },
        { id: 'hub-founders', label: 'Gist with Founders', icon: '💡', duration: 9, cost: 0, effects: { social: 12 }, xp: { hustle: 12, charisma: 6 }, tags: ['social', 'training'], beta: true, note: seenName },
        { id: 'hub-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
    },
  },
  hospital: {
    id: 'hospital', label: 'General Hospital', district: 'Gbagada', icon: '🏥', category: 'care',
    description: 'Doctors, a pharmacy and a free clinic. Open all day and all night.',
    zone: 'mainland', map: { x: 72, y: 28 }, scene: { kind: 'hospital', anchors: { clinic: 'doctor', work: 'reception' } },
    ambient: ['A nurse is calling the next number', 'The corridor smells of disinfectant', 'Someone’s auntie brought food for the whole ward', 'The pharmacy shutter just went up'],
    spots: {
      clinic: { id: 'clinic', label: 'Outpatient clinic', icon: '🩺', caption: 'Take a number, take a seat', activities: [
        { id: 'hospital-doctor', label: 'See the Doctor', icon: '🩺', duration: 8, cost: 1500, requiresIllness: true, effects: { energy: 6 }, tags: ['cure'], beta: true },
        { id: 'hospital-checkup', label: 'Health Check-up', icon: '📋', duration: 8, cost: 500, tags: ['checkup'], beta: true },
      ] },
      ward: { id: 'ward', label: 'Free clinic', icon: '🛏️', caption: 'No bill, long wait', activities: [
        { id: 'hospital-free', label: 'Queue at the Free Clinic', icon: '⏳', duration: 45, cost: 0, requiresIllness: true, tags: ['cure'], beta: true },
        { id: 'hospital-rest', label: 'Rest on a Bench', icon: '🪑', duration: 10, cost: 0, effects: { energy: 6 }, tags: ['rest'], beta: true },
        { id: 'hospital-donate', label: 'Donate Blood', icon: '🩸', duration: 12, cost: 0, minimumNeeds: { energy: 40, hunger: 30 }, effects: { energy: -15 },
          moodlets: [{ id: 'good-deed', label: 'Good Deed', value: 8, duration: 3600 }], cooldown: 86400, tags: ['kindness'], beta: true },
      ] },
      pharmacy: { id: 'pharmacy', label: 'Pharmacy', icon: '💊', caption: 'Ask for the pharmacist, not the cashier', activities: [
        { id: 'hospital-vitamins', label: 'Buy Vitamins', icon: '💊', duration: 4, cost: 800, tags: ['immunity'], beta: true },
        { id: 'hospital-volunteer', label: 'Volunteer at Reception', icon: '🗂️', duration: 14, reward: 300, minimumNeeds: { energy: 20 },
          effects: { energy: -8 }, xp: { charisma: 10 }, cooldown: 300, tags: ['gig'], beta: true },
        { id: 'hospital-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
    },
  },
  salon: {
    id: 'salon', label: 'Mama Bisi’s Salon', district: 'Bariga', icon: '💇🏾', category: 'care',
    description: 'Braids, cuts, nails and every piece of news in the neighbourhood.',
    hours: { open: 8, close: 20 },
    zone: 'mainland', map: { x: 83, y: 14 }, scene: { kind: 'salon', anchors: { bench: 'dryer' } },
    ambient: ['The dryer is roaring', 'Mama Bisi is telling the story again', 'Someone is choosing between three shades of attachment', 'Nollywood is playing on the wall TV'],
    spots: {
      chairs: { id: 'chairs', label: 'Styling chairs', icon: '💇🏾', caption: 'Sit still — this will take a while', activities: [
        { id: 'salon-style', label: 'Braids or a Fresh Cut', icon: '💇🏾', duration: 12, cost: 4000, effects: { hygiene: 20, fun: 8 },
          moodlets: [{ id: 'fresh-look', label: 'Fresh Look', value: 8, duration: 7200 }], tags: ['style'], beta: true },
        { id: 'salon-trim', label: 'Quick Trim', icon: '✂️', duration: 7, cost: 1000, effects: { hygiene: 12 },
          moodlets: [{ id: 'fresh-look', label: 'Fresh Look', value: 4, duration: 3600 }], tags: ['style'], beta: true },
      ] },
      basin: { id: 'basin', label: 'Wash basin', icon: '🚿', caption: 'Warm water, strong fingers', activities: [
        { id: 'salon-wash', label: 'Wash & Condition', icon: '🚿', duration: 8, cost: 800, effects: { hygiene: 40 }, tags: ['hygiene'], beta: true },
      ] },
      bench: { id: 'bench', label: 'Waiting bench', icon: '🗞️', caption: 'The gist is free', activities: [
        { id: 'salon-gist', label: 'Salon Gist', icon: '💬', duration: 9, cost: 0, effects: { social: 14, fun: 6 }, xp: { charisma: 8, comedy: 6 }, tags: ['social'], beta: true },
        { id: 'salon-magazines', label: 'Flip Through Style Magazines', icon: '📖', duration: 8, cost: 0, effects: { fun: 5 }, xp: { photography: 8 }, tags: ['rest'], beta: true },
      ] },
      nails: { id: 'nails', label: 'Nail table', icon: '💅🏾', caption: 'Pick a colour', activities: [
        { id: 'salon-nails', label: 'Mani-Pedi', icon: '💅🏾', duration: 10, cost: 2500, effects: { fun: 12, hygiene: 10 }, tags: ['style'], beta: true },
        { id: 'salon-sweep', label: 'Sweep Up for Mama Bisi', icon: '🧹', duration: 12, reward: 250, minimumNeeds: { energy: 20 },
          effects: { energy: -8, hygiene: -3 }, xp: { hustle: 8 }, cooldown: 300, tags: ['gig'], beta: true },
        { id: 'salon-portfolio', label: 'Shoot the Hairstyle Portfolio', icon: '📸', duration: 12, requiresSkill: { id: 'photography', level: 3 }, reward: 800, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 22 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
    },
  },
  church: {
    id: 'church', label: 'Church', district: 'Lagos Island', icon: '⛪', category: 'care',
    description: 'A cool, quiet nave, a loud choir and jollof after service.',
    hours: { open: 6, close: 21 },
    zone: 'island', map: { x: 11, y: 58 }, scene: { kind: 'worship', variant: 'church', anchors: { hall: 'offering' } },
    ambient: ['The organist is practising', 'Ushers are arranging the offering baskets', 'Choir robes are being ironed', 'A harmattan breeze moves through the louvres'],
    spots: {
      pews: { id: 'pews', label: 'Pews', icon: '⛪', caption: 'Find a seat near the fan', activities: [
        { id: 'church-service', label: 'Attend Service', icon: '🙏🏾', duration: 14, cost: 0, effects: { fun: 6, social: 10 },
          moodlets: [{ id: 'at-peace', label: 'At Peace', value: 6, duration: 3600 }], tags: ['worship', 'social'], beta: true },
        { id: 'church-quiet', label: 'Quiet Prayer', icon: '🕊️', duration: 9, cost: 0, effects: { energy: 4 },
          moodlets: [{ id: 'at-peace', label: 'At Peace', value: 4, duration: 1800 }], tags: ['worship', 'rest'], beta: true },
        { id: 'church-offering', label: 'Give an Offering', icon: '🧺', duration: 5, cost: 500,
          moodlets: [{ id: 'generous', label: 'Generous', value: 5, duration: 3600 }], tags: ['kindness'], beta: true },
      ] },
      choir: { id: 'choir', label: 'Choir stand', icon: '🎼', caption: 'Sopranos to the left', activities: [
        { id: 'church-choir', label: 'Choir Practice', icon: '🎼', duration: 12, cost: 0, effects: { social: 8, energy: -3 }, xp: { music: 26 }, tags: ['training', 'social'], beta: true },
        { id: 'church-solo', label: 'Sing the Solo', icon: '🎤', duration: 11, requiresSkill: { id: 'music', level: 2 }, reward: 500, minimumNeeds: { energy: 20 },
          effects: { energy: -6, social: 8 }, xp: { music: 24 }, cooldown: 900, tags: ['performance'], beta: true },
      ] },
      hall: { id: 'hall', label: 'Fellowship hall', icon: '🍛', caption: 'Coolers of rice at the back', activities: [
        { id: 'church-jollof', label: 'Fellowship Jollof', icon: '🍛', duration: 8, cost: 0, effects: { hunger: 30, social: 8 }, cooldown: 1800, tags: ['food'], beta: true },
        { id: 'church-serve', label: 'Serve at the Food Drive', icon: '🥘', duration: 13, cost: 0, minimumNeeds: { energy: 20 }, effects: { energy: -8, social: 6 }, xp: { cooking: 14 },
          moodlets: [{ id: 'good-deed', label: 'Good Deed', value: 8, duration: 3600 }], tags: ['kindness', 'training'], beta: true },
      ] },
    },
  },
  mosque: {
    id: 'mosque', label: 'Mosque', district: 'Lagos Island', icon: '🕌', category: 'care',
    description: 'A wide, calm prayer hall, running water for ablution and a shaded courtyard.',
    hours: { open: 5, close: 22 },
    zone: 'island', map: { x: 17, y: 70 }, scene: { kind: 'worship', variant: 'mosque', anchors: { hall: 'prayer', courtyard: 'charity' } },
    ambient: ['Sandals are lined up at the door', 'The call to prayer carries over the rooftops', 'Children are reciting in the courtyard', 'Someone is sharing dates from a tray'],
    spots: {
      hall: { id: 'hall', label: 'Prayer hall', icon: '🕌', caption: 'Shoes off, phone silent', activities: [
        { id: 'mosque-prayer', label: 'Join the Prayer', icon: '🤲🏾', duration: 12, cost: 0, effects: { social: 8, fun: 4 },
          moodlets: [{ id: 'at-peace', label: 'At Peace', value: 6, duration: 3600 }], tags: ['worship', 'social'], beta: true },
        { id: 'mosque-quiet', label: 'Quiet Reflection', icon: '📿', duration: 9, cost: 0, effects: { energy: 4 },
          moodlets: [{ id: 'at-peace', label: 'At Peace', value: 4, duration: 1800 }], tags: ['worship', 'rest'], beta: true },
        { id: 'mosque-sadaqah', label: 'Give Sadaqah', icon: '🪙', duration: 5, cost: 500,
          moodlets: [{ id: 'generous', label: 'Generous', value: 5, duration: 3600 }], tags: ['kindness'], beta: true },
      ] },
      ablution: { id: 'ablution', label: 'Ablution area', icon: '💧', caption: 'Cool water from a row of taps', activities: [
        { id: 'mosque-ablution', label: 'Perform Ablution', icon: '💧', duration: 6, cost: 0, effects: { hygiene: 15 }, tags: ['hygiene'], beta: true },
      ] },
      courtyard: { id: 'courtyard', label: 'Courtyard', icon: '🌴', caption: 'Mats in the shade', activities: [
        { id: 'mosque-dates', label: 'Share Dates & Kunu', icon: '🥛', duration: 7, cost: 0, effects: { hunger: 20, social: 8 }, cooldown: 1800, tags: ['food'], beta: true },
        { id: 'mosque-recite', label: 'Learn Recitation', icon: '📖', duration: 11, cost: 0, effects: { fun: 3 }, xp: { music: 18, charisma: 6 }, tags: ['training'], beta: true },
        { id: 'mosque-teach', label: 'Help at the Madrasa', icon: '🧑🏾‍🏫', duration: 13, cost: 0, minimumNeeds: { energy: 20 }, effects: { energy: -6, social: 6 }, xp: { charisma: 16 },
          moodlets: [{ id: 'good-deed', label: 'Good Deed', value: 8, duration: 3600 }], tags: ['kindness', 'training'], beta: true },
      ] },
    },
  },
  market: {
    id: 'market', label: 'Market', district: 'Lagos Island', icon: '🧺', category: 'work',
    description: 'Fabric, pepper, plastics and noise. Bring your haggling voice.',
    hours: { open: 6, close: 20 },
    zone: 'island', map: { x: 24, y: 82 }, scene: { kind: 'market', anchors: { stalls: 'fabric', food: 'produce', spice: 'provisions', wholesale: 'porter', work: 'gadgets' } },
    ambient: ['“Customer! Come and see!”', 'A wheelbarrow is forcing its way through', 'New lace just arrived on the third row', 'Somebody is counting change very slowly'],
    spots: {
      stalls: { id: 'stalls', label: 'Fabric stalls', icon: '🧵', caption: 'Ankara to the ceiling', activities: [
        { id: 'market-browse', label: 'Browse the Ankara', icon: '🧵', duration: 9, cost: 0, effects: { fun: 8 }, xp: { hustle: 6 }, tags: ['fun'], beta: true },
        { id: 'market-haggle', label: 'Haggle Like a Pro', icon: '🤝', duration: 10, cost: 0, effects: { social: 6, energy: -3 }, xp: { hustle: 24, charisma: 6 }, tags: ['training'], beta: true },
        { id: 'market-fabric', label: 'Buy Six Yards of Ankara', icon: '🎁', duration: 7, cost: 3500, effects: { fun: 14 },
          moodlets: [{ id: 'fresh-drip', label: 'Fresh Drip', value: 5, duration: 1800 }], tags: ['status', 'shopping'], beta: true },
      ] },
      food: { id: 'food', label: 'Food lane', icon: '🍠', caption: 'Follow the smoke', activities: [
        { id: 'market-boli', label: 'Boli & Groundnut', icon: '🍠', duration: 6, cost: 250, effects: { hunger: 22 }, tags: ['food'], beta: true },
        { id: 'market-akara', label: 'Akara & Pap', icon: '🧆', duration: 6, cost: 300, effects: { hunger: 26, fun: 3 }, tags: ['food'], beta: true },
        { id: 'market-water', label: 'Cold Sachet Water', icon: '💧', duration: 3, cost: 50, effects: { hunger: 2, energy: 3, bladder: -3 }, tags: ['drink'], beta: true },
      ] },
      spice: { id: 'spice', label: 'Pepper sellers', icon: '🌶️', caption: 'Your eyes will water', activities: [
        { id: 'market-spices', label: 'Learn Spice Blends from Iya Ata', icon: '🌶️', duration: 10, cost: 200, effects: { fun: 3 }, xp: { cooking: 26 }, tags: ['training'], beta: true },
        { id: 'market-lookbook', label: 'Shoot a Trader’s Lookbook', icon: '📸', duration: 12, requiresSkill: { id: 'photography', level: 2 }, reward: 600, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 20 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      wholesale: { id: 'wholesale', label: 'Wholesale row', icon: '📦', caption: 'Cartons stacked to the roof', activities: [
        { id: 'market-carry', label: 'Carry Loads for Traders', icon: '📦', duration: 14, reward: 400, minimumNeeds: { energy: 25 },
          effects: { energy: -14, hygiene: -8 }, xp: { fitness: 10, hustle: 8 }, cooldown: 300, tags: ['gig'], beta: true },
        { id: 'market-flip', label: 'Flip Goods for Profit', icon: '💹', duration: 13, requiresSkill: { id: 'hustle', level: 2 }, reward: 900, minimumNeeds: { energy: 20 },
          effects: { energy: -8 }, xp: { hustle: 26 }, cooldown: 600, tags: ['performance'], beta: true },
        { id: 'market-container', label: 'Broker a Container Deal', icon: '🚢', duration: 15, requiresSkill: { id: 'hustle', level: 5 }, reward: 2200, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { hustle: 40, charisma: 10 }, cooldown: 1500, tags: ['performance'], beta: true },
      ] },
    },
  },
  police: {
    id: 'police', label: 'Police Station', district: 'Lagos Island', icon: '🚓', category: 'civic',
    description: 'A front desk, a parade yard and a community room. Sort things out properly.',
    zone: 'island', map: { x: 31, y: 58 }, scene: { kind: 'police', anchors: { yard: 'people', community: 'board' } },
    ambient: ['The desk sergeant is writing in a very large book', 'Boots are drumming in the yard', 'A ceiling fan is losing its battle', 'Somebody came to report a missing goat'],
    spots: {
      desk: { id: 'desk', label: 'Front desk', icon: '📒', caption: 'State your name and business', activities: [
        { id: 'police-report', label: 'Report a Lost Item', icon: '📒', duration: 8, cost: 0, effects: { fun: -2, social: 4 }, xp: { charisma: 6 }, tags: ['civic'], beta: true },
        { id: 'police-clear', label: 'Pay to Clear Your Name', icon: '🧾', duration: 8, cost: 1000, requiresMoodlet: 'booked', requiresReason: 'You have no record at the station, so there is nothing to clear.', clears: ['booked'], tags: ['civic'], beta: true },
        { id: 'police-service', label: 'Do Community Service', icon: '🧹', duration: 30, cost: 0, requiresMoodlet: 'booked', requiresReason: 'You have no record at the station, so there is nothing to clear.', clears: ['booked'], effects: { energy: -8 }, tags: ['civic'], beta: true },
      ] },
      yard: { id: 'yard', label: 'Parade yard', icon: '🥾', caption: 'Left, right, left', activities: [
        { id: 'police-drill', label: 'Join the Morning Drill', icon: '🥾', duration: 12, cost: 0, minimumNeeds: { energy: 20 }, effects: { energy: -10, hygiene: -5 }, xp: { fitness: 26 }, tags: ['training'], beta: true },
        { id: 'police-defence', label: 'Self-defence Class', icon: '🥋', duration: 11, cost: 500, minimumNeeds: { energy: 20 }, effects: { energy: -8, fun: 5 }, xp: { fitness: 30 }, tags: ['training'], beta: true },
      ] },
      community: { id: 'community', label: 'Community room', icon: '🤝', caption: 'Plastic chairs in a circle', activities: [
        { id: 'police-watch', label: 'Neighbourhood Watch Shift', icon: '🔦', duration: 15, reward: 400, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { charisma: 8, hustle: 6 }, cooldown: 600, tags: ['gig'], beta: true },
        { id: 'police-mediate', label: 'Mediate a Dispute', icon: '⚖️', duration: 12, requiresSkill: { id: 'charisma', level: 3 }, reward: 700, minimumNeeds: { energy: 20 },
          effects: { energy: -6, social: 8 }, xp: { charisma: 26 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
    },
  },
  'polling-unit': {
    id: 'polling-unit', label: 'Polling Unit', district: 'Lagos Island', icon: '🗳️', category: 'civic',
    description: 'A canopy, a table and a queue with opinions. Where the city chooses.',
    hours: { open: 8, close: 18 },
    zone: 'island', map: { x: 38, y: 70 }, scene: { kind: 'polling', anchors: { table: 'officials', canopy: 'results' } },
    ambient: ['Agents are comparing their lists', 'The queue has an unofficial chairman', 'Somebody brought a stool from home', 'Ink pads are drying in the sun'],
    spots: {
      queue: { id: 'queue', label: 'The queue', icon: '🧍🏾', caption: 'No shunting', activities: [
        { id: 'polling-gist', label: 'Gist on the Queue', icon: '💬', duration: 8, cost: 0, effects: { social: 10, fun: 3 }, xp: { charisma: 8 }, tags: ['social', 'civic'], beta: true },
        { id: 'polling-debate', label: 'Debate the Candidates', icon: '🗯️', duration: 10, cost: 0, requiresSkill: { id: 'charisma', level: 2 }, effects: { social: 12, fun: 8 }, xp: { charisma: 22, comedy: 6 }, tags: ['social', 'civic'], beta: true },
      ] },
      table: { id: 'table', label: 'Registration table', icon: '📋', caption: 'Check your name on the list', activities: [
        { id: 'polling-register', label: 'Check the Voter Register', icon: '📋', duration: 6, cost: 0, effects: { fun: 2 }, tags: ['civic'], beta: true },
        { id: 'polling-educate', label: 'Voter Education Session', icon: '🧑🏾‍🏫', duration: 10, cost: 0, effects: { social: 4 }, xp: { charisma: 14 }, tags: ['training', 'civic'], beta: true },
        { id: 'polling-agent', label: 'Volunteer as a Polling Agent', icon: '🪪', duration: 15, reward: 400, minimumNeeds: { energy: 20 },
          effects: { energy: -8, fun: -3 }, xp: { hustle: 8 }, cooldown: 600, tags: ['gig', 'civic'], beta: true },
      ] },
      canopy: { id: 'canopy', label: 'Shade canopy', icon: '⛱️', caption: 'The only shade for fifty metres', activities: [
        { id: 'polling-puffpuff', label: 'Puff-puff from the Tray', icon: '🍩', duration: 5, cost: 200, effects: { hunger: 14, fun: 3 }, tags: ['food'], beta: true },
        { id: 'polling-shade', label: 'Rest in the Shade', icon: '⛱️', duration: 9, cost: 0, effects: { energy: 5 }, tags: ['rest'], beta: true },
      ] },
    },
  },
  'state-house': {
    id: 'state-house', label: 'Lagos State House', district: 'Marina', icon: '🏛️', category: 'civic',
    description: 'White columns facing the lagoon. Tours, town halls and the Chairman’s business.',
    hours: { open: 9, close: 17 },
    zone: 'island', map: { x: 35, y: 95 }, scene: { kind: 'statehouse', anchors: { gate: 'steps', gallery: 'office', gardens: 'gardens', press: 'podium' } },
    ambient: ['A convoy is idling at the gate', 'Gardeners are trimming the hedges', 'A town hall notice is pinned to the board', 'Press crews are setting up tripods'],
    spots: {
      gate: { id: 'gate', label: 'Front gate', icon: '🚪', caption: 'Visitors sign in here', activities: [
        { id: 'state-tour', label: 'Take the Guided Tour', icon: '🏛️', duration: 12, cost: 500, effects: { fun: 10 }, xp: { charisma: 6 }, tags: ['fun', 'civic'], beta: true },
        { id: 'state-petition', label: 'Submit a Petition', icon: '✍🏾', duration: 8, cost: 0, effects: { fun: 2, social: 4 }, tags: ['civic'], beta: true },
      ] },
      gallery: { id: 'gallery', label: 'Public gallery', icon: '🪑', caption: 'Phones on silent', activities: [
        { id: 'state-townhall', label: 'Watch a Town Hall', icon: '🪑', duration: 11, cost: 0, effects: { social: 8 }, xp: { charisma: 12 }, tags: ['civic', 'training'], beta: true },
        { id: 'state-speak', label: 'Speak at the Town Hall', icon: '🎙️', duration: 12, cost: 0, requiresSkill: { id: 'charisma', level: 5 }, minimumNeeds: { energy: 20 }, effects: { energy: -6, social: 20 }, xp: { charisma: 35 },
          moodlets: [{ id: 'voice-heard', label: 'Voice Heard', value: 8, duration: 3600 }], tags: ['civic', 'performance'], beta: true },
      ] },
      gardens: { id: 'gardens', label: 'Gardens', icon: '🌺', caption: 'Lagoon breeze and clipped hedges', activities: [
        { id: 'state-gardens', label: 'Walk the Gardens', icon: '🌺', duration: 10, cost: 0, effects: { energy: 4, fun: 8 }, tags: ['rest'], beta: true },
        { id: 'state-architecture', label: 'Photograph the Architecture', icon: '📷', duration: 9, cost: 0, effects: { fun: 4 }, xp: { photography: 24 }, tags: ['training'], beta: true },
      ] },
      press: { id: 'press', label: 'Press room', icon: '🎥', caption: 'Elbows out for the front row', activities: [
        { id: 'state-press', label: 'Cover the Press Briefing', icon: '🎥', duration: 12, requiresSkill: { id: 'photography', level: 3 }, reward: 900, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 24 }, cooldown: 900, tags: ['performance', 'civic'], beta: true },
      ] },
    },
  },
  'i-fitness': {
    id: 'i-fitness', label: 'i-Fitness', district: 'Victoria Island', icon: '🏋🏾', category: 'care',
    description: 'Weights, classes and mirrors. Leg day is every day.',
    hours: { open: 5, close: 23 },
    zone: 'island', map: { x: 52, y: 58 }, scene: { kind: 'gym', anchors: { studio: 'mats', bar: 'desk', showers: 'desk', work: 'treadmills' } },
    ambient: ['Someone just dropped a very heavy bar', 'The aerobics class is counting in Yoruba', 'A trainer is shouting “one more!”', 'The smoothie blender is screaming'],
    spots: {
      weights: { id: 'weights', label: 'Weights floor', icon: '🏋🏾', caption: 'Re-rack your plates', activities: [
        { id: 'gym-lift', label: 'Lift Weights', icon: '🏋🏾', duration: 12, cost: 500, minimumNeeds: { energy: 20 }, effects: { energy: -12, hygiene: -8, fun: 4 }, xp: { fitness: 40 }, tags: ['training'], beta: true },
        { id: 'gym-spot', label: 'Spot a Stranger', icon: '🤜🏾', duration: 7, cost: 0, effects: { social: 8 }, xp: { fitness: 8 }, tags: ['social'], beta: true },
      ] },
      studio: { id: 'studio', label: 'Studio', icon: '🤸🏾', caption: 'Mats down, music up', activities: [
        { id: 'gym-aerobics', label: 'Afrobeat Aerobics Class', icon: '🤸🏾', duration: 12, cost: 700, minimumNeeds: { energy: 20 }, effects: { energy: -10, hygiene: -6, fun: 12 }, xp: { fitness: 24, dance: 16 }, tags: ['training', 'fun'], beta: true },
        { id: 'gym-stretch', label: 'Stretch on the Mats', icon: '🧘🏾', duration: 8, cost: 0, effects: { energy: 2 }, xp: { fitness: 10 }, tags: ['training', 'rest'], beta: true },
        { id: 'gym-bootcamp', label: 'Lead a Bootcamp', icon: '📣', duration: 14, requiresSkill: { id: 'fitness', level: 4 }, reward: 1100, minimumNeeds: { energy: 30 },
          effects: { energy: -16, hygiene: -8 }, xp: { fitness: 30, charisma: 10 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      bar: { id: 'bar', label: 'Smoothie bar', icon: '🥤', caption: 'Protein with everything', activities: [
        { id: 'gym-smoothie', label: 'Protein Smoothie', icon: '🥤', duration: 5, cost: 900, effects: { hunger: 20, energy: 8, bladder: -4 }, tags: ['food'], beta: true },
      ] },
      showers: { id: 'showers', label: 'Showers', icon: '🚿', caption: 'Hot water, actual pressure', activities: [
        { id: 'gym-shower', label: 'Hot Shower', icon: '🚿', duration: 7, cost: 200, effects: { hygiene: 45 }, tags: ['hygiene'], beta: true },
        { id: 'gym-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
    },
  },
  office: {
    id: 'office', label: 'Office', district: 'Marina', icon: '🏢', category: 'work',
    description: 'Marina Towers: glass, lifts, lanyards and the best air-conditioning on the island.',
    hours: { open: 7, close: 20 },
    zone: 'island', map: { x: 58, y: 70 }, scene: { kind: 'office', anchors: { lobby: 'reception', canteen: 'lounge', floor: 'desks', work: 'desks' } },
    ambient: ['The lift is stuck on the ninth floor again', 'Someone is on a very loud speakerphone', 'Security is checking ID cards', 'A printer is producing somebody’s wedding invitations'],
    spots: {
      lobby: { id: 'lobby', label: 'Lobby', icon: '🛗', caption: 'Lanyards and marble', activities: [
        { id: 'office-network', label: 'Network in the Lobby', icon: '🤝', duration: 9, cost: 0, effects: { social: 10 }, xp: { charisma: 16 }, tags: ['social', 'training'], beta: true },
        { id: 'office-cv', label: 'Drop Off Your CV', icon: '📄', duration: 7, cost: 0, effects: { fun: -2 }, xp: { hustle: 10 }, tags: ['training'], beta: true },
        { id: 'office-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
      canteen: { id: 'canteen', label: 'Canteen', icon: '🍛', caption: 'Rice is finished by 1PM', activities: [
        { id: 'office-lunch', label: 'Canteen Rice & Stew', icon: '🍛', duration: 8, cost: 700, effects: { hunger: 40 }, tags: ['food'], beta: true },
        { id: 'office-coffee', label: 'Vending-machine Coffee', icon: '☕', duration: 4, cost: 300, effects: { energy: 10, bladder: -5 }, tags: ['drink'], beta: true },
      ] },
      floor: { id: 'floor', label: 'Open floor', icon: '🖥️', caption: 'Hot-desking, cold AC', activities: [
        { id: 'office-spreadsheets', label: 'Lunch-and-Learn: Spreadsheets', icon: '📊', duration: 11, cost: 0, effects: { fun: -2 }, xp: { coding: 18 }, tags: ['training'], beta: true },
        { id: 'office-temp', label: 'Temp Data Entry', icon: '⌨️', duration: 15, reward: 450, minimumNeeds: { energy: 20 },
          effects: { energy: -10, fun: -6 }, xp: { coding: 8, hustle: 6 }, cooldown: 300, tags: ['gig'], beta: true },
      ] },
      boardroom: { id: 'boardroom', label: 'Boardroom', icon: '📊', caption: 'A very long table', activities: [
        { id: 'office-present', label: 'Present to the Board', icon: '📽️', duration: 13, requiresSkill: { id: 'charisma', level: 4 }, reward: 1500, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { charisma: 30 }, cooldown: 900, tags: ['performance'], beta: true },
        { id: 'office-deal', label: 'Close a Corporate Deal', icon: '🖋️', duration: 14, requiresSkill: { id: 'hustle', level: 4 }, reward: 1800, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { hustle: 34 }, cooldown: 1200, tags: ['performance'], beta: true },
      ] },
    },
  },
  quilox: {
    id: 'quilox', label: 'Quilox', district: 'Victoria Island', icon: '🪩', category: 'nightlife',
    description: 'The big-night-out club: lasers, sparklers and tables that cost more than rent.',
    hours: { open: 20, close: 6 },
    zone: 'island', map: { x: 70, y: 58 }, scene: { kind: 'club', anchors: { rope: 'bookcase', vip: 'lounge', work: 'dj' } },
    ambient: ['Sparklers are heading for a VIP table', 'The bouncer is reading a very short list', 'The bass is rearranging people’s organs', 'Somebody just sprayed a whole bundle'],
    spots: {
      rope: { id: 'rope', label: 'Velvet rope', icon: '🚧', caption: 'Dress well, smile at the bouncer', activities: [
        { id: 'quilox-queue', label: 'People-watch on the Queue', icon: '👀', duration: 7, cost: 0, effects: { social: 8, fun: 4 }, xp: { photography: 6 }, tags: ['social'], beta: true },
      ] },
      floor: { id: 'floor', label: 'Dance floor', icon: '🪩', caption: 'No space, nobody minds', activities: [
        { id: 'quilox-dance', label: 'Dance Till Dawn', icon: '💃', duration: 11, cost: 0, effects: { energy: -8, fun: 18 }, xp: { dance: 26 }, tags: ['training', 'fun'], beta: true },
        { id: 'quilox-hype', label: 'Hype the Crowd', icon: '🙌🏾', duration: 8, cost: 0, effects: { social: 10, energy: -3 }, xp: { charisma: 12 }, tags: ['social', 'training'], beta: true },
        { id: 'quilox-battle', label: 'Win the Dance Battle', icon: '🏆', duration: 12, requiresSkill: { id: 'dance', level: 3 }, reward: 1300, minimumNeeds: { energy: 25 },
          effects: { energy: -14, hygiene: -6 }, xp: { dance: 30 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      vip: { id: 'vip', label: 'VIP section', icon: '🍾', caption: 'Sparklers on request', activities: [
        { id: 'quilox-table', label: 'Book a VIP Table', icon: '🍾', duration: 10, cost: 50000, effects: { fun: 30, social: 30 },
          moodlets: [{ id: 'big-spender', label: 'Big Spender', value: 10, duration: 1800 }], tags: ['status', 'broadcast'], beta: true },
        { id: 'quilox-spray', label: 'Spray Money on the Floor', icon: '💸', duration: 6, cost: 5000, effects: { fun: 12, social: 18 },
          moodlets: [{ id: 'big-spender', label: 'Big Spender', value: 6, duration: 900 }], tags: ['status', 'broadcast'], beta: true },
      ] },
      bar: { id: 'bar', label: 'Bar', icon: '🍹', caption: 'Shout your order twice', activities: [
        { id: 'quilox-chapman', label: 'Chapman', icon: '🍹', duration: 5, cost: 1500, effects: { fun: 8, hunger: 5, bladder: -8 }, tags: ['drink'], beta: true },
        { id: 'quilox-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
    },
  },
  rooftop: {
    id: 'rooftop', label: 'Ivory Rooftop', district: 'Victoria Island', icon: '🌇', category: 'nightlife',
    description: 'A terrace above the island: sunset, grills, a pool and people who came to be seen.',
    hours: { open: 12, close: 2 },
    zone: 'island', map: { x: 76, y: 70 }, scene: { kind: 'rooftop', anchors: { stage: 'dj', work: 'view' } },
    ambient: ['The skyline is turning orange', 'A saxophonist is warming up', 'Ring lights are out in force', 'The grill man is fanning the coals'],
    spots: {
      terrace: { id: 'terrace', label: 'Terrace', icon: '🌇', caption: 'Best view on the island', activities: [
        { id: 'rooftop-sunset', label: 'Watch the Sunset', icon: '🌇', duration: 10, cost: 0, effects: { fun: 10, energy: 3 }, tags: ['rest'], beta: true },
        { id: 'rooftop-content', label: 'Shoot Content for the ’Gram', icon: '🤳', duration: 10, cost: 0, effects: { fun: 4 }, xp: { photography: 26, charisma: 6 }, tags: ['training'], beta: true },
        { id: 'rooftop-campaign', label: 'Shoot a Brand Campaign', icon: '📸', duration: 14, requiresSkill: { id: 'photography', level: 5 }, reward: 2000, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { photography: 36 }, cooldown: 1200, tags: ['performance'], beta: true },
      ] },
      bar: { id: 'bar', label: 'Sky bar', icon: '🍸', caption: 'Small glasses, big prices', activities: [
        { id: 'rooftop-mocktail', label: 'Sunset Mocktail', icon: '🍸', duration: 6, cost: 2500, effects: { fun: 12, social: 6, bladder: -8 }, tags: ['drink'], beta: true },
        { id: 'rooftop-grill', label: 'Mixed Grill Platter', icon: '🍖', duration: 9, cost: 6000, effects: { hunger: 55, fun: 12, social: 8 }, tags: ['food'], beta: true },
      ] },
      stage: { id: 'stage', label: 'Acoustic stage', icon: '🎸', caption: 'One stool, one spotlight', activities: [
        { id: 'rooftop-acoustic', label: 'Listen to Acoustic Night', icon: '🎸', duration: 11, cost: 1500, effects: { fun: 16 }, xp: { music: 8 }, tags: ['fun', 'show'], beta: true },
        { id: 'rooftop-mc', label: 'MC the Evening', icon: '🎤', duration: 13, requiresSkill: { id: 'charisma', level: 4 }, reward: 1400, minimumNeeds: { energy: 25 },
          effects: { energy: -10, social: 10 }, xp: { charisma: 28, comedy: 8 }, cooldown: 900, tags: ['performance'], beta: true },
        { id: 'rooftop-sing', label: 'Sing at Acoustic Night', icon: '🎶', duration: 13, requiresSkill: { id: 'music', level: 4 }, reward: 1500, minimumNeeds: { energy: 25 },
          effects: { energy: -10, fun: 8 }, xp: { music: 32 }, cooldown: 900, tags: ['performance'], beta: true },
      ] },
      pool: { id: 'pool', label: 'Pool deck', icon: '🏊🏾', caption: 'Nobody here is actually swimming', activities: [
        { id: 'rooftop-pool', label: 'Dip in the Pool', icon: '🏊🏾', duration: 9, cost: 3000, effects: { fun: 18, hygiene: 10, energy: -4 }, tags: ['fun'], beta: true },
      ] },
    },
  },
  'canopy-walk': {
    id: 'canopy-walk', label: 'Canopy Walk', district: 'Lekki', icon: '🌿', category: 'fun',
    description: 'A swaying walkway through the treetops, monkeys overhead and swamp below.',
    hours: { open: 7, close: 19 },
    zone: 'east', map: { x: 89, y: 56 }, scene: { kind: 'walk' },
    ambient: ['The walkway is swaying a little', 'A monkey just stole somebody’s biscuit', 'Birdsong over the swamp', 'A school group is counting the steps'],
    spots: {
      walkway: { id: 'walkway', label: 'Canopy walkway', icon: '🌉', caption: 'Do not look down', activities: [
        { id: 'canopy-cross', label: 'Cross the Canopy Walk', icon: '🌉', duration: 14, cost: 1000, effects: { fun: 22, energy: -8 }, xp: { fitness: 18 }, tags: ['fun'], beta: true },
        { id: 'canopy-treetops', label: 'Photograph the Treetops', icon: '📷', duration: 9, cost: 0, effects: { fun: 6 }, xp: { photography: 28 }, tags: ['training'], beta: true },
        { id: 'canopy-guide', label: 'Guide a Tour Group', icon: '🧭', duration: 14, requiresSkill: { id: 'charisma', level: 3 }, reward: 800, minimumNeeds: { energy: 25 },
          effects: { energy: -10 }, xp: { charisma: 22, fitness: 8 }, cooldown: 600, tags: ['performance'], beta: true },
      ] },
      trail: { id: 'trail', label: 'Nature trail', icon: '🥾', caption: 'Boardwalk over the swamp', activities: [
        { id: 'canopy-hike', label: 'Hike the Nature Trail', icon: '🥾', duration: 12, cost: 0, minimumNeeds: { energy: 15 }, effects: { energy: -8, hygiene: -4, fun: 10 }, xp: { fitness: 22 }, tags: ['training', 'fun'], beta: true },
        { id: 'canopy-monkeys', label: 'Watch the Monkeys', icon: '🐒', duration: 8, cost: 0, effects: { fun: 10 }, tags: ['fun'], beta: true },
        { id: 'canopy-wildlife', label: 'Sell Wildlife Shots', icon: '🦜', duration: 12, requiresSkill: { id: 'photography', level: 4 }, reward: 1200, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 28 }, cooldown: 900, tags: ['performance'], beta: true },
      ] },
      huts: { id: 'huts', label: 'Picnic huts', icon: '🧺', caption: 'Thatch roofs and a tortoise', activities: [
        { id: 'canopy-picnic', label: 'Picnic Under the Huts', icon: '🧺', duration: 9, cost: 800, effects: { hunger: 30, fun: 8, social: 6 }, tags: ['food'], beta: true },
        { id: 'canopy-rest', label: 'Rest in the Shade', icon: '🌴', duration: 10, cost: 0, effects: { energy: 8 }, tags: ['rest'], beta: true },
      ] },
    },
  },
  palms: {
    id: 'palms', label: 'The Palms', district: 'Lekki', icon: '🛍️', category: 'fun',
    description: 'The mall: a cinema, a food court, shops and the coldest air in Lekki.',
    hours: { open: 9, close: 22 },
    zone: 'east', map: { x: 93, y: 69 }, scene: { kind: 'mall', anchors: { arcade: 'tech', work: 'shops' } },
    ambient: ['The cinema queue is curling round the corner', 'A toddler has escaped on the escalator', 'Somebody is doing a photoshoot by the fountain', 'There is a sale, allegedly'],
    spots: {
      cinema: { id: 'cinema', label: 'Cinema', icon: '🎬', caption: 'Now showing: three Nollywood premieres', activities: [
        { id: 'palms-movie', label: 'See a Movie', icon: '🎬', duration: 14, cost: 3000, effects: { fun: 28, energy: 3 }, tags: ['fun', 'movie', 'show'], beta: true },
        { id: 'palms-popcorn', label: 'Popcorn & a Drink', icon: '🍿', duration: 4, cost: 1200, effects: { hunger: 12, fun: 5, bladder: -5 }, tags: ['food'], beta: true },
      ] },
      food: { id: 'food', label: 'Food court', icon: '🌯', caption: 'Trays, queues and free AC', activities: [
        { id: 'palms-shawarma', label: 'Chicken Shawarma', icon: '🌯', duration: 6, cost: 2000, effects: { hunger: 40, fun: 6 }, tags: ['food'], beta: true },
        { id: 'palms-icecream', label: 'Two Scoops of Ice Cream', icon: '🍨', duration: 5, cost: 1000, effects: { fun: 10, hunger: 8 }, tags: ['food'], beta: true },
        { id: 'palms-restroom', label: 'Use the Restroom', icon: '🚻', duration: 4, cost: 0, effects: { bladder: 60 }, tags: ['restroom'], beta: true },
      ] },
      shops: { id: 'shops', label: 'Shops', icon: '🛍️', caption: 'Everything is “imported”', activities: [
        { id: 'palms-window', label: 'Window-shop', icon: '👀', duration: 9, cost: 0, effects: { fun: 7 }, tags: ['fun'], beta: true },
        { id: 'palms-outfit', label: 'Buy a New Outfit', icon: '👗', duration: 8, cost: 15000, effects: { fun: 16 },
          moodlets: [{ id: 'fresh-drip', label: 'Fresh Drip', value: 8, duration: 3600 }], tags: ['status', 'shopping'], beta: true },
        { id: 'palms-flyers', label: 'Hand Out Promo Flyers', icon: '📄', duration: 13, reward: 350, minimumNeeds: { energy: 20 },
          effects: { energy: -8, fun: -3 }, xp: { hustle: 10, charisma: 6 }, cooldown: 300, tags: ['gig'], beta: true },
      ] },
      arcade: { id: 'arcade', label: 'Arcade', icon: '🕹️', caption: 'Tokens, tickets and a claw machine that cheats', activities: [
        { id: 'palms-arcade', label: 'Play Arcade Games', icon: '🕹️', duration: 9, cost: 500, effects: { fun: 16 }, tags: ['fun'], beta: true },
        { id: 'palms-photobooth', label: 'Squeeze into the Photo Booth', icon: '📸', duration: 6, cost: 300, effects: { fun: 6, social: 4 }, xp: { photography: 14 }, tags: ['fun', 'training'], beta: true },
      ] },
    },
  },
  beach: {
    id: 'beach', label: 'Beach', district: 'Lekki', icon: '🏖️', category: 'fun',
    description: 'Atlantic waves, cabanas, horses and grilled fish. Never closes.',
    zone: 'east', map: { x: 89, y: 82 }, scene: { kind: 'beach', anchors: { grill: 'bar' } },
    ambient: ['The tide is coming in', 'A horse is posing for photographs', 'Fish is hissing on the grill', 'Somebody’s speaker is louder than the sea'],
    spots: {
      shore: { id: 'shore', label: 'Shoreline', icon: '🌊', caption: 'Wet sand, loud waves', activities: [
        { id: 'beach-stroll', label: 'Stroll the Shoreline', icon: '🌊', duration: 10, cost: 0, effects: { energy: 3, fun: 8 }, tags: ['rest'], beta: true },
        { id: 'beach-swim', label: 'Swim in the Atlantic', icon: '🏊🏾', duration: 10, cost: 0, minimumNeeds: { energy: 15 }, effects: { energy: -6, hygiene: 6, fun: 14 }, xp: { fitness: 16 }, tags: ['training', 'fun'], beta: true },
        { id: 'beach-sunset', label: 'Shoot the Sunset', icon: '📷', duration: 9, cost: 0, effects: { fun: 5 }, xp: { photography: 26 }, tags: ['training'], beta: true },
      ] },
      cabanas: { id: 'cabanas', label: 'Cabanas', icon: '⛱️', caption: 'Shade for hire', activities: [
        { id: 'beach-cabana', label: 'Rent a Cabana', icon: '⛱️', duration: 12, cost: 4000, effects: { energy: 14, fun: 16, social: 6 }, tags: ['rest', 'status'], beta: true },
        { id: 'beach-portraits', label: 'Shoot Beach Portraits', icon: '📸', duration: 12, requiresSkill: { id: 'photography', level: 2 }, reward: 650, minimumNeeds: { energy: 20 },
          effects: { energy: -6 }, xp: { photography: 20 }, cooldown: 480, tags: ['performance'], beta: true },
      ] },
      pitch: { id: 'pitch', label: 'Sand pitch', icon: '⚽', caption: 'Slippers for goalposts', activities: [
        { id: 'beach-football', label: 'Beach Football', icon: '⚽', duration: 12, cost: 0, minimumNeeds: { energy: 20 }, effects: { energy: -12, hygiene: -8, fun: 14, social: 8 }, xp: { fitness: 28 }, tags: ['training', 'fun', 'social'], beta: true },
        { id: 'beach-tournament', label: 'Win the Beach Tournament', icon: '🏆', duration: 14, requiresSkill: { id: 'fitness', level: 5 }, reward: 1400, minimumNeeds: { energy: 30 },
          effects: { energy: -16, hygiene: -8 }, xp: { fitness: 32 }, cooldown: 900, tags: ['performance'], beta: true },
      ] },
      grill: { id: 'grill', label: 'Fish grill', icon: '🐟', caption: 'Choose your fish, then wait', activities: [
        { id: 'beach-fish', label: 'Grilled Croaker & Chips', icon: '🐟', duration: 8, cost: 3500, effects: { hunger: 50, fun: 10 }, tags: ['food'], beta: true },
        { id: 'beach-coconut', label: 'Fresh Coconut', icon: '🥥', duration: 4, cost: 400, effects: { hunger: 8, energy: 4 }, tags: ['food', 'drink'], beta: true },
        { id: 'beach-horse', label: 'Ride a Horse', icon: '🐎', duration: 8, cost: 1500, effects: { fun: 16 }, tags: ['fun'], beta: true },
      ] },
    },
  },
  // The airport at Ikeja and the refinery in the Lekki Free Zone: src/game/content/venues-transport.ts.
  airport: AIRPORT,
  refinery: REFINERY,
  // The University of Lagos campus at Akoka (Lagos only): src/campus/unilag/content.ts.
  unilag: UNILAG_VENUE,
} satisfies Record<string, VenueDefinition>;
export const VENUES: Record<string, VenueDefinition> & Record<keyof typeof VENUES_DATA, VenueDefinition> = VENUES_DATA;


export const HOME_SPOTS: Record<HouseId, HomeMapSpot> = {
  mushin: { district: 'Mushin', zone: 'mainland', map: { x: 27, y: 33 } },
  yaba: { district: 'Yaba', zone: 'mainland', map: { x: 53, y: 29 } },
  lekki: { district: 'Lekki Phase 1', zone: 'east', map: { x: 94, y: 92 } },
  ikoyi: { district: 'Ikoyi', zone: 'island', map: { x: 74, y: 88 } },
  banana: { district: 'Banana Island', zone: 'island', map: { x: 79, y: 86 } },
};
