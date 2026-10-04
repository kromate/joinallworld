/**
 * OWNER: growth
 * Everything a share says, as pure functions: the link-preview title and description (used by the
 * server's /s/<code> page), the text that goes to WhatsApp or X, and the data the browser draws
 * the picture card from. No DOM, no I/O.
 *
 * WORDS COME FROM HERE, NEVER FROM A PLAYER. A share carries a small record of facts the server
 * took from the sharer's own life (`ShareFacts`); the only player-chosen text in it is the name,
 * which has already passed the server's text filter. Nothing a visitor types reaches a preview.
 *
 * EMOJI. The game draws no emoji on its own screens. Text that LEAVES the game for a chat app is
 * the one exception (the owner's decision): squares and a few symbols are the native format there.
 *
 * @typedef {'invite'|'house'|'missions'|'week'|'table'|'event'} ShareKind
 * @typedef {object} ShareFacts
 * @property {ShareKind} kind
 * @property {string} name        the sharer's display name
 * @property {string} [district]  home district label, e.g. "Yaba"
 * @property {string} [city]      city name, e.g. "Lagos"
 * @property {number} [done]      missions finished today (missions)
 * @property {number} [total]     missions in the set (missions)
 * @property {number} [days]      days lived actively (missions, week)
 * @property {number} [stamps]    days played this week (week)
 * @property {string} [title]     the sharer's current title (missions, week)
 * @property {string} [game]      table game label, e.g. "Whot" (table)
 * @property {boolean} [won]      (table)
 * @property {string} [event]     event title (event);  @property {string} [venue] venue label (event, table)
 * @property {string} [tableId]   a table to land beside (table): makes the share an invitation to that table
 */
export const SHARE_KINDS = Object.freeze(['invite', 'house', 'missions', 'week', 'table', 'event']);
export const BRAND = 'Allworld';
export const TAGLINE = 'Your city story. Live in Lagos, with real people.';

const clip = (value, max) => { const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const count = (value, max = 100000) => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : 0);
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

/** A facts record reduced to known fields of bounded size. Unknown kinds become 'invite'. */
export function cleanFacts(facts) {
  const kind = SHARE_KINDS.includes(facts?.kind) ? facts.kind : 'invite';
  return { kind, name: clip(facts?.name, 24) || 'A Lagosian', district: clip(facts?.district, 24), city: clip(facts?.city, 24) || 'Lagos',
    done: count(facts?.done, 9), total: count(facts?.total, 9), days: count(facts?.days), stamps: count(facts?.stamps, 7), title: clip(facts?.title, 24),
    game: clip(facts?.game, 24), won: facts?.won === true, event: clip(facts?.event, 48), venue: clip(facts?.venue, 32),
    tableId: typeof facts?.tableId === 'string' && /^[a-z0-9-]{1,40}$/.test(facts.tableId) ? facts.tableId : '' };
}

/**
 * Title and description for the link preview (Open Graph). Plain text; the page escapes it.
 * @param {ShareFacts} facts  @returns {{ title: string, description: string }}
 */
export function sharePreview(facts) {
  const f = cleanFacts(facts), place = f.district ? `${f.district}, ${f.city}` : f.city;
  switch (f.kind) {
    case 'house': return { title: `Come to ${f.name}’s house in ${place}`, description: `Knock at the door in ${BRAND}. No sign-up: pick a name and walk in.` };
    case 'missions': return { title: `${f.name} finished ${f.done} of ${f.total || 3} missions today`, description: `${days(f.days)} in ${f.city}${f.title ? ` · ${f.title}` : ''}. Start your own life in ${BRAND}.` };
    case 'week': return { title: `${f.name}’s week in ${f.city}`, description: `${f.stamps} of 7 days played · ${days(f.days)} in the city${f.title ? ` · ${f.title}` : ''}.` };
    case 'table': return f.tableId ? { title: `Come and play ${f.game || 'a game'} with ${f.name}`, description: `${f.name} is at a table${f.venue ? ` at ${f.venue}` : ''} in ${BRAND}. Sit down or watch. No sign-up.` }
      : { title: f.won ? `${f.name} just won at ${f.game || 'the table'}` : `${f.name} is at the ${f.game || 'games'} table`, description: `Pull up a chair in ${BRAND}. Whot at the buka, with real people.` };
    case 'event': return { title: `${f.event || 'Something is on'} · ${f.venue || f.city}`, description: `${f.name} is going. Meet them there in ${BRAND}.` };
    default: return { title: `Join ${f.name} in ${BRAND}`, description: `${f.name} lives in ${place}. Make your Sim, get a job, and come through. No sign-up.` };
  }
}

