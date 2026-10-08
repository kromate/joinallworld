/** Independent read-only reconstruction; deliberately imports no compiler, publisher or validators. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = Record<string, any>;
const HASH = /^[a-f0-9]{64}$/;
const PRODUCT = 'natural-earth-selected-places-v1', COMPILER = 'selected-place-compiler-v1';
const MiB = 1024 * 1024;
const started = performance.now();
let peakRssBytes = 0, readBytes = 0;
function live(): void {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  if (peakRssBytes > 512 * MiB) throw new Error('independent settlement verification exceeded 512 MiB RSS');
  if (performance.now() - started >= 120_000) throw new Error('independent settlement verification exceeded 120 seconds');
}
function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): Row {
  insist(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an object');
  return value as Row;
}
function canonical(value: unknown, depth = 0): string {
  insist(depth <= 64, 'JSON exceeds nesting limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { insist(Number.isFinite(value), 'nonfinite JSON number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  const row = object(value);
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key], depth + 1)}`).join(',')}}`;
}
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
function key(value: unknown): string {
  const number = Number(value);
  insist((typeof value === 'number' || typeof value === 'string' && /^[1-9][0-9]*$/.test(value))
    && Number.isSafeInteger(number) && number > 0 && (typeof value !== 'string' || String(number) === value), 'invalid canonical NE_ID');
  return `NE_ID:${number}`;
}
function exact(row: Row, keys: string[]): void {
  insist(same(Object.keys(row).sort(), keys.sort()), 'missing or unknown object fields');
}
const parse = (bytes: Uint8Array): Row => object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
function finiteDocument(value: unknown, depth = 0): void {
  insist(depth <= 64, 'source JSON nesting exceeded');
  if (typeof value === 'number') insist(Number.isFinite(value), 'source JSON contains nonfinite number');
  else if (Array.isArray(value)) for (const item of value) finiteDocument(item, depth + 1);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) finiteDocument(item, depth + 1);
}
async function main(): Promise<void> {
  const manifestHash = process.argv[2];
  insist(process.argv.length === 3 && typeof manifestHash === 'string' && HASH.test(manifestHash), 'usage: verify_settlement_product.ts <manifest-sha256>');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  insist(await realpath(root) === root, 'repository path must be canonical');
  const read = async (relative: string, cap: number): Promise<Buffer> => {
    live();
    insist(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.includes('\0')
      && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'unsafe input path');
    let cursor = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      cursor = path.join(cursor, parts[i]!);
      const info = await lstat(cursor);
      insist(!info.isSymbolicLink() && (i === parts.length - 1 ? info.isFile() : info.isDirectory()), 'unsafe input ancestor or nonregular file');
    }
    const handle = await open(cursor, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      insist(stat.isFile() && stat.size > 0 && stat.size <= cap, 'file exceeds read cap');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) { live(); const next = await handle.read(bytes, offset, bytes.length - offset, offset); insist(next.bytesRead > 0, 'short file read'); offset += next.bytesRead; }
      const probe = await handle.read(Buffer.alloc(1), 0, 1, stat.size);
      const after = await handle.stat();
      insist(probe.bytesRead === 0 && after.size === stat.size && after.mtimeMs === stat.mtimeMs, 'file changed during audit');
      readBytes += bytes.length; insist(readBytes <= 128 * MiB, 'aggregate read bytes exceeded'); live(); return bytes;
    } finally { await handle.close(); }
  };
  const sourcePin = parse(await read('world/settlement-sources.json', 64 * 1024));
  const parentPin = parse(await read('world/settlement-parent.json', 64 * 1024));
  const capture = parse(await read('world/settlement-capture.json', 64 * 1024));
  const admission = parse(await read('world/settlement-admission.json', 128 * 1024));
  exact(sourcePin, ['schemaVersion','source','input','gitBlobSha1']);
  insist(sourcePin.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(sourcePin.gitBlobSha1), 'invalid source pin');
  exact(parentPin, ['manifestHash','directoryRoot','source','input']);
  insist(admission.schemaVersion === 1 && capture.schemaVersion === 1 && capture.provider === 'natural-earth'
    && capture.resolution === '10m' && /^[a-f0-9]{40}$/.test(capture.release)
    && same(admission.source, sourcePin.source) && admission.gitBlobSha1 === sourcePin.gitBlobSha1
    && admission.parentManifestHash === parentPin.manifestHash && capture.release === sourcePin.source.release
    && capture.expectedBytes === sourcePin.source.bytes && capture.expectedGitBlobSha1 === sourcePin.gitBlobSha1
    && capture.license === sourcePin.source.license && capture.attribution === sourcePin.source.attribution,
  'source/parent pins differ from admitted capture evidence');
  const metadataRaw = await read(capture.metadataPath, 64 * 1024), metadata = parse(metadataRaw);
  insist(metadataRaw.length === capture.metadataBytes && sha(metadataRaw) === capture.metadataSha256
    && metadata.path === 'geojson/ne_10m_populated_places.geojson' && metadata.type === 'file'
    && metadata.sha === sourcePin.gitBlobSha1 && metadata.size === sourcePin.source.bytes
    && metadata.download_url === sourcePin.source.url
    && metadata.url === `https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${metadata.path}?ref=${capture.release}`,
  'source metadata does not bind the admitted artifact');
  insist(sourcePin.source.id === `natural-earth-places-10m-${capture.release}`
    && sourcePin.source.url === `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${capture.release}/${metadata.path}`
    && sourcePin.source.license === 'Public-domain', 'source identity differs from admitted artifact');
  const sourceRequestHash = sha(canonical({ release: capture.release, path: metadata.path, blob: sourcePin.gitBlobSha1, expectedBytes: sourcePin.source.bytes }));
  insist(sourcePin.input === `.cache/world-build/settlement-source-cache/${sourceRequestHash}.geojson`, 'source input is outside canonical capture identity');
  const admissionAuditRaw = await read(admission.independentAudit.input, 256 * 1024);
  insist(admissionAuditRaw.length === admission.independentAudit.bytes && sha(admissionAuditRaw) === admission.independentAudit.sha256,
    'admitted independent source audit differs');
  const sourceRaw = await read(sourcePin.input, 32 * MiB);
  insist(sourceRaw.length === sourcePin.source.bytes && sha(sourceRaw) === sourcePin.source.sha256, 'place raw SHA/size differs from pin');
  insist(createHash('sha1').update(`blob ${sourceRaw.length}\0`).update(sourceRaw).digest('hex') === sourcePin.gitBlobSha1, 'place Git blob differs from pin');
  const source = parse(sourceRaw); finiteDocument(source); live();
  insist(source.type === 'FeatureCollection' && Array.isArray(source.features) && source.features.length <= 100_000, 'invalid source FeatureCollection');
  const parentRaw = await read(parentPin.input, 16 * MiB);
  insist(parentRaw.length === parentPin.source.bytes && sha(parentRaw) === parentPin.source.sha256, 'parent raw SHA/size differs from pin');
  const parentBlob = createHash('sha1').update(`blob ${parentRaw.length}\0`).update(parentRaw).digest('hex');
  const parentRequestHash = sha(canonical({ release: parentPin.source.release, path: 'geojson/ne_10m_admin_0_countries.geojson', blob: parentBlob, expectedBytes: parentRaw.length }));
  insist(parentPin.input === `.cache/world-build/country-source-cache/${parentRequestHash}.geojson`
    && /^[a-f0-9]{40}$/.test(parentPin.source.release)
    && parentPin.source.id === `natural-earth-admin0-10m-${parentPin.source.release}`
    && parentPin.source.url === `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${parentPin.source.release}/geojson/ne_10m_admin_0_countries.geojson`
    && parentPin.source.license === 'Public-domain', 'parent input/identity differs from canonical artifact cache');
  const parent = parse(parentRaw); finiteDocument(parent); live();
  insist(parent.type === 'FeatureCollection' && Array.isArray(parent.features) && parent.features.length <= 1024, 'invalid parent FeatureCollection');
  insist(parentPin.directoryRoot === '.cache/world-build/output/country-inventory' && HASH.test(parentPin.manifestHash), 'invalid parent directory pin');
  const hashed = async (base: string, relative: string, folder: string, cap: number): Promise<{ bytes: Buffer; value: Row }> => {
    insist(new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(relative), 'invalid content-addressed path');
    const bytes = await read(`${base}/${relative}`, cap);
    insist(sha(bytes) === path.basename(relative, '.json'), 'content-addressed asset hash differs');
    return { bytes, value: parse(bytes) };
  };
  const parentManifest = (await hashed(parentPin.directoryRoot, `manifests/${parentPin.manifestHash}.json`, 'manifests', MiB)).value;
  insist(same(parentManifest.source, parentPin.source), 'parent manifest uses different source');
  const identity = (await hashed(parentPin.directoryRoot, parentManifest.identityPath, 'identity', 256_000)).value;
  const identities = new Map<string, Row>();
  for (const item of [...identity.retained, ...identity.added]) {
    insist(typeof item.featureKey === 'string' && !identities.has(item.featureKey), 'duplicate parent identity key'); identities.set(item.featureKey, item);
  }
  insist(identities.size === parent.features.length && identity.candidateUnits === parent.features.length && identity.missing.length === 0, 'identity sidecar does not conserve parent');
  const nodes = new Map<string, Row>(), byKey = new Map<string, Row>(), visited = new Set<string>();
  const pending = [{ relative: parentManifest.rootNodePath, id: 'world:earth', parentId: null as string | null, parentKind: null as string | null, name: 'World' }];
  for (let i = 0; i < pending.length; i++) {
    live(); insist(i < 4096, 'parent traversal exceeds entry cap');
    const expected = pending[i]!;
    insist(!visited.has(expected.relative) && !nodes.has(expected.id), 'parent hierarchy has duplicate nodes'); visited.add(expected.relative);
    const index = (await hashed(parentPin.directoryRoot, expected.relative, 'nodes', 128_000)).value, node = object(index.node);
    insist(index.schemaVersion === 1 && node.id === expected.id && node.parentId === expected.parentId && node.name === expected.name, 'parent hierarchy id/name/parent link mismatch');
    insist((expected.parentKind === null && node.kind === 'world') || (expected.parentKind === 'world' && node.kind === 'continent') || (expected.parentKind === 'continent' && node.kind === 'country'), 'parent hierarchy kind mismatch');
    insist(Array.isArray(index.children), 'invalid parent children'); nodes.set(node.id, node);
    if (node.kind === 'country') {
      insist(index.children.length === 0 && Array.isArray(node.sourceFeatureIds) && node.sourceFeatureIds.length === 1, 'country hierarchy source binding invalid');
      const prefix = `${parentPin.source.id}:`, reference = node.sourceFeatureIds[0];
      insist(typeof reference === 'string' && reference.startsWith(prefix), 'country reference outside parent source');
      const featureKey = reference.slice(prefix.length), row = identities.get(featureKey);
      insist(row && row.countryId === node.id && ('candidateName' in row ? row.candidateName : row.name) === node.name && !byKey.has(featureKey), 'country identity does not match sidecar');
      byKey.set(featureKey, node);
      if (node.id === 'legacy-ng' || node.countryCode === 'NG' || node.provider === 'legacy-ng') insist(node.id === 'legacy-ng' && node.countryCode === 'NG' && node.provider === 'legacy-ng' && node.outline === 'missing' && index.outlineIndexPath === null, 'Nigeria parent protection changed');
      else insist(node.provider === 'world', 'unexpected country provider');
    } else insist(node.sourceFeatureIds.length === 0 && index.outlineIndexPath === null, 'noncountry owns source geometry');
    for (const child of index.children) pending.push({ relative: child.path, id: child.id, parentId: node.id, parentKind: node.kind, name: child.name });
  }
  insist(nodes.size === parentManifest.nodeCount && byKey.size === parent.features.length, 'parent directory coverage changed');
  const candidates = new Map<string, Set<string>>(), parentKeys = new Set<string>();
  for (const feature of parent.features) {
    const featureKey = key(feature.properties.NE_ID), node = byKey.get(featureKey), code = feature.properties.ADM0_A3;
    insist(node && !parentKeys.has(featureKey) && typeof code === 'string', 'parent raw feature is not bound once'); parentKeys.add(featureKey);
    const ids = candidates.get(code) ?? new Set<string>(); ids.add(node.id); candidates.set(code, ids);
  }
  insist(candidates.get('NGA')?.size === 1 && candidates.get('NGA')?.has('legacy-ng'), 'literal NGA protection is not unique');
  const outputRoot = '.cache/world-build/output/selected-places';
  const loadedManifest = await hashed(outputRoot, `manifests/${manifestHash}.json`, 'manifests', 256 * 1024), manifest = loadedManifest.value;
  insist(loadedManifest.bytes.toString('utf8') === `${canonical(manifest)}\n`, 'manifest is not canonical LF JSON');
  exact(manifest, ['schemaVersion','product','compiler','source','parent','joinPolicy','keyField','countryField','representation','validation','sourceUnits','validPoints','linked','protected','unlinked','ambiguous','invalidRows','emittedUnits','exceptionUnits','inspection','countries','limitations']);
  insist(manifest.schemaVersion === 1 && manifest.product === PRODUCT && manifest.compiler === COMPILER && manifest.joinPolicy === 'literal-ADM0_A3-v1' && manifest.keyField === 'NE_ID' && manifest.countryField === 'ADM0_A3', 'unsupported product/join schema');
  insist(manifest.representation === 'selected-source-point-geometry' && manifest.validation === 'source-bound-structural-with-explicit-exceptions', 'representation scope changed');
  insist(same(manifest.source, sourcePin.source) && same(manifest.parent, { manifestHash: parentPin.manifestHash, source: parentPin.source }), 'manifest source/parent binding differs');
  const assetPaths = new Set<string>(), pointRows = new Map<string, Row>(), countryRefs = new Map<string, Row>();
  let logicalBytes = loadedManifest.bytes.length;
  const asset = async (ref: Row, folder: string, cap: number): Promise<Row> => {
    exact(ref, ['path','sha256','bytes']);
    insist(!assetPaths.has(ref.path) && HASH.test(ref.sha256) && path.basename(ref.path, '.json') === ref.sha256 && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= cap, 'invalid/repeated asset ref');
    assetPaths.add(ref.path); const loaded = await hashed(outputRoot, ref.path, folder, cap);
    insist(loaded.bytes.length === ref.bytes && loaded.bytes.toString('utf8') === `${canonical(loaded.value)}\n`, 'asset size/canonical bytes differ'); logicalBytes += loaded.bytes.length;
    insist(logicalBytes <= 16 * MiB, 'logical product exceeds 16 MiB'); return loaded.value;
  };
  const report = await asset(manifest.inspection, 'reports', 3 * MiB);
  insist(same(report.source, sourcePin.source) && same(report.parent, manifest.parent) && report.schemaVersion === 1 && report.product === PRODUCT && report.compiler === COMPILER && report.joinPolicy === manifest.joinPolicy && report.keyField === 'NE_ID' && report.countryField === 'ADM0_A3', 'inspection binding differs');
  exact(report, ['schemaVersion','product','compiler','source','parent','joinPolicy','keyField','countryField','sourceUnits','validPoints','linked','protected','unlinked','ambiguous','invalidRows','emittedUnits','countries','missingCountries','rows','limitations']);
  insist(Array.isArray(manifest.countries) && manifest.countries.length === byKey.size, 'country denominator differs');
  let previousCountry = '';
  for (const ref of manifest.countries) {
    exact(ref, ['countryId','status','sourceUnits','emittedUnits','points']);
    insist(typeof ref.countryId === 'string' && ref.countryId > previousCountry && nodes.get(ref.countryId)?.kind === 'country', 'invalid/unsorted country reference'); previousCountry = ref.countryId; countryRefs.set(ref.countryId, ref);
    if (ref.countryId === 'legacy-ng') insist(ref.status === 'protected' && ref.points === null && ref.emittedUnits === 0, 'Nigeria has a generated point asset');
    else if (ref.points === null) insist(ref.status === 'missing' && ref.emittedUnits === 0, 'missing country emits points');
    else {
      insist(ref.status === 'available', 'point asset belongs to unavailable country');
      const country = await asset(ref.points, 'points', 512_000);
      exact(country, ['schemaVersion','product','countryId','sourceSha256','parentManifestHash','sourceUnits','emittedUnits','rows']);
      insist(country.schemaVersion === 1 && country.product === PRODUCT && country.countryId === ref.countryId && country.sourceSha256 === sourcePin.source.sha256 && country.parentManifestHash === parentPin.manifestHash && country.sourceUnits === ref.sourceUnits && country.emittedUnits === ref.emittedUnits && Array.isArray(country.rows) && country.rows.length === ref.emittedUnits, 'country point envelope differs');
      let previousKey = '';
      for (const row of country.rows) { exact(row, ['sourceOrdinal','sourceKey','id','name','nameAscii','sourceClass','scaleRank','coordinates']); insist(typeof row.sourceKey === 'string' && row.sourceKey > previousKey && !pointRows.has(row.sourceKey), 'duplicate/unsorted point key'); previousKey = row.sourceKey; pointRows.set(row.sourceKey, { countryId: ref.countryId, row }); }
    }
  }
  const audits = new Map<string, Row>(), ordinals = new Set<number>(); let previousKey = '';
  insist(Array.isArray(report.rows) && report.rows.length === source.features.length, 'source audit row count differs');
  for (const row of report.rows) {
    exact(row, ['sourceOrdinal','sourceKey','id','featureSha256','adm0Code','countryId','joinStatus','pointIssue','labelIssue','emitted']);
    insist(typeof row.sourceKey === 'string' && row.sourceKey > previousKey && !audits.has(row.sourceKey) && Number.isSafeInteger(row.sourceOrdinal) && row.sourceOrdinal >= 0 && row.sourceOrdinal < source.features.length && !ordinals.has(row.sourceOrdinal), 'audit keys/ordinals not unique/sorted'); previousKey = row.sourceKey; audits.set(row.sourceKey, row); ordinals.add(row.sourceOrdinal);
  }
  const tallies = { sourceUnits: source.features.length, validPoints: 0, linked: 0, protected: 0, unlinked: 0, ambiguous: 0, invalidRows: 0, emittedUnits: 0 };
  const countryTallies = new Map<string, { countryId: string; sourceUnits: number; emittedUnits: number }>([...countryRefs.keys()].map(countryId => [countryId, { countryId, sourceUnits: 0, emittedUnits: 0 }]));
  const validText = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
  for (let ordinal = 0; ordinal < source.features.length; ordinal++) {
    live(); const feature = source.features[ordinal], properties = object(feature.properties), sourceKey = key(properties.NE_ID), row = audits.get(sourceKey);
    insist(feature.type === 'Feature' && row, 'missing source feature audit');
    const rawCode = properties.ADM0_A3, code = typeof rawCode === 'string' && Buffer.byteLength(rawCode) <= 64 && !/[\u0000-\u001f\u007f]/u.test(rawCode) ? rawCode : null;
    const ids = code === null ? [] : [...(candidates.get(code) ?? [])];
    const joinStatus = ids.length === 1 ? (ids[0] === 'legacy-ng' ? 'protected' : 'linked') : ids.length > 1 ? 'ambiguous' : 'unlinked';
    const countryId = ids.length === 1 ? ids[0]! : null;
    const coordinates = feature.geometry?.coordinates;
    const validPoint = feature.geometry?.type === 'Point' && Array.isArray(coordinates) && coordinates.length === 2 && coordinates.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)) && Math.abs(coordinates[0]) <= 180 && Math.abs(coordinates[1]) <= 90;
    const validLabel = [properties.NAME, properties.NAMEASCII, properties.FEATURECLA].every(validText) && Number.isInteger(properties.SCALERANK) && properties.SCALERANK >= 0 && properties.SCALERANK <= 10;
    const emitted = joinStatus === 'linked' && validPoint && validLabel, id = `place:natural-earth:${encodeURIComponent(sourceKey)}`;
    insist(row.sourceOrdinal === ordinal && row.sourceKey === sourceKey && row.id === id && row.featureSha256 === sha(canonical(feature)) && row.adm0Code === code && row.countryId === countryId && row.joinStatus === joinStatus && row.emitted === emitted, 'source identity/hash/country assignment differs');
    insist((row.pointIssue === null) === validPoint && (row.labelIssue === null) === validLabel, 'source issue classification differs');
    for (const issue of [row.pointIssue, row.labelIssue]) insist(issue === null || typeof issue === 'string' && issue.length > 0 && Buffer.byteLength(issue) <= 512, 'invalid source issue text');
    tallies[joinStatus]++; if (validPoint) tallies.validPoints++; if (!validPoint || !validLabel) tallies.invalidRows++;
    if (countryId !== null) countryTallies.get(countryId)!.sourceUnits++;
    if (emitted) {
      tallies.emittedUnits++; countryTallies.get(countryId!)!.emittedUnits++;
      const actual = pointRows.get(sourceKey), expected = { sourceOrdinal: ordinal, sourceKey, id, name: properties.NAME, nameAscii: properties.NAMEASCII, sourceClass: properties.FEATURECLA, scaleRank: properties.SCALERANK, coordinates };
      insist(actual?.countryId === countryId && same(actual?.row, expected), 'published labels/coordinates differ from original source');
    } else insist(!pointRows.has(sourceKey), 'exception/protected source row emits coordinates');
  }
  insist(pointRows.size === tallies.emittedUnits, 'published point membership differs');
  for (const [name, total] of Object.entries(tallies)) insist(manifest[name] === total && report[name] === total, `summary ${name} differs from independent reconstruction`);
  insist(admission.features === tallies.sourceUnits && admission.validPoints === tallies.validPoints
    && admission.literalKeyField === 'NE_ID' && admission.literalCountryCodeField === 'ADM0_A3'
    && admission.countryJoinCounts.linked === tallies.linked && admission.countryJoinCounts.protected === tallies.protected
    && admission.countryJoinCounts.unlinked === tallies.unlinked && tallies.ambiguous === 0,
  'independent reconstruction differs from the admitted source census');
  insist(manifest.exceptionUnits === tallies.sourceUnits - tallies.emittedUnits, 'exception total differs');
  const expectedCountries = [...countryTallies.values()].sort((a, b) => a.countryId < b.countryId ? -1 : 1);
  insist(same(report.countries, expectedCountries), 'inspection country rollups differ');
  for (const expected of expectedCountries) { const actual = countryRefs.get(expected.countryId)!; insist(actual.sourceUnits === expected.sourceUnits && actual.emittedUnits === expected.emittedUnits, 'manifest country totals differ'); }
  insist(same(report.missingCountries, expectedCountries.filter(row => row.countryId !== 'legacy-ng' && row.emittedUnits === 0).map(row => row.countryId)), 'missing countries differ');
  insist(same(manifest.limitations, report.limitations) && Array.isArray(manifest.limitations) && manifest.limitations.length > 0 && manifest.limitations.length <= 16 && manifest.limitations.every((item: unknown) => typeof item === 'string' && item.length > 0 && Buffer.byteLength(item) <= 2048), 'scope limitations differ or exceed bounds');
  live();
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, manifestHash, ...tallies, countries: countryRefs.size, parentNodes: nodes.size, assets: assetPaths.size + 1, bytes: logicalBytes, elapsedMs: Math.round(performance.now() - started), peakRssBytes, networkBytes: 0, scope: 'Independent exact source/parent/point/label/accounting reconstruction; no building, admin1 containment, navigation or playability claim.' })}\n`);
}
main().catch(error => { process.stderr.write(`${String(error instanceof Error ? error.message : error).slice(0, 2000)}\n`); process.exitCode = 1; });
