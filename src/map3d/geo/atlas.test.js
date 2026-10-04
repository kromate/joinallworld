// The atlas (world → Africa → Nigeria): the data, picking, the registry, levels, labels, routes, the battery rule and lazy loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { WORLD } from './data/world.js';
import { AFRICA } from './data/africa.js';
import { NIGERIA, AROUND, WATER } from './data/nigeria.js';
import { decodeTopology, decodeInts, encodeInts, encodeArc, selfIntersections, ringArea2 } from './topo.js';
import { createPicker } from './pick.js';
import { EXTENT, project, relLon, unproject } from './projection.js';
import { FRAME_MARGIN, HYSTERESIS, crumbs, focusLevel, levelAt, pitchAt, thresholds } from './levels.js';
import { LABEL_CAP, placeLabels, textWidth } from './labels.js';
import { AIRPORTS, HIGHWAYS, TOWNS, interCityTripOf, linkId, linkPath, measure, pointAlong, travelEase, tripPoint } from './routes.js';
import { listOrder, regionInfo } from './info.js';
import { createAtlas } from './atlas.js';
import { ATLAS, ATLAS_LEVELS, ZONES, AFRICA_GROUPS, canEnter, cityEntry, plannedRoutes, regionEntry, regionStatus, stateOfCity, MORE_REGIONS } from '../regions.js';
import { CITY_LINKS } from '../../game/content/world.js';

const here = (name) => new URL(name, import.meta.url);
const world = decodeTopology(WORLD), africa = decodeTopology(AFRICA), nigeria = decodeTopology(NIGERIA), around = decodeTopology(AROUND);
const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
  'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
// The 54 member states of the African Union that are also UN members, by ISO code.
const AFRICAN = 'dz ao bj bw bf bi cv cm cf td km cg cd ci dj eg gq er sz et ga gm gh gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd tz tg tn ug zm zw'.split(' ');

test('the data: 37 first-level units of Nigeria by name, every African country, and every feature with a name, an id and bounds', () => {
  assert.deepEqual(nigeria.features.map((feature) => feature.name).sort(), STATES);
  assert.equal(new Set(nigeria.features.map((feature) => feature.id)).size, 37);
  for (const feature of nigeria.features) {
    assert.match(feature.ab, /^[A-Z]{2}$/, feature.id);
    assert.ok(typeof feature.cap[0] === 'string' && createPicker(nigeria, { slack: 0.05 }).find(feature.cap[1], feature.cap[2])?.id === feature.id, `${feature.name}'s capital ${feature.cap[0]} lies in it`);
    assert.ok(Object.hasOwn(ATLAS.state, feature.id) && ZONES[ATLAS.state[feature.id].zone] && ATLAS.state[feature.id].teaser.length > 20, `${feature.id} is in the registry with a zone and a teaser`);
  }
  assert.deepEqual(Object.keys(ATLAS.state).sort(), nigeria.features.map((feature) => feature.id).sort(), 'the registry names no state the map lacks');
  assert.equal(africa.features.length, 56, '54 countries, plus Western Sahara and Somaliland as Natural Earth draws them');
  for (const id of AFRICAN) { assert.ok(africa.byId.get(id), `${id} is on the Africa sheet`); assert.equal(world.byId.get(id)?.c, 'af', `${id} is African on the world sheet`); }
  assert.deepEqual(africa.features.map((feature) => feature.id).filter((id) => !AFRICAN.includes(id)).sort(), ['eh', 'sol']);
  for (const feature of africa.features) assert.ok(AFRICA_GROUPS[feature.sub], `${feature.name} is in a regional group`);
  assert.ok(world.features.length > 230);
  for (const [name, topology] of Object.entries({ world, africa, nigeria, around })) {
    assert.equal(new Set(topology.features.map((feature) => feature.id)).size, topology.features.length, `${name}: ids are unique`);
    for (const feature of topology.features) {
      assert.ok(feature.id && feature.name && feature.rings.length, `${name}/${feature.id}`);
      const b = feature.bounds;
      assert.ok(Number.isFinite(b.minLon + b.maxLon + b.minLat + b.maxLat) && b.maxLon > b.minLon && b.maxLat > b.minLat, `${name}/${feature.id} has bounds`);
      for (const poly of feature.rings) for (const ring of poly) assert.ok(ring.length >= 6 && Math.abs(ringArea2(ring)) > 0, `${name}/${feature.id}: no collapsed ring`);
    }
  }
  assert.deepEqual(around.features.map((feature) => feature.id).sort(), [...ATLAS_LEVELS[2].around].sort());
  assert.deepEqual(WATER.rivers.map((river) => river.name), ['Niger', 'Benue']);
  assert.ok(WATER.lakes.some((lake) => lake.name === 'Lake Chad'));
  // The Niger and the Benue meet at Lokoja.
  const lokoja = TOWNS.lokoja, nearest = (river) => Math.min(...river.lines.flatMap((line) => Array.from({ length: line.length / 2 }, (_, i) => Math.hypot(line[i * 2] - lokoja[0], line[i * 2 + 1] - lokoja[1]))));
  for (const river of WATER.rivers) assert.ok(nearest(river) < 0.12, `the ${river.name} passes Lokoja`);
});

