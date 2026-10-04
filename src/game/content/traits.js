/**
 * OWNER: character
 * Traits, dreams, birth lottery outcomes, starting homes and appearance options.
 * Plain data only (no functions, no imports outside content/).
 *
 * Provenance: `beta: true` marks an original beta value. Names, option lists and any value
 * without that mark follow what was observed in the reference game. Where only part of an
 * entry is original, `betaFields` lists which fields are.
 *
 * EFFECT DATA (`fx`) — shared by traits, lottery outcomes and perks (content/goals.js) and
 * applied by src/game/character-effects.js through the registry modifier keys:
 *   xp          { all?: mult, [skill]: mult }      'skills.xpRate'
 *   decay       { all?: mult, [need]: mult }       'needs.decayRate'
 *   nightDecay  { [need]: mult }                   'needs.decayRate', 9 PM – 5 AM Lagos time only
 *   performance mult                               'career.performance' (applied to gains only)
 *   social      mult                               'social.gain' (applied to gains only)
 *   fare        mult                               'travel.fare'
 *   shop        mult                               'shop.price' for furniture and groceries (never cars)
 *   cost        { tags: [...], mult }              'activity.cost' for activities with any tag
 *   reward      { tags: [...], mult }              'activity.reward' for activities with any tag
 *   bonus       { tags: [...], needs: { ... } }    extra need change when such an activity completes
 */

