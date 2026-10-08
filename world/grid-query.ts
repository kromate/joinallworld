import { ACQUISITION_BUDGET_REASONS } from './acquisition-errors.ts';
import type { CountryGridPlan, CountryGridCell } from './country-grid-types.ts';
import type { Bounds } from './types.ts';
import type { GridQueryAddress, GridQueryBinding, GridQueryCoverage, GridQueryJobView, ResolvedGridQueryAddress } from './grid-query-types.ts';
import { canonicalJson, sha256 } from './pack.ts';

const SHA = /^[a-f0-9]{64}$/;
const exact = (v: Record<string, unknown>, keys: string[], label: string): void => {
  if (Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) throw new TypeError(`${label} has missing or unknown fields`);
};
const object = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${label} must be an object`);
  return v as Record<string, unknown>;
};
const integer = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`${label} is out of range`);
  return v;
};

export function validateGridQueryBinding(value: unknown): GridQueryBinding {
  const v = object(value, 'grid query binding');
  exact(v, ['schemaVersion', 'planHash', 'maxDepth', 'maxJobs'], 'grid query binding');
  if (v.schemaVersion !== 1 || typeof v.planHash !== 'string' || !SHA.test(v.planHash)) throw new TypeError('grid query binding schema or plan hash is invalid');
  return { schemaVersion: 1, planHash: v.planHash, maxDepth: integer(v.maxDepth, 'maxDepth', 0, 8), maxJobs: integer(v.maxJobs, 'maxJobs', 1, 400_000) };
}

function validatePlan(plan: CountryGridPlan, binding: GridQueryBinding): Map<string, CountryGridCell> {
  if (!plan || plan.schemaVersion !== 1 || plan.compilerVersion !== 'country-source-cut-grid-v1'
      || plan.geographicCoverage !== 'source-bound-grid-denominator' || plan.geometryCoverage !== 'not-acquired'
      || !plan.request || !SHA.test(plan.requestHash) || binding.planHash !== sha256(`${canonicalJson(plan)}\n`)
      || plan.request.countryId === 'legacy-ng' || plan.country.id === 'legacy-ng' || plan.country.countryCode === 'NG'
      || plan.country.kind !== 'country' || plan.country.provider !== 'world' || plan.country.outline !== 'available'
      || !Array.isArray(plan.cells) || !plan.counts || !Number.isSafeInteger(plan.counts.selectedCells)
      || plan.cells.length !== plan.counts.selectedCells || plan.cells.length < 1 || binding.maxJobs < plan.cells.length) {
    throw new TypeError('country grid plan does not match the query binding or frozen non-Nigeria denominator');
  }
  const cells = new Map<string, CountryGridCell>();
  const step = 1 / (2 ** plan.grid.level);
  if (plan.grid.level !== plan.request.level || !Number.isFinite(step) || plan.grid.columns !== 360 / step || plan.grid.rows !== 180 / step) throw new TypeError('country grid lattice is invalid');
  for (const cell of plan.cells) {
    if (cell.state !== 'not-started' || cell.level !== plan.grid.level || !Number.isSafeInteger(cell.column) || !Number.isSafeInteger(cell.row)
        || cell.column < 0 || cell.column >= plan.grid.columns || cell.row < 0 || cell.row >= plan.grid.rows
        || cell.id !== `geo-grid-v1:l${cell.level}:x${cell.column}:y${cell.row}`
        || !sameBounds(cell.bounds, [cell.column * step - 180, cell.row * step - 90, (cell.column + 1) * step - 180, (cell.row + 1) * step - 90])
        || cells.has(cell.id)) throw new TypeError('country grid plan contains an invalid or duplicate root cell');
    cells.set(cell.id, cell);
  }
  return cells;
}

function sameBounds(a: unknown, b: Bounds): boolean {
  return Array.isArray(a) && a.length === 4 && a.every((x, i) => typeof x === 'number' && Number.isFinite(x) && x === b[i]);
}
function address(value: unknown): GridQueryAddress {
  const v = object(value, 'grid query address'); exact(v, ['rootCellId', 'path'], 'grid query address');
  if (typeof v.rootCellId !== 'string' || typeof v.path !== 'string' || !/^[0-3]{0,8}$/.test(v.path)) throw new TypeError('grid query address root or path is invalid');
  return { rootCellId: v.rootCellId, path: v.path };
}
function subdivide(bounds: Bounds): Bounds[] {
  const [west, south, east, north] = bounds;
  const midLon = west + (east - west) / 2, midLat = south + (north - south) / 2;
  return [[west, south, midLon, midLat], [midLon, south, east, midLat], [west, midLat, midLon, north], [midLon, midLat, east, north]];
}

function resolveAddress(addressValue: unknown, binding: GridQueryBinding, cells: Map<string, CountryGridCell>): ResolvedGridQueryAddress {
  const a = address(addressValue);
  const root = cells.get(a.rootCellId);
  if (!root || a.path.length > binding.maxDepth) throw new TypeError('grid query address is outside the bound plan/depth');
  let bounds = root.bounds;
  for (const digit of a.path) bounds = subdivide(bounds)[Number(digit)]!;
  return { ...a, cellId: a.path ? `${a.rootCellId}:q${a.path}` : a.rootCellId, depth: a.path.length, bounds };
}
export interface GridQueryResolver {
  resolve(address: unknown): ResolvedGridQueryAddress;
  subdivide(address: unknown): GridQueryAddress[];
}

function resolverFrom(binding: GridQueryBinding, checked: Map<string, CountryGridCell>): GridQueryResolver {
  const cells = new Map<string, CountryGridCell>();
  for (const [id, cell] of checked) cells.set(id, { ...cell, bounds: [...cell.bounds] as Bounds, polygonIndices: [...cell.polygonIndices] });
  const frozenBinding: GridQueryBinding = { ...binding };
  const resolve = (value: unknown): ResolvedGridQueryAddress => resolveAddress(value, frozenBinding, cells);
  const subdivideAddress = (value: unknown): GridQueryAddress[] => {
    const parent = resolve(value);
    if (parent.depth >= frozenBinding.maxDepth) throw new RangeError('grid query maximum subdivision depth reached');
    if (frozenBinding.maxJobs < cells.size + 4) throw new RangeError('grid query job cap cannot admit four atomic children');
    return ['0', '1', '2', '3'].map(digit => ({ rootCellId: parent.rootCellId, path: parent.path + digit }));
  };
  return { resolve, subdivide: subdivideAddress };
}

/** Validate and snapshot the immutable grid binding once for bulk root traversal. */
export function createGridQueryResolver(plan: CountryGridPlan, bindingValue: GridQueryBinding): GridQueryResolver {
  const binding = validateGridQueryBinding(bindingValue), checked = validatePlan(plan, binding);
  return resolverFrom(binding, checked);
}

export function resolveGridQueryAddress(plan: CountryGridPlan, addressValue: unknown, bindingValue: GridQueryBinding): ResolvedGridQueryAddress {
  return createGridQueryResolver(plan, bindingValue).resolve(addressValue);
}

export function subdivideGridQuery(plan: CountryGridPlan, addressValue: unknown, bindingValue: GridQueryBinding): GridQueryAddress[] {
  return createGridQueryResolver(plan, bindingValue).subdivide(addressValue);
}

interface CheckedJob { address: GridQueryAddress; status: GridQueryJobView['status']; result: GridQueryJobView['result'] }
function checkResult(result: unknown, status: GridQueryJobView['status'], label: string): GridQueryJobView['result'] {
  if (status !== 'completed') {
    if (result !== null) throw new TypeError(`${label} non-completed job must not have a result`);
    return null;
  }
  const r = object(result, `${label} result`);
  if (r.status === 'query-captured') {
    exact(r, ['status', 'features', 'requestHash', 'inputSha256', 'inputBytes', 'receiptSha256', 'receiptBytes'], `${label} capture result`);
    integer(r.features, `${label} feature rows`, 0, 5_000_000);
    integer(r.inputBytes, `${label} input bytes`, 1, 32_000_000_000);
    integer(r.receiptBytes, `${label} receipt bytes`, 1, 2_000_000);
    for (const key of ['requestHash', 'inputSha256', 'receiptSha256']) if (typeof r[key] !== 'string' || !SHA.test(r[key] as string)) throw new TypeError(`${label} ${key} is invalid`);
    return r as unknown as GridQueryJobView['result'];
  }
  if (r.status === 'query-subdivided') {
    exact(r, ['status', 'reason', 'children'], `${label} subdivision result`);
    if (typeof r.reason !== 'string' || !ACQUISITION_BUDGET_REASONS.includes(r.reason as typeof ACQUISITION_BUDGET_REASONS[number]) || !Array.isArray(r.children) || r.children.length !== 4) throw new TypeError(`${label} subdivision result is invalid`);
    return r as unknown as GridQueryJobView['result'];
  }
  throw new TypeError(`${label} completed result has an unsupported status`);
}

export function gridQueryCoverage(plan: CountryGridPlan, bindingValue: GridQueryBinding, jobsValue: GridQueryJobView[]): GridQueryCoverage {
  const binding = validateGridQueryBinding(bindingValue), roots = validatePlan(plan, binding);
  const resolver = resolverFrom(binding, roots);
  if (!Array.isArray(jobsValue) || jobsValue.length > binding.maxJobs) throw new RangeError('grid query jobs exceed their bounded list');
  const jobs = new Map<string, CheckedJob>();
  for (const raw of jobsValue) {
    const row = object(raw, 'grid query job'); exact(row, ['address', 'status', 'result'], 'grid query job');
    const a = address(row.address); resolver.resolve(a);
    if (!['queued', 'leased', 'failed', 'completed'].includes(String(row.status))) throw new TypeError('grid query job status is invalid');
    const status = row.status as GridQueryJobView['status'], result = checkResult(row.result, status, a.path || a.rootCellId);
    const key = `${a.rootCellId}\0${a.path}`;
    if (jobs.has(key)) throw new TypeError('duplicate grid query job address');
    jobs.set(key, { address: a, status, result });
  }
  const k = (a: GridQueryAddress) => `${a.rootCellId}\0${a.path}`;
  let subdividedCount = 0, capturedCount = 0, zero = 0, failed = 0, queued = 0, leased = 0, supportedFeatureRows = 0;
  for (const job of jobs.values()) {
    if (job.status === 'failed') failed++;
    else if (job.status === 'queued') queued++;
    else if (job.status === 'leased') leased++;
    else if (job.result?.status === 'query-captured') { capturedCount++; supportedFeatureRows += job.result.features; if (job.result.features === 0) zero++; }
    else if (job.result?.status === 'query-subdivided') {
      subdividedCount++;
      const expected = ['0', '1', '2', '3'].map(digit => ({ rootCellId: job.address.rootCellId, path: job.address.path + digit }));
      if (job.address.path.length >= binding.maxDepth) throw new TypeError('subdivided grid query is already at maximum depth');
      const provided = (job.result.children as GridQueryAddress[]).map(address);
      if (provided.length !== 4 || provided.some((child, i) => child.rootCellId !== expected[i]!.rootCellId || child.path !== expected[i]!.path)) throw new TypeError('subdivision children do not exactly match the atomic quadrant addresses');
      for (const child of expected) if (!jobs.has(k(child))) throw new TypeError('completed subdivision is missing an atomically enqueued child job');
    }
  }
  for (const job of jobs.values()) {
    if (!job.address.path) continue;
    const parent = { rootCellId: job.address.rootCellId, path: job.address.path.slice(0, -1) }, parentJob = jobs.get(k(parent));
    if (!parentJob || parentJob.status !== 'completed' || parentJob.result?.status !== 'query-subdivided') throw new TypeError('orphan grid query child job');
  }
  let rootCaptured = 0, rootException = 0, rootPending = 0;
  for (const cell of roots.values()) {
    const visit = (a: GridQueryAddress): 'captured' | 'exception' | 'pending' => {
      const job = jobs.get(k(a));
      if (!job) return 'pending';
      if (job.status === 'failed') return 'exception';
      if (job.status === 'queued' || job.status === 'leased') return 'pending';
      if (job.result?.status === 'query-captured') return 'captured';
      if (job.result?.status !== 'query-subdivided') throw new TypeError('completed grid query job has no valid terminal result');
      let pending = false, exception = false;
      for (const child of job.result.children as GridQueryAddress[]) {
        const childState = visit(child); pending ||= childState === 'pending'; exception ||= childState === 'exception';
      }
      return exception ? 'exception' : pending ? 'pending' : 'captured';
    };
    const state = visit({ rootCellId: cell.id, path: '' });
    if (state === 'captured') rootCaptured++; else if (state === 'exception') rootException++; else rootPending++;
  }
  return { schemaVersion: 1, planHash: binding.planHash, coverage: 'source-query-only', geometryCoverage: 'not-compiled',
    roots: { requested: roots.size, captured: rootCaptured, exception: rootException, pending: rootPending },
    jobs: { total: jobs.size, subdivided: subdividedCount, captured: capturedCount, zeroSupportedFeatures: zero, failed, queued, leased }, supportedFeatureRows };
}
