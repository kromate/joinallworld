/**
 * OWNER: companion
 * WHAT IS CHECKED BEFORE A MODEL'S WORDS ARE SHOWN, and how its JSON is read. Pure and portable.
 *
 * parseModelReply  tolerates code fences and text around the JSON; when there is no JSON the whole answer is the text (and goes
 *                  through the same checks), and no button is offered.
 * checkReply       the text: markdown removed; a sentence with a link, an e-mail, a phone number or a handle, a naira amount that
 *                  was not in what the model was told, or real-money talk is DROPPED; the whole reply is refused when it claims to be
 *                  human, a named person or the game's owner, makes a promise, or the text filter blocks it; at most MAX_REPLY
 *                  characters. null means: use the deterministic reply.
 */
import { screenText } from '../moderation/text.ts';
import { COMPANION_NAME } from '../../src/app/features/companion/identity.ts';

export const MAX_REPLY = 320;
export const MAX_INPUT = 400;

export interface ModelReply { text: string; suggest: unknown[]; structured: boolean }

export function parseModelReply(raw: string): ModelReply | null {
  const body = raw.trim();
  const candidates = [body, body.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim()];
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(body.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const text = Reflect.get(value, 'text'), suggest = Reflect.get(value, 'suggest');
        if (typeof text === 'string') return { text, suggest: Array.isArray(suggest) ? suggest.slice(0, 12) : [], structured: true };
      }
    } catch { /* the next form */ }
  }
  // No JSON at all: plain text may still be a fine answer, but half a JSON object is not.
  if (/[{}]|"text"|"suggest"/.test(body)) return null;
  return body ? { text: body, suggest: [], structured: false } : null;
}

const URL_LIKE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ng|io|co|xyz|app|gg|me|ly|tv|info|biz|link|shop|site|online|dev|ai)\b)/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\s().-]{0,2}){9,}/;
const HANDLE = /(^|\s)@[a-z0-9._]{3,}|\b(whats\s?app|telegram|insta(gram)?|snap(chat)?|tik\s?tok|discord|facebook|twitter)\b\s*(?::|@)\s*[a-z0-9._]{3,}/i;
const REAL_MONEY = /\$|£|€|\busd\b|\bdollars?\b|\bpounds?\b|\breal[- ]money\b|\breal[- ]life money\b|\bwithdraw|\bcrypto|\bbitcoin\b|\bcash ?out\b/i;
const HUMAN = /\b(i['’]?m|i am|as)\s+(a\s+)?(real\s+)?(human|person|man|woman|boy|girl|guy|lady|student|developer|engineer)\b|\bnot an? (ai|bot|robot)\b|\bi['’]?m\s+(real|alive)\b|\bmy (mum|mom|mother|father|dad|wife|husband|girlfriend|boyfriend)\b/i;
const OWNER = /\b(i|we)\b[^.!?]{0,40}\b(founder|owner|creator|developer|admin|moderator|staff|ceo)\b|\b(founder|owner|creator|ceo) of (allworld|the game)\b/i;
const NAMED = /\b(?:[Ii]['’]m|[Ii] am|[Mm]y name is|[Cc]all me)\s+([A-Z][a-z]{2,})\b/g;
const NOT_NAMES = new Set(['Allworld', 'Not', 'Sorry', 'Happy', 'Glad', 'Here', 'Ready', 'Just', 'Still', 'Always', 'Sure', 'Afraid', 'Excited', 'Good', 'Fine', 'Well']);
const LEAK = /\b(ignore|disregard|forget) (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules)|\bsystem prompt\b|\bmy (instructions|rules) (say|are|tell)\b|\bdeveloper mode\b|\bjailbreak/i;
const PROMISE = /\b(i|we)\s+(promise|guarantee|swear|assure)\b|\bwill (soon )?be added\b|\bcoming soon\b|\bwe(['’]ll| will) (add|release|launch|give)\b/i;
const MONEY = /(?:₦|\bNGN\b|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?|\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?\s?(naira|ngn)\b/gi;

/** The whole naira amounts a sentence names ("₦5,000", "5k naira", "N2m"), as digit strings. */
export function amountsIn(sentence: string): string[] {
  const found: string[] = [];
  for (const m of sentence.matchAll(MONEY)) {
    const digits = (m[1] ?? m[3] ?? '').replace(/,/g, ''), unit = (m[2] ?? m[4] ?? '').toLowerCase();
    const factor = unit === 'k' || unit === 'thousand' ? 1000 : unit === 'm' || unit === 'million' ? 1000000 : 1;
    const value = Number(digits) * factor;
    if (Number.isFinite(value)) found.push(String(Math.round(value)), digits);
  }
  return found;
}

const plain = (text: string): string => text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>~|]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** A sentence is fit unless it carries a link, contact, handle, real-money talk or a naira amount nobody told the model about. */
function badSentence(sentence: string, numbers: ReadonlySet<string>): boolean {
  if (URL_LIKE.test(sentence) || EMAIL.test(sentence) || PHONE.test(sentence) || HANDLE.test(sentence) || REAL_MONEY.test(sentence)) return true;
  const verdict = screenText(sentence, { contact: true });
  if (verdict && verdict.code !== 'text_blocked') return true;
  return amountsIn(sentence).length > 0 && amountsIn(sentence).some((amount) => !numbers.has(amount));
}

/** The text to show, or null (use the deterministic reply). `numbers`: the numbers the model was told (context.ts). */
export function checkReply(raw: string, numbers: ReadonlySet<string>, extra: { name?: string } = {}): string | null {
  const text = plain(raw);
  if (!text) return null;
  const name = extra.name ?? COMPANION_NAME;
  if (LEAK.test(text) || HUMAN.test(text) || OWNER.test(text) || PROMISE.test(text) || screenText(text)?.code === 'text_blocked') return null;
  for (const m of text.matchAll(NAMED)) if (m[1] !== name && !NOT_NAMES.has(m[1] ?? '')) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !badSentence(sentence, numbers));
  if (!kept.length) return null;
  let out = '';
  for (const sentence of kept) { if (out.length + sentence.length + 1 > MAX_REPLY) break; out = out ? `${out} ${sentence}` : sentence; }
  if (!out) { const cut = kept[0]?.slice(0, MAX_REPLY - 1) ?? ''; out = `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length)}…`; }
  return out;
}

/** An input line: trimmed, control characters removed, at most MAX_INPUT characters. Returns '' for anything that is not text. */
export const cleanInput = (value: unknown, max = MAX_INPUT): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
