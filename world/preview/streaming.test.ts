import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_LIMITS } from '../types.ts';
import type { Bounds, TileRef, WorldManifest } from '../types.ts';
import { selectVisibleTiles, TileStreamScheduler } from './streaming.ts';
import type { LoadedTile, PinnedManifest, TileLoadContext, VisibleTileCaps, VisibleTileSelection } from './streaming.ts';

const hash = (digit: string) => digit.repeat(64);
function ref(id: string, bounds: Bounds, more: Partial<TileRef> = {}): TileRef {
  const sha256 = more.sha256 ?? hash(String((id.charCodeAt(0) % 9) + 1));
  return { id, path: `tiles/${sha256}.json`, sha256, bytes: 100, brotliBytes: 50, triangles: 100, drawCalls: 5, bounds, ...more };
}
const caps = (more: Partial<VisibleTileCaps> = {}): VisibleTileCaps => ({ maxTriangles: 1_000, maxDrawCalls: 100, maxResidentBytes: 10_000, maxTiles: 10, shadowOverhead: { triangles: 0, drawCalls: 1 }, ...more });
function selection(selected: TileRef[]): VisibleTileSelection {
  return { selected, deferred: [], overbudget: [], outsideView: [], cost: { triangles: 0, drawCalls: 0, residentBytes: 0 } };
}
function pinned(refs: TileRef[], identity = hash('a')): PinnedManifest {
  const value: WorldManifest = {
    schemaVersion: 1, compilerVersion: 'test', frame: 'wgs84-enu-m-v1', verticalDatum: 'WGS84-ellipsoid', coverage: 'explorable',
    region: { id: 'region-a', parentId: null, name: 'Test region', kind: 'admin', countryCode: 'NG', timezone: null, bounds: [-180, -90, 180, 90] },
    exceptions: [], sources: [{ id: 'src-a', url: 'https://example.test/source', release: 'r1', license: 'CC0', attribution: 'Test', sha256: hash('b'), bytes: 1 }], tiles: refs, climate: null,
  };
  return { identity, value };
}
const emptyLoad = <Payload>(ref: TileRef, context: TileLoadContext, payload: Payload, cacheBytes = 1): LoadedTile<Payload> => ({
  manifestIdentity: context.manifestIdentity, regionId: context.regionId, tileId: ref.id, sha256: ref.sha256, cacheBytes, payload,
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('visible selection intersects dateline-wrapped bounds and orders nearest tile centers first', () => {
  const east = ref('east', [178, -1, 179, 1]), west = ref('west', [-179, -1, -178, 1]), hidden = ref('hidden', [-2, -1, 2, 1]);
  const result = selectVisibleTiles([west, hidden, east], [170, -2, -170, 2], [178.5, 0], caps());
  assert.deepEqual(result.selected.map((item) => item.id), ['east', 'west']);
  assert.deepEqual(result.outsideView.map((item) => item.id), ['hidden']);
});

test('polar bounds include every longitude at the pole and reject tiles beyond the visible latitude range', () => {
  const nearPole = ref('pole-west', [-165, 88, -150, 90]), farAroundPole = ref('pole-east', [72, 89, 110, 90]), tooFar = ref('subarctic', [0, 70, 10, 75]);
  const result = selectVisibleTiles([farAroundPole, tooFar, nearPole], [-180, 87, 180, 90], [0, 89], caps());
  assert.deepEqual(new Set(result.selected.map((item) => item.id)), new Set(['pole-west', 'pole-east']));
  assert.deepEqual(result.outsideView.map((item) => item.id), ['subarctic']);
  const partialLongitude = selectVisibleTiles([farAroundPole], [120, 89, 160, 90], [140, 89.5], caps());
  assert.deepEqual(partialLongitude.selected.map((item) => item.id), ['pole-east'], 'all longitudes meet at the pole');
});

test('selection reserves per-tile shadow overhead and reports cumulative deferrals and individually overbudget tiles', () => {
  const near = ref('a', [0, 0, 1, 1], { triangles: 60, drawCalls: 2, bytes: 40 });
  const next = ref('b', [1, 0, 2, 1], { triangles: 50, drawCalls: 2, bytes: 40 });
  const huge = ref('c', [2, 0, 3, 1], { triangles: 120, drawCalls: 2, bytes: 40 });
  const tileLimited = ref('d', [3, 0, 4, 1], { triangles: 10, drawCalls: 1, bytes: 10 });
  const alsoLimited = ref('e', [4, 0, 5, 1], { triangles: 10, drawCalls: 1, bytes: 10 });
  const result = selectVisibleTiles([near, next, huge, tileLimited, alsoLimited], [-1, -1, 6, 2], [0, 0.5], caps({ maxTriangles: 100, maxDrawCalls: 6, maxResidentBytes: 100, maxTiles: 2 }));
  assert.deepEqual(result.selected.map((item) => item.id), ['a', 'd']);
  assert.equal(result.cost.drawCalls, 5, 'declared calls and per-tile shadow draws are reserved');
  assert.deepEqual(result.deferred.map(({ ref: item, reason }) => [item.id, reason]), [['b', 'triangle-cap'], ['e', 'tile-cap']]);
  assert.deepEqual(result.overbudget.map(({ ref: item, reason }) => [item.id, reason]), [['c', 'triangle-cap']]);
});

test('renderer cost override is explicit; default draw call costs remain conservative', () => {
  const item = ref('rendered', [0, 0, 1, 1], { triangles: 40, drawCalls: 18, bytes: 90 });
  const conservative = selectVisibleTiles([item], [-1, -1, 2, 2], [0, 0], { maxTriangles: 1_000, maxDrawCalls: 10, maxResidentBytes: 1_000, maxTiles: 1 });
  assert.equal(conservative.overbudget[0]?.reason, 'draw-call-cap');
  assert.deepEqual(conservative.overbudget[0]?.cost, { triangles: 80, drawCalls: 36, residentBytes: 90 }, 'default shadow allowance repeats the declared render work');
  const merged = selectVisibleTiles([item], [-1, -1, 2, 2], [0, 0], caps({ maxDrawCalls: 3, renderCost: () => ({ drawCalls: 2, residentBytes: 70 }) }));
  assert.deepEqual(merged.selected.map((tile) => tile.id), ['rendered']);
  assert.deepEqual(merged.cost, { triangles: 40, drawCalls: 3, residentBytes: 70 });
});

test('scheduler limits concurrency to two, aborts obsolete work and never publishes a late result', async () => {
  const refs = ['a', 'b', 'c'].map((id, i) => ref(id, [i, 0, i + 1, 1]));
  const resolves = new Map<string, (value: LoadedTile<string>) => void>(), signals = new Map<string, AbortSignal>();
  const published: { pendingIds: readonly string[]; activeIds: string[] }[] = [];
  let inFlight = 0, peak = 0;
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 3, maxCacheBytes: 1000,
    load: (tile, context, signal) => {
      signals.set(tile.id, signal); inFlight += 1; peak = Math.max(peak, inFlight);
      return new Promise((resolve) => { resolves.set(tile.id, (value) => { inFlight -= 1; resolve(value); }); });
    }, activate: (payload) => payload, disposeActive: () => {},
    onChange: (snapshot) => published.push({ pendingIds: snapshot.pendingIds, activeIds: snapshot.active.map(({ ref: tile }) => tile.id) }),
  });
  scheduler.setManifest(pinned(refs));
  scheduler.setSelection(selection(refs));
  assert.equal(resolves.size, 2);
  assert.equal(peak, 2);
  scheduler.setSelection(selection([refs[0]!]));
  assert.equal(signals.get('b')?.aborted, true, 'a removed tile request is aborted');
  resolves.get('a')!(emptyLoad(refs[0]!, { manifestIdentity: hash('a'), regionId: 'region-a', sourceIds: new Set(['src-a']) }, 'A'));
  resolves.get('b')!(emptyLoad(refs[1]!, { manifestIdentity: hash('a'), regionId: 'region-a', sourceIds: new Set(['src-a']) }, 'late B'));
  await tick(); await tick();
  assert.deepEqual(scheduler.snapshot().active.map(({ ref: tile, value }) => [tile.id, value]), [['a', 'A']]);
  assert.equal(scheduler.snapshot().pendingIds.length, 0);
  assert.deepEqual(published.at(-1), { pendingIds: [], activeIds: ['a'] }, 'the settled notification has no completed request in its pending IDs');
  scheduler.dispose();
});

