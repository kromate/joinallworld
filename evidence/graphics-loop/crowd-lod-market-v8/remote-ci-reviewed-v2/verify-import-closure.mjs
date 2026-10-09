import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../');
const closurePath = path.join(HERE, 'production-import-closure.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const closure = JSON.parse(await readFile(closurePath, 'utf8'));
if (closure.schema !== 'allworld-v8-production-import-closure-v1') throw new Error('Unexpected import-closure schema');
function safeTarget(relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Unsafe source path: ${relative}`);
  const target = path.resolve(ROOT, relative), rel = path.relative(ROOT, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Source path escapes checkout: ${relative}`);
  return target;
}

const runtime = new Set();
const typeOnly = new Set();
const edges = [];
const queue = [closure.entry];
function resolveLocal(importer, specifier) {
  const source = specifier.split('?')[0];
  let base;
  if (source.startsWith('/src/')) base = path.resolve(ROOT, source.slice(1));
  else if (source.startsWith('.')) base = path.resolve(path.dirname(path.resolve(ROOT, importer)), source);
  else return null;
  const candidates = [base, ...['.ts', '.tsx', '.js', '.mjs', '.json', '.glb'].map(ext => `${base}${ext}`)];
  return candidates.find(candidate => {
    try { return lstatSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

const declaration = /^\s*(import|export)\b([\s\S]*?);/gm;
const sourceSpecifier = /(?:\bfrom\s*)?['"]([^'"]+)['"]/;
while (queue.length) {
  const relative = queue.pop();
  if (runtime.has(relative)) continue;
  runtime.add(relative);
  const bytes = await readFile(safeTarget(relative));
  if (!/\.(?:ts|tsx|js|mjs|json)$/.test(relative)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(declaration)) {
    const [, kind, body] = match;
    const spec = body.match(sourceSpecifier)?.[1];
    if (!spec) continue;
    const target = resolveLocal(relative, spec);
    if (!target) {
      if (spec.startsWith('.') || spec.startsWith('/src/')) throw new Error(`Unresolved local import ${relative} -> ${spec}`);
      continue;
    }
    const targetRelative = path.relative(ROOT, target).split(path.sep).join('/');
    const isType = /^\s*type\b/.test(body);
    edges.push({ from: relative, specifier: spec, to: targetRelative, kind: isType ? 'type-only' : 'runtime' });
    if (isType) typeOnly.add(targetRelative);
    else queue.push(targetRelative);
  }
}
for (const item of runtime) typeOnly.delete(item);
const sorted = values => [...values].sort();
const expectedRuntime = sorted(closure.runtimeFiles.map(item => item.path));
const expectedTypes = sorted(closure.typeOnlyFiles.map(item => item.path));
if (JSON.stringify(sorted(runtime)) !== JSON.stringify(expectedRuntime)) throw new Error('Runtime import closure differs from its pinned path set');
if (JSON.stringify(sorted(typeOnly)) !== JSON.stringify(expectedTypes)) throw new Error('Direct type-only import set differs from its pinned path set');
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const edgeOrder = (a, b) => textOrder(a.from, b.from) || textOrder(a.specifier, b.specifier);
const actualEdges = [...edges].sort(edgeOrder);
const expectedEdges = [...closure.edges].sort(edgeOrder);
if (JSON.stringify(actualEdges) !== JSON.stringify(expectedEdges)) throw new Error('Resolved local import edges differ from the frozen graph');
const records = [...closure.runtimeFiles, ...closure.typeOnlyFiles];
for (const record of records) {
  const target = safeTarget(record.path);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing/non-file import dependency: ${record.path}`);
  const bytes = await readFile(target);
  if (bytes.byteLength !== record.bytes || sha(bytes) !== record.sha256) throw new Error(`Source import changed: ${record.path}`);
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', record.path], { cwd: ROOT, stdio: 'ignore' });
  } catch { throw new Error(`Import dependency is not tracked by the checked-out package commit: ${record.path}`); }
}
console.log(JSON.stringify({ status: 'complete-import-closure-verified', runtimeFiles: runtime.size,
  typeOnlyFiles: typeOnly.size, paths: records.map(item => item.path), edges: edges.length }, null, 2));
