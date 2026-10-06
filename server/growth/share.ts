/**
 * OWNER: growth
 * Share links: a short code that maps, on this server, to a few facts taken from the sharer's own
 * life, and the small HTML page a chat app's crawler reads to draw a link preview.
 *
 * THE PAGE (/s/<code>) is static HTML with Open Graph and Twitter tags in <head>: the crawlers of
 * WhatsApp, X, Telegram and Facebook do not run JavaScript, so a page that needs a script shows an
 * empty preview. A person who opens it is sent on to the game (`/?join=<publicId>&ref=<code>`) by a meta refresh and
 * has an ordinary link as well; no script runs on the page at all. Every value written into it is
 * escaped, and the only player-chosen text is the sharer's name, which the text filter has passed.
 * An unknown or expired code gives the game's general preview and leads to the game.
 */
import { UUID_PATTERN } from '../protocol.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { viewLife } from '../../src/life.ts';
import { lgaOf } from '../../src/game/content/world.ts';
import { cityContent, cityRules } from '../../src/game/cities/index.ts';
import { hasPlace } from '../../src/game/systems/estate.ts';
import { isGuestLife } from '../../src/game/systems/onboarding.ts';
import { BRAND, TAGLINE, SHARE_KINDS, cleanFacts, isShareCode, sharePreview } from '../../src/game/share-model.ts';
import type { ShareOffer } from '../../src/game/share-model.ts';
import { eventsBetween } from '../../src/game/calendar.ts';
import { GAME_LABELS } from '../../src/tables/places.ts';
import { withBoardGames } from '../../src/tables/derive.ts';
import { LIMITS, playerOf, sweep } from './data.ts';
import { count } from './metrics.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { ShareFacts, ShareKind } from '../../src/types/growth.ts';
import type { GrowthCollection, GrowthPlayerRecord, RouteContext, SessionRecord, ShareRecord } from '../types.ts';

export const OG_IMAGE = '/og/allworld.png';
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
const no = <Code extends string>(code: Code, reason: string): { ok: false; code: Code; reason: string } => ({ ok: false, code, reason });

/** The facts of a share, read from the sharer's settled life. Nothing comes from the request but the kind (and an event id). */
export function factsFor(kind: ShareKind, session: Pick<SessionRecord, 'name'>, state: LifeState, cityId: CityId, now: number, player: GrowthPlayerRecord, eventId?: unknown, tableId?: unknown): Partial<ShareFacts> | null {
  const actualCity: CityId = typeof state.estate?.city === 'string' && cityRules(state.estate.city) ? state.estate.city : cityId;
  const view = viewLife(state, { now, cityId: actualCity });
  // Where the sharer lives: the local government of their own house, or the district of the home they rent. A guest (no
  // home yet) and a life whose local government is only the game's guess say nothing about where they live.
  const unit = hasPlace(state) && state.estate.living === 'own' ? lgaOf(state.estate.city, state.estate.lga) : null;
  const district = unit ? unit.name : !isGuestLife(state) && state.estate?.living !== 'own' ? cityRules(actualCity)?.districts?.find((item) => item.id === state.property?.house)?.name ?? '' : '';
  const base = { kind, name: session.name, district, city: cityRules(actualCity)?.name ?? actualCity };
  if (kind === 'missions') return { ...base, done: view.missions.dailySet.done, total: view.missions.dailySet.total || 3, days: view.missions.activeDays, title: view.missions.title ?? '' };
  if (kind === 'week') return { ...base, stamps: view.missions.stamps.days, days: view.missions.activeDays, title: view.missions.title ?? '' };
  if (kind === 'table') {
    // With a table id: an invitation to that table. Without: the caller's last result.
    const content = cityContent(actualCity), place = typeof tableId === 'string' ? withBoardGames(content.venues, content.tablePlaces).find((item) => item.id === tableId) ?? null : null;
    if (place) {
      const game = Object.hasOwn(GAME_LABELS, place.game) ? (GAME_LABELS as Readonly<Record<string, string>>)[place.game] : null;
      const venue = content.venues.find((item) => item.id === place.venueId);
      return game && venue ? { ...base, game, tableId: place.id, venue: venue.name } : null;
    }
    if (!player.table) return null;
    const tableCity = player.table.cityId ?? 'lagos';
    return { ...base, city: cityRules(tableCity)?.name ?? tableCity, district: tableCity === actualCity ? base.district : '', game: player.table.label, won: player.table.won };
  }
  if (kind === 'event') {
    const event = eventsBetween(now, now + 8 * 86400000, cityId).find((item) => item.id === eventId);
    return event ? { ...base, event: event.title, venue: event.venueLabel } : null;
  }
  return base;
}