test('an aborted but unresolved loader still occupies a concurrency slot until it settles', async () => {
  const refs = ['a', 'b', 'c', 'd'].map((id, i) => ref(id, [i, 0, i + 1, 1]));
  const pending = new Map<string, { resolve(value: LoadedTile<string>): void; ref: TileRef; context: TileLoadContext; signal: AbortSignal }>();
  const starts: string[] = [];
  let transports = 0, peak = 0;
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 4, maxCacheBytes: 1000,
    load: (tile, context, signal) => {
      starts.push(tile.id); transports += 1; peak = Math.max(peak, transports);
      return new Promise((resolve) => pending.set(tile.id, { resolve, ref: tile, context, signal }));
    }, activate: (payload) => payload, disposeActive: () => {},
  });
  scheduler.setManifest(pinned(refs)); scheduler.setSelection(selection(refs.slice(0, 2)));
  scheduler.setSelection(selection(refs.slice(2)));
  assert.equal(pending.get('a')?.signal.aborted, true);
  assert.equal(pending.get('b')?.signal.aborted, true);
  assert.deepEqual(starts, ['a', 'b'], 'new work waits while both aborted transports remain unresolved');
  const finish = (id: string, value: string) => {
    const request = pending.get(id)!; transports -= 1;
    request.resolve(emptyLoad(request.ref, request.context, value));
  };
  finish('a', 'stale-a'); await tick(); await tick();
  assert.deepEqual(starts, ['a', 'b', 'c']);
  assert.deepEqual(scheduler.snapshot().active, [], 'a stale result was not activated');
  finish('b', 'stale-b'); await tick(); await tick();
  assert.deepEqual(starts, ['a', 'b', 'c', 'd']);
  assert.deepEqual(scheduler.snapshot().active, [], 'the second stale result was not activated');
  finish('c', 'C'); finish('d', 'D'); await tick(); await tick();
  assert.deepEqual(scheduler.snapshot().active.map(({ ref: tile, value }) => [tile.id, value]), [['c', 'C'], ['d', 'D']]);
  assert.equal(peak, 2, 'actual unresolved loader work never exceeded two');
  scheduler.dispose();
});

