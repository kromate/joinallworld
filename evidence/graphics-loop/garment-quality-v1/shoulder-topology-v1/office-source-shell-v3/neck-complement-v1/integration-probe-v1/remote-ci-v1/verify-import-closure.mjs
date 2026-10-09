import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySnapshot } from './verify-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../../..');
const extensions = new Set(['.ts', '.mts', '.js', '.mjs', '.html']);
const localSpecifiers = (source, importer) => {
  const found = [];
  for (const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*)(['"])([^'"]+)\1/g)) found.push({ value: match[2], kind: 'module' });
  for (const match of source.matchAll(/\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/g)) found.push({ value: match[2], kind: 'asset' });
  if (path.extname(importer) === '.html') for (const match of source.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/g)) found.push({ value: match[2], kind: 'html' });
  return found;
};

export async function verifyImportClosure(expectedManifestSha) {
  const { manifest, sourceHashes } = await verifySnapshot(expectedManifestSha);
  const pinned = new Set(manifest.files.map(entry => path.resolve(ROOT, entry.path)));
  const resolutions = [];
  for (const entry of manifest.files) {
    const importer = path.resolve(ROOT, entry.path);
    if (!extensions.has(path.extname(importer))) continue;
    const source = await readFile(importer, 'utf8');
    for (const { value: raw, kind } of localSpecifiers(source, importer)) {
      const specifier = raw.split('?')[0];
      let target;
      if (specifier.startsWith('/src/')) target = path.resolve(ROOT, specifier.slice(1));
      else if (specifier.startsWith('./') || specifier.startsWith('../')) target = path.resolve(path.dirname(importer), specifier);
      else continue;
      const relative = path.relative(ROOT, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Local import escapes checkout: ${entry.path} -> ${raw}`);
      await readFile(target);
      const auditLocal = entry.path.startsWith('evidence/graphics-loop/garment-quality-v1/shoulder-topology-v1/office-source-shell-v3/neck-complement-v1/integration-probe-v1/');
      const requiresPin = kind !== 'module' || specifier.startsWith('/src/') || auditLocal;
      if (requiresPin && !pinned.has(target)) throw new Error(`Local input is not pinned: ${entry.path} -> ${raw} (${relative})`);
      resolutions.push({ importer: entry.path, specifier: raw, target: relative.split(path.sep).join('/'), pinned: pinned.has(target) });
    }
  }
  return { manifestSha256: expectedManifestSha, pinnedFiles: manifest.files.length, sourceHashes, localResolutions: resolutions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyImportClosure(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
