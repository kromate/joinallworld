import { CAMPUS_NPCS } from '../../campus/unilag/content.js';
/**
 * OWNER: social
 * NPCs, the interactions they offer, relationship tiers, family contacts and the limits on
 * player-to-player gifts. Plain data only (no functions, no imports).
 *
 * Provenance: `beta: true` marks an original beta value. Entries or fields without it follow
 * what was observed in the reference game. Where a single field of an observed entry is
 * original, the entry carries a `note` saying which.
 */

/**
 * Relationship tiers by closeness points (0–100).
 * Observed in the reference game: a closeness meter that unlocks "Ask to be my Bae" at 40, and
 * a "Paddy Mi" (best friend) status. The tier names in between and every other threshold are
 * original beta values. Bae is not a points tier: it is a status two real players agree on.
 */
export const MAX_CLOSENESS = 100;
export const BAE_UNLOCK = 40; // observed in the reference game
export const TIERS = [
  { id: 'stranger', label: 'Stranger', min: 0, beta: true },
  { id: 'acquaintance', label: 'Acquaintance', min: 5, beta: true },
  { id: 'friend', label: 'Friend', min: 20, beta: true },
  { id: 'paddy', label: 'Paddy Mi', min: BAE_UNLOCK, note: 'Name observed; sharing the 40-point Bae threshold is an original beta choice.', beta: true },
];
export const BAE_TIER = { id: 'bae', label: 'Bae' };

/** Interactions per person per Lagos day before they have "heard enough" (original beta value). */
export const DAILY_INTERACTIONS = 4;
/** Most people remembered in one life; the least-close stranger is forgotten first (original beta value). */
export const MAX_RELATIONSHIPS = 200;

/**
 * Interactions offered by every NPC. Labels, the +Fun/+Social tags, the ₦300 drink and the
 * 60% joke chance were observed in the reference game. Say Hello's +12 Social / +2 Fun was
 * observed; every duration, every other effect size, XP and closeness points are original
 * beta values.
 *   effects   applied on completion whatever happens
 *   success   { base } percent chance (before skill and closeness); `bonus` effects and the
 *             closeness points are only granted when it lands
 */
export const NPC_ACTIONS = [
  { id: 'hello', label: 'Say Hello', icon: '👋', duration: 6, effects: { social: 12, fun: 2 }, xp: { charisma: 5 }, points: 2,
    note: 'Effects observed in the reference game; duration, XP and points are original beta values.' },
  { id: 'gist', label: 'Gist', icon: '🗣️', duration: 10, effects: { social: 10, fun: 6 }, xp: { charisma: 8 }, points: 3, beta: true },
  { id: 'joke', label: 'Crack Joke', icon: '😂', duration: 8, effects: { social: 3, fun: 2 }, bonus: { social: 5, fun: 8 }, xp: { charisma: 6, comedy: 6 }, points: 5,
    success: { base: 60 }, note: 'The 60% base chance was observed in the reference game; everything else is an original beta value.' },
  { id: 'compliment', label: 'Compliment Their Fit', icon: '✨', duration: 6, effects: { social: 8, fun: 4 }, xp: { charisma: 6 }, points: 3, beta: true },
  { id: 'drink', label: 'Buy Them a Drink', icon: '🥤', duration: 9, cost: 300, effects: { social: 12, fun: 8 }, xp: { charisma: 8 }, points: 6,
    note: 'The ₦300 price was observed in the reference game; everything else is an original beta value.' },
];

/**
 * Interactions between two real players standing in the same venue. Labels and tags were
 * observed in the reference game; all numbers are original beta values (the reference showed a
 * different joke chance per target, formula unknown). These are instant and limited per day.
 */
export const PLAYER_ACTIONS = [
  { id: 'hello', label: 'Say Hello', icon: '👋', effects: { social: 10 }, xp: { charisma: 4 }, points: 2, beta: true },
  { id: 'gist', label: 'Gist', icon: '🗣️', effects: { social: 8, fun: 5 }, xp: { charisma: 6 }, points: 3, beta: true },
  { id: 'joke', label: 'Crack Joke', icon: '😂', effects: { social: 3, fun: 2 }, bonus: { social: 4, fun: 7 }, xp: { charisma: 5, comedy: 5 }, points: 5, success: { base: 60 }, beta: true },
  { id: 'shade', label: 'Throw Shade', icon: '😏', effects: { social: 4, fun: 6 }, xp: { charisma: 3 }, points: 1, beta: true },
];
/** Joke chance = base + per charisma level + per closeness point, clamped (original beta formula). */
export const JOKE_FORMULA = { perCharismaLevel: 2, perClosenessPoint: 0.4, min: 5, max: 95, beta: true };