// ---- Appearance -------------------------------------------------------------------------
// Option names and list lengths as observed in the reference game; hex values are original.
export const APPEARANCE = {
  bodies: [{ id: 'woman', label: 'Woman' }, { id: 'man', label: 'Man' }],
  hair: {
    woman: ['braids', 'afro', 'bun', 'ponytail', 'long', 'locs', 'low-cut', 'gele', 'classic'],
    man: ['low-cut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic'],
  },
  outfits: {
    woman: ['casual', 'office', 'owambe', 'site-work'],
    man: ['casual', 'hoodie', 'office', 'chill', 'site-work'],
  },
  fabrics: ['plain', 'ankara', 'adire', 'aso-oke'],
  skin: [
    { id: 'skin-1', label: 'Light brown', hex: '#e0ac7e' }, { id: 'skin-2', label: 'Tan', hex: '#c98e62' },
    { id: 'skin-3', label: 'Warm brown', hex: '#b0764c' }, { id: 'skin-4', label: 'Brown', hex: '#96603c' },
    { id: 'skin-5', label: 'Deep brown', hex: '#7a4a2c' }, { id: 'skin-6', label: 'Dark', hex: '#5e3620' },
    { id: 'skin-7', label: 'Very dark', hex: '#3f2416' },
  ],
  hairColours: [
    { id: 'black', label: 'Black', hex: '#15110f' }, { id: 'soft-black', label: 'Soft black', hex: '#2a211d' },
    { id: 'dark-brown', label: 'Dark brown', hex: '#3d2a1e' }, { id: 'brown', label: 'Brown', hex: '#5b3a24' },
    { id: 'auburn', label: 'Auburn', hex: '#8a3b22' }, { id: 'blonde', label: 'Blonde', hex: '#d9b45f' },
    { id: 'purple', label: 'Purple', hex: '#7b4bb0' },
  ],
  /** Used for both the outfit colour and the bottoms colour. */
  outfitColours: [
    { id: 'blue', label: 'Blue', hex: '#3b6fd4' }, { id: 'green', label: 'Green', hex: '#3f9a5f' },
    { id: 'red', label: 'Red', hex: '#c8443a' }, { id: 'orange', label: 'Orange', hex: '#e58a2f' },
    { id: 'violet', label: 'Violet', hex: '#7c55c7' }, { id: 'pink', label: 'Pink', hex: '#e07aa6' },
    { id: 'teal', label: 'Teal', hex: '#2c9c9a' }, { id: 'navy', label: 'Navy', hex: '#243a6b' },
    { id: 'cream', label: 'Cream', hex: '#f1e6cf' }, { id: 'gold', label: 'Gold', hex: '#d4a72c' },
  ],
  labels: {
    braids: 'Braids', afro: 'Afro', bun: 'Bun', ponytail: 'Ponytail', long: 'Long', locs: 'Locs', 'low-cut': 'Low cut',
    gele: 'Gele', classic: 'Classic', bald: 'Bald', curls: 'Curls',
    casual: 'Casual', office: 'Office', owambe: 'Owambe', 'site-work': 'Site work', hoodie: 'Hoodie', chill: 'Chill',
    plain: 'Plain', ankara: 'Ankara', adire: 'Adire', 'aso-oke': 'Aso-oke',
    // Original beta additions
    cornrows: 'Cornrows', twists: 'Twists', 'bantu-knots': 'Bantu knots', fade: 'Fade',
    jersey: 'Jersey', kaftan: 'Kaftan', gown: 'Gown', agbada: 'Agbada',
    glasses: 'Glasses', sunglasses: 'Sunglasses', cap: 'Cap', headwrap: 'Headwrap', fila: 'Fila', earrings: 'Earrings', chain: 'Chain',
    watch: 'Wristwatch', beads: 'Beads', backpack: 'Backpack', handbag: 'Handbag',
    oval: 'Oval', round: 'Round', long: 'Long', smile: 'Smile', neutral: 'Calm', grin: 'Grin',
  },
  /**
   * Original beta additions (add-only; the lists above stay exactly as observed). A body's styles
   * are its list above followed by its list here.
   */
  extra: {
    beta: true,
    hair: { woman: ['cornrows', 'twists', 'bantu-knots'], man: ['fade', 'cornrows', 'twists'] },
    outfits: { woman: ['jersey', 'kaftan', 'gown'], man: ['jersey', 'kaftan', 'agbada'] },
  },
  /**
   * Accessories: an optional list on a look (`look.accessories`), at most `accessoryLimit` and at
   * most one per slot. Original beta list.
   */
  accessories: [
    { id: 'glasses', slot: 'eyes' }, { id: 'sunglasses', slot: 'eyes' },
    { id: 'cap', slot: 'head' }, { id: 'headwrap', slot: 'head' }, { id: 'fila', slot: 'head' },
    { id: 'earrings', slot: 'ears' }, { id: 'chain', slot: 'neck' }, { id: 'watch', slot: 'wrist' }, { id: 'beads', slot: 'hand' },
    { id: 'backpack', slot: 'carry' }, { id: 'handbag', slot: 'carry' },
  ],
  accessoryLimit: 5,
  /** Optional on a look (`look.face`, `look.expression`); the first of each is the default. Free. Original beta lists. */
  faces: ['oval', 'round', 'long'],
  expressions: ['smile', 'neutral', 'grin'],
  /**
   * Styles that cannot be chosen (or shuffled) while creating a character: they are bought in the
   * Boutique after moving in. Everything else that is offered is free at creation. Original beta choice.
   */
  boutiqueOnly: {
    hair: ['twists', 'bantu-knots'], outfit: ['kaftan', 'gown', 'agbada'],
    accessories: ['sunglasses', 'headwrap', 'fila', 'chain', 'beads', 'backpack', 'handbag'],
  },
};

/** Look given to a life that predates character creation, and the starting point of a new one. */
export const DEFAULT_LOOK = {
  body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain',
  skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy',
};

/** Items every Sim owns without buying them (valid for both bodies). Original beta choice. */
export const WARDROBE_BASICS = { hair: ['low-cut'], outfit: ['casual'], fabric: ['plain'] };
/** Accessories every Sim owns without buying them: the ones offered at creation. Original beta choice. */
export const ACCESSORY_BASICS = ['glasses', 'cap', 'earrings', 'watch'];

