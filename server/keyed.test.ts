// OWNER: store — the keyed-collection layer (server/keyed.ts) against plain objects: splitting, assembling, and a randomized model
// that applies the same mutations to a plain document and to the layer and compares them after every commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Layer, assembleText, markerIds, plainOrder, splitText } from './keyed.ts';
import { MemoryLayers } from './keyed-memory.ts';

type Json = Record<string, unknown>;

test('splitText cuts the keyed maps out of a collection and assembleText puts them back', () => {
  const social = { players: { a: { name: 'A "q" \\ \u{1F600}', friends: { b: 1 } }, b: { name: 'B' } }, convs: {}, houses: { x: null }, pending: { a: [{ at: 1 }] }, reports: [{ id: 1, text: '{"$keyed":"players"}' }], seq: 7 };
  const text = JSON.stringify(social);
  const split = splitText('social', text);
  assert.deepEqual(markerIds(split.rootText), ['players', 'convs', 'houses', 'pending']);
  assert.ok(!split.rootText.includes('friends'));
  assert.equal(assembleText(split.rootText, (id) => split.maps.find((map) => map.id === id)?.entries ?? []), text);
  assert.deepEqual(split.maps.find((map) => map.id === 'players')?.entries.map(([key]) => key), ['a', 'b']);
  // Whitespace and escaped keys do not matter to the splitter.
  const spaced = JSON.stringify(social, null, 2);
  const again = splitText('social', spaced);
  assert.deepEqual(JSON.parse(assembleText(again.rootText, (id) => again.maps.find((map) => map.id === id)?.entries ?? [])), social);
  const escaped = splitText('social', '{"players":{"a\\"b":{"n":1},"c\\\\":2},"seq":1}');
  assert.deepEqual(escaped.maps[0]?.entries, [['a"b', '{"n":1}'], ['c\\', '2']]);
});

test('splitText finds maps under a wildcard and leaves a keyed name that is not an object alone', () => {
  const civic = { v: 1, prefs: {}, cities: { lagos: { seq: 1, residents: { r1: { n: 1 }, r2: { n: 2 } }, gov: { elections: { 5: { votes: {} }, 6: { votes: {} } }, announcements: [] } }, 'new/york': { residents: {}, gov: { elections: {}, announcements: [] } } } };
  const text = JSON.stringify(civic), split = splitText('civic', text);
  assert.deepEqual(split.maps.map((map) => map.id).sort(), ['cities/lagos/gov/elections', 'cities/lagos/residents', 'cities/new%2Fyork/gov/elections', 'cities/new%2Fyork/residents']);
  assert.equal(assembleText(split.rootText, (id) => split.maps.find((map) => map.id === id)?.entries ?? []), text);
  const odd = splitText('social', '{"players":[1,2],"convs":null,"seq":1}');
  assert.deepEqual(odd.maps, []);
  assert.equal(odd.rootText, '{"players":[1,2],"convs":null,"seq":1}');
});

test('plainOrder lists integer-like keys first and ascending, as a plain object does', () => {
  assert.deepEqual(plainOrder(['b', '10', 'a', '2', '01', '4294967295']), ['2', '10', 'b', 'a', '01', '4294967295']);
  const o: Json = {}; for (const key of ['b', '10', 'a', '2']) o[key] = 1;
  assert.deepEqual(plainOrder(['b', '10', 'a', '2']), Object.keys(o));
});

function open(layers: MemoryLayers) { return new Layer(layers); }
function commit(layers: MemoryLayers, layer: Layer): void { layers.apply(layer.changes()); }