test('simplification kept the shapes sound: no ring crosses itself among the most detailed, and neighbours share their borders exactly', () => {
  for (const [name, topology] of Object.entries({ world, africa, nigeria, around })) {
    const rings = topology.features.flatMap((feature) => feature.rings.flat().map((ring) => ({ ring, id: feature.id }))).sort((a, b) => b.ring.length - a.ring.length);
    for (const { ring, id } of rings.slice(0, name === 'world' ? 40 : 60)) assert.equal(selfIntersections(ring), 0, `${name}/${id} (${ring.length / 2} points)`);
    assert.ok(topology.users.some((users) => users.length === 2), `${name} has shared borders stored once`);
    assert.ok(topology.users.every((users) => users.length >= 1 && users.length <= 2), `${name}: an arc belongs to one region or two`);
  }
  // Every state touches another: nothing floats free of its neighbours after simplification.
  const touching = new Set(nigeria.users.filter((users) => users.length === 2).flat());
  assert.equal(touching.size, 37);
});

test('the data modules are small, say where they came from, and decode from their compact form', () => {
  const limits = { 'world.js': 120000, 'africa.js': 80000, 'nigeria.js': 60000 };
  for (const [file, limit] of Object.entries(limits)) {
    const path = here(`./data/${file}`), text = readFileSync(path, 'utf8');
    assert.ok(statSync(path).size <= limit, `${file} is ${statSync(path).size} bytes (limit ${limit})`);
    assert.match(text, /Natural Earth/); assert.match(text, /public domain/); assert.match(text, /Visvalingam/); assert.match(text, /default view/);
  }
  assert.deepEqual(readdirSync(here('./data/')).sort(), Object.keys(limits).sort());
  const values = [0, 1, -1, 31, 32, -33, 1024, -99999, 1234567];
  assert.deepEqual(decodeInts(encodeInts(values)), values);
  const arc = [[100, 200], [101, 198], [90, 260]];
  assert.deepEqual([...decodeTopology({ grid: 0.5, arcs: encodeArc(arc), features: [] }).arcs[0]], arc.flat().map((value) => value * 0.5));
});

test('the projection is Equal Earth about 11°E: it round-trips, keeps Africa near the middle and the sheet twice as wide as tall', () => {
  for (const [lon, lat] of [[3.4, 6.5], [-74, 40.7], [139.7, 35.7], [18.4, -33.9], [170, -45], [0, 89]]) {
    const [x, y] = project(relLon(lon), lat), [backLon, backLat] = unproject(x, y);
    assert.ok(Math.abs(backLon - relLon(lon)) < 1e-6 && Math.abs(backLat - lat) < 1e-6, `${lon}, ${lat}`);
    assert.ok(x >= EXTENT.minX && x <= EXTENT.maxX && y >= EXTENT.minY && y <= EXTENT.maxY);
  }
  assert.ok(Math.abs(project(11, 0)[0]) < 1e-9 && Math.abs(project(20, 3)[0]) < 12, 'Africa is near the centre of the sheet');
  assert.ok(Math.abs((EXTENT.maxX - EXTENT.minX) / (EXTENT.maxY - EXTENT.minY) - 2.0546) < 0.01);
  assert.equal(relLon(-175), 185); assert.equal(relLon(-160), -160); assert.equal(relLon(190), 190);
  assert.ok(project(8, 10)[1] > project(8, 5)[1] && project(9, 8)[0] > project(4, 8)[0], 'north is up, east is right');
});