/** Boutique prices in naira. Every price is an original beta value. */
export const BOUTIQUE_PRICES = {
  beta: true,
  hair: { 'low-cut': 0, bald: 500, bun: 2000, ponytail: 2000, afro: 2500, classic: 2500, curls: 3000, braids: 3500, long: 4000, locs: 4500, gele: 6000,
    fade: 1500, cornrows: 3000, twists: 3500, 'bantu-knots': 3000 },
  outfit: { casual: 0, chill: 4000, 'site-work': 5000, hoodie: 6000, office: 8000, owambe: 15000, jersey: 5000, kaftan: 12000, gown: 10000, agbada: 25000 },
  fabric: { plain: 0, ankara: 5000, adire: 7000, 'aso-oke': 12000 },
  accessories: { glasses: 0, cap: 0, earrings: 0, watch: 0, beads: 1500, headwrap: 1500, sunglasses: 2500, fila: 3000, backpack: 4000, chain: 6000, handbag: 7000 },
};

// ---- Traits (choose exactly two) ---------------------------------------------------------
// The ten names and what each one is about were observed; every magnitude is an original beta value.
export const TRAITS_REQUIRED = 2;
export const TRAITS = {
  hustler: { id: 'hustler', label: 'Hustler', icon: '💸', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Every corner is a business plan.', effects: ['Hustle grows 25% faster', 'Work performance rises 15% faster'],
    fx: { xp: { hustle: 1.25 }, performance: 1.15 } },
  foodie: { id: 'foodie', label: 'Foodie', icon: '🍛', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'A good plate fixes most problems.', effects: ['Cooking grows 25% faster', 'Every meal gives +5 Fun'],
    fx: { xp: { cooking: 1.25 }, bonus: { tags: ['food'], needs: { fun: 5 } } } },
  'owambe-spirit': { id: 'owambe-spirit', label: 'Owambe Spirit', icon: '🎊', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'First on the dance floor, last to leave.', effects: ['Dance grows 25% faster', 'Parties and dancing give +6 Fun', 'Fun drops 15% faster'],
    fx: { xp: { dance: 1.25 }, decay: { fun: 1.15 }, bonus: { tags: ['party', 'dance'], needs: { fun: 6 } } } },
  'gym-rat': { id: 'gym-rat', label: 'Gym Rat', icon: '🏋️', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Rest day is a rumour.', effects: ['Fitness grows 25% faster', 'Workouts give +6 Fun'],
    fx: { xp: { fitness: 1.25 }, bonus: { tags: ['workout', 'fitness'], needs: { fun: 6 } } } },
  'smooth-talker': { id: 'smooth-talker', label: 'Smooth Talker', icon: '🗣️', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Could talk a danfo conductor into giving change.', effects: ['Charisma grows 25% faster', 'Social interactions gain 15% more'],
    fx: { xp: { charisma: 1.25 }, social: 1.15 } },
  'lazy-bone': { id: 'lazy-bone', label: 'Lazy Bone', icon: '🛋️', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Saves energy like it is rent money.', effects: ['Energy drops 20% slower', 'Work performance rises 10% slower'],
    fx: { decay: { energy: 0.8 }, performance: 0.9 } },
  'clean-pikin': { id: 'clean-pikin', label: 'Clean Pikin', icon: '🫧', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Smells like fresh laundry at all times.', effects: ['Hygiene drops 25% slower'],
    fx: { decay: { hygiene: 0.75 } } },
  'night-crawler': { id: 'night-crawler', label: 'Night Crawler', icon: '🌙', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'The city gets interesting after dark.', effects: ['Energy drops 25% slower from 9 PM to 5 AM', 'Nightlife costs 10% less', 'Nightlife and parties give +5 Fun'],
    fx: { nightDecay: { energy: 0.75 }, cost: { tags: ['nightlife'], mult: 0.9 }, bonus: { tags: ['nightlife', 'party'], needs: { fun: 5 } } } },
  'tech-bro-or-sis': { id: 'tech-bro-or-sis', label: 'Tech Bro or Sis', icon: '💻', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Ships a side project before breakfast.', effects: ['Coding grows 25% faster'],
    fx: { xp: { coding: 1.25 } } },
  musical: { id: 'musical', label: 'Musical', icon: '🎵', beta: true, betaFields: ['fx', 'blurb'],
    blurb: 'Has a melody for every mood.', effects: ['Music grows 25% faster'],
    fx: { xp: { music: 1.25 } } },
};

