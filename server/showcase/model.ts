/** OWNER: showcase. What a seller may write: every field is checked and cleaned here, then screened in the service. */
import { SHOWCASE, SHOWCASE_CATEGORIES, SHOWCASE_CHAT_KINDS, SHOWCASE_ICONS, SHOWCASE_PAY_KINDS, SHOWCASE_TEMPLATES } from '../../src/types/showcase.ts';
import type { ShowcaseChatKind, ShowcaseHours, ShowcaseInput, ShowcasePayKind, ShowcaseService } from '../../src/types/showcase.ts';
import { record } from './data.ts';

/** The only keys a body may carry. Anything else (a fee, a phone, an address, a wallet) is refused, not ignored. */
const KEYS = new Set(['clientId', 'expectedRevision', 'city', 'venue', 'slot', 'name', 'category', 'template', 'colours', 'sign', 'logo', 'about', 'services', 'hours', 'chat', 'pay']);
const COLOUR = /^#[0-9a-f]{6}$/i;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// Control characters and angle brackets never belong in what a seller shows.
const BAD = /[\u0000-\u001f\u007f<>]/;
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null => (typeof value === 'string' ? list.find((item) => item === value) ?? null : null);

export function line(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string' || BAD.test(value)) return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length >= min && clean.length <= max ? clean : null;
}
const whole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export type Parsed = { ok: true; input: ShowcaseInput } | { ok: false; code: string };
const bad = (code = 'invalid_shop'): Parsed => ({ ok: false, code });

export function parseInput(body: Record<string, unknown>): Parsed {
  if (Object.keys(body).some((key) => !KEYS.has(key))) return bad('unsupported_shop_field');
  const city = line(body.city, 1, 60), venue = line(body.venue, 1, 80), name = line(body.name, SHOWCASE.name.min, SHOWCASE.name.max), sign = line(body.sign, 1, SHOWCASE.sign);
  const category = oneOf(SHOWCASE_CATEGORIES, body.category), template = oneOf(SHOWCASE_TEMPLATES, body.template), logo = oneOf(SHOWCASE_ICONS, body.logo);
  if (!city || !venue || !name || !sign || !category || !template || !logo) return bad();
  if (typeof body.about !== 'string' || BAD.test(body.about.replace(/\n/g, ' ')) ) return bad();
  const about = body.about.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (about.length < 1 || about.length > SHOWCASE.about) return bad();
  if (!Array.isArray(body.colours) || body.colours.length !== 2 || !body.colours.every((item) => typeof item === 'string' && COLOUR.test(item))) return bad();
  const colours: [string, string] = [String(body.colours[0]).toLowerCase(), String(body.colours[1]).toLowerCase()];
  if (!Array.isArray(body.services) || body.services.length < 1 || body.services.length > SHOWCASE.services) return bad();
  const services: ShowcaseService[] = [];
  for (const item of body.services) {
    if (!record(item) || Object.keys(item).some((key) => key !== 'label' && key !== 'priceNaira' && key !== 'note')) return bad();
    const label = line(item.label, 1, SHOWCASE.label), note = line(item.note ?? '', 0, SHOWCASE.note);
    if (!label || note === null || !whole(item.priceNaira, 0, SHOWCASE.priceMax)) return bad();
    services.push({ label, priceNaira: item.priceNaira, note });
  }
  if (!Array.isArray(body.hours) || body.hours.length !== 7) return bad();
  const hours: (ShowcaseHours | null)[] = [];
  for (const day of body.hours) {
    if (day === null) { hours.push(null); continue; }
    if (!record(day) || typeof day.open !== 'string' || typeof day.close !== 'string' || !CLOCK.test(day.open) || !CLOCK.test(day.close) || day.close <= day.open) return bad();
    hours.push({ open: day.open, close: day.close });
  }
  if (!record(body.chat) || typeof body.chat.url !== 'string') return bad();
  const chatKind = body.chat.kind === undefined ? undefined : oneOf<ShowcaseChatKind>(SHOWCASE_CHAT_KINDS, body.chat.kind);
  if (chatKind === null) return bad('chat_link_not_allowed');
  let pay: ShowcaseInput['pay'] = null;
  if (body.pay !== undefined && body.pay !== null) {
    if (!record(body.pay) || typeof body.pay.url !== 'string') return bad();
    const payKind = body.pay.kind === undefined ? undefined : oneOf<ShowcasePayKind>(SHOWCASE_PAY_KINDS, body.pay.kind);
    if (payKind === null) return bad('pay_link_not_allowed');
    pay = { url: body.pay.url, ...(payKind ? { kind: payKind } : {}) };
  }
  const slot = body.slot === undefined ? undefined : body.slot;
  if (slot !== undefined && !whole(slot, 1, SHOWCASE.slotsPerVenue)) return bad();
  return { ok: true, input: { city, venue, ...(slot === undefined ? {} : { slot }), name, category, template, colours, sign, logo, about, services, hours, chat: { url: body.chat.url, ...(chatKind ? { kind: chatKind } : {}) }, pay } };
}

/** Every text a seller wrote that strangers read. */
export const prose = (input: ShowcaseInput): string[] => [input.name, input.sign, input.about, ...input.services.flatMap((item) => [item.label, item.note])];
/** Text for the directory search: lower case, accents and punctuation out. */
export const searchable = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