test('pick() finds the right region at known places, at every level, through the grid', () => {
  const states = createPicker(nigeria, { slack: 0.05 }), countries = createPicker(africa, { slack: 0.3 }), all = createPicker(world, { cells: 72, slack: 0.8 });
  const state = (lon, lat) => states.find(lon, lat)?.id, country = (lon, lat) => countries.find(lon, lat)?.id, anywhere = (lon, lat) => all.find(relLon(lon), lat)?.id;
  assert.equal(state(3.38, 6.52), 'lagos'); assert.equal(state(8.52, 12.0), 'kano'); assert.equal(state(7.49, 9.06), 'fct'); assert.equal(state(7.03, 4.82), 'rivers');
  assert.equal(state(3.9, 7.38), 'oyo'); assert.equal(state(13.16, 11.85), 'borno'); assert.equal(state(6.74, 7.8), 'kogi');
  assert.equal(states.pick(3.5, 4.5), null, 'the open sea is nobody');
  assert.equal(country(36.82, -1.29), 'ke'); assert.equal(country(31.24, 30.04), 'eg'); assert.equal(country(3.38, 6.52), 'ng'); assert.equal(country(28.05, -26.2), 'za'); assert.equal(country(-0.19, 5.6), 'gh');
  assert.equal(anywhere(-0.12, 51.5), 'gb'); assert.equal(anywhere(-74.0, 40.71), 'us'); assert.equal(anywhere(36.82, -1.29), 'ke'); assert.equal(anywhere(31.24, 30.04), 'eg');
  assert.equal(anywhere(139.7, 35.68), 'jp'); assert.equal(anywhere(151.2, -33.87), 'au'); assert.equal(anywhere(-43.2, -22.9), 'br'); assert.equal(anywhere(174.76, -36.85), 'nz');
  assert.equal(all.find(relLon(-140), 0), null, 'the middle of the Pacific');
  // The index keeps a hover cheap: a cell holds a handful of candidates, not the whole sheet.
  for (const picker of [states, countries, all]) assert.ok(picker.cells.largest <= 14 && picker.cells.columns * picker.cells.rows > 500, JSON.stringify(picker.cells));
  assert.ok(all.candidates(relLon(8), 9).length < 12);
});

