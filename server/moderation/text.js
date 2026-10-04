/**
 * OWNER: moderation — the server-side text filter for everything a player writes that another
 * player can read. Portable and pure (the Cloudflare adapter bundles it through protocol.js).
 *
 *   screenText(text, { contact = false, what = 'That text' }) → null | { code, reason, category }
 *     code 'text_blocked'         a term from terms.js
 *     code 'links_not_allowed'    looks like a web address            (only with contact: true)
 *     code 'contact_not_allowed'  a phone number, an e-mail address or a handle on another app
 *
 * WHERE IT IS APPLIED
 *   words only        venue chat (ws/rooms.js), direct, group and house messages (social/service.js)
 *   words + contact   nicknames (protocol.js validateName), group names, slogans, announcements,
 *                     ad text, song titles and artists (civic/text.js cleanLine)
 *   Links and contact details are refused only where they were already not allowed or where the
 *   text is a public label; a private message may still mention a website as plain text (nothing
 *   a player types is ever rendered as a link).
 *
 * REFUSED, NEVER ALTERED. A blocked text is rejected with a reason the sender is shown. Nothing
 * is starred out, shortened or delivered in part, so a message is either exactly what was typed
 * or not sent at all.
 *
 * This is a seatbelt, not a moderator: it is conservative by design and trivially evaded by
 * someone determined. Blocking, reports and operator mutes are the real tools.
 */
import { BLOCKED_WORDS, BLOCKED_PHRASES } from './terms.js';

const FOLD = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
const INVISIBLE = /[\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;
export const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ng|io|co|xyz|app|gg|me|ly|tv|info|biz|link|shop|site|online)\b)/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i;
// Nine or more digits, allowing the separators people put in phone numbers (not commas: ₦1,000,000,000 is money).
const PHONE = /(?:\+?\d[\s().-]{0,2}){9,}/;
// A platform name followed by ':' or '@' and a handle ("WhatsApp: ada", "telegram @ada"). Naming a platform alone is fine.
const HANDLE = /\b(whats\s?app|telegram|insta(gram)?|snap(chat)?|tik\s?tok|discord|facebook|twitter|ig)\b\s*(?::\s*@?|@)[a-z0-9._]{3,}/i;

/** Lower-case, strip accents and invisible characters, fold look-alikes, keep letters and spaces. */
export function normalise(text) {
  const base = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(INVISIBLE, '').toLowerCase();
  let out = '';
  for (const char of base) out += FOLD[char] ?? char;
  return out.replace(/[^a-z\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Collapse a run of three or more of the same letter ("niiiice" → "niice"). */
const squeeze = (word, to) => word.replace(/([a-z])\1{2,}/g, to === 1 ? '$1' : '$1$1');
const words = new Map(BLOCKED_WORDS);
const phrases = BLOCKED_PHRASES.map(([phrase, category]) => [` ${phrase} `, category]);

function wordCategory(word) {
  for (const form of new Set([word, squeeze(word, 2), squeeze(word, 1)])) {
    if (words.has(form)) return words.get(form);
    // Plain plurals only ("…s", "…es"); no other suffixes, so a longer innocent word never matches.
    if (form.endsWith('s') && words.has(form.slice(0, -1))) return words.get(form.slice(0, -1));
    if (form.endsWith('es') && words.has(form.slice(0, -2))) return words.get(form.slice(0, -2));
  }
  return null;
}

/** The category of the first blocked term in `text`, or null. */
export function blockedCategory(text) {
  const tokens = normalise(text).split(' ').filter(Boolean);
  // Letters spelt out one at a time ("k y s", "n.i.g…") are read as the word they spell.
  const joined = [];
  let run = '';
  for (const token of tokens) {
    if (token.length === 1) { run += token; continue; }
    if (run) { joined.push(run); run = ''; }
    joined.push(token);
  }
  if (run) joined.push(run);
  for (const list of [tokens, joined]) {
    for (const token of list) { const category = wordCategory(token); if (category) return category; }
    const line = ` ${list.join(' ')} `;
    for (const [phrase, category] of phrases) if (line.includes(phrase)) return category;
  }
  return null;
}

const REASONS = {
  hate: 'it contains a slur',
  threat: 'it tells someone to harm themselves or threatens them',
  minors: 'it refers to sexual content about children',
};

export function screenText(text, { contact = false, what = 'That text' } = {}) {
  if (typeof text !== 'string') return null;
  const category = blockedCategory(text);
  if (category) return { code: 'text_blocked', category, reason: `${what} was not accepted because ${REASONS[category]}. Nothing was sent or saved; change the wording and try again.` };
  if (!contact) return null;
  const plain = text.replace(INVISIBLE, '');
  if (LINK.test(plain)) return { code: 'links_not_allowed', category: 'link', reason: `${what} cannot contain a link or web address in this beta.` };
  if (EMAIL.test(plain) || PHONE.test(plain) || HANDLE.test(plain)) {
    return { code: 'contact_not_allowed', category: 'contact', reason: `${what} cannot contain a phone number, an e-mail address or a handle on another app. Nothing was saved; remove it and try again.` };
  }
  return null;
}
