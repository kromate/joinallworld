import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALLOWED_ROOT } from './pipeline.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { validateCountryDirectoryManifest } from './preview/country-directory-view.ts';
import { readCountryDirectory } from './country-directory-reader.ts';
import { publishCountryGrid } from './country-grid-publish.ts';
import { validateAcquisitionRequest } from './acquire.ts';
import { createGridQueryResolver, validateGridQueryBinding } from './grid-query.ts';
import type { CountryGridPlan } from './country-grid-types.ts';
import type { AcquisitionRequest, WorldCampaign } from './production-types.ts';
import type { GridQueryAddress, GridQueryBinding, GridQueryCampaign, GridQueryUnit } from './grid-query-types.ts';
import type { GridQueryResolver } from './grid-query.ts';

const SHA = /^[a-f0-9]{64}$/;
const MAX_PLAN_BYTES = 16_000_000;
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite grid query plan value'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new TypeError('grid query plan is not JSON data');
}
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) throw new TypeError(`${label} has missing or unknown fields`);
}
function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
async function noLinks(target: string): Promise<void> {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current);
    const final = current === resolved;
    if (info.isSymbolicLink() || (final ? !info.isFile() : !info.isDirectory())) throw new Error('grid query path has a symlink or non-directory ancestor');
  }
}
function parseCanonical(bytes: Uint8Array, label: string, newline = true): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (text !== `${canonical(value)}${newline ? '\n' : ''}`) throw new Error(`${label} is not canonical JSON`);
  return value;
}

/** Load only an already completed, hash-addressed country-grid product. This never creates a plan. */
export async function loadVerifiedGridQueryPlan(planPath: string, planHash: string, directoryManifestPath: string): Promise<CountryGridPlan> {
  if (!SHA.test(planHash) || !path.isAbsolute(planPath) || path.resolve(planPath) !== planPath || !path.isAbsolute(directoryManifestPath) || path.resolve(directoryManifestPath) !== directoryManifestPath) throw new TypeError('grid query paths and plan hash must be canonical');
  const suffix = new RegExp(`^(.*)${path.sep}country-grids${path.sep}([a-z0-9][a-z0-9._-]{0,47})${path.sep}plans${path.sep}(${SHA.source.slice(1, -1)})\\.json$`);
  const pathMatch = suffix.exec(planPath);
  if (!pathMatch || pathMatch[3] !== planHash || !pathMatch[1]) throw new TypeError('grid query plan path must be a hash-addressed country-grid plan');
  const allowedRoot = pathMatch[1]!;
  const productionRoot = path.resolve(ALLOWED_ROOT);
  const tempRoot = await realpath(tmpdir());
  if (allowedRoot !== productionRoot && (!inside(tempRoot, allowedRoot) || allowedRoot === tempRoot)) throw new Error('grid query product must be under production world-build or an isolated temporary root');
  if (await realpath(allowedRoot) !== allowedRoot) throw new Error('grid query allowed root is not canonical');
  await noLinks(planPath);
  const planBytes = await readBoundedLocalFile(planPath, MAX_PLAN_BYTES);
  if (sha(planBytes) !== planHash) throw new Error('country-grid plan hash does not match its path binding');
  const plan = parseCanonical(planBytes, 'country-grid plan') as CountryGridPlan;
  const request = object(plan.request, 'country-grid request');
  const id = request.id;
  if (typeof id !== 'string' || id !== pathMatch[2] || !/^[a-z0-9][a-z0-9._-]{0,47}$/.test(id) || !SHA.test(String(request.directoryManifestHash)) || plan.requestHash !== sha(canonical(plan.request))) throw new Error('country-grid plan request identity is invalid');
  const expectedPlanPath = path.join(allowedRoot, 'country-grids', id, 'plans', `${planHash}.json`);
  if (planPath !== expectedPlanPath) throw new Error('country-grid plan path is outside its canonical request namespace');
  const expectedDirectoryRoot = path.join(allowedRoot, 'output', 'country-inventory');
  const expectedManifestPath = path.join(expectedDirectoryRoot, 'manifests', `${String(request.directoryManifestHash)}.json`);
  if (directoryManifestPath !== expectedManifestPath) throw new Error('country directory manifest path does not match the grid plan pin');
  await noLinks(directoryManifestPath);
  const directory = await readCountryDirectory(expectedDirectoryRoot, String(request.directoryManifestHash));
  if (directoryManifestPath !== path.join(expectedDirectoryRoot, 'manifests', `${directory.manifestHash}.json`)) throw new Error('country directory manifest hash mismatch');
  const manifest = validateCountryDirectoryManifest(parseCanonical(await readBoundedLocalFile(directoryManifestPath, 1_000_000), 'country directory manifest', false));
  if (canonical(manifest.source) !== canonical(plan.source) || !directory.nodes.some(node => node.id === plan.country.id && canonical(node) === canonical(plan.country))) throw new Error('grid plan country/source differs from the verified country directory');
  const outputRoot = path.join(allowedRoot, 'country-grids', id);
  const completionPath = path.join(outputRoot, 'completions', `${plan.requestHash}.json`);
  await noLinks(completionPath);
  const completionBytes = await readBoundedLocalFile(completionPath, 16_000);
  const completion = object(parseCanonical(completionBytes, 'country-grid completion'), 'country-grid completion');
  exact(completion, ['schemaVersion', 'requestHash', 'planHash', 'planPath', 'bytes'], 'country-grid completion');
  if (completion.schemaVersion !== 1 || completion.requestHash !== plan.requestHash || completion.planHash !== planHash || completion.planPath !== `plans/${planHash}.json` || completion.bytes !== planBytes.byteLength) throw new Error('country-grid completion does not bind the requested immutable plan');
  const published = await publishCountryGrid(plan.request, { allowedRoot, directoryRoot: expectedDirectoryRoot, outputRoot, durationMs: 60_000, memoryMb: 512 });
  if (!published.cacheHit || published.planHash !== planHash || published.bytes !== planBytes.byteLength || published.completion.sha256 !== sha(completionBytes) || canonical(published.plan) !== canonical(plan)) throw new Error('country-grid cache verification did not reproduce the exact completed plan');
  return plan;
}