test('open versus coming soon is the registry: only an open region can be entered, and only Lagos is open', () => {
  assert.deepEqual(Object.keys(ATLAS.state).filter((id) => canEnter('state', id)), ['lagos']);
  assert.deepEqual(world.features.map((feature) => feature.id).filter((id) => canEnter('country', id)), ['ng']);
  const context = { current: 'lagos', held: ['lagos'], routes: null };
  for (const feature of nigeria.features) {
    const info = regionInfo({ kind: 'state', id: feature.id }, { ...context, feature });
    assert.equal(Boolean(info.action), feature.id === 'lagos', `${feature.id}: ${info.tag}`);
    assert.equal(info.tag, feature.id === 'lagos' ? 'You are here' : 'Coming soon');
    assert.ok(info.teaser && info.type.includes(feature.id === 'fct' ? 'Territory' : 'State') && info.capital === feature.cap[0]);
    for (const route of info.routes) assert.equal(route.live, false, 'nothing leaves for a city that is not open');
  }
  for (const feature of [...africa.features, ...world.features]) {
    const info = regionInfo({ kind: 'country', id: feature.id }, { ...context, feature });
    assert.equal(Boolean(info.action), feature.id === 'ng', feature.id);
    assert.ok(info.name && info.teaser && info.tag);
  }
  const lagos = regionInfo({ kind: 'state', id: 'lagos' }, { ...context, feature: nigeria.byId.get('lagos') });
  assert.deepEqual([lagos.action.kind, lagos.action.label, lagos.tone], ['open-city', 'Enter Lagos', 'here']);
  assert.equal(lagos.routes.length, CITY_LINKS.filter((link) => link.a === 'lagos' || link.b === 'lagos').length);
  // The three planned cities keep their preview and their routes, with fare and time.
  for (const [id, city] of [['oyo', 'ibadan'], ['fct', 'abuja'], ['rivers', 'port-harcourt']]) {
    const info = regionInfo({ kind: 'state', id }, { ...context, feature: nigeria.byId.get(id) });
    assert.equal(regionStatus('state', id), 'planned'); assert.equal(stateOfCity(city), id);
    assert.deepEqual(info.preview, cityEntry(city).preview); assert.ok(info.routes.length >= 1);
    for (const route of info.routes) { assert.ok(route.fare > 0 && route.minutes > 0 && route.km > 0 && route.hub); assert.match(route.why, /is not open yet, so nothing leaves for it\. Departures start the day it opens\./); }
  }
  // A route is live only when the server says the trip may start.
  const mine = [{ to: 'ibadan', mode: 'road', blocked: null }];
  assert.equal(regionInfo({ kind: 'state', id: 'oyo' }, { ...context, routes: mine, feature: nigeria.byId.get('oyo') }).routes[0].live, false, 'the city itself is not open');
  // The one way in that already existed: a player who holds a life in a legacy city is offered it as a preview.
  assert.equal(regionInfo({ kind: 'state', id: 'oyo' }, { current: 'lagos', held: ['lagos', 'ibadan'], feature: nigeria.byId.get('oyo') }).action.label, 'Preview · open your Ibadan life');
  // Statuses are data: planned countries are the "Later" list, each with a hub and so a planned route.
  assert.deepEqual(plannedRoutes('lagos').map((route) => route.to.name), ['Accra', 'Nairobi', 'Johannesburg', 'London']);
  for (const route of plannedRoutes('lagos')) assert.ok(MORE_REGIONS.includes(world.byId.get(route.to.id).name), route.to.id);
  assert.equal(regionStatus('country', 'fr'), 'soon'); assert.equal(regionStatus('country', 'aq'), null); assert.equal(regionEntry('country', 'ng').level, 'nigeria');
  assert.equal(regionInfo({ kind: 'country', id: 'ng' }, { ...context, feature: africa.byId.get('ng') }).action.kind, 'zoom');
  assert.match(regionInfo({ kind: 'country', id: 'gh' }, { ...context, feature: africa.byId.get('gh') }).planned, /Lagos and Accra/);
  const rows = nigeria.features.map((feature) => regionInfo({ kind: 'state', id: feature.id }, { ...context, feature })).sort(listOrder);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.id), ['lagos', 'fct', 'oyo', 'rivers', 'abia']);
});

test('levels: thresholds half-way between the fits, hysteresis at each, and a closer level only over its own frame', () => {
  const fits = [750, 220, 30], cuts = thresholds(fits);
  assert.deepEqual(cuts.map(Math.round), [406, 81]);
  assert.deepEqual([900, 407, 405, 82, 80, 5].map((distance) => levelAt(distance, cuts)), [0, 0, 1, 1, 2, 2]);
  // Just past a threshold nothing changes; clearly past it, it does — in both directions.
  assert.equal(levelAt(cuts[0] * 0.97, cuts, 0), 0); assert.equal(levelAt(cuts[0] / HYSTERESIS - 1, cuts, 0), 1);
  assert.equal(levelAt(cuts[1] * 1.03, cuts, 2), 2); assert.equal(levelAt(cuts[1] * HYSTERESIS + 1, cuts, 2), 1);
  assert.equal(levelAt(10, cuts, 0), 2, 'a jump across two levels lands on the right one'); assert.equal(levelAt(800, cuts, 2), 0);
  assert.equal(focusLevel(2, 8, 9, ATLAS_LEVELS), 2, 'over Nigeria'); assert.equal(focusLevel(2, 30, -2, ATLAS_LEVELS), 1, 'zoomed in on Uganda is still Africa');
  assert.equal(focusLevel(2, -50, -10, ATLAS_LEVELS), 0, 'zoomed in on Brazil is still the world'); assert.equal(focusLevel(1, 100, 40, ATLAS_LEVELS), 0);
  assert.ok(FRAME_MARGIN > 0 && focusLevel(2, 16, 9, ATLAS_LEVELS) === 2, 'a little outside the frame still counts');
  const pitches = [1.5, 1.44, 1.04];
  assert.equal(pitchAt(2000, fits, pitches), 1.5); assert.equal(pitchAt(10, fits, pitches), 1.04); assert.equal(pitchAt(220, fits, pitches), 1.44);
  assert.ok(pitchAt(80, fits, pitches) > 1.04 && pitchAt(80, fits, pitches) < 1.44);
  assert.deepEqual(crumbs(ATLAS_LEVELS, 2, { id: 'lagos', name: 'Lagos' }).map((crumb) => crumb.name), ['World', 'Africa', 'Nigeria', 'Lagos']);
  assert.deepEqual(crumbs(ATLAS_LEVELS, 0).map((crumb) => [crumb.name, crumb.current]), [['World', true]]);
});