// ---- Dreams (choose one) -----------------------------------------------------------------
// Names and completion conditions were observed. How progress is measured on the way there
// (see systems/goals.js) and the completion reward are original beta values.
export const DREAMS = {
  'oga-at-the-top': { id: 'oga-at-the-top', label: 'Oga at the Top', icon: '👔', goal: 'Reach the top level of any career.',
    measure: 'Progress follows your highest career level.' },
  'lekki-landlord': { id: 'lekki-landlord', label: 'Lekki Landlord', icon: '🏘️', goal: 'Build a net worth of ₦1,000,000.',
    measure: 'Progress is your cash plus what you have bought, minus loan debt, out of ₦1,000,000.' },
  'afrobeats-star': { id: 'afrobeats-star', label: 'Afrobeats Star', icon: '🎤', goal: 'Max out the Music skill (level 10).',
    measure: 'Progress follows your Music level, including partial levels.' },
  'everybodys-padi': { id: 'everybodys-padi', label: "Everybody's Padi", icon: '🤝', goal: 'Become best friends with 4 people.',
    measure: 'Each of your first 4 friends and each of your first 4 best friends adds 12.5%.' },
  'yaba-unicorn': { id: 'yaba-unicorn', label: 'Yaba Unicorn', icon: '🦄', goal: 'Get your startup funded at CcHub, Yaba.',
    measure: 'Coding to level 8 is 60%, Hustle to level 5 is 20%, a first CcHub visit 5%, and getting funded the last 15%.' },
};
/** Original beta values: what completing a dream pays, once. */
export const DREAM_REWARD = { beta: true, cash: 50000, stars: 10 };
export const DREAM_TARGETS = { beta: true, netWorth: 1000000, bestFriends: 4, careerTopLevel: 6, codingLevel: 8, hustleLevel: 5,
  /** One-off cash when the startup pitch succeeds. */ funding: 250000 };

// ---- Starting homes ----------------------------------------------------------------------
// Names, districts, weekly rent and difficulty tags were observed; the descriptions are original.
export const START_HOMES = {
  mushin: { id: 'mushin', label: 'Face-me-I-face-you', district: 'Mushin', rent: 2400, tag: 'Hard start', icon: '🏚️',
    blurb: 'One room in a busy shared compound. The rent is tiny and so is the space.' },
  yaba: { id: 'yaba', label: 'Self-contain', district: 'Yaba', rent: 6000, tag: 'Balanced', icon: '🏠',
    blurb: 'Your own bathroom and a kitchen corner, a short walk from the tech hubs.' },
  lekki: { id: 'lekki', label: 'Mini-flat', district: 'Lekki Phase 1', rent: 17000, tag: 'Big spender', icon: '🏢',
    blurb: 'A bedroom, a sitting room and a proper kitchen. Lovely, and priced like it.' },
};
export const RENT_NOTE = 'Rent is paid every Saturday.';

/** Needs a life starts with once it moves in, as reported for a fresh life in the reference game. */
export const START_NEEDS = { hunger: 80, energy: 85, fun: 70, social: 60, hygiene: 75, bladder: 70 };

