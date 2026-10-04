// OWNER: world — one city pack, two maps: local governments, estates, houses at scale, and the links between cities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKit } from '../scene/kit.ts';
import pack from './cities/lagos.js';
import { buildNetwork, pointInPolygon } from './roads.js';
import { buildCity } from './city-build.js';
import { flatModel, flatSvg } from './flat.js';
import { lgaAt, landOf, onLand, rasterLgas, resolveLga } from './lga.js';
import { estateLayout, plotAt } from './estates.js';
import { createHouses, DETAIL_BUDGET } from './houses.js';
import { createWorldData, ESTATES_KEPT } from './world-data.js';
import { COUNTRIES, cityEntry } from './regions.js';
import { VENUES, COMING_SOON } from '../game/content/venues.ts';
import { CITY_LINKS, CITY_RULES, ESTATE, LAGOS_LGAS, PLOTS_PER_ESTATE, packStyle } from '../game/content/world.ts';

const network = buildNetwork(pack), kit = createKit();
const city = buildCity(kit, pack, network, { venues: VENUES, soon: COMING_SOON });
const model = flatModel(pack, network, { venues: VENUES, soon: COMING_SOON });

test('the flat map IS the 3D map from above: every venue, home, road, bridge, coming-soon zone and local government, at the same place', () => {
  // Places: the flat model and the 3D build read the same sites, so their coordinates are identical.
  const flat = Object.fromEntries(model.places.map((place) => [place.id, place]));
  const ids = Object.keys(city.places).filter((id) => id !== 'home');
  assert.deepEqual(Object.keys(flat).sort(), ids.sort());
  for (const id of ids) assert.deepEqual([flat[id].x, flat[id].z], [city.places[id].x, city.places[id].z], id);
  for (const id of Object.keys(VENUES).filter((venue) => venue !== 'home')) assert.ok(flat[id], `${id} is on the flat map`);
  for (const [id, home] of Object.entries(pack.homes)) assert.deepEqual([model.homes[id].x, model.homes[id].z], [home.x, home.z]);
  // Roads: the same smoothed centre lines the 3D ribbons are built on, bridges included.
  assert.deepEqual(model.roads.map((road) => road.id), network.roads.map((road) => road.id));
  for (const road of network.roads) {
    const twin = model.roads.find((item) => item.id === road.id);
    assert.equal(twin.bridge, road.bridge > 0);
    assert.deepEqual([twin.from.x, twin.from.z, twin.to.x, twin.to.z], [road.points[0].x, road.points[0].z, road.points.at(-1).x, road.points.at(-1).z]);
    assert.equal(twin.d.split('L').length, road.points.length);
  }
  assert.ok(model.roads.filter((road) => road.bridge).length >= 4);
  // Land: the outlines the 3D ground is extruded from.
  assert.deepEqual(model.land.map((entry) => entry.id), landOf(pack).map((entry) => entry.id));
  assert.deepEqual(model.zones.map((zone) => zone.id).sort(), Object.keys(pack.soon).sort());
  assert.deepEqual(model.lgas.map((lga) => [lga.id, lga.tint, lga.plate]), pack.lgas.map((lga) => [lga.id, lga.tint, lga.plate]));
  const svg = flatSvg(model);
  for (const lga of pack.lgas) assert.ok(svg.includes(`data-lga="${lga.id}"`));
  for (const road of network.roads) assert.ok(svg.includes(`data-road="${road.id}"`));
  assert.ok(!/<script|onerror|javascript:/i.test(svg));
  // And the flat map is what the city view mounts for a city with a pack; the old schematic is only for a city without one.
  const host = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(host, /if \(pack\) \{[^}]*createMap2D\(container, \{ pack/);
  const two = readFileSync(new URL('./map2d.js', import.meta.url), 'utf8');
  assert.ok(!/requestAnimationFrame|setInterval|setTimeout/.test(two), 'the flat map has no loop and no timer');
  assert.ok(!/innerHTML = [^;]*(slot\.ad|plot\.text|house\.name)/.test(two), 'player text is never markup');
});

test('the twenty local governments: geometry matches the rules, plates stand on land, every place belongs to exactly one', () => {
  assert.deepEqual(pack.lgas.map((lga) => lga.id), LAGOS_LGAS.map((lga) => lga.id));
  const lands = landOf(pack);
  for (const lga of pack.lgas) {
    assert.ok(lga.polygon.length >= 4 && /^#[0-9a-f]{6}$/.test(lga.tint) && lga.geo.box.length === 4, lga.id);
    assert.ok(pointInPolygon(lga.plate[0], lga.plate[1], lga.polygon) && onLand(lands, lga.plate[0], lga.plate[1]), `${lga.id} name plate is on its own land`);
    assert.ok(lga.geo.c[0] >= lga.geo.box[0] && lga.geo.c[0] <= lga.geo.box[2] && lga.geo.c[1] >= lga.geo.box[1] && lga.geo.c[1] <= lga.geo.box[3]);
  }
  for (const [id, spot] of [...Object.entries(pack.sites), ...Object.entries(pack.homes)]) assert.equal(pack.lgas.filter((lga) => pointInPolygon(spot.x, spot.z, lga.polygon)).length, 1, `${id} is in exactly one local government`);
  // The rented-home districts lie in the local government the rules say they do.
  for (const lga of LAGOS_LGAS) for (const district of lga.districts || []) if (pack.homes[district]) assert.equal(lgaAt(pack, pack.homes[district].x, pack.homes[district].z), lga.id);
  // The tint layer: coloured on land only, the player's own one brighter.
  const image = rasterLgas(pack, { scale: 1, own: 'ikeja' });
  const alphaAt = (x, z) => image.data[(Math.floor(z - image.z0) * image.width + Math.floor(x - image.x0)) * 4 + 3];
  assert.equal(alphaAt(88, -40), 0, 'the lagoon is not tinted');
  assert.ok(alphaAt(-70, -62) > alphaAt(-150, -80) && alphaAt(-150, -80) > 0);
  assert.ok(city.setLgas(true, 'ikeja')); assert.equal(city.setLgas(true, 'ikeja'), false, 'nothing is rebuilt when nothing changed');
});

test('finding a local government from a position happens in this module alone, from bundled boxes, and returns an id', () => {
  assert.deepEqual(resolveLga(pack, 6.6018, 3.3515), { id: 'ikeja', name: 'Ikeja', sure: true });
  assert.equal(resolveLga(pack, 6.4281, 3.4219).id, 'eti-osa');
  assert.equal(resolveLga(pack, 6.455, 3.39).id, 'lagos-island');
  assert.equal(resolveLga(pack, 6.42, 2.88).id, 'badagry');
  assert.equal(resolveLga(pack, 9.07, 7.4), null, 'Abuja is not in Lagos');
  assert.equal(resolveLga(pack, NaN, 3), null);
  const guess = resolveLga(pack, 6.70, 3.42);
  assert.ok(guess && LAGOS_LGAS.some((lga) => lga.id === guess.id));
  // No network and no storage anywhere near a position.
  const lga = readFileSync(new URL('./lga.js', import.meta.url), 'utf8'), card = readFileSync(new URL('../ui/panels/lga-card.js', import.meta.url), 'utf8');
  assert.ok(!/fetch|XMLHttpRequest|localStorage|sessionStorage|WebSocket|sendBeacon/.test(lga));
  assert.ok(!/localStorage|sessionStorage|sendBeacon|console\./.test(card));
  assert.equal((card.match(/coords\./g) || []).length, 2, 'latitude and longitude are read once each, inside the callback');
  assert.match(card, /api\.command\('estate\.set-lga', \{ lga, via \}\)/, 'the action carries the id and how it was found — nothing else');
  // Analytics is told how it was chosen and which local government (an id from the fixed list of twenty) — never the position.
  assert.match(card, /track\('lga_chosen', \{ method: via === 'device' \? 'device' : 'manual', lga \}\)/);
  assert.match(card, /track\('lga_chosen', \{ method: draft\.extra\.area\?\.via === 'device' \? 'device' : 'manual', lga: draft\.extra\.area\?\.lga \}\)/, 'the settle-in card says the same two things');
  assert.equal((card.match(/track\('/g) || []).length, 2, 'two reports, both of the choice: nothing else is reported from this file');
  assert.match(card, /payload: \(draft\) => \(draft\.extra\.area\?\.lga \? \{ lga: draft\.extra\.area\.lga, via: draft\.extra\.area\.via === 'device' \? 'device' : 'manual' \} : \{\}\)/, 'at settle-in the move-in carries the id and how it was found — nothing else');
});

test('every local government holds its 512 estates on its own buildable land, and an address is one point on both maps', () => {
  const seen = [];
  for (const lga of pack.lgas) {
    const layout = estateLayout(pack, lga.id);
    assert.equal(layout.cells.length, ESTATE.estates);
    assert.ok(layout.front >= 7, `${lga.id} first estate is ${layout.front.toFixed(1)} units`);
    for (const estate of [0, 1, 255, 511]) {
      const cell = layout.cells[estate];
      assert.equal(lgaAt(pack, cell.x, cell.z), lga.id);
      for (const plot of [0, 13, 97, 195]) { const at = layout.plot(estate, plot); assert.deepEqual(plotAt(layout, at.x, at.z), { estate, plot }, `${lga.id}/${estate}/${plot}`); }
    }
    // No estate stands on a venue's lot, in a coming-soon zone or over another estate.
    for (const cell of layout.cells) {
      for (const spot of Object.values(pack.sites)) assert.ok(Math.abs(cell.x - spot.x) > cell.size / 2 + 3 || Math.abs(cell.z - spot.z) > cell.size / 2 + 3);
      for (const zone of pack.zones) assert.ok(cell.x + cell.size / 2 < zone[0] + 0.3 || cell.x - cell.size / 2 > zone[2] - 0.3 || cell.z + cell.size / 2 < zone[1] + 0.3 || cell.z - cell.size / 2 > zone[3] - 0.3);
    }
    seen.push(layout);
    assert.equal(estateLayout(pack, lga.id), layout, 'computed once');
  }
  assert.equal(plotAt(seen[0], 500, 500), null);
});

test('houses at city scale: two million residents cost one mesh of blocks; only the estates in view become houses, inside the triangle budget', () => {
  const houses = createHouses(kit, pack);
  const full = new Uint8Array(ESTATE.estates).fill(PLOTS_PER_ESTATE);
  houses.setSummary(new Map(pack.lgas.map((lga) => [lga.id, { houses: 100352, occ: full }])));   // 2,007,040 houses
  let asked = 0;
  const estate = new Map(Array.from({ length: PLOTS_PER_ESTATE }, (_, plot) => [plot, { p: plot, s: packStyle({ shape: plot % 4, wall: plot % 8, roof: plot % 8, door: plot % 4, windows: plot % 4, fence: plot % 4, yard: plot % 8, sign: plot % 2 }, ['starter', 'bq', 'bungalow', 'duplex', 'villa'][plot % 5]), u: plot % 40 === 0 ? 99 : 0, online: plot % 3 === 0 }]));
  const data = { estate: () => { asked += 1; return { houses: estate, at: 1 }; } };
  // The whole city.
  assert.deepEqual(houses.update({ x: 0, z: -20, distance: 330, pixels: 2.2 }, data, {}), []);
  let c = houses.counts();
  assert.equal(houses.level, 'far'); assert.equal(asked, 0, 'nothing about individual houses is asked for');
  assert.ok(c.calls === 1 && c.far > 0 && c.far < 6000, `${c.far} triangles for the whole city`);
  // One local government in view: its estates as pads.
  houses.update({ x: -64, z: -66, distance: 110, pixels: 6 }, data, {});
  c = houses.counts();
  assert.equal(houses.level, 'near'); assert.equal(c.pads, ESTATE.estates * 2); assert.equal(asked, 0);
  // Close on the first estate: real houses, every style a per-instance colour, a handful of draw calls.
  const front = estateLayout(pack, 'ikeja').cells[0];
  const wanted = houses.update({ x: front.x, z: front.z, distance: 30, pixels: 30 }, data, { serverNow: 5, own: { lga: 'ikeja', estate: 0, plot: 7 } });
  c = houses.counts();
  assert.equal(houses.level, 'close'); assert.ok(wanted.length >= 1 && wanted.length <= 9);
  assert.ok(c.detail > 5000 && c.detail <= DETAIL_BUDGET, `${c.detail} triangles of houses`);
  assert.ok(c.calls <= 16, `${c.calls} draw calls`);
  assert.ok(city.triangles + houses.triangles < 60000, `${city.triangles + houses.triangles} triangles with the city`);
  const dots = houses.group.children.find((mesh) => mesh.name === 'houses-dots'), scaffold = houses.group.children.find((mesh) => mesh.name === 'houses-scaffold');
  assert.equal(dots.count, c.estates * Math.ceil(PLOTS_PER_ESTATE / 3), 'one green light per owner who is online');
  assert.equal(scaffold.count, c.estates * 5, 'scaffolding round the houses being upgraded');
  // The same view again rebuilds nothing.
  const before = dots.instanceMatrix.version;
  houses.update({ x: front.x, z: front.z, distance: 30, pixels: 30 }, data, { serverNow: 5, own: { lga: 'ikeja', estate: 0, plot: 7 } });
  assert.equal(dots.instanceMatrix.version, before);
  // The layer off: nothing is drawn or asked for.
  asked = 0;
  assert.deepEqual(houses.update({ x: front.x, z: front.z, distance: 30, pixels: 30 }, data, { visible: false }), []);
  assert.equal(houses.group.visible, false); assert.equal(asked, 0);
  houses.dispose();
});

test('the maps fetch only what is in view: one summary with a version stamp, one estate at a time, a bounded cache', async () => {
  const calls = [];
  let clock = 0;
  const occ = Buffer.from(new Uint8Array(ESTATE.estates).fill(3)).toString('base64');
  const fetchJson = async (path) => {
    calls.push(path);
    if (path.startsWith('/api/world/city')) return path.includes('&v=') ? { v: 'a.1', unchanged: true, online: { ikeja: 9 } } : { v: 'a.1', lgas: [{ id: 'ikeja', residents: 5, houses: 5, online: 2, occ }] };
    return { v: 1, page: Number(new URL(path, 'http://x').searchParams.get('page')), pages: 2, houses: [{ p: Number(new URL(path, 'http://x').searchParams.get('page')) * 98, s: 0, u: 0 }] };
  };
  const changes = [];
  const data = createWorldData({ fetchJson, cityId: 'lagos', onChange: (kind) => changes.push(kind), now: () => clock });
  clock = 100000;
  await data.loadCity();
  assert.equal(data.summary().get('ikeja').occ[511], 3);
  await data.loadCity();
  assert.equal(calls.length, 1, 'a fresh summary is not asked for again');
  clock += 30000; await data.loadCity();
  assert.match(calls[1], /&v=a\.1$/); assert.equal(data.summary().get('ikeja').online, 9, 'presence still arrives with an unchanged summary');
  assert.equal(data.estate('ikeja', 4), null);
  await new Promise((done) => setTimeout(done, 5));
  assert.deepEqual([...data.estate('ikeja', 4).houses.keys()], [0, 98], 'both pages of the estate, and only that estate');
  assert.equal(calls.filter((path) => path.includes('/estate/')).length, 2);
  for (let i = 0; i < 60; i++) data.estate('ikeja', 100 + i);
  assert.ok(data.size() <= ESTATES_KEPT);
  data.drop('ibadan'); assert.equal(data.summary(), null); assert.equal(data.size(), 0);
  assert.ok(changes.includes('city') && changes.includes('estate'));
});

test('cities connect as data, and each city that is coming soon has a preview on the country map', () => {
  for (const id of Object.keys(CITY_RULES)) assert.ok(cityEntry(id), `${id} is on the country map`);
  for (const link of CITY_LINKS) assert.ok(cityEntry(link.a) && cityEntry(link.b));
  const soon = Object.values(COUNTRIES.nigeria.cities).filter((item) => item.status === 'soon');
  assert.deepEqual(soon.map((item) => item.id), ['ibadan', 'abuja', 'port-harcourt']);
  for (const item of soon) { assert.equal(item.preview.length, 3); assert.equal(CITY_RULES[item.id].status, 'soon'); assert.ok(CITY_LINKS.some((link) => link.a === item.id || link.b === item.id)); }
  // The atlas shows a route's Travel button only when the server would let it leave; otherwise it says why (src/map3d/geo).
  const atlas = readFileSync(new URL('./geo/atlas.js', import.meta.url), 'utf8'), info = readFileSync(new URL('./geo/info.js', import.meta.url), 'utf8');
  assert.match(atlas, /data-atlas-travel=/); assert.match(info, /is not open yet, so nothing leaves for it/);
});
