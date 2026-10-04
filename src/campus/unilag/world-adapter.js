import { createVenueWorld } from '../../venue-world.js';
import { createCampusHost } from './host.js';

/** Switches between the static venue host and the walkable UNILAG host behind one stable API. */
export function createWorldAdapter(container, { location = 'park', ...options } = {}) {
  let currentLocation = location;
  let host = null;
  let state = null;
  let player = null;
  let crowd = [];
  let insets = null;

  const campus = (id) => id === 'unilag';
  function build(id) {
    host?.dispose();
    host = campus(id) ? createCampusHost(container, options) : createVenueWorld(container, { ...options, location: id });
    if (state?.location === id) host.setState(state);
    if (player) host.setPlayer(player);
    if (state?.location === id && crowd.length) host.setCrowd(crowd);
    if (insets) host.setInsets(insets);
  }
  build(currentLocation);

  return {
    update() { host?.update(); },
    resize() { host?.resize(); },
    diagnostics() { return { adapter: campus(currentLocation) ? 'campus' : 'venue', ...host?.diagnostics() }; },
    setInsets(next) { insets = { ...next }; return host?.setInsets(next); },
    setLocation(id) {
      if (id === currentLocation) return false;
      const rebuild = campus(id) !== campus(currentLocation);
      currentLocation = id;
      crowd = [];
      if (rebuild) build(id); else host?.setLocation(id);
      return true;
    },
    setState(next) { state = next; host?.setState(next); },
    setPlayer(next) { player = { ...next }; return host?.setPlayer(next); },
    setCrowd(next) { crowd = Array.isArray(next) ? next.map((person) => ({ ...person })) : []; return host?.setCrowd(crowd); },
    walkTo(id) { return host?.walkTo ? host.walkTo(id) : Promise.resolve({ ok: false, code: 'not_walkable' }); },
    position() { return host?.position?.() || null; },
    dispose() { host?.dispose(); host = null; },
  };
}

export default createWorldAdapter;
