/**
 * OWNER: home
 * Furniture catalogue, the starter room, and the actions furniture offers.
 *
 * FURNITURE[id] = { id, label, category, kind, w, h, wall?, stars, price, icon, beta? }
 *   category  one of CATEGORIES (the Buy tabs)
 *   kind      what the object does (see KINDS); objects of the same kind share actions
 *   w, h      footprint in floor tiles before rotation; `wall: true` items hang on a wall instead
 *   stars     quality 0–4. Better furniture gives better results: STAR_MULTIPLIER[stars] scales
 *             the positive effects and XP of the actions the object offers (original beta rule —
 *             provisional)
 *   Appearance and descriptions load separately from furniture-presentation.ts.
 *
 * Provenance: the six Comfort items WITHOUT `beta` (Plastic Chair, Velvet Sofa, 3-Seater Family
 * Sofa, Leather Sofa, Royal Gold Sofa, Lounge Armchair) have a fixed footprint, rating and price.
 * Everything marked `beta: true` is provisional: the starter objects' prices and the
 * rest of the catalogue may be retuned. There are nine category tabs (the ninth is Pets).
 */
import type { FurnitureId } from '../../types/life.ts'
import type {
  FurnitureCategory, FurnitureDefinition, FurnitureKind, FurnitureKindInfo, HomeActivityDefinition, HomeSpotMeta, StarterFurnitureEntry,
} from '../../types/content.ts'