test('labels never overlap, are capped, abbreviate when the region is narrow, and the open place is always named', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, x: 20 + (i % 20) * 31, y: 20 + Math.floor(i / 20) * 9, text: `State ${i}`, short: 'ST', priority: i % 7, room: i % 3 ? 200 : 30 }));
  const placed = placeLabels([...many, { id: 'open', x: 300, y: 50, text: 'Lagos', note: 'You are here', priority: 1000, fixed: true }], { width: 640, height: 400 });
  assert.ok(placed.length <= LABEL_CAP && placed.length > 10);
  assert.equal(placed[0].id, 'open');
  for (const [i, a] of placed.entries()) for (const b of placed.slice(i + 1)) assert.ok(a.box.right <= b.box.left || b.box.right <= a.box.left || a.box.bottom <= b.box.top || b.box.bottom <= a.box.top, `${a.id} and ${b.id} overlap`);
  assert.ok(placed.some((label) => label.abbreviated && label.shown === 'ST') && placed.some((label) => !label.abbreviated && label.id !== 'open'));
  assert.deepEqual(placeLabels([{ id: 'a', x: 5000, y: 10, text: 'Far away', priority: 1 }], { width: 640, height: 400 }), [], 'off screen');
  assert.deepEqual(placeLabels([{ id: 'a', x: 50, y: 50, text: 'Too wide for it', priority: 1, room: 20 }]), [], 'a name wider than its region, with no abbreviation, is left out');
  assert.equal(placeLabels(many, { cap: 5 }).length, 5);
  assert.ok(textWidth('Federal Capital Territory', 11) > textWidth('FCT', 11));
});

test('routes: the roads pass real towns in Nigeria, every link has a line, and a traveller is where the progress says', () => {
  const states = createPicker(nigeria, { slack: 0.05 });
  for (const [id, [lon, lat]] of Object.entries(TOWNS)) assert.ok(states.find(lon, lat), `${id} is in Nigeria`);
  assert.deepEqual(HIGHWAYS.map((road) => road.id), ['lagos-ibadan', 'ibadan-abuja', 'lagos-port-harcourt', 'abuja-kano', 'abuja-lokoja', 'enugu-port-harcourt', 'kano-maiduguri', 'east-west']);
  for (const road of HIGHWAYS) { assert.ok(road.towns.length >= 3); for (const town of road.towns) assert.ok(TOWNS[town], `${road.id}: ${town}`); }
  assert.equal(states.find(...TOWNS.lagos).id, 'lagos'); assert.equal(states.find(...TOWNS.kano).id, 'kano'); assert.equal(states.find(...TOWNS.maiduguri).id, 'borno'); assert.equal(states.find(...TOWNS.lokoja).id, 'kogi');
  for (const port of AIRPORTS) assert.ok(states.find(port.at[0], port.at[1]), port.id);
  for (const link of CITY_LINKS) {
    const path = linkPath(link, cityEntry), line = measure(path.points);
    assert.ok(path && line.total > 0, linkId(link));
    if (link.mode === 'road') assert.ok(path.towns.length >= 3 && path.towns[0] === link.a && path.towns.at(-1) === link.b, `${linkId(link)} runs from ${link.a} to ${link.b} through towns`);
    // Progress 0 is the start, 1 the end, and the distance covered never goes backwards.
    const start = pointAlong(line, 0), end = pointAlong(line, 1);
    assert.deepEqual([start.x, start.y], line.points[0]); assert.deepEqual([end.x, end.y], line.points.at(-1));
    let covered = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) { const at = tripPoint(path, line, link.a, p), d = Math.hypot(at.x - line.points[0][0], at.y - line.points[0][1]); if (link.mode === 'road' && path.towns.length < 4) assert.ok(d >= covered - 1e-9); covered = d; assert.ok(Number.isFinite(at.x + at.y + at.heading)); }
    // The same link walked from its far end starts there.
    const back = tripPoint(path, line, link.b, 0), there = line.points.at(-1);
    assert.ok(Math.hypot(back.x - there[0], back.y - there[1]) < 1e-9, `${linkId(link)} backwards`);
    const mid = tripPoint(path, line, link.a, 0.5);
    assert.equal(mid.height > 0, link.mode === 'air', 'a flight is in the air at half-way, a bus is on the road');
  }
  const half = pointAlong(measure([[0, 0], [10, 0], [10, 10]]), 0.5);
  assert.ok(Math.abs(half.x - project(10, 0)[0]) < 0.6, 'half-way along an L is its corner');
  assert.equal(travelEase(0), 0); assert.equal(travelEase(1), 1); assert.ok(travelEase(0.3) < travelEase(0.6));
  // The server owns the timer.
  assert.equal(interCityTripOf({ activeAction: { kind: 'travel', id: 'cchub' } }), null);
  assert.deepEqual(interCityTripOf({ activeAction: { kind: 'intercity', id: 'ibadan', from: 'lagos', mode: 'road', duration: 120, remaining: 30 } }), { key: 'intercity|lagos|ibadan|road|120', from: 'lagos', to: 'ibadan', mode: 'road', duration: 120, remaining: 30 });
});

