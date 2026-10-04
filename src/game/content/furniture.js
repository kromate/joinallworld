/**
 * OWNER: home
 * Furniture catalogue, the starter room, and the actions furniture offers.
 *
 * FURNITURE[id] = { id, label, category, kind, w, h, wall?, stars, price, icon, shape, color, blurb, beta? }
 *   category  one of CATEGORIES (the Buy tabs)
 *   kind      what the object does (see KINDS); objects of the same kind share actions
 *   w, h      footprint in floor tiles before rotation; `wall: true` items hang on a wall instead
 *   stars     quality 0–4. Better furniture gives better results: STAR_MULTIPLIER[stars] scales
 *             the positive effects and XP of the actions the object offers (original beta rule —
 *             the reference game shows the stars but what they do was never observed)
 *   shape     which procedural model src/scene/home-scene.js draws
 *
 * Provenance: the six Comfort items WITHOUT `beta` (Plastic Chair, Velvet Sofa, 3-Seater Family
 * Sofa, Leather Sofa, Royal Gold Sofa, Lounge Armchair) use the footprint, rating and price
 * observed in the reference game. Everything marked `beta: true` is original: the starter
 * objects were seen in the reference room but their prices were not, and the rest of the
 * catalogue was never opened. The nine category tabs follow the reference (the ninth was cut
 * off on screen and is assumed to be Pets).
 */
export const CATEGORIES = [
  { id: 'sleep', label: 'Sleep', icon: '🛏️' },
  { id: 'kitchen', label: 'Kitchen', icon: '🍳' },
  { id: 'bath', label: 'Bath', icon: '🪣' },
  { id: 'comfort', label: 'Comfort', icon: '🛋️' },
  { id: 'fun', label: 'Fun', icon: '📻' },
  { id: 'skills', label: 'Skills', icon: '📚' },
  { id: 'light', label: 'Light', icon: '💡' },
  { id: 'decor', label: 'Decor', icon: '🪴' },
  { id: 'pets', label: 'Pets', icon: '🐕', beta: true },
];

/** Positive effects and XP are multiplied by this, by star rating (original beta values). */
export const STAR_MULTIPLIER = [0.8, 1, 1.25, 1.5, 1.8];

/** Share of the list price returned when furniture is sold (original beta value). */
export const SELL_REFUND_RATE = 0.5;

/** Objects of these kinds work 20% better while a generator or inverter is in the room (original beta rule). */
export const POWERED_KINDS = ['tv', 'console', 'desk', 'keys'];
export const POWER_BONUS = 1.2;

/** kind → the home spot its actions appear at, and how to name it in a "you need one" message. */
export const KINDS = {
  bed: { spot: 'bedroom', needs: 'a bed' },
  cooler: { spot: 'kitchen', needs: 'a cooler box or fridge' },
  stove: { spot: 'kitchen', needs: 'a stove or cooker' },
  bath: { spot: 'bathroom', needs: 'a bucket or shower' },
  tub: { spot: 'bathroom', needs: 'a bathtub' },
  toilet: { spot: 'bathroom', needs: 'a toilet' },
  seat: { spot: 'living', needs: 'a chair or sofa' },
  radio: { spot: 'living', needs: 'a radio' },
  tv: { spot: 'living', needs: 'a TV' },
  console: { spot: 'living', needs: 'a game console' },
  game: { spot: 'living', needs: 'a board game' },
  pet: { spot: 'living', needs: 'a pet' },
  gym: { spot: 'study', needs: 'a gym mat or weight bench' },
  desk: { spot: 'study', needs: 'a laptop desk' },
  shelf: { spot: 'study', needs: 'a bookshelf' },
  keys: { spot: 'study', needs: 'a keyboard' },
  mirror: { spot: 'study', needs: 'a dance mirror' },
  tripod: { spot: 'study', needs: 'a camera tripod' },
  mic: { spot: 'study', needs: 'a practice mic' },
  light: { spot: null },
  power: { spot: null },
  water: { spot: null },
  decor: { spot: null },
};

/** Home spots this owner adds beside the ported kitchen, bathroom and bedroom. */
export const HOME_SPOTS = {
  living: { label: 'Sitting area', icon: '🛋️' },
  study: { label: 'Skills corner', icon: '📚' },
};

const B = true; // beta: original value