test('a stable failed selection stays failed until an explicit bounded retry', async () => {
  const tile = ref('retry', [0, 0, 1, 1]);
  let calls = 0;
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 1, maxCacheBytes: 100,
    load: async (item, context) => { calls += 1; if (calls === 1) throw new Error('temporary failure'); return emptyLoad(item, context, 'loaded'); },
    activate: (payload) => payload, disposeActive: () => {},
  });
  scheduler.setManifest(pinned([tile])); scheduler.setSelection(selection([tile])); await tick(); await tick();
  assert.equal(calls, 1);
  assert.deepEqual(scheduler.snapshot().failed, [{ id: 'retry', message: 'temporary failure' }]);
  assert.deepEqual(scheduler.snapshot().pendingIds, [], 'failure is terminal for the current selection');
  scheduler.setSelection(selection([tile])); await tick();
  assert.equal(calls, 1, 'a camera selection update does not silently retry');
  assert.equal(scheduler.retryFailed(['retry']), 1);
  assert.equal(scheduler.retryFailed(['retry']), 0, 'the same failure can only be retried once per explicit request');
  await tick(); await tick();
  assert.equal(calls, 2);
  assert.deepEqual(scheduler.snapshot().failed, []);
  assert.deepEqual(scheduler.snapshot().active.map(({ value }) => value), ['loaded']);
  scheduler.dispose();
});