// ---- the view: a fake renderer and a hand-cranked frame queue, as in ../map3d.test.js ----
function harness({ reducedMotion = false, width = 1280, height = 800, delay = 0 } = {}) {
  const queue = [], env = { now: 1000, hidden: false, loads: [], opened: [], entered: [] }, calls = { render: 0 };
  const renderer = { calls, domElement: {}, info: { render: {} }, setPixelRatio() {}, setSize() {}, setClearColor() {}, dispose() {}, render() { calls.render += 1; } };
  const container = { hidden: false, getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }) };
  const load = async (id) => { env.loads.push(id); if (delay) await new Promise((done) => setTimeout(done, delay)); return ATLAS_LEVELS.find((level) => level.id === id).data(); };
  const atlas = createAtlas(container, { renderer, reducedMotion, load, raf: (fn) => { queue.push(fn); return queue.length; }, caf: () => { queue.length = 0; }, now: () => env.now, tabHidden: () => env.hidden,
    onOpenCity: (id) => env.opened.push(id), onEnterCity: (id) => env.entered.push(id) });
  /** Run frames until nothing asks for another (or the limit). Returns how many ran. */
  const run = (limit = 2000, step = 16) => { let frames = 0; while (queue.length && frames < limit) { env.now += step; queue.shift()(); frames += 1; } return frames; };
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((done) => setTimeout(done, delay + 2)); run(); } };
  return { atlas, env, calls, queue, run, settle, container };
}

test('battery rule: nothing renders while idle, a level change is a bounded burst of frames, and the loop stops itself', async () => {
  const { atlas, calls, queue, run, settle, env } = harness();
  await atlas.ready; atlas.resize(); await settle();
  let d = atlas.diagnostics();
  assert.deepEqual([d.levelId, d.loop, d.fading], ['nigeria', false, false]);
  assert.deepEqual(d.selected, { kind: 'state', id: 'lagos' }, 'the state you are in is selected to begin with');
  assert.equal(calls.render, d.renderCount);
  const idle = calls.render;
  env.now += 60000; assert.equal(run(), 0); assert.equal(queue.length, 0);
  assert.equal(calls.render, idle, 'a minute of nothing draws nothing');
  // Out to Africa: an ease, a cross-fade, then silence.
  atlas.goLevel(1); await settle();
  d = atlas.diagnostics();
  const burst = calls.render - idle;
  assert.deepEqual([d.levelId, d.loop, d.fading], ['africa', false, false]);
  assert.ok(burst > 10 && burst < 140, `the fly-out took ${burst} frames`);
  assert.ok(d.layers.every((alpha) => alpha === 0 || alpha === 1), 'every layer finished its fade');
  const after = calls.render; env.now += 60000; assert.equal(run(), 0); assert.equal(calls.render, after);
  // Out to the world and all the way back in.
  atlas.goLevel(0); await settle(); assert.equal(atlas.diagnostics().levelId, 'world');
  atlas.goLevel(2); await settle(); d = atlas.diagnostics();
  assert.deepEqual([d.levelId, d.loop], ['nigeria', false]);
  const rest = calls.render; assert.equal(run(), 0); assert.equal(calls.render, rest);
  // Choosing a region or a route is one frame, not a loop.
  atlas.select({ kind: 'state', id: 'kano' }); assert.equal(run(), 1); assert.deepEqual(atlas.diagnostics().selected, { kind: 'state', id: 'kano' });
  // Hidden, nothing is scheduled at all.
  env.hidden = true; atlas.select({ kind: 'state', id: 'oyo' }); atlas.goLevel(1); assert.equal(queue.length, 0);
  env.hidden = false;
  // A wheel-style zoom across the threshold swaps the level without an ease: only the fade runs.
  atlas.goLevel(2); await settle();
  const before = calls.render;
  for (let i = 0; i < 8; i++) atlas.zoomBy(1.25);
  await settle();
  assert.equal(atlas.diagnostics().levelId, 'africa');
  assert.ok(calls.render - before < 60, `the cross-fade took ${calls.render - before} frames`);
  atlas.destroy();
});