test('a transaction reads one entry, writes only what changed, and sees plain-object behaviour', () => {
  const layers = new MemoryLayers();
  layers.ingest('social', JSON.stringify({ players: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } }, convs: {}, houses: {}, pending: {}, reports: [], seq: 0 }));
  const view = open(layers), social = view.get('social') as { players: Record<string, { n: number }>; seq: number };
  assert.equal(social.players['a']?.n, 1);
  assert.equal(social.players['a'], social.players['a']);
  assert.ok('b' in social.players && !('z' in social.players));
  assert.deepEqual(Object.keys(social.players), ['a', 'b', 'c']);
  assert.equal(Object.keys(social.players).length, 3);
  social.players['a']!.n = 10; delete social.players['b']; social.players['d'] = { n: 4 };
  const writes = view.changes();
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.root, null);
  const map = writes[0]?.maps[0];
  assert.deepEqual(map?.puts.map((put) => put.key), ['a', 'd']);
  assert.deepEqual(map?.deletes, ['b']);
  commit(layers, view);
  assert.deepEqual(JSON.parse(layers.text('social') as string).players, { a: { n: 10 }, c: { n: 3 }, d: { n: 4 } });
  assert.deepEqual(Object.keys(JSON.parse(layers.text('social') as string).players), ['a', 'c', 'd']);
});

test('a read that changes nothing writes nothing, and what a transaction changed and dropped leaves no trace', () => {
  const layers = new MemoryLayers();
  layers.ingest('social', JSON.stringify({ players: { a: { n: 1 } }, convs: {}, houses: {}, pending: {}, seq: 0 }));
  const view = open(layers), social = view.get('social') as { players: Record<string, { n: number }> };
  void social.players['a']?.n; void Object.values(social.players);
  assert.deepEqual(view.changes(), []);
  const dropped = open(layers), draft = dropped.get('social') as { players: Record<string, { n: number }> };
  draft.players['a']!.n = 99; // never committed
  assert.equal((open(layers).get('social') as { players: Record<string, { n: number }> }).players['a']?.n, 1);
});

test('a key removed and made again goes to the end; replacing a map or a collection clears what was stored', () => {
  const layers = new MemoryLayers();
  layers.ingest('social', JSON.stringify({ players: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } }, convs: { x: { m: 1 } }, houses: {}, pending: {}, seq: 0 }));
  let view = open(layers), social = view.get('social') as { players: Record<string, { n: number }>; convs: Record<string, unknown> };
  const a = social.players['a']; delete social.players['a']; social.players['a'] = a!;
  commit(layers, view);
  assert.deepEqual(Object.keys(JSON.parse(layers.text('social') as string).players), ['b', 'c', 'a']);
  view = open(layers); social = view.get('social') as typeof social;
  social.players = { z: { n: 26 } }; social.convs = {};
  commit(layers, view);
  assert.deepEqual(JSON.parse(layers.text('social') as string).players, { z: { n: 26 } });
  assert.deepEqual(JSON.parse(layers.text('social') as string).convs, {});
  view = open(layers); view.remove('social');
  commit(layers, view);
  assert.equal(layers.text('social'), undefined);
  view = open(layers);
  assert.equal(view.get('social'), undefined);
  view.set('social', { players: { q: { n: 1 } }, convs: {}, houses: {}, pending: {}, seq: 1 });
  commit(layers, view);
  assert.deepEqual(JSON.parse(layers.text('social') as string).players, { q: { n: 1 } });
});

test('a city made by the route gets its residents stored; a city removed takes them along', () => {
  const layers = new MemoryLayers();
  layers.ingest('civic', JSON.stringify({ v: 1, prefs: {}, cities: { lagos: { seq: 0, residents: { a: { x: 1 } }, gov: { elections: { 3: { v: 1 } }, announcements: [] } } } }));
  let view = open(layers), civic = view.get('civic') as { cities: Record<string, unknown> };
  civic.cities['ibadan'] = { seq: 0, residents: { b: { x: 2 } }, gov: { elections: {}, announcements: [] } };
  commit(layers, view);
  assert.deepEqual(layers.keys('civic', 'cities/ibadan/residents'), ['b']);
  view = open(layers); civic = view.get('civic') as typeof civic;
  delete civic.cities['lagos'];
  commit(layers, view);
  assert.deepEqual(layers.keys('civic', 'cities/lagos/residents'), []);
  assert.deepEqual(layers.keys('civic', 'cities/lagos/gov/elections'), []);
  assert.deepEqual(Object.keys((JSON.parse(layers.text('civic') as string) as { cities: Json }).cities), ['ibadan']);
});

