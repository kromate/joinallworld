/**
 * ONE SCENE API, TWO HOSTS. Every venue is drawn by the venue host (src/venue-world.js). The UNILAG
 * campus is a venue the size of a district — ten zones, position-driven level of detail, a shuttle on
 * its roads — so it has a host of its own (./host.js), built from the same movement, motion-loop and
 * avatar modules (src/scene/*). This adapter keeps the entry file talking to one object and swaps the
 * host when the player's location crosses the campus gate.
 *
 * The campus host is its own download: it is fetched when the player is at the campus (or a trip to
 * it has set off — prepare()), never with the first scene. Until it has arrived nothing is drawn in
 * its place; if it cannot be fetched the venue host draws its plain plaza for the campus instead, so
 * the game is never left without a scene.
 *
 * What the entry file passes, besides the venue host's own options (onTag, onMove):
 *   commitSpot({ id })  → Promise<{ ok, code?, reason? }>   the campus host calls it when the avatar has
 *                        walked to a landmark; it sends the game's ordinary `spot` action
 *   now()               server time, for the shuttle's place on its route
 *   onHost(kind)        'venue' | 'campus' — a host was built (the entry file re-measures the HUD insets)
 */
import { createVenueWorld } from '../../venue-world.js';

export const CAMPUS_VENUE = 'unilag';
const campus = (id) => id === CAMPUS_VENUE;

export function createWorldAdapter(container, { location = 'park', commitSpot, now, onHost, loadCampus = () => import('./host.js'), ...options } = {}) {
  let currentLocation = location;
  let host = null, kind = null, token = 0, disposed = false;
  let state = null, player = null, crowd = [], insets = null, goal = null;

  function replay() {
    if (!host) return;
    if (state?.location === currentLocation) host.setState(state);
    if (player) host.setPlayer(player);
    if (state?.location === currentLocation && crowd.length) host.setCrowd(crowd);
    if (insets) host.setInsets(insets);
    if (goal !== null) host.setGoal?.(goal);
    host.resize?.();
    onHost?.(kind);
  }
  function useVenueHost(id) { kind = 'venue'; host = createVenueWorld(container, { ...options, location: id }); replay(); }
  function build(id) {
    host?.dispose(); host = null; kind = null;
    const mine = ++token;
    if (!campus(id)) { useVenueHost(id); return; }
    container.classList?.add('campus-loading');
    loadCampus().then(({ createCampusHost }) => {
      if (mine !== token || disposed) return;
      kind = 'campus';
      host = createCampusHost(container, { onTag: options.onTag, onMove: options.onMove, onSpot: commitSpot, now, renderer: options.renderer });
      replay();
    }).catch((error) => {
      if (mine !== token || disposed) return;
      console.error('The campus could not be loaded:', error);
      useVenueHost(id);
    }).finally(() => { if (mine === token) container.classList?.remove('campus-loading'); });
  }
  build(currentLocation);

  return {
    update() { host?.update(); },
    resize() { host?.resize(); },
    get location() { return currentLocation; },
    /** Which host is drawing: 'venue', 'campus', or null while the campus is on its way. */
    get host() { return kind; },
    diagnostics() { return { adapter: kind, ...host?.diagnostics() }; },
    setInsets(next) { insets = { ...next }; return host?.setInsets(next); },
    setLocation(id) {
      if (id === currentLocation) return false;
      const rebuild = campus(id) !== campus(currentLocation) || !host;
      currentLocation = id;
      crowd = [];
      if (rebuild) build(id); else host.setLocation(id);
      return true;
    },
    /** A trip has set off: have the place it goes to ready (the campus: its code; any other venue: its scene). */
    prepare(id) {
      if (campus(id)) { void loadCampus().catch(() => {}); return true; }
      return kind === 'venue' ? host.prepare?.(id) === true : false;
    },
    setState(next) { state = next; host?.setState(next); },
    setPlayer(next) { player = { ...next }; return host?.setPlayer(next); },
    setGoal(next) { goal = next ?? null; return host?.setGoal?.(next) ?? false; },
    setCrowd(next) { crowd = Array.isArray(next) ? next.map((person) => ({ ...person })) : []; return host?.setCrowd(crowd); },
    zoom(direction) { return host?.zoom?.(direction); },
    recentre() { return host?.recentre?.(); },
    /** Walk to a point of the floor (venue host only: the campus is walked with its own controls and by landmark). */
    walkTo(x, z) { return kind === 'venue' ? host.walkTo(x, z) : false; },
    walkBy(dx, dz) { return kind === 'venue' ? host.walkBy(dx, dz) : false; },
    /**
     * Walk to a landmark and then select it. Only the campus walks first: → Promise<{ ok, code?, reason? }>, the
     * result of the `spot` action sent on arrival. Anywhere else it answers { ok: false, code: 'not_walkable' }
     * at once and the caller sends the action itself.
     */
    walkToSpot(id) { return kind === 'campus' ? host.walkTo(id) : Promise.resolve({ ok: false, code: 'not_walkable' }); },
    position() { return host?.position?.() || null; },
    dispose() { disposed = true; token += 1; host?.dispose(); host = null; kind = null; },
  };
}

export default createWorldAdapter;