test('each level fetches its data the first time it is wanted, with the map already on screen kept meanwhile', async () => {
  const { atlas, env, settle, run } = harness({ delay: 15 });
  assert.deepEqual(env.loads, [], 'nothing is fetched until asked');
  await new Promise((done) => setTimeout(done, 1));
  assert.deepEqual(env.loads, ['nigeria'], 'the level in view first');
  await atlas.ready; atlas.resize(); await settle();
  assert.deepEqual(env.loads, ['nigeria', 'world'], 'then the world sheet behind it; Africa not yet');
  assert.deepEqual(atlas.diagnostics().loaded, ['world', 'nigeria']);
  atlas.goLevel(1); run(400);
  let d = atlas.diagnostics();
  // The camera has arrived but the data has not: the level on screen stays, and a status line says what is coming.
  assert.deepEqual([d.wanted, d.levelId, d.loading], [1, 'nigeria', 'Africa']);
  await settle(); d = atlas.diagnostics();
  assert.deepEqual([d.levelId, d.loading], ['africa', '']);
  assert.deepEqual(env.loads, ['nigeria', 'world', 'africa']);
  atlas.goLevel(2); await settle(); atlas.goLevel(1); await settle();
  assert.deepEqual(env.loads, ['nigeria', 'world', 'africa'], 'and never twice');
  atlas.destroy();
});

test('reduced motion: levels and views cut instead of flying, and a trip is a marker without a frame loop', async () => {
  const { atlas, calls, run, settle, queue } = harness({ reducedMotion: true });
  await atlas.ready; atlas.resize(); await settle();
  const before = calls.render;
  atlas.goLevel(1); await settle(); atlas.goLevel(1); await settle();
  let d = atlas.diagnostics();
  assert.equal(d.levelId, 'africa'); assert.ok(calls.render - before <= 6, `${calls.render - before} frames`);
  assert.ok(Math.abs(d.view.distance - d.fits[1]) < 1e-6, 'already there');
  atlas.goLevel(2); await settle();
  const still = calls.render;
  assert.equal(atlas.previewTrip('lagos:abuja:air'), true); run();
  d = atlas.diagnostics();
  assert.deepEqual([d.trip.preview, d.trip.progress, d.loop], [true, 0.5, false]);
  assert.ok(calls.render - still <= 2 && queue.length === 0);
  atlas.destroy();
});