export const CATEGORIES: FurnitureCategory[] = [
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
export const STAR_MULTIPLIER: number[] = [0.8, 1, 1.25, 1.5, 1.8];

/** Share of the list price returned when furniture is sold (original beta value). */
export const SELL_REFUND_RATE = 0.5;

/** Objects of these kinds work 20% better while a generator or inverter is in the room (original beta rule). */
export const POWERED_KINDS: FurnitureKind[] = ['tv', 'console', 'desk', 'keys'];
export const POWER_BONUS = 1.2;

/** kind → the home spot its actions appear at, and how to name it in a "you need one" message. */
export const KINDS: Record<FurnitureKind, FurnitureKindInfo> = {
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
export const HOME_SPOTS: Record<'living' | 'study', HomeSpotMeta> = {
  living: { label: 'Sitting area', icon: '🛋️' },
  study: { label: 'Skills corner', icon: '📚' },
};

const B = true; // beta: original value

export const FURNITURE: Record<FurnitureId, FurnitureDefinition> = {
  // ---- Sleep ----
  'sleeping-mat': { id: 'sleeping-mat', label: 'Raffia Sleeping Mat', category: 'sleep', kind: 'bed', w: 1, h: 2, stars: 0, price: 1500, icon: '🧺', beta: B },
  'spring-bed': { id: 'spring-bed', label: 'Spring Bed', category: 'sleep', kind: 'bed', w: 1, h: 2, stars: 1, price: 6000, icon: '🛏️', beta: B },
  'foam-bed': { id: 'foam-bed', label: 'Double Foam Bed', category: 'sleep', kind: 'bed', w: 2, h: 2, stars: 2, price: 28000, icon: '🛏️', beta: B },
  'ortho-bed': { id: 'ortho-bed', label: 'Orthopaedic Bed', category: 'sleep', kind: 'bed', w: 2, h: 2, stars: 3, price: 85000, icon: '🛏️', beta: B },
  'king-bed': { id: 'king-bed', label: 'Royal King Bed', category: 'sleep', kind: 'bed', w: 2, h: 3, stars: 4, price: 240000, icon: '👑', beta: B },
  // ---- Kitchen ----
  'cooler-box': { id: 'cooler-box', label: 'Cooler Box', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 1, price: 3500, icon: '🧊', beta: B },
  'kerosene-stove': { id: 'kerosene-stove', label: 'Kerosene Stove', category: 'kitchen', kind: 'stove', w: 1, h: 1, stars: 1, price: 4500, icon: '🔥', beta: B },
  'gas-cooker': { id: 'gas-cooker', label: 'Two-burner Gas Cooker', category: 'kitchen', kind: 'stove', w: 1, h: 1, stars: 2, price: 38000, icon: '🍳', beta: B },
  'chef-range': { id: 'chef-range', label: 'Chef’s Range', category: 'kitchen', kind: 'stove', w: 2, h: 1, stars: 4, price: 320000, icon: '👩‍🍳', beta: B },
  fridge: { id: 'fridge', label: 'Single-door Fridge', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 2, price: 95000, icon: '🧊', beta: B },
  'double-fridge': { id: 'double-fridge', label: 'Double-door Fridge', category: 'kitchen', kind: 'cooler', w: 1, h: 1, stars: 3, price: 260000, icon: '🧊', beta: B },
  'water-drum': { id: 'water-drum', label: 'Water Drum', category: 'kitchen', kind: 'water', w: 1, h: 1, stars: 0, price: 2000, icon: '🛢️', beta: B },
  // ---- Bath ----
  'bucket-bowl': { id: 'bucket-bowl', label: 'Bucket & Bowl', category: 'bath', kind: 'bath', w: 1, h: 1, stars: 1, price: 800, icon: '🪣', beta: B },
  'shower-cubicle': { id: 'shower-cubicle', label: 'Shower Cubicle', category: 'bath', kind: 'bath', w: 1, h: 1, stars: 3, price: 60000, icon: '🚿', beta: B },
  bathtub: { id: 'bathtub', label: 'Soaking Bathtub', category: 'bath', kind: 'tub', w: 2, h: 1, stars: 4, price: 180000, icon: '🛁', beta: B },
  toilet: { id: 'toilet', label: 'Toilet', category: 'bath', kind: 'toilet', w: 1, h: 1, stars: 1, price: 5000, icon: '🚽', beta: B },
  'wc-suite': { id: 'wc-suite', label: 'Soft-close WC Suite', category: 'bath', kind: 'toilet', w: 1, h: 1, stars: 3, price: 45000, icon: '🚽', beta: B },
  basin: { id: 'basin', label: 'Wash Basin', category: 'bath', kind: 'decor', w: 1, h: 1, stars: 0, price: 400, icon: '🫧', beta: B },
  // ---- Comfort (the six without `beta` are fixed) ----
  'plastic-chair': { id: 'plastic-chair', label: 'Plastic Chair', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 0, price: 500, icon: '🪑' },
  'velvet-sofa': { id: 'velvet-sofa', label: 'Velvet Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 2, price: 10200, icon: '🛋️' },
  'family-sofa': { id: 'family-sofa', label: '3-Seater Family Sofa', category: 'comfort', kind: 'seat', w: 3, h: 1, stars: 3, price: 24000, icon: '🛋️' },
  'leather-sofa': { id: 'leather-sofa', label: 'Leather Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 3, price: 32000, icon: '🛋️' },
  'gold-sofa': { id: 'gold-sofa', label: 'Royal Gold Sofa', category: 'comfort', kind: 'seat', w: 2, h: 1, stars: 4, price: 55000, icon: '👑' },
  'lounge-armchair': { id: 'lounge-armchair', label: 'Lounge Armchair', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 2, price: 8500, icon: '💺' },
  'bean-bag': { id: 'bean-bag', label: 'Ankara Bean Bag', category: 'comfort', kind: 'seat', w: 1, h: 1, stars: 1, price: 3200, icon: '🫘', beta: B },
  'corner-lounge': { id: 'corner-lounge', label: 'Corner Lounge Set', category: 'comfort', kind: 'seat', w: 2, h: 2, stars: 2, price: 15000, icon: '🛋️', beta: B },
  'wall-fan': { id: 'wall-fan', label: 'Wall Fan', category: 'comfort', kind: 'decor', w: 1, h: 1, wall: true, stars: 1, price: 6500, icon: '🌀', beta: B },
  // ---- Fun ----
  'radio-stool': { id: 'radio-stool', label: 'Radio on a Stool', category: 'fun', kind: 'radio', w: 1, h: 1, stars: 1, price: 2500, icon: '📻', beta: B },
  'sound-system': { id: 'sound-system', label: 'Party Sound System', category: 'fun', kind: 'radio', w: 1, h: 1, stars: 3, price: 90000, icon: '🔊', beta: B },
  'ludo-board': { id: 'ludo-board', label: 'Ludo Board', category: 'fun', kind: 'game', w: 1, h: 1, stars: 1, price: 1800, icon: '🎲', beta: B },
  'small-tv': { id: 'small-tv', label: '21-inch TV', category: 'fun', kind: 'tv', w: 1, h: 1, stars: 2, price: 45000, icon: '📺', beta: B },
  'flat-tv': { id: 'flat-tv', label: 'Flat-screen & Console Unit', category: 'fun', kind: 'tv', w: 2, h: 1, stars: 3, price: 150000, icon: '📺', beta: B },
  'game-console': { id: 'game-console', label: 'Game Console', category: 'fun', kind: 'console', w: 1, h: 1, stars: 3, price: 120000, icon: '🎮', beta: B },
  // ---- Skills ----
  'gym-mat': { id: 'gym-mat', label: 'Gym Mat & Dumbbells', category: 'skills', kind: 'gym', w: 1, h: 2, stars: 1, price: 7500, icon: '🏋️', beta: B },
  'weight-bench': { id: 'weight-bench', label: 'Weight Bench', category: 'skills', kind: 'gym', w: 2, h: 1, stars: 3, price: 65000, icon: '🏋️', beta: B },
  'laptop-desk': { id: 'laptop-desk', label: 'Laptop Desk', category: 'skills', kind: 'desk', w: 2, h: 1, stars: 2, price: 180000, icon: '💻', beta: B },
  bookshelf: { id: 'bookshelf', label: 'Bookshelf', category: 'skills', kind: 'shelf', w: 1, h: 1, stars: 2, price: 22000, icon: '📚', beta: B },
  keyboard: { id: 'keyboard', label: 'Keyboard Piano', category: 'skills', kind: 'keys', w: 2, h: 1, stars: 2, price: 75000, icon: '🎹', beta: B },
  'dance-mirror': { id: 'dance-mirror', label: 'Dance Mirror', category: 'skills', kind: 'mirror', w: 1, h: 1, wall: true, stars: 2, price: 18000, icon: '🪞', beta: B },
  'camera-tripod': { id: 'camera-tripod', label: 'Camera & Tripod', category: 'skills', kind: 'tripod', w: 1, h: 1, stars: 2, price: 110000, icon: '📷', beta: B },
  'practice-mic': { id: 'practice-mic', label: 'Practice Mic', category: 'skills', kind: 'mic', w: 1, h: 1, stars: 1, price: 12000, icon: '🎙️', beta: B },
  // ---- Light ----
  'wall-lamp': { id: 'wall-lamp', label: 'Wall Lamp', category: 'light', kind: 'light', w: 1, h: 1, wall: true, stars: 0, price: 1200, icon: '💡', beta: B },
  lantern: { id: 'lantern', label: 'Rechargeable Lantern', category: 'light', kind: 'light', w: 1, h: 1, stars: 1, price: 2000, icon: '🏮', beta: B },
  'standing-lamp': { id: 'standing-lamp', label: 'Standing Lamp', category: 'light', kind: 'light', w: 1, h: 1, stars: 2, price: 9000, icon: '🛋️', beta: B },
  'led-strip': { id: 'led-strip', label: 'LED Strip Light', category: 'light', kind: 'light', w: 1, h: 1, wall: true, stars: 3, price: 30000, icon: '✨', beta: B },
  generator: { id: 'generator', label: 'Small Petrol Generator', category: 'light', kind: 'power', w: 1, h: 1, stars: 2, price: 150000, icon: '⛽', beta: B },
  inverter: { id: 'inverter', label: 'Inverter & Batteries', category: 'light', kind: 'power', w: 1, h: 1, stars: 3, price: 600000, icon: '🔋', beta: B },
  // ---- Decor ----
  'wall-calendar': { id: 'wall-calendar', label: 'Wall Calendar', category: 'decor', kind: 'decor', w: 1, h: 1, wall: true, stars: 0, price: 300, icon: '🗓️', beta: B },
  'jerry-cans': { id: 'jerry-cans', label: 'Jerry Cans', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 0, price: 600, icon: '🧴', beta: B },
  'potted-plant': { id: 'potted-plant', label: 'Potted Plant', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 1, price: 2500, icon: '🪴', beta: B },
  'wall-art': { id: 'wall-art', label: 'Framed Adire Art', category: 'decor', kind: 'decor', w: 1, h: 1, wall: true, stars: 2, price: 14000, icon: '🖼️', beta: B },
  'centre-rug': { id: 'centre-rug', label: 'Centre Rug', category: 'decor', kind: 'decor', w: 2, h: 2, stars: 2, price: 16000, icon: '🧶', beta: B },
  wardrobe: { id: 'wardrobe', label: 'Wardrobe', category: 'decor', kind: 'decor', w: 2, h: 1, stars: 2, price: 30000, icon: '🚪', beta: B },
  aquarium: { id: 'aquarium', label: 'Aquarium', category: 'decor', kind: 'decor', w: 1, h: 1, stars: 3, price: 95000, icon: '🐠', beta: B },
  // ---- Pets ----
  'local-dog': { id: 'local-dog', label: 'Loyal Local Dog', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 2, price: 35000, icon: '🐕', beta: B },
  'house-cat': { id: 'house-cat', label: 'House Cat', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 2, price: 25000, icon: '🐈', beta: B },
  'grey-parrot': { id: 'grey-parrot', label: 'Talking Parrot', category: 'pets', kind: 'pet', w: 1, h: 1, stars: 3, price: 60000, icon: '🦜', beta: B },
};

/**
 * The room a new life starts with, with positions designed for a 6 × 6 room (bigger rooms
 * scale the positions). The objects are the starter room's; the
 * exact arrangement is original. Wall items give a wall slot as `x` (rot 0 = back wall) or
 * `y` (rot 1 = side wall).
 */
export const STARTER_FURNITURE: StarterFurnitureEntry[] = [
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
 * Actions furniture offers, run by the shared activity engine (see systems/activities.ts for
 * the definition format). `needs` is the furniture kind that must be placed in the room. The
 * engine-wide activity id is `home-<id>`.
 * All amounts are original beta values unless the note says otherwise.
 */
export const HOME_ACTIVITIES: HomeActivityDefinition[] = [
  { id: 'sleep', label: 'Sleep', icon: '😴', needs: 'bed', duration: 36, effectsPerSecond: { energy: 2.5 }, tags: ['sleep'],
    note: 'Duration is fixed; energy rises gradually and waking early keeps what was gained. The rate is an original beta value.' },
  { id: 'stay-in-bed', label: 'Stay in Bed', icon: '🛌', needs: 'bed', duration: 36, effectsPerSecond: { energy: 1.2, fun: 0.6 }, tags: ['sleep'],
    note: 'Duration is fixed; rates are original beta values.' },
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
export const PORTED_ACTIVITY_KIND = { nap: 'bed', bath: 'bath' } satisfies Record<string, FurnitureKind>;
