import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySnapshot } from './verify-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLOSURE_PATH = 'evidence/graphics-loop/actor-volume-boarding-slice-v7/remote-ci-v1/runtime-closure.json';
const refs = source => {
  const found = [];
  for (const match of source.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) {
    const prefix = source.slice(Math.max(source.lastIndexOf('\n', match.index - 1) + 1, 0), match.index);
    found.push({ value: match[2], kind: /\bimport\s+type\b/.test(prefix) ? 'type' : 'module' });
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1, head = source.slice(lineStart, match.index).trimEnd();
    const typePosition = /\btype\s+[^=]+=$/.test(head) || head.lastIndexOf(':') > head.lastIndexOf('=') || /(?:ReturnType|InstanceType)\s*<\s*typeof\s*$/.test(head) || /\btypeof\s*$/.test(head);
    found.push({ value: match[2], kind: typePosition ? 'type' : 'module' });
  }
  for (const match of source.matchAll(/\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/g)) found.push({ value: match[2], kind: 'asset' });
  return found;
};
export async function verifyImportClosure(expectedSha) {
  const { manifest } = await verifySnapshot(expectedSha);
  const listed = new Set(manifest.files.map(entry => entry.path));
  const closure = JSON.parse(await readFile(path.join(ROOT, CLOSURE_PATH), 'utf8'));
  if (closure.schema !== 'allworld-actor-volume-v7-node-runtime-closure-v1') throw new Error('Unexpected v7 runtime closure schema');
  const allRequired = [...closure.localRuntimeModules, ...closure.typeOnlyResolutions, ...closure.dataInputs, ...closure.packageInputs, closure.entrypoint];
  for (const rel of allRequired) if (!listed.has(rel)) throw new Error(`Runtime closure input is not snapshot-pinned: ${rel}`);
  const runtimeFiles = new Set([...closure.localRuntimeModules, closure.entrypoint]);
  const pinned = new Set([...listed].map(rel => path.resolve(ROOT, rel)));
  const resolutions = [];
  for (const rel of runtimeFiles) {
    const importer = path.resolve(ROOT, rel), source = await readFile(importer, 'utf8');
    for (const { value, kind } of refs(source)) {
      const specifier = value.split('?')[0];
      let target;
      if (specifier.startsWith('/src/')) target = path.resolve(ROOT, specifier.slice(1));
      else if (specifier.startsWith('./') || specifier.startsWith('../')) target = path.resolve(path.dirname(importer), specifier);
      else continue;
      const relative = path.relative(ROOT, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Local import escapes checkout: ${rel} -> ${value}`);
      await readFile(target);
      if (kind !== 'type' && !pinned.has(target)) throw new Error(`Executable local import is not snapshot-pinned: ${rel} -> ${value}`);
      if (kind === 'type' && !pinned.has(target) && !closure.typeOnlyResolutions.includes(relative.split(path.sep).join('/'))) throw new Error(`Type-only import is not declared: ${rel} -> ${value}`);
      resolutions.push({ importer: rel, specifier: value, kind, target: relative.split(path.sep).join('/'), pinned: pinned.has(target) });
    }
  }
  return { manifestSha256: expectedSha, pinnedFiles: manifest.files.length, runtimeFiles: runtimeFiles.size, resolutions };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyImportClosure(process.argv[2]), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
