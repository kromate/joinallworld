/**
 * OWNER: scenes
 * Who stands in a venue scene besides the player, from real data only (pure; no THREE, no DOM):
 *   - real players: the server's who-is-here listing for the player's own venue room. The public
 *     id seeds the avatar and `look` (appearance option ids recorded by the server) dresses it.
 *   - NPCs: the venue's regulars from the social system's view (`view.social.here`), each
 *     standing at their own place in the scene (`at`, a landmark key).
 * Real players come first, so a regular never crowds a person out of the capped list.
 *
 * POSITIONS. A player's place in the scene is optional: `positions` is { [publicId]: { x, z } } in
 * scene coordinates — the same numbers the scene host reports for the local avatar ('jaw:avatar-move',
 * options.onMove in src/venue-world.js) and the presence channel's `move` message carries. The
 * entry file (src/life-main.js) does not pass them yet: that needs the host's onMove wired to the
 * community panel's moveTo(x, z), and the panel to expose its members' positions. Until then
 * players stand at the scene's spare places exactly as before.
 * The result is what the scene host's setCrowd() takes; it is compared by value there, so
 * calling this again with unchanged data never causes a frame.
 */
import { isDeparting } from '../game/registry.js';
/** No venue floor reaches farther than this from its centre; a reported position is kept inside it. */
const SCENE_REACH = 14.2;
export const CROWD_LIMIT = 12; // equals MAX_CROWD in venue-scenes.js (asserted in crowd.test.js)

export function crowdList({ players = [], npcs = [], selfId = null, max = CROWD_LIMIT, positions = null } = {}) {
  const seen = new Set(selfId ? [selfId] : []);
  const list = [];
  for (const player of Array.isArray(players) ? players : []) {
    if (!player || typeof player.id !== 'string' || seen.has(player.id) || player.here === false) continue;
    seen.add(player.id);
    // Where the player stands, when presence reports it (see the header): the scene places them there instead of at a spare place.
    const at = positions && typeof positions === 'object' ? positions[player.id] : null;
    const placed = at && Number.isFinite(at.x) && Number.isFinite(at.z) ? { x: Math.max(-SCENE_REACH, Math.min(SCENE_REACH, at.x)), z: Math.max(-SCENE_REACH, Math.min(SCENE_REACH, at.z)) } : null;
    list.push({ id: player.id, name: String(player.name ?? 'Player'), kind: 'player', seed: player.id, look: player.look && typeof player.look === 'object' ? player.look : null, ...placed });
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
