import type { LifeState } from '../types/life.ts';
/**
 * OWNER: scenes
 * Who stands in a venue scene besides the player, from real data only (pure; no THREE, no DOM):
 *   - real players: the server's who-is-here listing for the player's own venue room. The public
 *     id seeds the avatar and `look` (appearance option ids recorded by the server) dresses it.
 *   - NPCs: the venue's regulars from the social system's view (`view.social.here`), each
 *     standing at their own place in the scene (`at`, a landmark key).
 * Real players come first, so a regular never crowds a person out of the capped list.
 *
 * POSITIONS. `positions` is { [publicId]: { x, z } }: where each player stands, as the room's
 * `presence` reports it — the numbers the scene host reports for the local avatar (options.onMove
 * in src/venue-world.ts, sent by the community module's moveTo). The entry file (src/life-main.js)
 * passes what the community module's onMembers gives it. A player in the listing who has not
 * reported a position yet stands at one of the scene's crowd places, as before; a player who is in
 * the positions but NOT in the who-is-here listing is not drawn (the listing is what says someone
 * is here: it leaves out anyone on a trip or still creating their Sim).
 * The result is what the scene host's setCrowd() takes; it is compared by value there, so
 * calling this again with unchanged data never causes a frame.
 */
import { isDeparting } from '../game/registry.ts';
/** The room protocol's bounds (server/protocol.ts POSITION_BOUNDS); the scene keeps a figure on its own floor. */
const SCENE_REACH = 20;
export const CROWD_LIMIT = 12; // equals MAX_CROWD in venue-scenes.js (asserted in crowd.test.js)

/** One person the scene host's setCrowd() takes. Real players carry a `look`, regulars a `spot`; `x`/`z` only when presence reported them. */
export interface CrowdEntry {
  id: string;
  name: string;
  kind: 'player' | 'npc';
  seed: string;
  look?: Record<string, unknown> | null;
  x?: number;
  z?: number;
  spot?: string;
}
/** What crowdList reads (the data is not trusted: anything malformed is skipped). */
export interface CrowdInput {
  players?: unknown;
  npcs?: unknown;
  selfId?: string | null;
  max?: number;
  /** { [publicId]: { x, z } } as the room's presence reports it. */
  positions?: unknown;
}
interface PlayerIn { id?: unknown; name?: unknown; here?: unknown; look?: unknown }
interface NpcIn { id?: unknown; name?: unknown; at?: unknown }
/** The server's who-is-here listing for a venue room. */
export interface PresenceListing { error?: unknown; venue?: unknown; cityId?: unknown; players?: unknown }

export function crowdList({ players = [], npcs = [], selfId = null, max = CROWD_LIMIT, positions = null }: CrowdInput = {}): CrowdEntry[] {
  const seen = new Set<string>(selfId ? [selfId] : []);
  const list: CrowdEntry[] = [];
  for (const player of (Array.isArray(players) ? players : []) as (PlayerIn | null)[]) {
    if (!player || typeof player.id !== 'string' || seen.has(player.id) || player.here === false) continue;
    seen.add(player.id);
    // Where the player stands, when presence reports it (see the header): the scene places them there instead of at a spare place.
    const at = (positions && typeof positions === 'object' ? (positions as Record<string, { x?: unknown; z?: unknown } | null | undefined>)[player.id] : null);
    const placed = at && typeof at.x === 'number' && Number.isFinite(at.x) && typeof at.z === 'number' && Number.isFinite(at.z) ? { x: Math.max(-SCENE_REACH, Math.min(SCENE_REACH, at.x)), z: Math.max(-SCENE_REACH, Math.min(SCENE_REACH, at.z)) } : null;
    list.push({ id: player.id, name: String(player.name ?? 'Player'), kind: 'player', seed: player.id, look: player.look && typeof player.look === 'object' ? player.look as Record<string, unknown> : null, ...placed });
  }
  for (const npc of (Array.isArray(npcs) ? npcs : []) as (NpcIn | null)[]) {
    if (!npc || typeof npc.id !== 'string') continue;
    list.push({ id: `npc:${npc.id}`, name: String(npc.name ?? ''), kind: 'npc', seed: npc.id, ...(typeof npc.at === 'string' ? { spot: npc.at } : {}) });
  }
  return list.slice(0, Math.max(0, max));
}

/** The server's listing, if it is for the venue and city the player is in right now; otherwise nobody. */
export function playersHere(listing: PresenceListing | null | undefined, state: { location?: string; activeAction?: unknown } | null | undefined, cityId: string): unknown[] {
  if (!listing || listing.error || listing.venue !== state?.location || listing.cityId !== cityId) return [];
  if (isDeparting(state as Pick<LifeState, 'activeAction'> | null | undefined)) return []; // in transit (a trip, the commute): the player is in no venue
  return Array.isArray(listing.players) ? listing.players : [];
}