/** Make (or find again) the caller's share link of one kind. Runs inside a store transaction. */
export function createShare(ctx: Pick<RouteContext, 'now' | 'fail' | 'randomId'>, g: GrowthCollection, session: SessionRecord, state: LifeState, cityId: CityId, body: Record<string, unknown>) {
  const now = ctx.now(), kind = SHARE_KINDS.find((item) => item === body.kind);
  if (!kind) throw ctx.fail(400, 'invalid_share_kind');
  if (body.event !== undefined && (typeof body.event !== 'string' || !/^[a-z0-9-]{1,40}$/.test(body.event))) throw ctx.fail(400, 'invalid_event');
  const player = playerOf(g, session.publicId);
  if (!player) return no('server_full', 'Sharing is not available right now. Try again later.');
  if (body.table !== undefined && (typeof body.table !== 'string' || !/^[a-z0-9-]{1,40}$/.test(body.table))) throw ctx.fail(400, 'invalid_table');
  const raw = factsFor(kind, session, state, cityId, now, player, body.event, body.table);
  if (!raw) return no('nothing_to_share', kind === 'table' ? 'Finish a table game first, then share the result.' : 'That event is not on this week.');
  const facts = cleanFacts(raw), text = JSON.stringify(facts);
  sweep(g, now);
  // The same card twice is the same link: a second tap on Share makes nothing new.
  const day = lagosTime(now).day;
  const existing = Object.entries(g.shares).find(([, share]) => share.by === session.publicId && lagosTime(share.at).day === day && JSON.stringify(share.facts) === text);
  if (existing) return { ok: true, code: 'shared', share: { code: existing[0], path: `/s/${existing[0]}`, facts } };
  if (player.shares.day !== day) player.shares = { day, n: 0 };
  if (player.shares.n >= LIMITS.sharesPerDay) return no('share_limit', `You have made ${LIMITS.sharesPerDay} share links today. The ones you made still work.`);
  if (Object.keys(g.shares).length >= LIMITS.shares) return no('server_full', 'Sharing is not available right now. Try again later.');
  let code = '';
  for (let tries = 0; tries < 5 && (!code || Object.hasOwn(g.shares, code)); tries++) code = ctx.randomId().replace(/-/g, '').slice(0, 10);
  if (!isShareCode(code) || Object.hasOwn(g.shares, code)) return no('server_full', 'Sharing is not available right now. Try again later.');
  const actualCity: CityId = typeof state.estate?.city === 'string' && cityRules(state.estate.city) ? state.estate.city : cityId;
  g.shares[code] = { cityId: actualCity, by: session.publicId, kind, at: now, facts, opened: 0, joined: 0 };
  player.shares.n += 1;
  count(g, now, actualCity, `share.made.${kind}`);
  return { ok: true, code: 'shared', share: { code, path: `/s/${code}`, facts } };
}

/** A stored, unexpired share, or null. */
export function findShare(g: GrowthCollection, code: unknown, now: number): ShareRecord | null {
  if (typeof code !== 'string' || !isShareCode(code) || !Object.hasOwn(g.shares, code)) return null;
  const share = g.shares[code];
  if (!share) return null;
  return share.at >= now - LIMITS.shareDays * 86400000 ? share : null;
}

/** Only http(s) origins made of host characters are written into a page; anything else falls back to relative links. */
export const safeOrigin = (origin: unknown): string => (typeof origin === 'string' && /^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(origin) ? origin : '');

/**
 * The preview page. `share` may be null (unknown code): the general preview.
 * `origin` is e.g. "https://play.example" or ''.
 */
export function sharePageHtml(share: Pick<ShareRecord, 'by' | 'facts'> | null, code: unknown, origin: unknown = '', offer: ShareOffer | null = null): string {
  const base = safeOrigin(origin);
  const preview = share ? sharePreview(share.facts, offer) : { title: `${BRAND}: a digital world you can live in`, description: TAGLINE };
  // People are sent on to the game's own landing hook: `join` places a new visitor with the sharer (their venue, their
  // door, or a table), `ref` is this share code, which the game attaches as a referral once the visitor's life exists.
  const table = share?.facts?.tableId && /^[a-z0-9-]{1,40}$/.test(share.facts.tableId) ? `&table=${share.facts.tableId}` : '';
  const target = share && isShareCode(code) && UUID_PATTERN.test(share.by ?? '') ? `/?join=${share.by}&ref=${code}${table}` : '/';
  const url = `${base}${share && isShareCode(code) ? `/s/${code}` : '/'}`, image = `${base}${OG_IMAGE}`;
  const title = esc(preview.title), description = esc(preview.description);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND)}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<link rel="canonical" href="${esc(url)}"><meta property="og:locale" content="en_NG"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:type" content="image/png"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(BRAND)}: a yellow danfo crossing a cable-stayed bridge over the Lagos skyline">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0;url=${esc(target)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#183b2a;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center}main{padding:24px;max-width:420px}a{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#e8a643;color:#20232c;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>${title}</h1><p>${description}</p><a href="${esc(target)}">Open ${esc(BRAND)}</a></main></body></html>`;
}
