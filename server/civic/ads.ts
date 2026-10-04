// OWNER: civic — billboards and sea plots: rent a slot for a fixed period with in-game naira.
// A creative is a short text line, a colour and an icon from fixed sets. There are no uploaded
// images and no links, so a map can draw every ad procedurally from one response.
// Portable and pure: functions take the city's civic data and a time.
import { AD_COLOURS, AD_ICONS, AD_TEXT, BILLBOARDS, SEA_PLOTS } from '../../src/game/content/civic.ts';
import { adSlot } from '../../src/game/systems/civic.ts';
import type { AdKind, AdsView, Ad } from '../../src/types/civic.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { AdRecord, CivicCityRecord } from '../types.ts';
import { field } from './data.ts';
import { cleanLine } from './text.ts';

type Block = { code: string; reason: string };
type Creative = { text: string; colour: string; icon: string };

const DAY_MS = 86400000;
export const AD_KINDS: readonly AdKind[] = ['billboard', 'sea'];
const isKind = (kind: unknown): kind is AdKind => AD_KINDS.some((item) => item === kind);
const LIMITS: Record<AdKind, number> = { billboard: BILLBOARDS.maxPerPlayer, sea: SEA_PLOTS.maxPerPlayer };
const NOUN: Record<AdKind, string> = { billboard: 'billboards', sea: 'sea plots' };

/** Validate the creative. Returns { ok: true, creative: { text, colour, icon } } or { ok: false, code, reason }. */
export function validateCreative(input: unknown): { ok: false; code: string; reason: string } | { ok: true; creative: Creative } {
  const line = cleanLine(field(input, 'text'), { min: AD_TEXT.min, max: AD_TEXT.max, what: 'Ad text' });
  if (!line.ok) return line;
  const colour = field(input, 'colour'), icon = field(input, 'icon');
  if (typeof colour !== 'string' || typeof icon !== 'string') return { ok: false, code: 'invalid_colour', reason: 'Choose one of the listed colours.' };
  if (!AD_COLOURS.some((item) => item.id === colour)) return { ok: false, code: 'invalid_colour', reason: 'Choose one of the listed colours.' };
  if (!AD_ICONS.some((item) => item.id === icon)) return { ok: false, code: 'invalid_icon', reason: 'Choose one of the listed icons.' };
  return { ok: true, creative: { text: line.text, colour, icon } };
}

const live = (ad: AdRecord | null | undefined, now: number): ad is AdRecord => !!ad && Number.isFinite(ad.expiresAt) && ad.expiresAt > now;
const book = (city: CivicCityRecord, kind: AdKind): Record<string, AdRecord> => city.ads[kind];

/** Drop expired ads (call inside a write). */
export function pruneAds(city: CivicCityRecord, now: number): void {
  for (const kind of AD_KINDS) for (const [slot, ad] of Object.entries(book(city, kind))) if (!live(ad, now) || !adSlot(kind, slot)) delete book(city, kind)[slot];
}

/** Why `playerId` cannot rent this slot now, or null. The wallet is checked by the rules engine. */
export function rentBlock(city: CivicCityRecord, now: number, playerId: string, kind: unknown, slot: unknown): Block | null {
  const info = adSlot(kind, slot);
  if (!info) return { code: 'invalid_slot', reason: 'Choose a billboard or sea plot from the list.' };
  const current = book(city, info.kind)[info.slot];
  if (live(current, now)) {
    return current.by.id === playerId ? { code: 'already_yours', reason: `You already rent ${info.label}. It runs for ${Math.ceil((current.expiresAt - now) / DAY_MS)} more day(s).` }
      : { code: 'slot_taken', reason: `${info.label} is rented by ${current.by.name} for ${Math.ceil((current.expiresAt - now) / DAY_MS)} more day(s). Pick a free one.` };
  }
  const mine = Object.values(book(city, info.kind)).filter((ad) => live(ad, now) && ad.by.id === playerId).length;
  if (mine >= LIMITS[info.kind]) return { code: 'ad_limit', reason: `You can rent ${LIMITS[info.kind]} ${NOUN[info.kind]} at a time. Take one down or wait for one to expire.` };
  return null;
}

