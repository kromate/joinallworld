import test from 'node:test';
import assert from 'node:assert/strict';
import { CountryDetailPanelModel, countryOutlineSvg } from './country-detail.ts';
import type { CountryDetailCatalogue, CountryDetailOutline, CountryDetailService } from './country-detail-types.ts';

const catalogue: CountryDetailCatalogue = {
  countries: [
    { countryId: 'country:ne:1', name: 'Alpha', continent: 'Test region', atlasId: 'aa', status: 'mapped' },
    { countryId: 'country:ne:2', name: 'Beta', continent: 'Test region', atlasId: null, status: 'mapped' },
    { countryId: 'country:ne:3', name: 'Gamma', continent: 'Test region', atlasId: null, status: 'missing' },
    { countryId: 'legacy-ng', name: 'Nigeria', continent: 'Africa', atlasId: 'ng', status: 'protected' },
  ], sourceLabel: 'Synthetic test source', sourceUrl: 'https://example.test/source', boundaryNote: 'Synthetic display data only.',
};
const outline: CountryDetailOutline = {
  country: catalogue.countries[0]!,
  geometry: { type: 'Polygon', coordinates: [[[-4, 4], [4, 4], [4, -4], [-4, -4], [-4, 4]], [[-1, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]]] },
  attribution: 'test attribution', limitations: ['Synthetic geometry'],
};
const betaOutline: CountryDetailOutline = { ...outline, country: catalogue.countries[1]! };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function service(overrides: Partial<CountryDetailService> = {}) {
  let catalogueCalls = 0, loadCalls: string[] = [];
  const value: CountryDetailService = {
    async catalogue(signal) { catalogueCalls++; if (signal.aborted) throw new DOMException('aborted', 'AbortError'); return catalogue; },
    async load(id, signal) { loadCalls.push(id); if (signal.aborted) throw new DOMException('aborted', 'AbortError'); return id === 'country:ne:2' ? betaOutline : outline; },
    ...overrides,
  };
  return { value, stats: () => ({ catalogueCalls, loadCalls: [...loadCalls] }) };
}

test('catalogue and country payloads are fetched only after their explicit actions', async () => {
  const source = service();
  const model = new CountryDetailPanelModel(async () => source.value);
  assert.equal(source.stats().catalogueCalls, 0);
  assert.equal(source.stats().loadCalls.length, 0);
  await model.open('aa');
  assert.equal(model.snapshot().selectedCountryId, 'country:ne:1');
  assert.equal(source.stats().catalogueCalls, 1);
  assert.equal(source.stats().loadCalls.length, 0, 'opening and auto-choosing never fetches a country bundle');
  model.choose('country:ne:2');
  assert.equal(source.stats().loadCalls.length, 0, 'changing the chooser is selection only');
  await model.showOutline();
  assert.deepEqual(source.stats().loadCalls, ['country:ne:2']);
  assert.equal(model.snapshot().outline?.country.countryId, 'country:ne:2');
});

test('protected Nigeria remains a no-bundle action and can never reach service.load', async () => {
  const source = service();
  const model = new CountryDetailPanelModel(async () => source.value);
  await model.open('ng');
  assert.equal(model.snapshot().selectedCountryId, 'legacy-ng');
  await model.showOutline();
  assert.deepEqual(source.stats().loadCalls, []);
  assert.match(model.snapshot().message, /existing map/i);
});

test('missing-outline countries remain in the chooser and never trigger a bundle load', async () => {
  const source = service();
  const model = new CountryDetailPanelModel(async () => source.value);
  await model.open();
  model.choose('country:ne:3');
  assert.equal(model.snapshot().selectedCountryId, 'country:ne:3');
  assert.match(model.snapshot().message, /no outline is available/i);
  await model.showOutline();
  assert.deepEqual(source.stats().loadCalls, []);
});

test('stale outline completion after chooser change cannot replace the current selection', async () => {
  let finish!: (value: CountryDetailOutline) => void;
  const source = service({ load: () => new Promise<CountryDetailOutline>((resolve) => { finish = resolve; }) });
  const model = new CountryDetailPanelModel(async () => source.value);
  await model.open('aa');
  const loading = model.showOutline();
  await turn();
  model.choose('country:ne:2');
  finish(outline);
  await loading;
  assert.equal(model.snapshot().selectedCountryId, 'country:ne:2');
  assert.equal(model.snapshot().outline, null);
  assert.equal(model.snapshot().state, 'ready');
});