const SQUARE = { on: '🟩', off: '⬜' };
/**
 * The text that leaves the game. The link is always the last line on its own, so it can be removed.
 * @param {ShareFacts} facts  @param {string} link  absolute URL of the share page
 */
export function shareText(facts, link = '') {
  const f = cleanFacts(facts), lines = [];
  if (f.kind === 'missions') {
    const total = f.total || 3;
    lines.push(`${BRAND} · day ${f.days} in ${f.city}`, `${SQUARE.on.repeat(Math.min(f.done, total))}${SQUARE.off.repeat(Math.max(0, total - f.done))} ${f.done}/${total} missions`);
    if (f.title) lines.push(`⭐ ${f.title}`);
  } else if (f.kind === 'week') {
    lines.push(`${BRAND} · my week in ${f.city}`, `${SQUARE.on.repeat(f.stamps)}${SQUARE.off.repeat(7 - f.stamps)} ${f.stamps}/7 days`, `${days(f.days)} in the city${f.title ? ` · ⭐ ${f.title}` : ''}`);
  } else if (f.kind === 'table') lines.push(...(f.tableId ? [`Come and play ${f.game} with me${f.venue ? ` at ${f.venue}` : ''} 🃏`, `I am at the table in ${BRAND}. Tap to sit down.`] : [f.won ? `I just won at ${f.game} in ${BRAND} 🏆` : `I am at the ${f.game} table in ${BRAND}`, 'Come and play me.']));
  else if (f.kind === 'house') lines.push(`Come to my house in ${f.district || f.city} 🏠`, `Knock in ${BRAND}. No sign-up.`);
  else if (f.kind === 'event') lines.push(`${f.event} · ${f.venue}`, `I am going. Meet me there in ${BRAND}.`);
  else lines.push(`I live in ${f.district || f.city} now, in ${BRAND}.`, 'Make your Sim and come through. No sign-up.');
  if (link) lines.push(link);
  return lines.join('\n');
}

/**
 * What the picture card shows: plain fields for the canvas painter (src/ui/share.js).
 * @returns {{ kicker: string, headline: string, lines: string[], squares: boolean[], footer: string }}
 */
export function shareCard(facts) {
  const f = cleanFacts(facts), place = f.district ? `${f.district}, ${f.city}` : f.city;
  const base = { kicker: BRAND.toUpperCase(), squares: [], footer: 'Play free in your browser' };
  if (f.kind === 'missions') return { ...base, headline: `${f.done}/${f.total || 3} missions today`, lines: [f.name, `${days(f.days)} in ${f.city}`, ...(f.title ? [f.title] : [])], squares: Array.from({ length: f.total || 3 }, (_, index) => index < f.done) };
  if (f.kind === 'week') return { ...base, headline: `My week in ${f.city}`, lines: [f.name, `${f.stamps} of 7 days played`, `${days(f.days)} in the city`], squares: Array.from({ length: 7 }, (_, index) => index < f.stamps) };
  if (f.kind === 'table') return { ...base, headline: f.tableId ? `Come and play ${f.game}` : f.won ? `Won at ${f.game}` : `At the ${f.game} table`, lines: [f.name, f.venue || place, f.tableId ? 'A seat is open' : 'Come and play me'] };
  if (f.kind === 'house') return { ...base, headline: 'Come to my house', lines: [f.name, place, 'Knock at the door'] };
  if (f.kind === 'event') return { ...base, headline: f.event, lines: [f.venue, `${f.name} is going`] };
  return { ...base, headline: `I live in ${f.district || f.city} now`, lines: [f.name, 'Make your Sim and come through'] };
}

const CODE = /^[a-z0-9]{8,16}$/;
export const isShareCode = (value) => typeof value === 'string' && CODE.test(value);
/** The share code in a link or a bare code (`…/s/<code>`, `?ref=<code>`, `?s=<code>`), or null. */
export function shareCodeFrom(text) {
  const match = /(?:\/s\/|[?&](?:s|ref)=|^)([a-z0-9]{8,16})(?:[/?#&]|$)/.exec(String(text ?? '').trim());
  return match ? match[1] : null;
}
/** Where a button for one channel points. `text` already ends with the link. */
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const xUrl = (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
