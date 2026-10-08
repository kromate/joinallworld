import assert from 'node:assert/strict';
import test from 'node:test';
import type { CountryGridPlan } from './country-grid-types.ts';
import { createGridQueryResolver, gridQueryCoverage, resolveGridQueryAddress, subdivideGridQuery, validateGridQueryBinding } from './grid-query.ts';
import type { GridQueryAddress, GridQueryBinding, GridQueryJobView } from './grid-query-types.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { geographicGridCell } from './country-grid.ts';

const H = 'a'.repeat(64);
function fixture(): { plan: CountryGridPlan; binding: GridQueryBinding } {
  const cell = { id: 'geo-grid-v1:l0:x180:y90', level: 0, column: 180, row: 90, bounds: [0, 0, 1, 1] as [number, number, number, number], polygonIndices: [0], state: 'not-started' as const };
  const plan = { schemaVersion: 1, compilerVersion: 'country-source-cut-grid-v1', requestHash: H,
    request: { schemaVersion: 1, id: 'fixture', directoryManifestHash: 'b'.repeat(64), countryId: 'country:test:1', level: 0,
      limits: { positions: 10, bboxCells: 10, cells: 10, operations: 100, outputBytes: 1000 } },
    country: { id: 'country:test:1', parentId: 'continent:test', name: 'Test', kind: 'country', countryCode: 'TT', bounds: [0, 0, 1, 1], sourceFeatureIds: ['src:NE_ID:1'], provider: 'world', outline: 'available', exceptions: [] },
    source: { id: 'src', url: 'https://example.test/source', release: 'test', license: 'test', attribution: 'test', sha256: 'c'.repeat(64), bytes: 1 },
    boundaryPins: { manifest: { path: `manifests/${'b'.repeat(64)}.json`, sha256: 'b'.repeat(64), bytes: 1 }, node: { path: `nodes/${'d'.repeat(64)}.json`, sha256: 'd'.repeat(64), bytes: 1 }, outlineIndex: { path: `outline-index/${'e'.repeat(64)}.json`, sha256: 'e'.repeat(64), bytes: 1 }, parts: [] },
    geographicCoverage: 'source-bound-grid-denominator', geometryCoverage: 'not-acquired', selection: 'inclusive-planar-source-cut-polygon-cell-contact', ownership: 'global-half-open-grid-seam-pole-v1',
    grid: { level: 0, stepDegrees: 1, columns: 360, rows: 180 }, cells: [cell], counts: { polygons: 1, positions: 5, bboxCandidates: 1, selectedCells: 1, operations: 1 }, limitations: ['fixture'] } as CountryGridPlan;
  return { plan, binding: { schemaVersion: 1, planHash: sha256(`${canonicalJson(plan)}\n`), maxDepth: 3, maxJobs: 20 } };
}
function captured(address: GridQueryAddress, features = 1): GridQueryJobView {
  return { address, status: 'completed', result: { status: 'query-captured', features, requestHash: H, inputSha256: 'b'.repeat(64), inputBytes: 100, receiptSha256: 'c'.repeat(64), receiptBytes: 20 } };
}
function split(address: GridQueryAddress, children: GridQueryAddress[]): GridQueryJobView {
  return { address, status: 'completed', result: { status: 'query-subdivided', reason: 'selected-item-count', children } };
}

test('binding is strict, bounded, and requires job capacity for every root', () => {
  const { plan, binding } = fixture();
  assert.deepEqual(validateGridQueryBinding(binding), binding);
  assert.throws(() => validateGridQueryBinding({ ...binding, extra: true }), /unknown fields/);
  assert.throws(() => validateGridQueryBinding({ ...binding, maxDepth: 9 }), /out of range/);
  assert.throws(() => gridQueryCoverage(plan, { ...binding, maxJobs: 0 }, []), /out of range/);
  const second = { ...plan.cells[0]!, id: 'geo-grid-v1:l0:x181:y90', column: 181, bounds: [1, 0, 2, 1] as [number, number, number, number] };
  const twoRootPlan = { ...plan, cells: [...plan.cells, second], counts: { ...plan.counts, selectedCells: 2 } };
  assert.throws(() => gridQueryCoverage(twoRootPlan, { ...binding, maxJobs: 1 }, []), /frozen non-Nigeria denominator/);
});

test('root address resolves to exact lattice bounds and recursive quadrant bounds', () => {
  const { plan, binding } = fixture();
  const root = resolveGridQueryAddress(plan, { rootCellId: plan.cells[0]!.id, path: '' }, binding);
  assert.deepEqual(root.bounds, [0, 0, 1, 1]);
  const children = subdivideGridQuery(plan, { rootCellId: root.rootCellId, path: '' }, binding);
  assert.deepEqual(children.map(a => resolveGridQueryAddress(plan, a, binding).bounds), [
    [0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1],
  ]);
  assert.equal(resolveGridQueryAddress(plan, children[3]!, binding).cellId, `${root.cellId}:q3`);
  assert.throws(() => resolveGridQueryAddress(plan, { rootCellId: root.rootCellId, path: '4' }, binding), /invalid/);
  assert.throws(() => resolveGridQueryAddress(plan, { rootCellId: root.rootCellId, path: '0000' }, { ...binding, maxDepth: 3 }), /depth/);
  assert.throws(() => subdivideGridQuery(plan, { rootCellId: root.rootCellId, path: '000' }, { ...binding, maxDepth: 3 }), /maximum subdivision/);
});