test('manifest identity scopes cache and publication, and active payloads are disposed when removed', async () => {
  const oldRef = ref('tile', [0, 0, 1, 1], { sha256: hash('1') }), newRef = ref('tile', [0, 0, 1, 1], { sha256: hash('2') });
  const resolves = new Map<string, (value: LoadedTile<string>) => void>();
  const disposed: string[] = [], contexts: string[] = [];
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 2, maxCacheBytes: 100,
    load: (tile, context) => { contexts.push(context.manifestIdentity); return new Promise((resolve) => { resolves.set(context.manifestIdentity, (value) => resolve(value)); }); },
    activate: (payload) => payload, disposeActive: (value) => disposed.push(value),
  });
  const oldManifest = pinned([oldRef], hash('a')), newManifest = pinned([newRef], hash('c'));
  scheduler.setManifest(oldManifest); scheduler.setSelection(selection([oldRef]));
  scheduler.setManifest(newManifest); scheduler.setSelection(selection([newRef]));
  resolves.get(oldManifest.identity)!(emptyLoad(oldRef, { manifestIdentity: oldManifest.identity, regionId: oldManifest.value.region.id, sourceIds: new Set() }, 'stale'));
  resolves.get(newManifest.identity)!(emptyLoad(newRef, { manifestIdentity: newManifest.identity, regionId: newManifest.value.region.id, sourceIds: new Set() }, 'current'));
  await tick();
  assert.deepEqual(contexts, [oldManifest.identity, newManifest.identity]);
  assert.equal(scheduler.snapshot().manifestIdentity, newManifest.identity);
  assert.deepEqual(scheduler.snapshot().active.map(({ ref: tile, value }) => [tile.id, value]), [['tile', 'current']]);
  assert.throws(() => scheduler.setSelection(selection([oldRef])), /outside the pinned manifest/);
  scheduler.setSelection(selection([]));
  assert.deepEqual(disposed, ['current'], 'removing an active tile releases its renderer payload');
  scheduler.dispose();
  assert.deepEqual(disposed, ['current'], 'disposing an already-cleared scheduler is safe');
});

test('cache obeys both entry and byte caps and retains hash-keyed payloads within a manifest', async () => {
  const refs = ['a', 'b', 'c'].map((id, i) => ref(id, [i, 0, i + 1, 1], { sha256: hash(String(i + 1)) }));
  let loads = 0;
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 3, maxCacheBytes: 10,
    load: async (tile, context) => { loads += 1; return emptyLoad(tile, context, tile.id, tile.id === 'a' ? 8 : 5); },
    activate: (payload) => payload, disposeActive: () => {},
  });
  scheduler.setManifest(pinned(refs));
  for (const item of refs.slice(0, 2)) { scheduler.setSelection(selection([item])); await tick(); await tick(); scheduler.setSelection(selection([])); }
  assert.equal(loads, 2);
  scheduler.setSelection(selection([refs[0]!])); await tick(); await tick();
  assert.equal(loads, 3, 'the eight-byte entry was evicted to respect the ten-byte cache cap');
  scheduler.dispose();

  let countBoundLoads = 0;
  const countBound = new TileStreamScheduler<string, string>({ maxCacheEntries: 1, maxCacheBytes: 100,
    load: async (tile, context) => { countBoundLoads += 1; return emptyLoad(tile, context, tile.id, 1); },
    activate: (payload) => payload, disposeActive: () => {},
  });
  countBound.setManifest(pinned(refs));
  for (const item of refs.slice(0, 2)) { countBound.setSelection(selection([item])); await tick(); await tick(); countBound.setSelection(selection([])); }
  countBound.setSelection(selection([refs[0]!])); await tick(); await tick();
  assert.equal(countBoundLoads, 3, 'the entry-count cap evicted the least-recent hash key');
  countBound.dispose();
});

test('scheduler rejects concurrency above the shared fetch limit and reports selected/deferred/overbudget refs', async () => {
  assert.throws(() => new TileStreamScheduler({ maxConcurrent: WORLD_LIMITS.maxFetches + 1, maxCacheEntries: 1, maxCacheBytes: 10,
    load: async () => { throw new Error('not called'); }, activate: (payload: never) => payload, disposeActive: () => {},
  }), /maxConcurrent/);
  const [visible, deferred, overbudget] = [ref('visible', [0, 0, 1, 1]), ref('deferred', [1, 0, 2, 1]), ref('large', [2, 0, 3, 1], { triangles: 2_000 })];
  const chosen = selectVisibleTiles([visible, deferred, overbudget], [-1, -1, 4, 2], [0, 0], caps({ maxTiles: 1, maxTriangles: 1_000 }));
  const scheduler = new TileStreamScheduler<string, string>({ maxCacheEntries: 0, maxCacheBytes: 0,
    load: async (tile, context) => emptyLoad(tile, context, tile.id), activate: (payload) => payload, disposeActive: () => {},
  });
  scheduler.setManifest(pinned([visible, deferred, overbudget])); scheduler.setSelection(chosen);
  assert.deepEqual(scheduler.snapshot().deferred.map(({ ref: tile }) => tile.id), ['deferred']);
  assert.deepEqual(scheduler.snapshot().overbudget.map(({ ref: tile }) => tile.id), ['large']);
  scheduler.dispose();
});
