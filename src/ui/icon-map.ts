/**
 * WHICH GLYPH A PIECE OF THE GAME GETS — the one place that turns game content into an icon.
 *
 * The content files (src/game/content/*, and a few system views) carry an emoji in their `icon`
 * field. That field stays: it is the plain-text fallback (aria labels, server messages) and the
 * key this module reads. Nothing on screen draws it. Every icon in the product UI is a glyph of
 * our own set (./phone/icons.js), chosen here:
 *
 *   iconFor(kind, id, icon?)        → the glyph as SVG html (class "ui-glyph": sized 1.2em by tokens.css)
 *   glyphNameFor(kind, id, icon?)   → the glyph's name
 *       1. BY_ID[kind][id]   an explicit choice for that id (travel modes, job tracks, notices, moods …)
 *       2. `icon` is already a glyph name → that glyph
 *       3. the emoji in `icon` → EMOJI (many emoji share one glyph: every plate of food is the bowl)
 *       4. the kind's own default (a spot is a pin, a person is a person)  5. 'info'
 *     Never an emoji, never nothing.
 *   withGlyphs(text)                → escaped html of a plain text, each emoji in it drawn as a glyph
 *                                     ("+₦500 +1✨" → the star glyph). For text that came with one.
 *   stripLeadEmoji(text)            → the text without a leading emoji (shown next to a glyph instead)
 *
 * `kind` is one of: venue, spot, activity, mode, weather, mood, health, need, track, furniture,
 * category, food, car, house, event, npc, npc-action, ad, trait, dream, home, lottery, goal, wish,
 * perk, notice, update, panel, empty.
 * Pure strings: no DOM, no CSS — src/ui/icon-map.test.js checks that every content id maps to a glyph.
 */
import { glyph, glyphFor, hasGlyph } from './phone/icons.ts';

/** glyph name → the emoji that mean it. Looked up by an emoji's first code point (skin tones, ZWJ tails and variation selectors do not matter). */
const GROUPS = {
  person: '👤🧑👩👨👴👵🧒🧔👮🕴🧍🧢', people: '👥👪', hand: '👋🙌🤜', handshake: '🤝', social: '💬🗣🗯', heart: '❤💞💔',
  fun: '😂😆😁😄🎉🎊', meh: '🙂😏', sad: '😟😣', sick: '🤒', pray: '🙏🤲📿🕊', crown: '👑',
  hunger: '🥣🍲🍛🥘🍜🍚', drink: '🍹🥤🍸☕🥥🥛🧃🥂🫗', bottle: '🍾🛢🧴🥫', grill: '🍢🍖🍗', snack: '🍩🧆🌯🍨🍿🍞🥚🍯🧈',
  leaf: '🥬🌶🍠🍌🌰🌾🌿🌺🪴', fish: '🐟🐠', pan: '🍳', fire: '🔥', box: '📦🧊🧂', groceries: '🧺🛒',
  bed: '🛏🛌😴', sofa: '🛋🫘', chair: '🪑💺', bath: '🛁🪣', shower: '🚿', hygiene: '💧🫧💦🩸🧼🧽', bladder: '🚻🚽',
  light: '💡🕯🏮🔦', screen: '📺🖥💻⌨🕹🎮', radio: '📻🔊', frame: '🖼🪞🎨', book: '📚📖📒🎓', paw: '🐕🐈🦜🐾🐒🐎', fan: '🌀',
  energy: '⚡⛽🔋', dumbbell: '🏋💪', note: '🎶🎵🎼🎹🎷🎸🥁', mic: '🎤🎙', camera: '📷📸🤳🎥📽', game: '🎲', dance: '💃🕺🤸🧘🪩',
  headphones: '🎧🎚', ball: '⚽🥅', mask: '🎭🎪', film: '🎬', star: '🌟⭐✨🦄', richlist: '🏆🏁',
  jobs: '💼👔', invest: '📈📊💹', statement: '📋🗂📄🧾📰🗞🖨🪪📇', pen: '✍🖋', megaphone: '📣📢', phone: '📱📞', wifi: '📶📡',
  bank: '🏦🏧', coin: '🪙💸💰👛🏷', gift: '🎁', ship: '🚢⛵', scissors: '💇✂💅', broom: '🧹', health: '🩺🏥', pill: '💊',
  clock: '⏳⏰🕘', calendar: '🗓', search: '🔎🔍👀', ballot: '🗳', governor: '🏛', scales: '⚖', shield: '🚓🛡🥋', boot: '🥾',
  building: '🏢🛗🏭', home: '🏠🏡', houses: '🏘🏚', church: '⛪', mosque: '🕌', barrier: '🚧🚦🛣', boutique: '🧵🧶👗👕', buy: '🛍',
  tree: '🌳🌴', umbrella: '⛱🏖', wave: '🌊🏊', sunset: '🌇🌅', bridge: '🌉', compass: '🧭', walk: '🚶🏃',
  keke: '🛺', bus: '🚌🚐', bike: '🏍', ride: '🚕', cars: '🚗🚙🏎🛞', plane: '✈', globe: '🌍🌎🌐', pin: '📍', map: '🗺',
  sun: '🌤☀', rain: '🌧', moon: '🌙', lock: '🔒', key: '🔑', link: '🔗', bell: '🔔🛎', hunt: '💎', good: '✅✔', error: '⚠',
  invite: '🚪', messages: '✉', goals: '🎯', support: '🛟', settings: '⚙',
};
const EMOJI = new Map();
for (const [name, list] of Object.entries(GROUPS)) for (const char of list) EMOJI.set(char, name);