// ---- Birth lottery -----------------------------------------------------------------------
// Rolled once. LAPO Baby is exactly as observed (loan, Hustle 2, +25% learning, Lekki locked,
// start cash 76,000 in Mushin and 96,000 in Yaba). Its odds, and every other outcome in full,
// are original beta content. `odds` are weights out of 100.
export const LOTTERY = {
  'lapo-baby': {
    id: 'lapo-baby', label: 'LAPO Baby', icon: '🧾', tagline: 'Nothing handed over, everything earned.', odds: 50, betaFields: ['odds', 'tagline'],
    startCash: { mushin: 76000, yaba: 96000 },
    locked: { lekki: 'Locked for LAPO Baby: a life started on a loan can only afford Mushin or Yaba. Earn your way up and move later in Phone → Houses.' },
    loan: { principal: 60000, weekly: 12000, owed: 72000 },
    skills: { hustle: 2 },
    fx: { xp: { all: 1.25 } },
    bullets: ['₦60,000 LAPO loan to start, repaid at ₦12,000 every week', 'Hustle starts at level 2', 'Learn every skill 25% faster', 'Start in Mushin or Yaba only'],
  },
  'civil-servant': {
    id: 'civil-servant', label: "Civil Servant's Pikin", icon: '🗂️', tagline: 'A steady home and a pension somewhere in the family.', odds: 28, beta: true,
    startCash: { mushin: 40000, yaba: 55000, lekki: 75000 },
    locked: {}, loan: null,
    skills: { charisma: 1 },
    fx: {},
    bullets: ['No loan: you start debt-free', 'Modest savings, less cash than a loan start', 'Charisma starts at level 1', 'Any of the three homes is open to you'],
  },
  'street-smart': {
    id: 'street-smart', label: 'Street Smart', icon: '🛞', tagline: 'Raised by the road. Tougher than the traffic.', odds: 14, beta: true,
    startCash: { mushin: 18000, yaba: 24000 },
    locked: { lekki: 'Locked for Street Smart: your savings cannot cover Lekki rent. Earn your way up and move later in Phone → Houses.' },
    loan: null,
    skills: { hustle: 3, fitness: 2 },
    fx: { decay: { hunger: 0.85, energy: 0.85 } },
    bullets: ['No loan, but very little cash', 'Hustle starts at level 3 and Fitness at level 2', 'Hunger and Energy drop 15% slower', 'Start in Mushin or Yaba only'],
  },
  ajebutter: {
    id: 'ajebutter', label: 'Ajebutter', icon: '🧈', tagline: 'Born with the generator already running.', odds: 8, beta: true,
    startCash: { mushin: 230000, yaba: 250000, lekki: 300000 },
    locked: {}, loan: null,
    skills: { charisma: 2 },
    fx: { xp: { all: 0.9 }, decay: { fun: 1.15 } },
    bullets: ['No loan and a large allowance', 'Charisma starts at level 2', 'Soft life: learn every skill 10% slower', 'Easily bored: Fun drops 15% faster'],
  },
};
export const LOTTERY_NOTE = 'Decided once. Starting a new life keeps the same roll.';

export const ONBOARDING_STEPS = [
  { id: 'look', label: 'Look' }, { id: 'traits', label: 'Personality' }, { id: 'dream', label: 'Dream' },
  { id: 'lottery', label: 'Birth lottery' }, { id: 'home', label: 'Home' },
];

// ---- Mood words and feeling lines --------------------------------------------------------
// The five mood words and their colours were observed; the score thresholds are original beta values.
export const MOODS = [
  { word: 'Very Happy', min: 78, tone: 'good', icon: '😁' },
  { word: 'Happy', min: 62, tone: 'good', icon: '😄' },
  { word: 'Fine', min: 45, tone: 'neutral', icon: '🙂' },
  { word: 'Uneasy', min: 25, tone: 'warn', icon: '😟' },
  { word: 'Miserable', min: 0, tone: 'bad', icon: '😣' },
];
/** Original one-line descriptions for the feelings the needs system reports, by feeling id. */
export const FEELING_LINES = {
  hungry: 'Your stomach is filing a complaint.', tired: 'Bed is calling your name.', bored: 'Nothing fun has happened in a while.',
  lonely: 'You have not talked to anyone lately.', grubby: 'A bath is overdue.', bursting: 'Find a toilet. Soon.',
};