/** A small deterministic random source. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** One random change to a social-shaped document, the same whichever object it is applied to. */
function mutate(social: Json, random: () => number): void {
  const players = social['players'] as Record<string, Json>, convs = social['convs'] as Record<string, Json>, pending = social['pending'] as Record<string, unknown[]>;
  const pick = (map: Record<string, unknown>): string | undefined => { const keys = Object.keys(map); return keys.length ? keys[Math.floor(random() * keys.length)] : undefined; };
  const id = (): string => (random() < 0.2 ? String(Math.floor(random() * 30)) : `p${Math.floor(random() * 40)}`);
  const r = random();
  if (r < 0.2) { const key = id(); if (!players[key]) players[key] = { name: `Name ${key}`, seen: 1, friends: {}, convs: {}, blocked: {} }; }
  else if (r < 0.4) { const key = pick(players); if (key) { const p = players[key] as Json; p['seen'] = Math.floor(random() * 1000); const f = p['friends'] as Record<string, number>; const other = pick(players); if (other) f[other] = Math.floor(random() * 99); } }
  else if (r < 0.5) { const key = pick(players); if (key) { for (const other of Object.values(players)) delete (other['friends'] as Json)[key]; delete players[key]; } }
  else if (r < 0.65) { const key = `c${Math.floor(random() * 15)}`; if (!convs[key]) convs[key] = { id: key, messages: [] }; (convs[key]!['messages'] as unknown[]).push({ seq: (convs[key]!['messages'] as unknown[]).length, text: `m${Math.floor(random() * 1e6)} \u{1F469}‍\u{1F4BB}`, at: Math.floor(random() * 1e9) }); }
  else if (r < 0.72) { const key = pick(convs); if (key) delete convs[key]; }
  else if (r < 0.82) { const key = id(); (pending[key] ||= []).push({ at: Math.floor(random() * 100) }); }
  else if (r < 0.87) { const key = pick(pending); if (key) delete pending[key]; }
  else if (r < 0.92) { social['seq'] = (social['seq'] as number) + 1; }
  else if (r < 0.95) { (social['reports'] as unknown[]).push({ id: social['seq'] }); }
  else if (r < 0.97) { const key = pick(players); if (key) { const copy = players[key]; delete players[key]; players[key] = copy as Json; } }
  else if (r < 0.985) { social['players'] = Object.fromEntries(Object.entries(players).filter(() => random() < 0.8)); }
  else { void Object.values(players).length; void Object.entries(convs).length; }
}

/** The collection's text as a plain object would list it (stored text keeps the order keys were added; parsing puts integer-like keys first). */
const norm = (text: string | undefined): string | undefined => (text === undefined ? undefined : JSON.stringify(JSON.parse(text)));
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  test(`model: the layer and a plain document agree after every transaction, restarts and discarded transactions included (seed ${seed})`, () => {
    const random = rng(seed);
    const start = { players: {}, convs: {}, houses: {}, pending: {}, reports: [], seq: 0, sweptAt: 0 };
    let plain: Json = JSON.parse(JSON.stringify(start)) as Json;
    let layers = new MemoryLayers();
    layers.ingest('social', JSON.stringify(start));
    for (let step = 0; step < 600; step += 1) {
      const view = open(layers), social = view.get('social') as Json;
      const draft = JSON.parse(JSON.stringify(plain)) as Json;
      const operations = 1 + Math.floor(random() * 4), seedOps = Math.floor(random() * 1e9);
      const ra = rng(seedOps), rb = rng(seedOps);
      for (let i = 0; i < operations; i += 1) { mutate(draft, ra); mutate(social, rb); }
      const keep = random() > 0.15;
      if (keep) {
        const before = layers.text('social');
        const undo = layers.apply(view.changes());
        plain = draft;
        assert.equal(norm(layers.text('social')), JSON.stringify(plain), `step ${step}`);
        if (random() < 0.1) { for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]?.(); plain = JSON.parse(before as string) as Json; assert.equal(layers.text('social'), before, `undo at step ${step}`); }
      }
      assert.equal(norm(layers.text('social')), JSON.stringify(plain), `after step ${step}`);
      if (random() < 0.05) { const text = layers.text('social') as string; layers = new MemoryLayers(); layers.ingest('social', text); }
    }
  });
}
