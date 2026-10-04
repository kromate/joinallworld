// The airport (Ikeja) and the refinery (Lekki Free Zone) are venues like any other: on the map,
// reachable, enterable, with spots to walk to and activities that run. The coming-soon mechanism
// they used to be the only users of is still there for the next place — checked with a made-up one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, spotsOf } from './life.js';
import { makeContext } from './game/util.js';
import { isOpen } from './game/clock.js';
import { VENUES, COMING_SOON, VENUE_CATEGORIES, GIG_DAILY_LIMIT } from './game/content/venues.js';
import { AIRPORT, REFINERY } from './game/content/venues-transport.js';
import { CITY_LINKS, CITY_RULES } from './game/content/world.js';
import { quote, isGig, travelBlock } from './game/systems/travel.js';
import { weatherAt } from './game/systems/health.js';
import { createKit } from './scene/kit.js';
import { buildVenueScene, WALK, SPOT_REACH } from './scene/venue-scenes.js';
import { createWalker } from './scene/movement.js';
import { sceneVenue } from './venue-world.js';
import pack from './map3d/cities/lagos.ts';
import { buildNetwork } from './map3d/roads.ts';
import { buildCity } from './map3d/city-build.ts';
import { flatModel, flatSvg } from './map3d/flat.ts';
import { lgaAt } from './map3d/lga.ts';
import { LANDMARK_KINDS } from './map3d/landmarks.ts';
import { goBlock, chosenMode, statusClass } from './ui/panels/world-ui.js';

const IDS = ['airport', 'refinery'];
const MONDAY_NOON = Date.UTC(2026, 0, 5, 11);   // Lagos is UTC+1
const at = (now, seed = 'transport') => makeContext({ now, cityId: 'lagos', seed });
/** A dry noon, so that a trek is not a soaking. */
const NOON = (() => { for (let t = MONDAY_NOON; ; t += 20 * 60000) if (!weatherAt(t, 'lagos').raining && !weatherAt(t + 60000, 'lagos').raining) return t; })();

test('the airport and the refinery are venues of the catalogue, and nothing in Lagos is coming soon', () => {
  assert.equal(VENUES.airport, AIRPORT); assert.equal(VENUES.refinery, REFINERY);
  assert.deepEqual(Object.keys(COMING_SOON), []);
  assert.deepEqual([AIRPORT.district, AIRPORT.zone, AIRPORT.scene.kind, AIRPORT.hours], ['Ikeja', 'mainland', 'airport', undefined], 'the airport never closes');
  assert.deepEqual([REFINERY.district, REFINERY.zone, REFINERY.scene.kind, REFINERY.hours], ['Lekki Free Zone', 'east', 'refinery', { open: 6, close: 22 }]);
  assert.deepEqual(Object.keys(AIRPORT.spots), ['departures', 'arrivals', 'deck', 'lounge', 'desk']);
  assert.deepEqual(Object.keys(REFINERY.spots), ['gate', 'control', 'loading', 'canteen', 'view']);
  for (const venue of [AIRPORT, REFINERY]) {
    assert.equal(venue.beta, true); assert.ok(Object.hasOwn(VENUE_CATEGORIES, venue.category));
    for (const spot of Object.values(venue.spots)) for (const def of spot.activities) assert.equal(def.beta, true, `${def.id} is an original beta value`);
  }
  // One paid gig each, bounded like every other: a need cost, a cooldown, and a place in the day's gig limit.
  const paid = [AIRPORT, REFINERY].flatMap((venue) => Object.values(venue.spots).flatMap((spot) => spot.activities.filter((def) => def.reward > 0)));
  assert.deepEqual(paid.map((def) => def.id), ['airport-carry-bags', 'refinery-load-drums']);
  for (const def of paid) { assert.ok(isGig(def) && def.cooldown >= 300 && def.effects.energy < 0 && def.minimumNeeds.energy >= 20 && def.reward <= 450, def.id); }
  // The travel desk names the flights that exist as data and are refused while their city is not open. It sells nothing.
  const flights = CITY_LINKS.filter((link) => link.mode === 'air' && (link.a === 'lagos' || link.b === 'lagos')).map((link) => CITY_RULES[link.a === 'lagos' ? link.b : link.a]);
  assert.ok(flights.length >= 2 && flights.every((city) => city.status !== 'open'));
  for (const city of flights) assert.ok(AIRPORT.spots.desk.caption.includes(city.name), city.name);
  assert.match(AIRPORT.spots.desk.caption, /begin when those cities open/);
  assert.ok(AIRPORT.spots.desk.activities.every((def) => !def.reward && !def.cost));
});

