/**
 * OWNER: scenes
 * Who stands in a venue scene besides the player, from real data only (pure; no THREE, no DOM):
 *   - real players: the server's who-is-here listing for the player's own venue room. The public
 *     id seeds the avatar and `look` (appearance option ids recorded by the server) dresses it.
 *   - NPCs: the venue's regulars from the social system's view (`view.social.here`), each
 *     standing at their own place in the scene (`at`, a landmark key).
 * Real players come first, so a regular never crowds a person out of the capped list.
 * The result is what the scene host's setCrowd() takes; it is compared by value there, so
 * calling this again with unchanged data never causes a frame.
 */
import { isDeparting } from '../game/registry.js';
export const CROWD_LIMIT = 12; // equals MAX_CROWD in venue-scenes.js (asserted in crowd.test.js)

export function crowdList({ players = [], npcs = [], selfId = null, max = CROWD_LIMIT } = {}) {
  const seen = new Set(selfId ? [selfId] : []);
  const list = [];
  for (const player of Array.isArray(players) ? players : []) {
    if (!player || typeof player.id !== 'string' || seen.has(player.id) || player.here === false) continue;
    seen.add(player.id);
    list.push({ id: player.id, name: String(player.name ?? 'Player'), kind: 'player', seed: player.id, look: player.look && typeof player.look === 'object' ? player.look : null });
  }
  for (const npc of Array.isArray(npcs) ? npcs : []) {
    if (!npc || typeof npc.id !== 'string') continue;
    list.push({ id: `npc:${npc.id}`, name: String(npc.name ?? ''), kind: 'npc', seed: npc.id, ...(typeof npc.at === 'string' ? { spot: npc.at } : {}) });
  }
  return list.slice(0, Math.max(0, max));
}

/** The server's listing, if it is for the venue and city the player is in right now; otherwise nobody. */
export function playersHere(listing, state, cityId) {
  if (!listing || listing.error || listing.venue !== state?.location || listing.cityId !== cityId) return [];
  if (isDeparting(state)) return []; // in transit (a trip, the commute): the player is in no venue
  return Array.isArray(listing.players) ? listing.players : [];
}
