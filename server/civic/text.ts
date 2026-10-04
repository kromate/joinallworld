// OWNER: civic — validation of every line of player text the civic features store.
// Portable: no Node-only imports. Rendering code must still escape these values.
import { cleanText } from '../../src/game/util.ts';
import { screenText } from '../moderation/text.ts';

// Zero-width and bidirectional-override characters can hide or reorder what a reader sees.
const INVISIBLE = /[\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;
// No links in this wave: nothing a player types is ever rendered as clickable, and anything
// that reads like an address, a phone number or a handle on another app is refused so the text
// cannot be used to advertise one either. Slurs and threats are refused by the same filter.

/**
 * One short line of player text. Returns { ok: true, text } or { ok: false, code, reason }.
 * Control characters and invisible characters are removed, runs of whitespace collapse to one
 * space, and the result must be between `min` and `max` characters and pass the text filter
 * (server/moderation/text.ts: no blocked term, no link, no contact detail). Refused, never altered.
 */
export function cleanLine(value, { min = 1, max = 80, what = 'Text' } = {}) {
  if (typeof value !== 'string') return { ok: false, code: 'text_required', reason: `${what} is required.` };
  if (value.length > max * 4 + 64) return { ok: false, code: 'text_too_long', reason: `${what} must be at most ${max} characters.` };
  const text = cleanText(value.replace(INVISIBLE, '').replace(/\s+/g, ' '), max * 4 + 64);
  const length = [...text].length;
  if (length < min) return { ok: false, code: 'text_too_short', reason: `${what} must be at least ${min} character${min === 1 ? '' : 's'}.` };
  if (length > max) return { ok: false, code: 'text_too_long', reason: `${what} must be at most ${max} characters (yours is ${length}).` };
  const verdict = screenText(text, { contact: true, what });
  if (verdict) return { ok: false, code: verdict.code, reason: verdict.reason };
  return { ok: true, text };
}