/**
 * The cast: two regulars per venue, placed by venue id (`at` is where they stand in its scene).
 * A venue that does not exist in the running build simply has no cast. "Amaka — Serving" at the buka was observed in the
 * reference game; every other name, role and every quote line is original.
 */
/**
 * Where each regular stands in their venue's scene: a landmark key of that scene kind
 * (src/scene/venues-*.js). Original placement; a regular without one joins the general crowd.
 */
const NPC_PLACES = {
  amaka: 'counter', 'baba-sege': 'table', kunle: 'trees', 'mama-ronke': 'drinks', zainab: 'lounge', deji: 'bar',
  tega: 'desks', halima: 'pitch', 'femi-sax': 'stage', yeni: 'floor', 'oga-tunde': 'benches', chidi: 'banter',
  'iya-bose': 'produce', emeka: 'gadgets', 'coach-bayo': 'weights', ngozi: 'treadmills', 'mrs-okafor': 'reception', dapo: 'lounge',
  'dj-kay': 'dj', 'simi-vip': 'bookcase', 'ranger-musa': 'gate', tolu: 'tower', aisha: 'shops', uche: 'cinema',
  'captain-jide': 'water', blessing: 'bar', 'nurse-kemi': 'reception', 'papa-john': 'waiting', 'mama-bisi': 'chair', funke: 'dryer',
  somto: 'view', lola: 'lounge', 'sergeant-audu': 'desk', 'corporal-ife': 'bench', 'sister-grace': 'choir', 'usher-ben': 'pews',
  'alhaji-sani': 'prayer', 'mallam-isa': 'mihrab', 'oap-tobi': 'studio', 'sound-ada': 'control', 'agent-wale': 'queue', 'mrs-bello': 'officials',
  'protocol-segun': 'steps', 'madam-secretary': 'office',
};
const npc = (id, venue, name, role, emoji, quotes, extra = { beta: true }) => ({ id, venue, name, role, emoji, quotes, ...extra });
export const NPCS = Object.fromEntries([
  npc('amaka', 'amala-shitta', 'Amaka', 'Serving', '👩🏾‍🍳', ['Extra meat is extra money, no vex.', 'This pot has fed half of Surulere today.', 'You look like somebody that skipped breakfast.'], { note: 'Name and role observed in the reference game; quotes are original.' }),
  npc('baba-sege', 'amala-shitta', 'Baba Sege', 'Regular customer', '👴🏾', ['I have eaten here since before you were born.', 'Abula first, wahala later.'],),
  npc('kunle', 'park', 'Kunle', 'Sketching by the trees', '🧑🏾‍🎨', ['Sit small, let me draw your shadow.', 'Art no dey rush. Lagos dey rush.', 'This breeze is the only free thing left.']),
  npc('mama-ronke', 'park', 'Mama Ronke', 'Selling zobo', '👩🏾', ['Cold zobo, sweet like better news.', 'My customer! You no greet today?']),
  npc('zainab', 'library', 'Zainab', 'Reading in the lounge', '👩🏾‍💼', ['Shh. This chapter is getting good.', 'Have you read anything that changed your mind lately?']),
  npc('deji', 'library', 'Deji', 'Behind the bar', '🧑🏾‍🍳', ['Chapman or something stronger?', 'Everybody tells the barman the truth.']),
  npc('tega', 'cchub', 'Tega', 'Debugging', '🧑🏾‍💻', ['It works on my machine. NEPA took the machine.', 'Ship first, sleep later.']),
  npc('halima', 'cchub', 'Halima', 'Pitching a startup', '👩🏾‍💻', ['We are Uber, but for generators.', 'Do you know any investor? Any at all?']),
  npc('femi-sax', 'shrine', 'Femi Sax', 'Tuning up', '🎷', ['Music is the weapon. The horn is the bullet.', 'Stay for the second set. That is the real one.']),
  npc('yeni', 'shrine', 'Yeni', 'Dancing near the stage', '💃🏾', ['If your waist is not moving, check your pulse.', 'Tonight the band no go tire.']),
  npc('oga-tunde', 'viewing-centre', 'Oga Tunde', 'Running the screen', '📺', ['Fifty naira for the bench, argument is free.', 'If light goes, nobody should shout at me.']),
  npc('chidi', 'viewing-centre', 'Chidi', 'Arguing about football', '⚽', ['That referee needs glasses and prayers.', 'My club will win the league. Write it down.']),
  npc('iya-bose', 'market', 'Iya Bose', 'Selling pepper', '🌶️', ['Fresh pepper! Price it well, I will sell.', 'Customer, last price is last price.']),
  npc('emeka', 'market', 'Emeka', 'Phone accessories', '📱', ['Original charger, I swear on my shop.', 'Screen guard? I fit it now-now.']),
  npc('coach-bayo', 'i-fitness', 'Coach Bayo', 'Personal trainer', '🏋🏾', ['One more rep. I said one more.', 'Jollof is not a pre-workout.']),
  npc('ngozi', 'i-fitness', 'Ngozi', 'On the treadmill', '🏃🏾‍♀️', ['Five kilometres before work, every day.', 'The gym is cheaper than the hospital.']),
  npc('mrs-okafor', 'office', 'Mrs Okafor', 'Front desk', '👩🏾‍💼', ['Sign the visitors book, please.', 'The lift is working today. Thank God.']),
  npc('dapo', 'office', 'Dapo', 'On a tea break', '☕', ['This meeting could have been an email.', 'Month end is far, my brother.']),
  npc('dj-kay', 'quilox', 'DJ Kay', 'On the decks', '🎧', ['Request? Send it with a drink.', 'When the beat drops, forget your problems.']),
  npc('simi-vip', 'quilox', 'Simi', 'In the VIP queue', '🥂', ['My name should be on the list.', 'These heels were a mistake.']),
  npc('ranger-musa', 'canopy-walk', 'Ranger Musa', 'Guiding visitors', '🧭', ['Do not look down. Okay, look small.', 'The monkeys here have no respect.']),
  npc('tolu', 'canopy-walk', 'Tolu', 'Taking pictures', '📷', ['Stand there, the light is perfect.', 'I came for peace and content.']),
  npc('aisha', 'palms', 'Aisha', 'Window shopping', '🛍️', ['I am only looking. My account knows why.', 'The AC here is the real attraction.']),
  npc('uche', 'palms', 'Uche', 'Cinema usher', '🎬', ['Screen three, straight then left.', 'No outside popcorn. I do not make the rules.']),
  npc('captain-jide', 'beach', 'Captain Jide', 'Boat operator', '⛵', ['Life jacket first, selfie after.', 'The sea has its own mind today.']),
  npc('blessing', 'beach', 'Blessing', 'Selling coconuts', '🥥', ['Fresh coconut, I will cut it for you.', 'Sand is free, shade is not.']),
  npc('nurse-kemi', 'hospital', 'Nurse Kemi', 'On duty', '👩🏾‍⚕️', ['Have you eaten before taking that drug?', 'Take your card to the next window.']),
  npc('papa-john', 'hospital', 'Papa John', 'Waiting his turn', '👴🏾', ['I have been number twelve since morning.', 'Health is wealth. I have neither today.']),
  npc('mama-bisi', 'salon', 'Mama Bisi', 'Braiding hair', '💇🏾‍♀️', ['Sit well, this style takes three hours.', 'All the gist in Lagos passes through this chair.']),
  npc('funke', 'salon', 'Funke', 'Under the dryer', '👩🏾‍🦱', ['Did you hear what happened on our street?', 'Beauty is pain, my sister.']),
  npc('somto', 'rooftop', 'Somto', 'Watching the skyline', '🌇', ['From up here the traffic looks peaceful.', 'One day, one of those towers will be mine.']),
  npc('lola', 'rooftop', 'Lola', 'Hosting tonight', '🍸', ['Table for how many?', 'Sunset is our best staff member.']),
  npc('sergeant-audu', 'police', 'Sergeant Audu', 'At the counter', '👮🏾', ['Write your statement. Use your own biro.', 'Bail is free. So they say.']),
  npc('corporal-ife', 'police', 'Corporal Ife', 'On gate duty', '👮🏾‍♀️', ['Park well. This is not your compound.', 'Wetin you carry?']),
  npc('sister-grace', 'church', 'Sister Grace', 'Choir practice', '🎶', ['Alto section, we are flat again.', 'You are welcome in the house.']),
  npc('usher-ben', 'church', 'Usher Ben', 'Arranging chairs', '🪑', ['Front row is free, nobody ever wants it.', 'Service starts on time. African time.']),
  npc('alhaji-sani', 'mosque', 'Alhaji Sani', 'After prayers', '🧔🏾', ['Peace be upon you, my friend.', 'Patience is half of everything.']),
  npc('mallam-isa', 'mosque', 'Mallam Isa', 'Teaching', '📿', ['Come and sit. Knowledge is not heavy.', 'Small small, the bird builds its nest.']),
  npc('oap-tobi', 'radio', 'OAP Tobi', 'On air soon', '🎙️', ['Lagos, are you with me this morning?', 'Three, two, one — we are live.']),
  npc('sound-ada', 'radio', 'Ada', 'Sound engineer', '🎚️', ['Do not touch that fader.', 'Your voice is fine. The mic is the problem.']),
  npc('agent-wale', 'polling-unit', 'Agent Wale', 'Party agent', '🗳️', ['Have you collected your card?', 'Every vote is one vote. Count it.']),
  npc('mrs-bello', 'polling-unit', 'Mrs Bello', 'Electoral officer', '📋', ['Queue here. One person, one line.', 'Ink on the finger, then you may go.']),
  npc('protocol-segun', 'state-house', 'Segun', 'Protocol officer', '🕴🏾', ['His Excellency is in a meeting.', 'Do you have an appointment?']),
  npc('madam-secretary', 'state-house', 'Madam Abike', 'Secretary', '🗂️', ['Drop your letter, we will get back to you.', 'The file is on the table.']),
].map((entry) => [entry.id, { ...entry, at: NPC_PLACES[entry.id] ?? null }]));

