// Observe the ordinary production Vite build and write a separate /tmp report.
// Module renderedLength/originalLength values describe Rollup's pre-minifier
// contribution; they are not compressed-byte attribution and must not be summed
// as if they measured the final minified chunks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3) {
  throw new Error('Usage: node scripts/living-world-attribution.mjs /tmp/report.json');
}

const reportPath = resolve(process.argv[2]);
const tmpRoot = resolve('/tmp');
const reportRelative = relative(tmpRoot, reportPath);
if (!reportPath.startsWith(`${tmpRoot}${sep}`) || reportRelative === '..' || reportRelative.startsWith(`..${sep}`) || isAbsolute(reportRelative)) {
  throw new Error('The report path must be a file inside /tmp.');
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const dirty = git(['status', '--porcelain', '--untracked-files=all']);
if (dirty) throw new Error('Refusing to build: the checkout has tracked or untracked changes.');
const sha = git(['rev-parse', 'HEAD']);

function safeId(value) {
  if (typeof value !== 'string') return value ?? null;
  if (value.startsWith('\0')) return `virtual:${safeId(value.slice(1))}`;
  if (value.startsWith('file://')) {
    try { value = fileURLToPath(value); } catch { return 'external:file-url'; }
  }
  const queryAt = value.indexOf('?');
  const id = queryAt < 0 ? value : value.slice(0, queryAt);
  const suffix = queryAt < 0 ? '' : value.slice(queryAt);
  if (!isAbsolute(id)) return `${id.replaceAll('\\', '/')}${suffix}`;
  const rel = relative(repoRoot, id);
  if (rel === '') return `.${suffix}`;
  if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return `${rel.split(sep).join('/')}${suffix}`;
  }
  const normalized = id.replaceAll('\\', '/');
  const nodeModules = normalized.lastIndexOf('/node_modules/');
  if (nodeModules >= 0) return `node_modules/${normalized.slice(nodeModules + '/node_modules/'.length)}${suffix}`;
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `external:${basename(normalized)}:${hash}${suffix}`;
}

const { build } = await import('vite');
await build({
  plugins: [{
    name: 'living-world:observe-output',
    enforce: 'post',
    writeBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((chunk) => ({
          file: chunk.fileName,
          rawBytes: Buffer.byteLength(chunk.code, 'utf8'),
          rawBytesMeaning: 'Final emitted chunk bytes after minification, before compression.',
          entry: chunk.isEntry,
          dynamicEntry: chunk.isDynamicEntry,
          facadeModuleId: safeId(chunk.facadeModuleId),
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          importedCss: [...(chunk.viteMetadata?.importedCss ?? [])].sort(),
          modules: Object.entries(chunk.modules)
            .map(([id, rendered]) => {
              const info = this.getModuleInfo(id);
              return {
                id: safeId(id),
                renderedLength: rendered.renderedLength,
                originalLength: rendered.originalLength,
                lengthMeaning: 'Rollup pre-minifier contribution; not final or compressed byte attribution.',
                importedIds: (info?.importedIds ?? []).map(safeId),
                dynamicallyImportedIds: (info?.dynamicallyImportedIds ?? []).map(safeId),
                moduleSideEffects: info?.moduleSideEffects,
              };
            })
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
      writeFileSync(reportPath, `${JSON.stringify({ sha, chunks }, null, 2)}\n`, 'utf8');
    },
  }],
});