export const FURNITURE = {
  // ---- Sleep ----
  'sleeping-mat': { id: 'sleeping-mat', label: 'Raffia Sleeping Mat', category: 'sleep', kind: 'bed', w: 1, h: 2, stars: 0, price: 1500, icon: '🧺', shape: 'mat', color: '#c9a45c', blurb: 'Roll it out, roll it up. Your back keeps the receipts.', beta: B },
  'spring-bed': { id: 'spring-bed', label: 'Spring Bed', category: 'sleep', kind: 'bed', w: 1, h: 2, stars: 1, price: 6000, icon: '🛏️', shape: 'bed', color: '#8fa7c4', blurb: 'A real frame and a mattress with opinions.', beta: B },
  'foam-bed': { id: 'foam-bed', label: 'Double Foam Bed', category: 'sleep', kind: 'bed', w: 2, h: 2, stars: 2, price: 28000, icon: '🛏️', shape: 'bed', color: '#b98b6a', blurb: 'Six inches of foam between you and Monday.', beta: B },
  'ortho-bed': { id: 'ortho-bed', label: 'Orthopaedic Bed', category: 'sleep', kind: 'bed', w: 2, h: 2, stars: 3, price: 85000, icon: '🛏️', shape: 'bed', color: '#6f8f86', blurb: 'Firm, quiet and doctor-approved.', beta: B },
  'king-bed': { id: 'king-bed', label: 'Royal King Bed', category: 'sleep', kind: 'bed', w: 2, h: 3, stars: 4, price: 240000, icon: '👑', shape: 'bed', color: '#7a4f8a', blurb: 'Sleep like the landlord.', beta: B },
  // ---- Kitchen ----
  'cooler-box': { id: 'cooler-box', label: 'Cooler Box', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 1, price: 3500, icon: '🧊', shape: 'cooler', color: '#3f7fbf', blurb: 'Keeps garri, sugar and zobo cool with no light at all.', beta: B },
  'kerosene-stove': { id: 'kerosene-stove', label: 'Kerosene Stove', category: 'kitchen', kind: 'stove', w: 1, h: 1, stars: 1, price: 4500, icon: '🔥', shape: 'stove', color: '#4f7a5a', blurb: 'Smoky, patient and never lets jollof down.', beta: B },
  'gas-cooker': { id: 'gas-cooker', label: 'Two-burner Gas Cooker', category: 'kitchen', kind: 'stove', w: 1, h: 1, stars: 2, price: 38000, icon: '🍳', shape: 'cooker', color: '#d9dcd6', blurb: 'Blue flame, no smoke, faster stew.', beta: B },
  'chef-range': { id: 'chef-range', label: 'Chef’s Range', category: 'kitchen', kind: 'stove', w: 2, h: 1, stars: 4, price: 320000, icon: '👩‍🍳', shape: 'cooker', color: '#9aa3a8', blurb: 'Six burners and an oven. The party jollof machine.', beta: B },
  fridge: { id: 'fridge', label: 'Single-door Fridge', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 2, price: 95000, icon: '🧊', shape: 'fridge', color: '#e4e9ea', blurb: 'Cold water on demand, when there is light.', beta: B },
  'double-fridge': { id: 'double-fridge', label: 'Double-door Fridge', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 3, price: 260000, icon: '🧊', shape: 'fridge', color: '#b9c2c6', blurb: 'A freezer on top and room for a whole pot of soup.', beta: B },
  'water-drum': { id: 'water-drum', label: 'Water Drum', category: 'kitchen', kind: 'water', w: 1, h: 1, stars: 0, price: 2000, icon: '🛢️', shape: 'drum', color: '#3d6fa3', blurb: 'Fetch once, use all week.', beta: B },
  // ---- Bath ----
  'bucket-bowl': { id: 'bucket-bowl', label: 'Bucket & Bowl', category: 'bath', kind: 'bath', w: 1, h: 1, stars: 1, price: 800, icon: '🪣', shape: 'bucket', color: '#3f8f6b', blurb: 'The shower every Lagosian learned first.', beta: B },
  'shower-cubicle': { id: 'shower-cubicle', label: 'Shower Cubicle', category: 'bath', kind: 'bath', w: 1, h: 1, stars: 3, price: 60000, icon: '🚿', shape: 'shower', color: '#bfd6dc', blurb: 'Water from above. No more scooping.', beta: B },
  bathtub: { id: 'bathtub', label: 'Soaking Bathtub', category: 'bath', kind: 'tub', w: 2, h: 1, stars: 4, price: 180000, icon: '🛁', shape: 'tub', color: '#f1f1ec', blurb: 'Bubbles, a long soak and nobody knocking.', beta: B },
  toilet: { id: 'toilet', label: 'Toilet', category: 'bath', kind: 'toilet', w: 1, h: 1, stars: 1, price: 5000, icon: '🚽', shape: 'toilet', color: '#eeeeea', blurb: 'Your own. No queue in the compound.', beta: B },
  'wc-suite': { id: 'wc-suite', label: 'Soft-close WC Suite', category: 'bath', kind: 'toilet', w: 1, h: 1, stars: 3, price: 45000, icon: '🚽', shape: 'toilet', color: '#d8e6ea', blurb: 'Quiet lid, strong flush.', beta: B },
  basin: { id: 'basin', label: 'Wash Basin', category: 'bath', kind: 'decor', w: 1, h: 1, stars: 0, price: 400, icon: '🫧', shape: 'basin', color: '#c9574f', blurb: 'For laundry day and nothing else.', beta: B },
  // ---- Comfort (the six without `beta` are as observed in the reference game) ----
  'plastic-chair': { id: 'plastic-chair', label: 'Plastic Chair', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 0, price: 500, icon: '🪑', shape: 'chair', color: '#e9e6dc', blurb: 'Every party, every compound, every veranda.' },
  'velvet-sofa': { id: 'velvet-sofa', label: 'Velvet Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 2, price: 10200, icon: '🛋️', shape: 'sofa', color: '#7b4b8e', blurb: 'Soft enough to lose the remote in.' },
  'family-sofa': { id: 'family-sofa', label: '3-Seater Family Sofa', category: 'comfort', kind: 'seat', w: 3, h: 1, stars: 3, price: 24000, icon: '🛋️', shape: 'sofa', color: '#9c7b5a', blurb: 'Room for you, your cousin and their cousin.' },
  'leather-sofa': { id: 'leather-sofa', label: 'Leather Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 3, price: 32000, icon: '🛋️', shape: 'sofa', color: '#5a3a2c', blurb: 'Imported leather that squeaks with importance.' },
  'gold-sofa': { id: 'gold-sofa', label: 'Royal Gold Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 4, price: 55000, icon: '👑', shape: 'sofa', color: '#c9a227', blurb: 'For receiving visitors you want to impress.' },
  'lounge-armchair': { id: 'lounge-armchair', label: 'Lounge Armchair', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 2, price: 8500, icon: '💺', shape: 'sofa', color: '#4f7f86', blurb: 'One seat, zero sharing.' },
  'bean-bag': { id: 'bean-bag', label: 'Ankara Bean Bag', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 1, price: 3200, icon: '🫘', shape: 'beanbag', color: '#d0672f', blurb: 'Sink in, struggle to stand up.', beta: B },
  'corner-lounge': { id: 'corner-lounge', label: 'Corner Lounge Set', category: 'comfort', kind: 'seat', w: 2, h: 2, stars: 2, price: 15000, icon: '🛋️', shape: 'sofa', color: '#6d8a5e', blurb: 'Fills a corner and seats the whole match-day crowd.', beta: B },
  'wall-fan': { id: 'wall-fan', label: 'Wall Fan', category: 'comfort', kind: 'decor', w: 1, h: 1, wall: true, stars: 1, price: 6500, icon: '🌀', shape: 'fan', color: '#dfe5e2', blurb: 'Breeze from a corner nobody was using.', beta: B },
  // ---- Fun ----
  'radio-stool': { id: 'radio-stool', label: 'Radio on a Stool', category: 'fun', kind: 'radio', w: 1, h: 1, stars: 1, price: 2500, icon: '📻', shape: 'radio', color: '#b2452f', blurb: 'Morning news, evening highlife.', beta: B },
  'sound-system': { id: 'sound-system', label: 'Party Sound System', category: 'fun', kind: 'radio', w: 1, h: 1, stars: 3, price: 90000, icon: '🔊', shape: 'speaker', color: '#2f3238', blurb: 'The neighbours will know your playlist.', beta: B },
  'ludo-board': { id: 'ludo-board', label: 'Ludo Board', category: 'fun', kind: 'game', w: 1, h: 1, stars: 1, price: 1800, icon: '🎲', shape: 'board', color: '#d8b13a', blurb: 'Friendships have ended over this.', beta: B },
  'small-tv': { id: 'small-tv', label: '21-inch TV', category: 'fun', kind: 'tv', w: 1, h: 1, stars: 2, price: 45000, icon: '📺', shape: 'tv', color: '#4a3b30', blurb: 'Football, Nollywood and the nine o’clock news.', beta: B },
  'flat-tv': { id: 'flat-tv', label: 'Flat-screen & Console Unit', category: 'fun', kind: 'tv', w: 2, h: 1, stars: 3, price: 150000, icon: '📺', shape: 'tv', color: '#2b2f36', blurb: 'Wide enough to see the offside clearly.', beta: B },
  'game-console': { id: 'game-console', label: 'Game Console', category: 'fun', kind: 'console', w: 1, h: 1, stars: 3, price: 120000, icon: '🎮', shape: 'console', color: '#30343b', blurb: 'One more match. Just one more.', beta: B },
  // ---- Skills ----
  'gym-mat': { id: 'gym-mat', label: 'Gym Mat & Dumbbells', category: 'skills', kind: 'gym', w: 1, h: 2, stars: 1, price: 7500, icon: '🏋️', shape: 'gymmat', color: '#3f6f9f', blurb: 'Push-ups before the sun gets serious.', beta: B },
  'weight-bench': { id: 'weight-bench', label: 'Weight Bench', category: 'skills', kind: 'gym', w: 2, h: 1, stars: 3, price: 65000, icon: '🏋️', shape: 'bench', color: '#8f2f2f', blurb: 'A proper bench and a bar that means it.', beta: B },
  'laptop-desk': { id: 'laptop-desk', label: 'Laptop Desk', category: 'skills', kind: 'desk', w: 2, h: 1, stars: 2, price: 180000, icon: '💻', shape: 'desk', color: '#8a6b4a', blurb: 'A desk, a laptop and a side project.', beta: B },
  bookshelf: { id: 'bookshelf', label: 'Bookshelf', category: 'skills', kind: 'shelf', w: 1, h: 1, stars: 2, price: 22000, icon: '📚', shape: 'shelf', color: '#7a5a3c', blurb: 'Novels, textbooks and one borrowed dictionary.', beta: B },
  keyboard: { id: 'keyboard', label: 'Keyboard Piano', category: 'skills', kind: 'keys', w: 2, h: 1, stars: 2, price: 75000, icon: '🎹', shape: 'keyboard', color: '#2c2c30', blurb: 'From choir practice to studio dreams.', beta: B },
  'dance-mirror': { id: 'dance-mirror', label: 'Dance Mirror', category: 'skills', kind: 'mirror', w: 1, h: 1, wall: true, stars: 2, price: 18000, icon: '🪞', shape: 'mirror', color: '#b9c9cf', blurb: 'Check the legwork before the party does.', beta: B },
  'camera-tripod': { id: 'camera-tripod', label: 'Camera & Tripod', category: 'skills', kind: 'tripod', w: 1, h: 1, stars: 2, price: 110000, icon: '📷', shape: 'tripod', color: '#33363c', blurb: 'Golden hour does not wait.', beta: B },
  'practice-mic': { id: 'practice-mic', label: 'Practice Mic', category: 'skills', kind: 'mic', w: 1, h: 1, stars: 1, price: 12000, icon: '🎙️', shape: 'mic', color: '#44484f', blurb: 'Test the jokes on the wall first.', beta: B },
  // ---- Light ----
  'wall-lamp': { id: 'wall-lamp', label: 'Wall Lamp', category: 'light', kind: 'light', w: 1, h: 1, wall: true, stars: 0, price: 1200, icon: '💡', shape: 'lamp', color: '#ffd98a', blurb: 'A warm bulb on a bracket.', beta: B },
  lantern: { id: 'lantern', label: 'Rechargeable Lantern', category: 'light', kind: 'light', w: 1, h: 1, stars: 1, price: 2000, icon: '🏮', shape: 'lantern', color: '#ffe6a8', blurb: 'For when the light goes without warning.', beta: B },
  'standing-lamp': { id: 'standing-lamp', label: 'Standing Lamp', category: 'light', kind: 'light', w: 1, h: 1, stars: 2, price: 9000, icon: '🛋️', shape: 'floorlamp', color: '#ffd27a', blurb: 'Soft light for a soft evening.', beta: B },
  'led-strip': { id: 'led-strip', label: 'LED Strip Light', category: 'light', kind: 'light', w: 1, h: 1, wall: true, stars: 3, price: 30000, icon: '✨', shape: 'strip', color: '#7fd6ff', blurb: 'Instant music-video lighting.', beta: B },
  generator: { id: 'generator', label: 'Small Petrol Generator', category: 'light', kind: 'power', w: 1, h: 1, stars: 2, price: 150000, icon: '⛽', shape: 'generator', color: '#c9372c', blurb: 'Loud, loyal and never asks the grid for permission.', beta: B },
  inverter: { id: 'inverter', label: 'Inverter & Batteries', category: 'light', kind: 'power', w: 1, h: 1, stars: 3, price: 600000, icon: '🔋', shape: 'inverter', color: '#d7dbd8', blurb: 'Silent light. The neighbours will ask questions.', beta: B },
  // ---- Decor ----
  'wall-calendar': { id: 'wall-calendar', label: 'Wall Calendar', category: 'decor', kind: 'decor', w: 1, h: 1, wall: true, stars: 0, price: 300, icon: '🗓️', shape: 'calendar', color: '#f4f1e6', blurb: 'A gift from the pharmacy down the road.', beta: B },
  'jerry-cans': { id: 'jerry-cans', label: 'Jerry Cans', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 0, price: 600, icon: '🧴', shape: 'jerrycans', color: '#e3b23c', blurb: 'Water today, fuel tomorrow.', beta: B },
  'potted-plant': { id: 'potted-plant', label: 'Potted Plant', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 1, price: 2500, icon: '🪴', shape: 'plant', color: '#4f8f5b', blurb: 'Green, quiet and hard to kill.', beta: B },
  'wall-art': { id: 'wall-art', label: 'Framed Adire Art', category: 'decor', kind: 'decor', w: 1, h: 1, wall: true, stars: 2, price: 14000, icon: '🖼️', shape: 'art', color: '#2f4f8f', blurb: 'Indigo patterns that make a wall look decided.', beta: B },
  'centre-rug': { id: 'centre-rug', label: 'Centre Rug', category: 'decor', kind: 'decor', w: 2, h: 2, stars: 2, price: 16000, icon: '🧶', shape: 'rug', color: '#a8443c', blurb: 'Shoes off, please.', beta: B },
  wardrobe: { id: 'wardrobe', label: 'Wardrobe', category: 'decor', kind: 'decor', w: 2, h: 1, stars: 2, price: 30000, icon: '🚪', shape: 'wardrobe', color: '#6b4f3a', blurb: 'The clothes finally leave the chair.', beta: B },
  aquarium: { id: 'aquarium', label: 'Aquarium', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 3, price: 95000, icon: '🐠', shape: 'aquarium', color: '#4fa3c9', blurb: 'Tiny fish, big calm.', beta: B },
  // ---- Pets ----
  'local-dog': { id: 'local-dog', label: 'Loyal Local Dog', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 2, price: 35000, icon: '🐕', shape: 'petbed', color: '#b07a45', blurb: 'Barks at strangers, forgives you everything.', beta: B },
  'house-cat': { id: 'house-cat', label: 'House Cat', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 2, price: 25000, icon: '🐈', shape: 'petbed', color: '#8a8f96', blurb: 'Lives here rent-free and knows it.', beta: B },
  'grey-parrot': { id: 'grey-parrot', label: 'Talking Parrot', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 3, price: 60000, icon: '🦜', shape: 'cage', color: '#8f989c', blurb: 'Repeats everything. Mind what you say.', beta: B },
};

/**
 * The room a new life starts with, with positions designed for a 6 × 6 room (bigger rooms
 * scale the positions). The objects follow the starter room seen in the reference game; the
 * exact arrangement is original. Wall items give a wall slot as `x` (rot 0 = back wall) or
 * `y` (rot 1 = side wall).
 */
export const STARTER_FURNITURE = [
  { item: 'spring-bed', x: 0, y: 0, rot: 0 },
  { item: 'radio-stool', x: 1, y: 0, rot: 0 },
  { item: 'kerosene-stove', x: 3, y: 0, rot: 0 },
  { item: 'cooler-box', x: 4, y: 0, rot: 0 },
  { item: 'water-drum', x: 5, y: 0, rot: 0 },
  { item: 'jerry-cans', x: 5, y: 1, rot: 0 },
  { item: 'plastic-chair', x: 2, y: 2, rot: 0 },
  { item: 'toilet', x: 5, y: 5, rot: 0 },
  { item: 'bucket-bowl', x: 4, y: 5, rot: 0 },
  { item: 'basin', x: 3, y: 5, rot: 0 },
  { item: 'wall-lamp', x: 1, y: 0, rot: 0 },
  { item: 'wall-lamp', x: 0, y: 2, rot: 1 },
  { item: 'wall-calendar', x: 5, y: 0, rot: 0 },
];

/**
 * Actions furniture offers, run by the shared activity engine (see systems/activities.js for
 * the definition format). `needs` is the furniture kind that must be placed in the room. The
 * engine-wide activity id is `home-<id>`.
 * All amounts are original beta values unless the note says otherwise.
 */
export const HOME_ACTIVITIES = [
  { id: 'sleep', label: 'Sleep', icon: '😴', needs: 'bed', duration: 36, effectsPerSecond: { energy: 2.5 }, tags: ['sleep'],
    note: 'Duration as observed in the reference game; energy rises gradually and waking early keeps what was gained. The rate is an original beta value.' },
  { id: 'stay-in-bed', label: 'Stay in Bed', icon: '🛌', needs: 'bed', duration: 36, effectsPerSecond: { energy: 1.2, fun: 0.6 }, tags: ['sleep'],
    note: 'Duration as observed in the reference game; rates are original beta values.' },
  { id: 'use-toilet', label: 'Use the Toilet', icon: '🚽', needs: 'toilet', duration: 4, effects: { bladder: 70 }, tags: ['bladder'] },
  { id: 'long-soak', label: 'Long Soak', icon: '🛁', needs: 'tub', duration: 12, effects: { hygiene: 30, fun: 8, energy: 4 }, tags: ['hygiene'] },
  { id: 'sit-down', label: 'Sit & Rest', icon: '🪑', needs: 'seat', duration: 8, effects: { energy: 6, fun: 4 }, tags: ['rest'] },
  { id: 'listen-radio', label: 'Listen to the Radio', icon: '📻', needs: 'radio', duration: 10, effects: { fun: 12 }, tags: ['fun'] },
  { id: 'watch-tv', label: 'Watch TV', icon: '📺', needs: 'tv', duration: 12, effects: { fun: 18, energy: 2 }, tags: ['fun'] },
  { id: 'play-console', label: 'Play a Match', icon: '🎮', needs: 'console', duration: 12, effects: { fun: 24, energy: -3 }, tags: ['fun'] },
  { id: 'play-ludo', label: 'Play Ludo', icon: '🎲', needs: 'game', duration: 8, effects: { fun: 10, social: 3 }, tags: ['fun'] },
  { id: 'play-pet', label: 'Play with Your Pet', icon: '🐾', needs: 'pet', duration: 8, effects: { fun: 10, social: 8 }, tags: ['fun', 'social'] },
  { id: 'workout', label: 'Work Out', icon: '🏋️', needs: 'gym', duration: 12, effects: { energy: -8, hygiene: -6, fun: 2 }, xp: { fitness: 40 }, minimumNeeds: { energy: 15 }, tags: ['skill'] },
  { id: 'code-practice', label: 'Practise Coding', icon: '💻', needs: 'desk', duration: 14, effects: { energy: -5, fun: -2 }, xp: { coding: 40 }, minimumNeeds: { energy: 15 }, tags: ['skill'] },
  { id: 'read-book', label: 'Read a Book', icon: '📖', needs: 'shelf', duration: 10, effects: { fun: 4, energy: -2 }, xp: { charisma: 30 }, tags: ['skill'] },
  { id: 'practise-keys', label: 'Practise Keyboard', icon: '🎹', needs: 'keys', duration: 10, effects: { fun: 6, energy: -3 }, xp: { music: 35 }, tags: ['skill'] },
  { id: 'dance-practice', label: 'Practise Dance Steps', icon: '💃', needs: 'mirror', duration: 10, effects: { fun: 8, energy: -6, hygiene: -3 }, xp: { dance: 35 }, minimumNeeds: { energy: 15 }, tags: ['skill'] },
  { id: 'photo-practice', label: 'Practise Photography', icon: '📷', needs: 'tripod', duration: 10, effects: { fun: 5, energy: -2 }, xp: { photography: 35 }, tags: ['skill'] },
  { id: 'joke-practice', label: 'Rehearse Jokes', icon: '🎙️', needs: 'mic', duration: 10, effects: { fun: 6, energy: -2 }, xp: { comedy: 35 }, tags: ['skill'] },
];

/**
 * Activities defined elsewhere (the ported home spots) that a placed object improves:
 * activity id → furniture kind whose star rating scales it.
 */
export const PORTED_ACTIVITY_KIND = { nap: 'bed', bath: 'bath' };