export function rent(city: CivicCityRecord, now: number, who: PlayerRef, kind: unknown, slot: unknown, creative: Creative): AdRecord {
  const info = adSlot(kind, slot);
  if (!info) throw new Error('invalid_slot');
  pruneAds(city, now);
  return (book(city, info.kind)[info.slot] = { by: { id: who.id, name: who.name }, ...creative, at: now, expiresAt: now + info.days * DAY_MS });
}

/** Take down your own ad. Returns a block reason or null. Rent is not refunded. */
export function removeAd(city: CivicCityRecord, now: number, playerId: string, kind: unknown, slot: unknown): Block | null {
  const current = isKind(kind) && typeof slot === 'string' ? book(city, kind)[slot] : null;
  if (!isKind(kind) || typeof slot !== 'string' || !live(current, now)) return { code: 'no_ad', reason: 'There is no active ad in that slot.' };
  if (current.by.id !== playerId) return { code: 'not_yours', reason: `That ad belongs to ${current.by.name}. You can only take down your own.` };
  delete book(city, kind)[slot];
  return null;
}

/** Operator removal: take down whatever is in the slot. Returns the removed ad, or null. Rent is not refunded. */
export function takeDown(city: CivicCityRecord, now: number, kind: unknown, slot: unknown): AdRecord | null {
  const current = isKind(kind) && typeof slot === 'string' && Object.hasOwn(book(city, kind), slot) ? book(city, kind)[slot] : null;
  if (!isKind(kind) || typeof slot !== 'string' || !live(current, now)) return null;
  delete book(city, kind)[slot];
  return current;
}

/** Every live ad with its slot, for the operator's listing. */
export function liveAds(city: CivicCityRecord, now: number) {
  const list: { kind: AdKind; slot: string; text: string; by: PlayerRef; at: number; expiresAt: number }[] = [];
  for (const kind of AD_KINDS) for (const [slot, ad] of Object.entries(book(city, kind))) if (live(ad, now)) list.push({ kind, slot, text: ad.text, by: { id: ad.by.id, name: ad.by.name }, at: ad.at, expiresAt: ad.expiresAt });
  return list;
}

const shown = (ad: AdRecord, info: { price: number }, viewerId: string | null): Ad => ({ text: ad.text, colour: ad.colour, icon: ad.icon, by: { id: ad.by.id, name: ad.by.name }, at: ad.at, expiresAt: ad.expiresAt, mine: ad.by.id === viewerId, price: info.price });

/**
 * Everything a map needs to draw the ads, in one response (no per-ad requests):
 *   { palette: { colours: [{ id, label, bg, ink }], icons: [{ id, icon }] },
 *     billboards: { price, days, maxPerPlayer, slots: [{ slot, near, road, price, ad: Ad | null }] },
 *     sea:        { rows, cols, price, shoreRows, shorePrice, days, maxPerPlayer, plots: [{ slot, row, col, ...Ad }] } }   rented plots only
 *   Ad = { text, colour, icon, by: { id, name }, at, expiresAt, mine, price }
 * `colour` and `icon` are ids into `palette`; `text` is plain text that the renderer must escape.
 */
export function adsView(city: CivicCityRecord, now: number, viewerId: string | null = null): AdsView {
  const slots = BILLBOARDS.slots.map((entry) => {
    const ad = book(city, 'billboard')[entry.id];
    return { slot: entry.id, near: entry.near, road: entry.road, price: BILLBOARDS.price, ad: live(ad, now) ? shown(ad, BILLBOARDS, viewerId) : null };
  });
  const plots: AdsView['sea']['plots'] = [];
  for (const [slot, ad] of Object.entries(book(city, 'sea'))) {
    const info = adSlot('sea', slot);
    if (info && info.kind === 'sea' && live(ad, now)) plots.push({ slot, row: info.row, col: info.col, ...shown(ad, info, viewerId) });
  }
  plots.sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    palette: { colours: AD_COLOURS, icons: AD_ICONS },
    billboards: { price: BILLBOARDS.price, days: BILLBOARDS.days, maxPerPlayer: BILLBOARDS.maxPerPlayer, slots },
    sea: { rows: SEA_PLOTS.rows, cols: SEA_PLOTS.cols, price: SEA_PLOTS.price, shoreRows: SEA_PLOTS.shoreRows, shorePrice: SEA_PLOTS.shorePrice, days: SEA_PLOTS.days, maxPerPlayer: SEA_PLOTS.maxPerPlayer, plots },
  };
}
