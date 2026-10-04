// OWNER: civic — validation of every line of player text the civic features store.
// Portable: no Node-only imports. Rendering code must still escape these values.
import { cleanText } from '../../src/game/util.js';

// Zero-width and bidirectional-override characters can hide or reorder what a reader sees.
const INVISIBLE = /[\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;
// No links in this wave: nothing a player types is ever rendered as clickable, and anything
// that reads like an address is refused so the text cannot be used to advertise one either.
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ng|io|co|xyz|app|gg|me|ly|tv|info|biz|link|shop|site|online)\b)/i;

/**
 * One short line of player text. Returns { ok: true, text } or { ok: false, code, reason }.
 * Control characters and invisible characters are removed, runs of whitespace collapse to one
 * space, and the result must be between `min` and `max` characters and contain no link.
 */
export function cleanLine(value, { min = 1, max = 80, what = 'Text' } = {}) {
  if (typeof value !== 'string') return { ok: false, code: 'text_required', reason: `${what} is required.` };
  if (value.length > max * 4 + 64) return { ok: false, code: 'text_too_long', reason: `${what} must be at most ${max} characters.` };
  const text = cleanText(value.replace(INVISIBLE, '').replace(/\s+/g, ' '), max * 4 + 64);
  const length = [...text].length;
  if (length < min) return { ok: false, code: 'text_too_short', reason: `${what} must be at least ${min} character${min === 1 ? '' : 's'}.` };
  if (length > max) return { ok: false, code: 'text_too_long', reason: `${what} must be at most ${max} characters (yours is ${length}).` };
  if (LINK.test(text)) return { ok: false, code: 'links_not_allowed', reason: `${what} cannot contain a link or web address in this beta.` };
  return { ok: true, text };
}