/** Explicit choices by content id, per kind. */
const BY_ID = {
  // Where the content's emoji would mislead (a chef's face for a cooker, a basket for a sleeping mat), the id decides.
  spot: { kitchen: 'pan', queue: 'people' },
  activity: { 'hub-freelance': 'screen', 'mosque-teach': 'book', 'polling-educate': 'book', 'park-sell-prints': 'frame' },
  furniture: { 'sleeping-mat': 'bed', 'chef-range': 'pan', 'standing-lamp': 'light', wardrobe: 'boutique', 'centre-rug': 'frame' },
  mode: { trek: 'walk', keke: 'keke', danfo: 'bus', okada: 'bike', cab: 'ride', car: 'cars', commute: 'jobs' },
  weather: { clear: 'sun', rain: 'rain' },
  mood: { good: 'fun', neutral: 'meh', warn: 'meh', bad: 'sad' },
  health: { sick: 'sick', rundown: 'hygiene', rain: 'rain', well: 'health' },
  need: { hunger: 'hunger', energy: 'energy', fun: 'fun', social: 'social', hygiene: 'hygiene', bladder: 'bladder' },
  track: { helper: 'jobs', tech: 'screen', banking: 'bank', music: 'mic', trading: 'groceries', nursing: 'health', hair: 'scissors', chef: 'pan', dj: 'headphones',
    fitness: 'dumbbell', creator: 'camera', teaching: 'book', event: 'mask', football: 'ball', retail: 'buy' },
  category: { sleep: 'bed', kitchen: 'pan', bath: 'bath', comfort: 'sofa', fun: 'radio', skills: 'book', light: 'light', decor: 'leaf', pets: 'paw', storage: 'box' },
  ad: { star: 'star', shop: 'buy', food: 'hunger', music: 'note', phone: 'phone', car: 'cars', house: 'home', heart: 'heart', crown: 'crown', fire: 'fire', ball: 'ball',
    book: 'book', scissors: 'scissors', camera: 'camera', palm: 'tree', megaphone: 'megaphone' },
  trait: { hustler: 'coin', foodie: 'hunger', 'owambe-spirit': 'fun', 'gym-rat': 'dumbbell', 'smooth-talker': 'social', 'lazy-bone': 'sofa', 'clean-pikin': 'hygiene',
    'night-crawler': 'moon', 'tech-bro-or-sis': 'screen', musical: 'note' },
  dream: { 'oga-at-the-top': 'career', 'lekki-landlord': 'houses', 'afrobeats-star': 'mic', 'everybodys-padi': 'handshake', 'yaba-unicorn': 'star' },
  home: { mushin: 'houses', yaba: 'home', lekki: 'building' },
  lottery: { 'lapo-baby': 'statement', 'civil-servant': 'jobs', 'street-smart': 'cars', ajebutter: 'crown' },
  notice: { 'rent-due': 'calendar', rent: 'home', 'rent-missed': 'error', loan: 'bank', 'loan-missed': 'error', promotion: 'career', illness: 'sick', recovered: 'health',
    gov: 'governor', transfer: 'coin', bae: 'heart' },
  update: { transfer: 'coin', report: 'shield', 'friend-request': 'handshake', 'friend-accepted': 'handshake', 'invite-knock': 'invite', 'invite-answer': 'invite',
    'group-added': 'people', 'bae-request': 'heart', 'bae-answer': 'heart' },
};
/** What a kind is drawn as when neither its id nor its emoji is known. */
const DEFAULTS = { venue: 'pin', spot: 'pin', activity: 'star', mode: 'compass', weather: 'cloud', mood: 'fun', health: 'health', need: 'health', track: 'jobs', furniture: 'box',
  category: 'box', food: 'hunger', car: 'cars', house: 'home', home: 'home', event: 'barrier', npc: 'person', 'npc-action': 'social', ad: 'star', trait: 'star', dream: 'goals',
  lottery: 'game', goal: 'goals', wish: 'star', perk: 'star', notice: 'megaphone', update: 'bell', empty: 'info' };