test('a trip to each works by trek and by danfo, and each is on the map list as an open venue with the five ways to go', () => {
  for (const id of IDS) {
    for (const mode of ['trek', 'danfo']) {
      const state = createLife(null, at(NOON));
      assert.equal(state.location, 'park');
      assert.equal(travelBlock(state, id, mode, at(NOON)), null, `${id} by ${mode}`);
      const trip = quote(state, id, mode, at(NOON));
      const started = dispatch(state, { type: 'travel', payload: { id, mode } }, at(NOON));
      assert.equal(started.ok, true, started.reason);
      assert.deepEqual([state.activeAction.kind, state.activeAction.id, state.activeAction.mode], ['travel', id, mode]);
      assert.equal(state.cash, 5000 - trip.fare); assert.equal(trip.fare > 0, mode === 'danfo');
      advanceLife(state, state.activeAction.duration, at(NOON + state.activeAction.duration * 1000));
      assert.deepEqual([state.location, state.activeAction, state.spot], [id, null, Object.keys(VENUES[id].spots)[0]], `arrived at ${id} by ${mode}, at its first spot`);
      assert.ok(state.travel.visited.includes(id));
      // And back out again: nobody is stranded there.
      assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, at(NOON + 120000)).ok, true);
    }
  }
  const state = createLife(null, at(NOON));
  const view = { ...viewLife(state, at(NOON)), connected: true, session: { id: 'p' } };
  assert.deepEqual(view.travel.destinations.filter((item) => item.kind === 'soon'), []);
  for (const id of IDS) {
    const item = view.travel.destinations.find((entry) => entry.id === id);
    assert.deepEqual([item.kind, item.open, item.blocked, statusClass(item)], ['venue', true, null, 'is-open']);
    assert.deepEqual(item.modes.map((mode) => mode.id), ['trek', 'keke', 'danfo', 'okada', 'cab']);
    assert.ok(item.modes.every((mode) => mode.blocked === null && mode.seconds > 0) && item.modes[0].fare === 0 && item.modes[2].fare > 0);
    assert.ok(item.description && item.ambient && item.band && item.preview.length >= 10, `${id} has the normal venue card`);
    for (const mode of ['trek', 'danfo']) assert.equal(goBlock(state, view, item, chosenMode(item, mode)), null, `Go to ${id} by ${mode}`);
  }
  // Fare bands by distance: the airport is on the mainland (far from the island's park); the refinery is with the Lekki venues.
  assert.equal(quote(createLife({ location: 'radio' }, at(NOON)), 'airport', 'danfo', at(NOON)).band, 'near');
  assert.equal(quote(createLife({ location: 'beach' }, at(NOON)), 'refinery', 'danfo', at(NOON)).band, 'near');
  assert.equal(quote(createLife({ location: 'airport' }, at(NOON)), 'refinery', 'danfo', at(NOON)).band, 'far');
  // The refinery keeps hours like any venue; the airport is always open.
  const night = Date.UTC(2026, 0, 5, 23);
  assert.equal(isOpen(REFINERY.hours, night), false); assert.equal(travelBlock(createLife(null, at(night)), 'refinery', 'trek', at(night)).code, 'closed');
  assert.equal(travelBlock(createLife(null, at(night)), 'airport', 'trek', at(night)), null);
});

test('every activity at both venues starts and completes; the paid gigs pay once, cool down and count towards the daily limit', () => {
  for (const id of IDS) {
    for (const spot of spotsOf(id)) {
      for (const def of spot.activities) {
        const state = createLife({ location: id, spot: spot.id, cash: 5000 }, at(NOON));
        state.needs.energy = 80;
        const before = { cash: state.cash, skills: { ...state.skills }, needs: { ...state.needs } };
        const started = dispatch(state, { type: 'activity', payload: { id: def.id } }, at(NOON));
        assert.equal(started.ok, true, `${def.id}: ${started.reason}`);
        assert.deepEqual([state.activeAction.kind, state.activeAction.id, state.activeAction.duration], ['activity', def.id, def.duration]);
        advanceLife(state, def.duration, at(NOON + def.duration * 1000));
        assert.equal(state.activeAction, null, `${def.id} completes`);
        assert.equal(state.cash, before.cash - (def.cost || 0) + (def.reward || 0), `${def.id} money`);
        for (const skill of Object.keys(def.xp || {})) assert.ok(state.skills[skill] > (before.skills[skill] || 0), `${def.id} trains ${skill}`);
        if (!def.reward) continue;
        assert.equal(state.travel.gigs.count, 1, `${def.id} is one of the day's ${GIG_DAILY_LIMIT} gigs`);
        const again = dispatch(state, { type: 'activity', payload: { id: def.id } }, at(NOON + 60000));
        assert.equal(again.code, 'cooldown', def.id);
        // At the day's limit it is refused like every other gig.
        const spent = createLife({ location: id, spot: spot.id }, at(NOON));
        spent.needs.energy = 80; spent.travel.gigs = { day: state.travel.gigs.day, count: GIG_DAILY_LIMIT };
        assert.equal(dispatch(spent, { type: 'activity', payload: { id: def.id } }, at(NOON)).ok, false, `${def.id} at the daily limit`);
      }
    }
  }
});

