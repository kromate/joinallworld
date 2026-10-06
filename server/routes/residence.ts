/**
 * OWNER: world
 * The location-confirmed badge (docs/LOCATION.md). The check happens on the player's device; the server is told only the id of the
 * main-home local government and that it matched (action 'estate.confirm-residence'), and here it tells other players whether a
 * confirmation stands.
 *
 *   POST /api/world/badges   { ids: [publicId, ...] }   at most BADGE_IDS ids
 *        { badges: { [id]: { lga: string | null, name: string | null } } }   only players with a standing confirmation appear
 *
 * WHO SEES WHAT. Everyone who can see a player's card or list entry sees the badge with the name of the local government: the player
 * chose to turn it on, and a confirmation is only ever for the local government they live in. Nothing here depends on where the player is now, on time of day or on movement: a confirmation is a fact about a past
 * moment, not a position. There is no distance, direction or "nearby" anywhere.
 */
import { lgaOf } from '../../src/game/content/world.ts';
import { standingConfirmation, mainHomeUnit } from '../../src/game/residence.ts';
import { characterCity } from '../character.ts';
import type { ActionRequest } from '../../src/types/protocol.ts';
import type { Db, RouteContext, RouteHandler, RouteKey, SessionRecord } from '../types.ts';

/** Most ids one request may ask about. */
export const BADGE_IDS = 40;
/** Confirmations one player may send in a day: the device only sends when it matched, so this bounds a script, not a person. */
export const CONFIRMS_PER_DAY = 5;
const DAY = 86400000;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Badge { lga: string; name: string }

/** The badge of one player, or null when none stands. Pure over the stored session. */
export function badgeOf(session: SessionRecord | undefined, now: number): Badge | null {
  const city = session ? characterCity(session) : null;
  const life = city ? session?.cities?.[city]?.state : undefined;
  if (!life?.estate) return null;
  const standing = standingConfirmation(life.estate, now), home = mainHomeUnit(life.estate);
  if (!standing || !home) return null;
  const unit = lgaOf(home.city, standing.lga);
  return unit ? { lga: unit.id, name: unit.name } : null;
}

/** Called by POST /api/action before a confirmation is applied: a long-window key, so it holds across restarts on both hosts. Throws 429. */
export function residenceGate(ctx: RouteContext, session: SessionRecord, body: ActionRequest): void {
  if (body.type !== 'estate.confirm-residence') return;
  if (!ctx.allow(`residence:day:${session.publicId}`, CONFIRMS_PER_DAY, DAY)) {
    throw Object.assign(ctx.fail(429, 'residence_rate_limited'), { reason: 'You have confirmed a few times today already. Try again tomorrow.' });
  }
}

export default function residenceRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const read = (db: Db, publicId: string): SessionRecord | undefined => ctx.core.sessionByPublicId(db, publicId);
  return {
    'POST /api/world/badges': async (request) => {
      const body = await request.json();
      const asked: unknown = body.ids;
      if (!Array.isArray(asked) || asked.length > BADGE_IDS || !asked.every((id): id is string => typeof id === 'string' && ID.test(id))) throw ctx.fail(400, 'invalid_ids');
      const ids = [...new Set(asked)];
      const badges = await ctx.store.read((db) => {
        const viewer = request.requireSession(db);
        if (!ctx.allow(`residence:badges:${viewer.publicId}`, 120)) throw Object.assign(ctx.fail(429, 'rate_limited'), { reason: 'You are doing that too quickly. Wait a minute and try again.' });
        const badges: Record<string, Badge> = {};
        for (const id of ids) {
          const found = badgeOf(read(db, id), ctx.now());
          if (found) badges[id] = found;
        }
        return badges;
      });
      return { body: { badges }, headers: { 'Cache-Control': 'no-store' } };
    },
  };
}
