import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySnapshot } from './verify-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLOSURE_PATH = 'evidence/graphics-loop/actor-volume-boarding-slice-v4/remote-ci-v1/runtime-closure.json';
const localRefs = source => {
  const refs = [];
  for (const match of source.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) {
    const prefix = source.slice(Math.max(source.lastIndexOf('\n', match.index - 1) + 1, 0), match.index);
    refs.push({ value: match[2], kind: /\bimport\s+type\b/.test(prefix) ? 'type' : 'module' });
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) refs.push({ value: match[2], kind: 'module' });
  for (const match of source.matchAll(/\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/g)) refs.push({ value: match[2], kind: 'asset' });
  return refs;
};
export async function verifyImportClosure(expectedSha) {
  const { manifest, sourceHashes } = await verifySnapshot(expectedSha);
  const pinned = new Set(manifest.files.map(entry => path.resolve(ROOT, entry.path)));
  const closure = JSON.parse(await readFile(path.join(ROOT, CLOSURE_PATH), 'utf8'));
  if (closure.schema !== 'allworld-actor-sampler-v4-node-runtime-closure-v1') throw new Error('Unexpected runtime-closure schema');
  const runtime = new Set([...closure.runtimeSourceFiles, closure.entrypoint]);
  const listed = new Set(manifest.files.map(entry => entry.path));
  for (const list of [closure.runtimeSourceFiles, closure.typeOnlyResolutions, closure.testAssets, closure.packageLockFiles, [closure.entrypoint]]) {
    for (const rel of list) if (!listed.has(rel)) throw new Error(`Runtime closure file is not pinned: ${rel}`);
  }
  const resolutions = [];
  for (const rel of runtime) {
    const importer = path.resolve(ROOT, rel), source = await readFile(importer, 'utf8');
    for (const { value, kind } of localRefs(source)) {
      const specifier = value.split('?')[0];
      let target;
      if (specifier.startsWith('/src/')) target = path.resolve(ROOT, specifier.slice(1));
      else if (specifier.startsWith('./') || specifier.startsWith('../')) target = path.resolve(path.dirname(importer), specifier);
      else continue;
      const fromRoot = path.relative(ROOT, target);
      if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error(`Local import escapes checkout: ${rel} -> ${value}`);
      await readFile(target);
      if (kind !== 'type' && !pinned.has(target)) throw new Error(`Runtime import/asset is not source-pinned: ${rel} -> ${value}`);
      resolutions.push({ importer: rel, specifier: value, kind, target: fromRoot.split(path.sep).join('/'), pinned: pinned.has(target) });
    }
  }
  return { manifestSha256: expectedSha, pinnedFiles: manifest.files.length, runtimeFiles: runtime.size, resolutions, sourceHashes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyImportClosure(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