test('failed outline is retryable, while close and destroy abort active requests', async () => {
  let attempt = 0, lastSignal: AbortSignal | undefined;
  const source = service({ load: async (_id, signal) => {
    lastSignal = signal;
    if (attempt++ === 0) throw new Error('offline');
    return outline;
  } });
  const model = new CountryDetailPanelModel(async () => source.value);
  await model.open('aa'); await model.showOutline();
  assert.equal(model.snapshot().state, 'outline-error');
  model.retry(); await turn();
  assert.equal(model.snapshot().state, 'ready');
  assert.ok(model.snapshot().outline);
  let pendingSignal!: AbortSignal;
  const pendingService = service({ load: (_id, signal) => { pendingSignal = signal; return new Promise<CountryDetailOutline>(() => {}); } });
  const pending = new CountryDetailPanelModel(async () => pendingService.value);
  await pending.open('aa'); void pending.showOutline();
  await turn(); pending.close();
  assert.equal(pendingSignal.aborted, true);
  const destroyed = new CountryDetailPanelModel(async () => pendingService.value);
  await destroyed.open('aa'); void destroyed.showOutline(); await turn(); destroyed.destroy();
  assert.equal(pendingSignal.aborted, true);
  assert.equal(lastSignal?.aborted, false);
});

test('a failed lazy module import is retried instead of poisoning the cached service promise', async () => {
  let imports = 0;
  const source = service();
  const model = new CountryDetailPanelModel(async () => {
    if (imports++ === 0) throw new Error('offline chunk');
    return source.value;
  });
  await model.open();
  assert.equal(model.snapshot().state, 'catalogue-error');
  model.retry(); await turn();
  assert.equal(imports, 2);
  assert.equal(model.snapshot().state, 'ready');
  assert.equal(source.stats().catalogueCalls, 1);
});

test('closing while the lazy service module is resolving prevents even a catalogue request', async () => {
  let finish!: (value: CountryDetailService) => void;
  const source = service();
  const model = new CountryDetailPanelModel(() => new Promise<CountryDetailService>((resolve) => { finish = resolve; }));
  const opening = model.open();
  await turn(); model.close(); finish(source.value); await opening;
  assert.equal(source.stats().catalogueCalls, 0);
  assert.equal(model.snapshot().open, false);
});

test('outline display is a bounded copy preserving polygon holes and never mutating the service geometry', () => {
  const before = structuredClone(outline.geometry);
  const svg = countryOutlineSvg(outline);
  assert.match(svg.path, /Z.*M.*Z/);
  assert.equal(svg.sourcePositions, 10);
  assert.equal(svg.displayPositions, 8);
  assert.equal(svg.simplified, false);
  assert.deepEqual(outline.geometry, before);
  const many = Array.from({ length: 50_000 }, (_, i) => {
    if (i === 49_999) return [10, 0];
    const angle = Math.PI * 2 * i / 49_999;
    return [10 * Math.cos(angle), 5 * Math.sin(angle)];
  });
  const bounded = countryOutlineSvg({ ...outline, geometry: { type: 'Polygon', coordinates: [many] } });
  assert.ok(bounded.displayPositions <= 30_000);
  assert.equal(bounded.simplified, true);
});

test('display framing stays north-up and gives dateline and polar outlines finite local frames', () => {
  const northFirst: CountryDetailOutline = { ...outline, geometry: { type: 'Polygon', coordinates: [[[0, 20], [-10, -20], [10, -20], [0, 20]]] } };
  const triangle = countryOutlineSvg(northFirst);
  const coords = [...triangle.path.matchAll(/(?:M|L)([-\d.]+),([-\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])] as const);
  assert.ok(coords.length >= 3);
  assert.ok(coords[0]![1] < coords[1]![1], 'north is placed above the southern vertices');

  const fiji: CountryDetailOutline = { ...outline, geometry: { type: 'Polygon', coordinates: [[[179, -18], [-179, -18], [-179, -17], [179, -17], [179, -18]]] } };
  const fijiSvg = countryOutlineSvg(fiji);
  assert.ok([...fijiSvg.path.matchAll(/[-\d.]+/g)].every((value) => Number.isFinite(Number(value[0]))));
  assert.ok(fijiSvg.displayPositions <= 30_000);

  const polar: CountryDetailOutline = { ...outline, geometry: { type: 'Polygon', coordinates: [[[-135, 85], [-45, 85], [45, 85], [135, 85], [-135, 85]]] } };
  const polarSvg = countryOutlineSvg(polar);
  assert.ok([...polarSvg.path.matchAll(/[-\d.]+/g)].every((value) => Number.isFinite(Number(value[0]))));
  assert.ok(polarSvg.displayPositions <= 30_000);
});

test('malformed catalogue, invalid WGS84 geometry, and unclosed rings fail closed', async () => {
  const invalid = service({ catalogue: async () => ({ ...catalogue, countries: catalogue.countries.slice(0, 2) }) });
  const model = new CountryDetailPanelModel(async () => invalid.value);
  await model.open(); assert.equal(model.snapshot().state, 'catalogue-error');
  assert.throws(() => countryOutlineSvg({ ...outline, geometry: { type: 'Polygon', coordinates: [[[0, 0], [181, 0], [0, 2], [0, 0]]] } }));
  assert.throws(() => countryOutlineSvg({ ...outline, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 2]]] } }));
});