test('bulk resolver snapshots a large root denominator once and survives caller mutation', () => {
  const { plan } = fixture();
  const cells = Array.from({ length: 1_000 }, (_, index) => ({ ...geographicGridCell(2, index, 180), polygonIndices: [0], state: 'not-started' as const }));
  const bulkPlan = { ...plan, request: { ...plan.request, level: 2 }, grid: { level: 2, stepDegrees: 0.25, columns: 1440, rows: 720 }, cells,
    counts: { ...plan.counts, selectedCells: cells.length } } as CountryGridPlan;
  const binding = { schemaVersion: 1 as const, planHash: sha256(`${canonicalJson(bulkPlan)}\n`), maxDepth: 2, maxJobs: 2_000 };
  const resolver = createGridQueryResolver(bulkPlan, binding);
  const original = structuredClone(cells[0]!);
  cells[0]!.bounds[0] = -999;
  cells[0]!.id = 'mutated';
  assert.deepEqual(resolver.resolve({ rootCellId: original.id, path: '' }).bounds, original.bounds);
  const addresses = cells.slice(1).map(cell => resolver.resolve({ rootCellId: cell.id, path: '' }));
  assert.equal(addresses.length, 999);
  assert.deepEqual(resolver.subdivide({ rootCellId: original.id, path: '' }).map(child => child.path), ['0', '1', '2', '3']);
});

test('missing roots are pending; captured zero is measured query coverage, not empty geography', () => {
  const { plan, binding } = fixture();
  const missing = gridQueryCoverage(plan, binding, []);
  assert.deepEqual(missing.roots, { requested: 1, captured: 0, exception: 0, pending: 1 });
  const zero = gridQueryCoverage(plan, binding, [captured({ rootCellId: plan.cells[0]!.id, path: '' }, 0)]);
  assert.deepEqual(zero.roots, { requested: 1, captured: 1, exception: 0, pending: 0 });
  assert.equal(zero.jobs.zeroSupportedFeatures, 1);
  assert.equal(zero.supportedFeatureRows, 0);
  assert.equal(zero.geometryCoverage, 'not-compiled');
});

test('atomic four-child subdivision conserves a root only after every leaf is captured', () => {
  const { plan, binding } = fixture(), rootCellId = plan.cells[0]!.id, root = { rootCellId, path: '' };
  const children = subdivideGridQuery(plan, root, binding), jobs = [split(root, children), ...children.map(child => captured(child, 2))];
  const result = gridQueryCoverage(plan, binding, jobs);
  assert.deepEqual(result.roots, { requested: 1, captured: 1, exception: 0, pending: 0 });
  assert.deepEqual(result.jobs, { total: 5, subdivided: 1, captured: 4, zeroSupportedFeatures: 0, failed: 0, queued: 0, leased: 0 });
  assert.equal(result.supportedFeatureRows, 8);
  assert.throws(() => gridQueryCoverage(plan, binding, [split(root, children), ...children.slice(0, 3).map(child => captured(child))]), /missing an atomically enqueued child/);
  assert.throws(() => gridQueryCoverage(plan, binding, [split(root, children), captured({ rootCellId, path: '0' }), captured({ rootCellId, path: '1' }), captured({ rootCellId, path: '2' }), captured({ rootCellId, path: '3' }), captured({ rootCellId, path: '00' })]), /orphan/);
});

test('failed leaves are exceptions and queued/leased leaves remain pending', () => {
  const { plan, binding } = fixture(), rootCellId = plan.cells[0]!.id;
  const failed: GridQueryJobView = { address: { rootCellId, path: '' }, status: 'failed', result: null };
  assert.deepEqual(gridQueryCoverage(plan, binding, [failed]).roots, { requested: 1, captured: 0, exception: 1, pending: 0 });
  for (const status of ['queued', 'leased'] as const) {
    const row: GridQueryJobView = { address: { rootCellId, path: '' }, status, result: null };
    assert.deepEqual(gridQueryCoverage(plan, binding, [row]).roots, { requested: 1, captured: 0, exception: 0, pending: 1 });
  }
});

test('foreign, duplicate, malformed, or over-budget jobs fail closed without mutating the plan', () => {
  const { plan, binding } = fixture(), rootCellId = plan.cells[0]!.id, initial = JSON.stringify(plan);
  assert.throws(() => gridQueryCoverage(plan, binding, [captured({ rootCellId: 'foreign', path: '' })]), /outside the bound plan/);
  const row = captured({ rootCellId, path: '' });
  assert.throws(() => gridQueryCoverage(plan, binding, [row, row]), /duplicate grid query/);
  assert.throws(() => gridQueryCoverage(plan, binding, [captured({ rootCellId, path: '' }, -1)]), /out of range/);
  assert.throws(() => gridQueryCoverage(plan, binding, [captured({ rootCellId, path: '' }), captured({ rootCellId, path: '0' })]), /orphan/);
  assert.equal(JSON.stringify(plan), initial);
});
