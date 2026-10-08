import { readdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @param {string | Uint8Array} bytes */
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} sourceSha @param {boolean} publish */
export function expectedConfig(sourceSha, publish) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || typeof publish !== 'boolean') throw Error('Invalid release identity');
  return {
    name: 'joinallworld-next', main: 'worker.js', compatibility_date: '2026-10-01',
    workers_dev: publish, preview_urls: false,
    assets: { directory: './assets', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: true },
    durable_objects: { bindings: [{ name: 'JOINALLWORLD', class_name: 'JoinAllworldState' }] },
    migrations: [{ tag: 'joinallworld-sqlite-v1', new_sqlite_classes: ['JoinAllworldState'] }],
    vars: { BUILD_ID: `joinallworld-${sourceSha}` }, observability: { enabled: false },
  };
}
/** @param {string} root @param {string} sourceSha @param {boolean} publish */
export function checkPackage(root, sourceSha, publish) {
  root = resolve(root);
  if (realpathSync(root) !== root) throw Error('Package path must be canonical');
  /** @type {{path: string, bytes: number, sha256: string}[]} */
  const files = [];
  /** @param {string} path */
  function walk(path) {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name), stat = lstatSync(full), rel = relative(root, full);
      if (stat.isSymbolicLink() || name.startsWith('.') || /(?:^|\/)(?:node_modules|server|evidence|devices\.json|package\.json)(?:\/|$)/i.test(rel)) throw Error('Forbidden package path');
      if (stat.isDirectory()) { if (rel !== 'assets' && !rel.startsWith('assets/')) throw Error('Unexpected directory'); walk(full); }
      else {
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw Error('Invalid package file');
        if (!['worker.js', 'wrangler.json', 'manifest.json'].includes(rel) && !/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:html|js|css|svg|png|jpg|jpeg|webp|ico|woff2|txt|glb)$/.test(rel)) throw Error('Unexpected package file');
        const bytes = readFileSync(full);
        if (rel.endsWith('.glb') && !isGlb(bytes)) throw Error('Invalid model file');
        files.push({ path: rel, bytes: stat.size, sha256: hash(bytes) });
      }
    }
  }
  walk(root);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (manifest.sourceSha !== sourceSha || manifest.publish !== publish) throw Error('Manifest identity mismatch');
  const listed = files.filter(file => file.path !== 'manifest.json');
  if (JSON.stringify(manifest.files) !== JSON.stringify(listed)) throw Error('Package manifest mismatch');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.json'), 'utf8'));
  if (JSON.stringify(config) !== JSON.stringify(expectedConfig(sourceSha, publish))) throw Error('Unapproved deployment configuration');
  if (!files.some(file => file.path === 'worker.js') || !files.some(file => file.path === 'assets/index.html')) throw Error('Missing runtime files');
  return hash(JSON.stringify(files));
}
// A binary glTF 2.0 file: "glTF" magic, version 2, a declared length equal to the file size, then a JSON chunk first.
// Anything else under a .glb name (a renamed script, an HTML page, a truncated upload) is refused.
/** @param {Uint8Array} bytes */
export function isGlb(bytes) {
  if (bytes.length < 20 || bytes.length > 2 * 1024 * 1024) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === bytes.length && view.getUint32(16, true) === 0x4e4f534a;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, sourceSha, publishing, expectedDigest, wrangler] = process.argv.slice(2);
  if (!root || !sourceSha || !mode || !publishing) throw Error('Missing arguments');
  if (!['check', 'deploy'].includes(mode) || !['true', 'false'].includes(publishing)) throw Error('Invalid arguments');
  const digest = checkPackage(root, sourceSha, publishing === 'true');
  if (expectedDigest && expectedDigest !== digest) throw Error('Package digest changed');
  if (mode === 'check') console.log(digest);
  else {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'kromate/joinallworld') throw Error('Deployment context rejected');
    if (!expectedDigest || !wrangler || !process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw Error('Missing protected deployment inputs');
    if (checkPackage(root, sourceSha, publishing === 'true') !== expectedDigest) throw Error('Package changed before deploy');
    const result = spawnSync(process.execPath, [realpathSync(wrangler), 'deploy', '--config', join(realpathSync(root), 'wrangler.json')], {
      cwd: realpathSync(root), stdio: 'inherit', env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        WRANGLER_SEND_METRICS: 'false',
      },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