/**
 * Family and phone contacts (original beta feature). A "Mummy" contact who can be called was
 * observed in the reference game; the rest of the household, every line and every number
 * here are original beta values. A call is a short timed action that works anywhere.
 *   every call: `effects`; the first call to each member per Lagos day also gives `first`, the
 *   XP and the check-in moodlet.
 */
export const FAMILY = {
  mummy: { id: 'mummy', name: 'Mummy', relation: 'Mother', emoji: '👩🏾', line: 'Picks up on the first ring', contact: true,
    quotes: ['Have you eaten?', 'Remember the child of whom you are.', 'Call your father too.'], note: 'Contact observed in the reference game; all values are original.', beta: true },
  daddy: { id: 'daddy', name: 'Daddy', relation: 'Father', emoji: '👨🏾', line: 'Short calls, big advice',
    quotes: ['How is work?', 'Save something every month.', 'Greet your landlord for me.'], beta: true },
  tobi: { id: 'tobi', name: 'Tobi', relation: 'Younger brother', emoji: '🧒🏾', line: 'Wants data and gist',
    quotes: ['Abeg send me something small.', 'When are you coming home?'], beta: true },
  grandma: { id: 'grandma', name: 'Grandma', relation: 'Grandmother', emoji: '👵🏾', line: 'Prays before she says hello',
    quotes: ['You will not see shame.', 'Come home for Christmas.'], beta: true },
};
export const FAMILY_CALL = { duration: 8, effects: { social: 2 }, first: { social: 8 }, xp: { charisma: 2 },
  moodlet: { id: 'family-checkin', label: 'Checked in with family', value: 5, duration: 6 * 3600 }, beta: true };

/**
 * Gifts of naira between players (original beta values, deliberately conservative: the
 * reference game's own rules were not observed and players reported that easy gifts made work
 * pointless). A life can never give away more than it has earned from paid work.
 */
export const TRANSFER_LIMITS = {
  min: 100, maxPerTransfer: 5000, dailyAmount: 10000, dailyCount: 3, dailyReceive: 20000,
  minEarned: 1000, minAccountAgeMs: 24 * 3600 * 1000, minFriendshipMs: 3600 * 1000, beta: true,
};

Object.assign(NPCS, CAMPUS_NPCS);
