import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { buildInventory } from './inventory.ts';
import { compareCountryIdentities } from './country-identity.ts';
import type { CountryInspectionReport, CountryInspectionWorkerInput } from './country-types.ts';
import type { SourceRecord } from './types.ts';

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('country inspection value is not JSON');
}
function decode(bytes: Uint8Array, source: SourceRecord): unknown {
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('country inspector source bytes differ from exact pin');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}
function countPositions(value: unknown): number {
  if (!Array.isArray(value)) throw new TypeError('outline coordinates must be arrays');
  if (typeof value[0] === 'number') return 1;
  let result = 0;
  for (const child of value) result += countPositions(child);
  return result;
}
try {
  if (!parentPort) throw new Error('country inspector requires its supervised worker');
  const input = workerData as CountryInspectionWorkerInput;
  const baseline = buildInventory(input.baselinePin.source, decode(new Uint8Array(input.baselineBuffer), input.baselinePin.source));
  if (baseline.sourceUnitCount !== input.baselinePin.sourceFeatureCount) throw new Error('baseline source count differs from pin');
  const sourceDocument = decode(new Uint8Array(input.rawBuffer), input.source);
  const candidate = buildInventory(input.source, sourceDocument);
  // buildInventory has already checked each source geometry, including protected Nigeria.
  const sourceFeatures = (sourceDocument as { features: Array<{ geometry: { coordinates: unknown } }> }).features;
  const sourceCoordinatePositions = sourceFeatures.reduce((sum, feature) => sum + countPositions(feature.geometry.coordinates), 0);
  const identity = compareCountryIdentities(baseline, candidate);
  const nodeById = new Map(candidate.nodes.map(node => [node.id, node]));
  let coordinatePositions = 0, outlineBytes = 0, largestOutlineBytes = 0;
  const oversizedOutlines: CountryInspectionReport['oversizedOutlines'] = [];
  for (const outline of candidate.outlines) {
    const positions = countPositions(outline.geometry.coordinates);
    const bytes = Buffer.byteLength(canonical(outline.geometry));
    coordinatePositions += positions; outlineBytes += bytes; largestOutlineBytes = Math.max(largestOutlineBytes, bytes);
    if (bytes > 512000 || positions > 100000) oversizedOutlines.push({ countryId: outline.nodeId, name: nodeById.get(outline.nodeId)!.name, bytes, positions });
  }
  const exceptions = [...candidate.exceptions,
    'Inspection checks source structure and exact identities; it does not establish polygon topology, spherical validity or real-world boundary correctness.',
    'Source coordinate positions include protected Nigeria; emitted outline positions exclude Nigeria and no replacement geometry is published.',
    'No country geometry or preview manifest is published by inspection.'];
  if (oversizedOutlines.length) exceptions.push(`${oversizedOutlines.length} source outlines exceed the current preview byte or vertex limit; a bounded representation is required before publication.`);
  if (identity.missing.length) exceptions.push(`${identity.missing.length} prior source identities are absent; explicit reviewed migration or coverage exceptions are required before replacement.`);
  const report: CountryInspectionReport = { schemaVersion: 1, inspector: 'country-source-inspector-v1', source: input.source, baselineSource: input.baselinePin.source,
    sourceUnits: candidate.sourceUnitCount, nodes: candidate.nodes.length, outlines: candidate.outlines.length, sourceCoordinatePositions, coordinatePositions,
    outlineBytes, largestOutlineBytes, outlineLimits: { bytes: 512000, positions: 100000 }, oversizedOutlines, identity, exceptions };
  if (Buffer.byteLength(canonical(report)) > 256 * 1024) throw new RangeError('country inspection report exceeds 256 KiB');
  parentPort.postMessage({ ok: true, report });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) });
  process.exitCode = 1;
} finally { parentPort?.close(); }