function safeId(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,47}$/.test(value)) throw new TypeError(`${label} must be a safe lowercase identifier`);
}
export function createGridQueryCampaign(plan: CountryGridPlan, options: { id: string; planHash: string; maxDepth: number; maxJobs: number; release: string; layers: AcquisitionRequest['layers']; requestLimits: AcquisitionRequest['limits']; limits: WorldCampaign['limits'] }): GridQueryCampaign {
  safeId(options.id, 'campaign id');
  if (!SHA.test(options.planHash) || sha(`${canonical(plan)}\n`) !== options.planHash) throw new Error('campaign plan hash does not match canonical country-grid plan bytes');
  const binding = validateGridQueryBinding({ schemaVersion: 1, planHash: options.planHash, maxDepth: options.maxDepth, maxJobs: options.maxJobs });
  const resolver = createGridQueryResolver(plan, binding);
  const units: GridQueryUnit[] = plan.cells.map((cell, priority) => {
    const address: GridQueryAddress = { rootCellId: cell.id, path: '' };
    const resolved = resolver.resolve(address);
    const unitId = `grid-query:${cell.id}`;
    const request = validateAcquisitionRequest({ schemaVersion: 1, id: unitId, inventoryUnitId: plan.country.id,
      provider: 'overture', release: options.release, layers: options.layers,
      region: { id: resolved.cellId, parentId: plan.country.id, name: `${plan.country.name} source query cell ${cell.id}`, kind: 'cell', countryCode: plan.country.countryCode, timezone: null, bounds: resolved.bounds },
      limits: options.requestLimits });
    return { id: unitId, inventoryUnitId: plan.country.id, priority, kind: 'grid-query', query: address, request };
  });
  if (options.maxJobs < units.length) throw new RangeError('grid query maxJobs must admit every selected root cell');
  const campaignLimits = object(options.limits, 'campaign limits');
  const limitKeys = ['durationMs', 'jobDurationMs', 'networkBytes', 'inputBytes', 'outputBytes', 'diskBytes', 'memoryMb', 'maxAttempts'];
  exact(campaignLimits, limitKeys, 'campaign limits');
  for (const key of limitKeys) if (!Number.isSafeInteger(campaignLimits[key]) || Number(campaignLimits[key]) < 1) throw new RangeError(`campaign limit ${key} must be a positive safe integer`);
  return { schemaVersion: 2, id: options.id, inventoryHash: plan.request.directoryManifestHash, inventoryKind: 'country-directory', gridQuery: binding, units, limits: structuredClone(campaignLimits) as WorldCampaign['limits'] };
}

export function makeGridQueryUnit(plan: CountryGridPlan, address: GridQueryAddress, bindingValue: GridQueryBinding, rootTemplate: GridQueryUnit, resolver?: GridQueryResolver): GridQueryUnit {
  const binding = validateGridQueryBinding(bindingValue);
  const queryResolver = resolver ?? createGridQueryResolver(plan, binding);
  if (rootTemplate.kind !== 'grid-query' || rootTemplate.query.path !== '' || rootTemplate.query.rootCellId !== address.rootCellId || rootTemplate.inventoryUnitId !== plan.country.id || rootTemplate.request.inventoryUnitId !== plan.country.id || rootTemplate.request.region.countryCode === 'NG') throw new TypeError('grid query template is not the matching non-Nigeria root request');
  const rootResolved = queryResolver.resolve(rootTemplate.query);
  const expectedName = `${plan.country.name} source query cell ${rootResolved.cellId}`;
  if (rootTemplate.id !== `grid-query:${rootResolved.cellId}` || rootTemplate.request.id !== rootTemplate.id || rootTemplate.request.region.id !== rootResolved.cellId || rootTemplate.request.region.parentId !== plan.country.id || rootTemplate.request.region.kind !== 'cell' || rootTemplate.request.region.countryCode !== plan.country.countryCode || rootTemplate.request.region.timezone !== null || rootTemplate.request.region.name !== expectedName || canonical(rootTemplate.request.region.bounds) !== canonical(rootResolved.bounds) || !Number.isSafeInteger(rootTemplate.priority) || rootTemplate.priority < 0) throw new TypeError('grid query root template is not bound to its exact root cell');
  const resolved = queryResolver.resolve(address);
  const unitId = `grid-query:${resolved.cellId}`;
  const request = validateAcquisitionRequest({ ...rootTemplate.request, id: unitId,
    region: { ...rootTemplate.request.region, id: resolved.cellId, bounds: resolved.bounds, name: `${plan.country.name} source query cell ${resolved.cellId}` } });
  return { id: unitId, inventoryUnitId: rootTemplate.inventoryUnitId, priority: rootTemplate.priority, kind: 'grid-query', query: { rootCellId: address.rootCellId, path: address.path }, request };
}