test('both scenes: every spot has its own landmark on walkable ground, with a path from the entrance, inside the budget', () => {
  const kit = createKit();
  const report = [];
  for (const id of IDS) {
    const venue = sceneVenue(id), kind = venue.scene.kind;
    assert.ok(Object.hasOwn(WALK, kind) && LANDMARK_KINDS.includes(kind), kind);
    const entry = buildVenueScene(kit, venue);
    assert.equal(entry.kind, kind, 'its own scene, not the generic plaza');
    const { grid, entrance } = entry.walk;
    assert.ok(grid.free(entrance.x, entrance.z), `${id}: the entrance is free`);
    const spots = entry.walk.spots();
    // Its own five spots, and the People spot the regulars bring.
    assert.deepEqual(spots.map((spot) => spot.id), [...Object.keys(VENUES[id].spots), 'people']);
    assert.deepEqual(spotsOf(id).map((spot) => spot.id), spots.map((spot) => spot.id));
    assert.equal(new Set(spots.map((spot) => `${spot.x},${spot.z}`)).size, spots.length, 'no two spots share a place');
    const walker = createWalker();
    walker.setGrid(grid); walker.place(entrance.x, entrance.z, Math.PI);
    for (const spot of spots) {
      assert.equal(entry.anchors[spot.id].landmark, spot.id, `${id}.${spot.id} stands at its own landmark`);
      assert.equal(spot.y, 0);
      assert.ok(grid.free(spot.x, spot.z), `${id}.${spot.id} is on walkable ground`);
      const path = grid.path(entrance.x, entrance.z, spot.x, spot.z);
      const end = path.at(-1) || entrance;
      assert.ok(Math.hypot(end.x - spot.x, end.z - spot.z) < 0.05, `${id}.${spot.id}: the path from the entrance ends on the spot`);
      // And it is really walked: the walker gets there, in well under a quarter of a minute.
      assert.equal(walker.goTo(spot.x, spot.z, { exact: true, face: spot.ry }), true);
      let seconds = 0;
      while (walker.step(1 / 30, 0) && seconds < 20) seconds += 1 / 30;
      assert.ok(Math.hypot(walker.x - spot.x, walker.z - spot.z) < 1e-6 && seconds < 14, `${id}.${spot.id}: walked in ${seconds.toFixed(1)} s`);
    }
    // A running activity's own place (a seat) is within reach of its spot.
    for (const spot of spots) { const act = entry.anchors[spot.id].act; if (act?.x != null) assert.ok(Math.hypot(act.x - spot.x, act.z - spot.z) < SPOT_REACH + 0.6, `${id}.${spot.id} seat`); }
    const stats = entry.stats();
    report.push(`${id}: ${stats.triangles} triangles, ${stats.meshes} meshes, ${stats.lights} lights`);
    assert.ok(stats.triangles > 5000 && stats.triangles < 11000 && stats.lights <= 4, report.at(-1));
    entry.dispose();
    assert.equal(entry.group.children.length, 0);
  }
  kit.dispose();
});

test('on both maps they are ordinary venues in the right local government; a coming-soon place is still marked when there is one', () => {
  assert.deepEqual(Object.keys(pack.soon), []);
  assert.equal(lgaAt(pack, pack.sites.airport.x, pack.sites.airport.z), 'ikeja');
  assert.equal(lgaAt(pack, pack.sites.refinery.x, pack.sites.refinery.z), 'ibeju-lekki');
  const network = buildNetwork(pack), kit = createKit();
  const city = buildCity(kit, pack, network, { venues: VENUES, soon: COMING_SOON });
  const model = flatModel(pack, network, { venues: VENUES, soon: COMING_SOON });
  assert.deepEqual(model.zones, [], 'no fenced-off zone on the flat map');
  assert.doesNotMatch(flatSvg(model), /data-zone=|stroke-dasharray="2\.2 2\.2"/);
  for (const id of IDS) {
    const place = city.places[id], flat = model.places.find((item) => item.id === id);
    assert.deepEqual([place.kind, flat.kind], ['venue', 'venue'], id);
    assert.deepEqual([flat.x, flat.z], [pack.sites[id].x, pack.sites[id].z]);
    assert.ok(place.gate && place.top > 6, `${id} has a landmark and a gate on a road`);
    assert.ok(Math.hypot(place.gate.x - place.x, place.gate.z - place.z) < 12, `${id} stands by its road`);
    for (const from of ['home:yaba', 'park', IDS.find((other) => other !== id)]) assert.ok(network.route(from, id)?.length > 10, `a road trip from ${from} to ${id}`);
  }
  assert.equal(Object.values(city.places).filter((place) => place.kind === 'soon').length, 0);
  // The mechanism itself, with a made-up district.
  const later = { ...pack, soon: { spaceport: { x: 150, z: 30, zone: [144, 24, 156, 36], gate: [152, 26] } } };
  const marked = flatModel(later, network, { venues: VENUES, soon: { spaceport: {} } });
  assert.deepEqual(marked.zones, [{ id: 'spaceport', x: 144, z: 24, width: 12, height: 12 }]);
  assert.equal(marked.places.find((item) => item.id === 'spaceport').kind, 'soon');
  assert.match(flatSvg(marked), /data-zone="spaceport"/);
  const built = buildCity(kit, later, network, { venues: VENUES, soon: { spaceport: {} } });
  assert.deepEqual([built.places.spaceport.kind, built.places.spaceport.gate], ['soon', null]);
  kit.dispose();
});