test('travel between cities: the preview plays and ends by itself, and a real trip follows the server\'s timer', async () => {
  const { atlas, calls, run, settle, env } = harness();
  await atlas.ready; atlas.resize(); await settle();
  assert.equal(atlas.previewTrip('nowhere:else:road'), false);
  assert.equal(atlas.previewTrip('lagos:ibadan:road'), true);
  assert.equal(run(40), 40);
  let d = atlas.diagnostics();
  assert.ok(d.trip.preview && d.trip.mode === 'road' && d.trip.progress > 0.05 && d.trip.progress < 0.2 && d.loop, JSON.stringify(d.trip));
  assert.equal(d.routeShown, 'lagos:ibadan:road');
  const frames = run();
  assert.ok(frames > 300 && frames < 520, `the preview ran ${frames} more frames and stopped`);
  d = atlas.diagnostics(); assert.equal(d.trip, null); assert.equal(d.loop, false);
  // The server's trip: progress is 1 − remaining ÷ duration, re-anchored by every state.
  atlas.setState({ activeAction: { kind: 'intercity', id: 'abuja', from: 'lagos', mode: 'air', duration: 90, remaining: 60 } });
  assert.ok(Math.abs(atlas.diagnostics().trip.progress - 1 / 3) < 0.01);
  run(100); d = atlas.diagnostics();
  assert.ok(d.loop && !d.trip.preview && d.trip.mode === 'air' && Math.abs(d.trip.progress - (30 + 1.6) / 90) < 0.01, JSON.stringify(d.trip));
  atlas.setState({ activeAction: { kind: 'intercity', id: 'abuja', from: 'lagos', mode: 'air', duration: 90, remaining: 9 } });
  run(30); assert.ok(Math.abs(atlas.diagnostics().trip.progress - (81 + 0.48) / 90) < 0.01);
  env.now += 20000; const closing = run();
  assert.ok(closing <= 2, 'arrived: the loop ends');
  atlas.setState({ activeAction: null }); run();
  assert.equal(atlas.diagnostics().trip, null);
  const idle = calls.render; env.now += 5000; assert.equal(run(), 0); assert.equal(calls.render, idle);
  atlas.destroy();
});

test('picking through the view, and entering: only the open city is entered, after the fly-in', async () => {
  const { atlas, env, run, settle } = harness();
  await atlas.ready; atlas.resize(); await settle();
  assert.deepEqual(atlas.pick(3.38, 6.52), { kind: 'state', id: 'lagos', name: 'Lagos' });
  assert.deepEqual(atlas.pick(8.52, 12.0), { kind: 'state', id: 'kano', name: 'Kano' });
  assert.deepEqual(atlas.pick(2.3, 9.5), { kind: 'country', id: 'bj', name: 'Benin' }, 'a neighbour is a country, coming soon');
  atlas.goLevel(1); await settle();
  assert.deepEqual(atlas.pick(36.82, -1.29), { kind: 'country', id: 'ke', name: 'Kenya' }); assert.deepEqual(atlas.pick(31.24, 30.04), { kind: 'country', id: 'eg', name: 'Egypt' });
  assert.deepEqual(atlas.pick(-0.12, 51.5), { kind: 'country', id: 'gb', name: 'United Kingdom' }, 'beyond Africa the world sheet answers');
  atlas.goLevel(0); await settle();
  assert.deepEqual(atlas.pick(-74.0, 40.71), { kind: 'country', id: 'us', name: 'United States' });
  // Lagos at the centre of the screen is where the default view puts Nigeria.
  atlas.goLevel(2); await settle();
  const lagos = atlas.screenOf(3.38, 6.52);
  assert.ok(lagos.x > 0 && lagos.x < 1280 && lagos.y > 0 && lagos.y < 800);
  assert.deepEqual(env.opened, []);
  atlas.destroy();
});

test('the atlas stays out of the first download, and its one frame loop lives in atlas.js', () => {
  const main = readFileSync('src/life-main.js', 'utf8'), door = readFileSync('src/world-map.js', 'utf8'), registry = readFileSync('src/map3d/regions.js', 'utf8');
  assert.doesNotMatch(main, /^import .*(geo\/|world-map)/m); assert.match(main, /import\('\.\/world-map\.js'\)/);
  assert.doesNotMatch(door, /requestAnimationFrame/);
  // The data is reached only through dynamic imports in the registry: one chunk per level.
  for (const level of ATLAS_LEVELS) assert.match(registry, new RegExp(`data: \\(\\) => import\\('\\./geo/data/${level.id}\\.js'\\)`));
  for (const name of readdirSync(here('./')).filter((item) => item.endsWith('.js') && !item.endsWith('.test.js'))) {
    const code = readFileSync(here(`./${name}`), 'utf8'), bare = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(bare, /^import[^;]*data\/(world|africa|nigeria)\.js/m, `${name} must not import map data statically`);
    assert.doesNotMatch(bare, /setInterval|setAnimationLoop|setTimeout/, name);
    if (name !== 'atlas.js') assert.doesNotMatch(bare, /requestAnimationFrame/, name);
    if (!['atlas.js', 'build.js'].includes(name)) assert.doesNotMatch(bare, /from 'three'|document\.|window\./, `${name} is pure`);
  }
});
