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

/** Compact catalogue rows; fixed entries omit beta and wall entries retain their slot rule. */
function furniture(id: FurnitureId, label: string, category: FurnitureDefinition['category'], kind: FurnitureKind,
  w: number, h: number, stars: number, price: number, icon: string,
  flags?: 'fixed' | 'wall'): [FurnitureId, FurnitureDefinition] {
  return [id, { id, label, category, kind, w, h, ...(flags === 'wall' ? { wall: true } : {}), stars, price, icon,
    ...(flags === 'fixed' ? {} : { beta: true }) }];
}

export const FURNITURE: Record<FurnitureId, FurnitureDefinition> = Object.fromEntries([
  // ---- Sleep ----
  furniture('sleeping-mat', 'Raffia Sleeping Mat', 'sleep', 'bed', 1, 2, 0, 1500, '🧺'),
  furniture('spring-bed', 'Spring Bed', 'sleep', 'bed', 1, 2, 1, 6000, '🛏️'),
  furniture('foam-bed', 'Double Foam Bed', 'sleep', 'bed', 2, 2, 2, 28000, '🛏️'),
  furniture('ortho-bed', 'Orthopaedic Bed', 'sleep', 'bed', 2, 2, 3, 85000, '🛏️'),
  furniture('king-bed', 'Royal King Bed', 'sleep', 'bed', 2, 3, 4, 240000, '👑'),
  // ---- Kitchen ----
  furniture('cooler-box', 'Cooler Box', 'kitchen', 'cooler', 1, 1, 1, 3500, '🧊'),
  furniture('kerosene-stove', 'Kerosene Stove', 'kitchen', 'stove', 1, 1, 1, 4500, '🔥'),
  furniture('gas-cooker', 'Two-burner Gas Cooker', 'kitchen', 'stove', 1, 1, 2, 38000, '🍳'),
  furniture('chef-range', 'Chef’s Range', 'kitchen', 'stove', 2, 1, 4, 320000, '👩‍🍳'),
  furniture('fridge', 'Single-door Fridge', 'kitchen', 'cooler', 1, 1, 2, 95000, '🧊'),
  furniture('double-fridge', 'Double-door Fridge', 'kitchen', 'cooler', 1, 1, 3, 260000, '🧊'),
  furniture('water-drum', 'Water Drum', 'kitchen', 'water', 1, 1, 0, 2000, '🛢️'),
  // ---- Bath ----
  furniture('bucket-bowl', 'Bucket & Bowl', 'bath', 'bath', 1, 1, 1, 800, '🪣'),
  furniture('shower-cubicle', 'Shower Cubicle', 'bath', 'bath', 1, 1, 3, 60000, '🚿'),
  furniture('bathtub', 'Soaking Bathtub', 'bath', 'tub', 2, 1, 4, 180000, '🛁'),
  furniture('toilet', 'Toilet', 'bath', 'toilet', 1, 1, 1, 5000, '🚽'),
  furniture('wc-suite', 'Soft-close WC Suite', 'bath', 'toilet', 1, 1, 3, 45000, '🚽'),
  furniture('basin', 'Wash Basin', 'bath', 'decor', 1, 1, 0, 400, '🫧'),
  // ---- Comfort (the six without `beta` are fixed) ----
  furniture('plastic-chair', 'Plastic Chair', 'comfort', 'seat', 1, 1, 0, 500, '🪑', 'fixed'),
  furniture('velvet-sofa', 'Velvet Sofa', 'comfort', 'seat', 2, 1, 2, 10200, '🛋️', 'fixed'),
  furniture('family-sofa', '3-Seater Family Sofa', 'comfort', 'seat', 3, 1, 3, 24000, '🛋️', 'fixed'),
  furniture('leather-sofa', 'Leather Sofa', 'comfort', 'seat', 2, 1, 3, 32000, '🛋️', 'fixed'),
  furniture('gold-sofa', 'Royal Gold Sofa', 'comfort', 'seat', 2, 1, 4, 55000, '👑', 'fixed'),
  furniture('lounge-armchair', 'Lounge Armchair', 'comfort', 'seat', 1, 1, 2, 8500, '💺', 'fixed'),
  furniture('bean-bag', 'Ankara Bean Bag', 'comfort', 'seat', 1, 1, 1, 3200, '🫘'),
  furniture('corner-lounge', 'Corner Lounge Set', 'comfort', 'seat', 2, 2, 2, 15000, '🛋️'),
  furniture('wall-fan', 'Wall Fan', 'comfort', 'decor', 1, 1, 1, 6500, '🌀', 'wall'),
  // ---- Fun ----
  furniture('radio-stool', 'Radio on a Stool', 'fun', 'radio', 1, 1, 1, 2500, '📻'),
  furniture('sound-system', 'Party Sound System', 'fun', 'radio', 1, 1, 3, 90000, '🔊'),
  furniture('ludo-board', 'Ludo Board', 'fun', 'game', 1, 1, 1, 1800, '🎲'),
  furniture('small-tv', '21-inch TV', 'fun', 'tv', 1, 1, 2, 45000, '📺'),
  furniture('flat-tv', 'Flat-screen & Console Unit', 'fun', 'tv', 2, 1, 3, 150000, '📺'),
  furniture('game-console', 'Game Console', 'fun', 'console', 1, 1, 3, 120000, '🎮'),
  // ---- Skills ----
  furniture('gym-mat', 'Gym Mat & Dumbbells', 'skills', 'gym', 1, 2, 1, 7500, '🏋️'),
  furniture('weight-bench', 'Weight Bench', 'skills', 'gym', 2, 1, 3, 65000, '🏋️'),
  furniture('laptop-desk', 'Laptop Desk', 'skills', 'desk', 2, 1, 2, 180000, '💻'),
  furniture('bookshelf', 'Bookshelf', 'skills', 'shelf', 1, 1, 2, 22000, '📚'),
  furniture('keyboard', 'Keyboard Piano', 'skills', 'keys', 2, 1, 2, 75000, '🎹'),
  furniture('dance-mirror', 'Dance Mirror', 'skills', 'mirror', 1, 1, 2, 18000, '🪞', 'wall'),
  furniture('camera-tripod', 'Camera & Tripod', 'skills', 'tripod', 1, 1, 2, 110000, '📷'),
  furniture('practice-mic', 'Practice Mic', 'skills', 'mic', 1, 1, 1, 12000, '🎙️'),
  // ---- Light ----
  furniture('wall-lamp', 'Wall Lamp', 'light', 'light', 1, 1, 0, 1200, '💡', 'wall'),
  furniture('lantern', 'Rechargeable Lantern', 'light', 'light', 1, 1, 1, 2000, '🏮'),
  furniture('standing-lamp', 'Standing Lamp', 'light', 'light', 1, 1, 2, 9000, '🛋️'),
  furniture('led-strip', 'LED Strip Light', 'light', 'light', 1, 1, 3, 30000, '✨', 'wall'),
  furniture('generator', 'Small Petrol Generator', 'light', 'power', 1, 1, 2, 150000, '⛽'),
  furniture('inverter', 'Inverter & Batteries', 'light', 'power', 1, 1, 3, 600000, '🔋'),
  // ---- Decor ----
  furniture('wall-calendar', 'Wall Calendar', 'decor', 'decor', 1, 1, 0, 300, '🗓️', 'wall'),
  furniture('jerry-cans', 'Jerry Cans', 'decor', 'decor', 1, 1, 0, 600, '🧴'),
  furniture('potted-plant', 'Potted Plant', 'decor', 'decor', 1, 1, 1, 2500, '🪴'),
  furniture('wall-art', 'Framed Adire Art', 'decor', 'decor', 1, 1, 2, 14000, '🖼️', 'wall'),
  furniture('centre-rug', 'Centre Rug', 'decor', 'decor', 2, 2, 2, 16000, '🧶'),
  furniture('wardrobe', 'Wardrobe', 'decor', 'decor', 2, 1, 2, 30000, '🚪'),
  furniture('aquarium', 'Aquarium', 'decor', 'decor', 1, 1, 3, 95000, '🐠'),
  // ---- Pets ----
  furniture('local-dog', 'Loyal Local Dog', 'pets', 'pet', 1, 1, 2, 35000, '🐕'),
  furniture('house-cat', 'House Cat', 'pets', 'pet', 1, 1, 2, 25000, '🐈'),
  furniture('grey-parrot', 'Talking Parrot', 'pets', 'pet', 1, 1, 3, 60000, '🦜'),
]);

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