const SKIP = /[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;
/** One emoji (with its skin tone, variation selector and ZWJ tail), or a flag. */
const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)/gu;
const LEAD_RE = new RegExp(`^(?:${EMOJI_RE.source}\\s*)+`, 'u');

/** The glyph an emoji stands for, or undefined. Flags are the globe. */
export function glyphOfEmoji(emoji) {
  if (typeof emoji !== 'string' || !emoji) return undefined;
  const first = [...emoji.replace(SKIP, '')][0];
  if (!first) return undefined;
  return EMOJI.get(first) || (/\p{Regional_Indicator}/u.test(first) ? 'globe' : undefined);
}

export function glyphNameFor(kind, id, icon) {
  if (kind === 'npc') return 'person'; // a person is never an emoji face: the lettered avatar, or the person glyph
  const byId = kind === 'panel' ? glyphFor(id) : BY_ID[kind]?.[id];
  if (byId && byId !== 'info') return byId;
  if (hasGlyph(icon)) return icon;
  return glyphOfEmoji(icon) || DEFAULTS[kind] || 'info';
}

/** The icon of a piece of content as SVG html. `icon` is the content's emoji field (or a glyph name). */
export const iconFor = (kind, id, icon) => glyph(glyphNameFor(kind, id, icon), 'ui-glyph');

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Plain text → escaped html in which every emoji is drawn as its glyph. Text marks (→ · − ₦) are left alone. */
export function withGlyphs(text) {
  const source = String(text ?? '');
  let out = '', last = 0;
  for (const match of source.matchAll(EMOJI_RE)) {
    const name = glyphOfEmoji(match[0]);
    if (!name) continue;
    out += escape(source.slice(last, match.index)) + glyph(name, 'ui-glyph');
    last = match.index + match[0].length;
  }
  return out + escape(source.slice(last));
}
/** A text without the emoji it starts with — for a line that is shown next to a glyph of its own. */
export const stripLeadEmoji = (text) => String(text ?? '').replace(LEAD_RE, '');
