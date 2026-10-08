import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPackage, expectedConfig } from './guard-joinallworld-package.mjs';
import { checkSource } from './check-joinallworld-source.mjs';
import { checkWorkflow, parseYaml } from './check-workflows.mjs';
const sha = 'a'.repeat(40);
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'joinallworld-package-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets/index.html'), '<!doctype html><title>Fixture</title>');
  writeFileSync(join(root, 'worker.js'), 'export default {fetch(){return new Response("fixture")}}');
  writeFileSync(join(root, 'wrangler.json'), JSON.stringify(expectedConfig(sha, false)));
  const seal = () => {
    const files = [];
    function walk(path) { for (const name of readdirSync(path).sort()) { if (name === 'manifest.json') continue; const full = join(path, name), stat = statSync(full); if (stat.isDirectory()) walk(full); else files.push({ path: relative(root, full), bytes: stat.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') }); } }
    walk(root); writeFileSync(join(root, 'manifest.json'), JSON.stringify({ sourceSha: sha, publish: false, files }));
  };
  seal(); return { root, seal };
}
test('accepts exact separate-worker package and rejects content changes', t => {
  const f = fixture(t); assert.match(checkPackage(f.root, sha, false), /^[a-f0-9]{64}$/);
  writeFileSync(join(f.root, 'worker.js'), 'tampered'); assert.throws(() => checkPackage(f.root, sha, false), /manifest mismatch/);
});
for (const [name, change] of [
  ['old Worker identity', config => { config.name = 'allworld'; }],
  ['old namespace binding', config => { config.durable_objects.bindings[0].script_name = 'allworld'; }],
  ['apex route', config => { config.routes = ['joinallworld.com/*']; }],
  ['build hook', config => { config.build = { command: 'unreviewed' }; }],
  ['preview exposure', config => { config.preview_urls = true; }],
  ['unapproved public runtime', config => { config.workers_dev = true; }],
  ['extra secret binding', config => { config.vars.TOKEN = 'synthetic'; }],
]) test(`rejects ${name} even with resealed manifest`, t => {
  const f = fixture(t), config = expectedConfig(sha, false); change(config);
  writeFileSync(join(f.root, 'wrangler.json'), JSON.stringify(config)); f.seal();
  assert.throws(() => checkPackage(f.root, sha, false), /Unapproved deployment configuration/);
});
function glb(jsonText) {
  const json = Buffer.from(jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, ' '));
  const out = Buffer.alloc(20 + json.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  return out;
}
test('accepts binary glTF models and rejects files only named .glb', t => {
  const f = fixture(t); mkdirSync(join(f.root, 'assets/models'));
  writeFileSync(join(f.root, 'assets/models/body-a1b2.glb'), glb('{"asset":{"version":"2.0"}}')); f.seal();
  assert.match(checkPackage(f.root, sha, false), /^[a-f0-9]{64}$/);
  writeFileSync(join(f.root, 'assets/models/body-a1b2.glb'), 'export default 1'); f.seal();
  assert.throws(() => checkPackage(f.root, sha, false), /Invalid model file/);
  const truncated = glb('{"asset":{"version":"2.0"}}').subarray(0, 24); writeFileSync(join(f.root, 'assets/models/body-a1b2.glb'), truncated); f.seal();
  assert.throws(() => checkPackage(f.root, sha, false), /Invalid model file/);
  rmSync(join(f.root, 'assets/models/body-a1b2.glb')); writeFileSync(join(f.root, 'assets/models/body.gltf'), '{}'); f.seal();
  assert.throws(() => checkPackage(f.root, sha, false), /Unexpected package file/);
});
test('rejects hidden, state and symlink files', t => {
  const f = fixture(t); writeFileSync(join(f.root, '.env'), 'synthetic'); assert.throws(() => checkPackage(f.root, sha, false), /Forbidden package path/); rmSync(join(f.root, '.env'));
  symlinkSync(join(f.root, 'worker.js'), join(f.root, 'assets/link.js')); assert.throws(() => checkPackage(f.root, sha, false), /Forbidden package path/);
});
test('workflow permits only the fixed guarded command', () => {
  const source = readFileSync(new URL('../.github/workflows/joinallworld-release.yml', import.meta.url), 'utf8');
  const workflow = parseYaml(source); assert.deepEqual(checkWorkflow('joinallworld-release.yml', workflow), []);
  assert.ok(checkWorkflow('other.yml', workflow).some(x => x.includes('outside the reviewed deploy job')));
  const changed = structuredClone(workflow); changed.jobs.deploy.steps.at(-1).run = 'node arbitrary-script.mjs';
  assert.ok(checkWorkflow('joinallworld-release.yml', changed).some(x => x.includes('not the guarded deploy')));
  const wrongSecret = structuredClone(workflow); wrongSecret.jobs.deploy.steps.at(-1).env.CLOUDFLARE_API_TOKEN = '${{ secrets.OTHER_TOKEN }}';
  assert.ok(checkWorkflow('joinallworld-release.yml', wrongSecret).some(x => x.includes('outside the reviewed deploy job')));
  const noMain = structuredClone(workflow); noMain.jobs.deploy.if = 'inputs.deploy';
  assert.ok(checkWorkflow('joinallworld-release.yml', noMain).some(x => x.includes('limited to refs/heads/main')));
  const suffix = structuredClone(workflow); suffix.jobs.deploy.steps.at(-1).run += '; arbitrary-command';
  assert.ok(checkWorkflow('joinallworld-release.yml', suffix).some(x => x.includes('not the guarded deploy')));
});

test('source gate rejects unmerged and foreign-repository revisions', t => {
  const f = fixture(t);
  const git = args => { const result = spawnSync('git', ['-C', f.root, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'synthetic@example.invalid']);
  git(['remote', 'add', 'origin', 'https://github.com/kromate/joinallworld']); git(['add', '.']); git(['commit', '-m', 'synthetic base']);
  const main = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', main]); checkSource(f.root, main);
  git(['checkout', '-b', 'unmerged']); writeFileSync(join(f.root, 'branch.txt'), 'branch'); git(['add', '.']); git(['commit', '-m', 'synthetic unmerged']);
  const branch = git(['rev-parse', 'HEAD']); assert.throws(() => checkSource(f.root, branch), /ancestor/);
  git(['checkout', 'main']); git(['remote', 'set-url', 'origin', 'https://github.com/other/joinallworld']); assert.throws(() => checkSource(f.root, main), /Wrong source/);
});

test('deploy context rejects before invoking any executable', t => {
  const f = fixture(t), digest = checkPackage(f.root, sha, false);
  const guard = fileURLToPath(new URL('./guard-joinallworld-package.mjs', import.meta.url));
  for (const context of [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kromate/joinallworld' }, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/other', GITHUB_REPOSITORY: 'kromate/joinallworld' }, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'other/repo' }]) {
    const result = spawnSync(process.execPath, [guard, 'deploy', f.root, sha, 'false', digest, '/does-not-exist'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...context } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Deployment context rejected/);
  }
  const allowed = spawnSync(process.execPath, [guard, 'deploy', f.root, sha, 'false', digest, '/does-not-exist'], { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kromate/joinallworld' } });
  assert.notEqual(allowed.status, 0); assert.match(allowed.stderr, /Missing protected deployment inputs/);
});

test('archive extractor rejects traversal, symlink, hardlink and oversize entries', t => {
  const f = fixture(t), unpack = fileURLToPath(new URL('./unpack-joinallworld.py', import.meta.url));
  for (const kind of ['traversal', 'symlink', 'hardlink', 'oversize']) {
    const archive = join(f.root, `${kind}.tar`), destination = join(f.root, `out-${kind}`);
    const script = `import tarfile,sys,io\nwith tarfile.open(sys.argv[1],'w') as t:\n i=tarfile.TarInfo('../escaped' if sys.argv[2]=='traversal' else 'entry')\n if sys.argv[2]=='symlink': i.type=tarfile.SYMTYPE; i.linkname='../escaped'\n if sys.argv[2]=='hardlink': i.type=tarfile.LNKTYPE; i.linkname='../escaped'\n if sys.argv[2]=='oversize': i.size=51*1024*1024\n t.addfile(i, io.BytesIO(bytes(i.size)) if i.size else None)\n`;
    assert.equal(spawnSync('python3', ['-c', script, archive, kind]).status, 0);
    const result = spawnSync('python3', [unpack, archive, destination], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsafe package entry|Package size limit|unexpected end/);
  }
});


test('archive extractor accepts the street-pack count and rejects excess entries or aggregate bytes', t => {
  const f = fixture(t), unpack = fileURLToPath(new URL('./unpack-joinallworld.py', import.meta.url));
  for (const [name, count, size, accepted] of [['streets', 6000, 0, true], ['too-many', 6501, 0, false], ['too-large', 21, 5 * 1024 * 1024, false]]) {
    const archive = join(f.root, `${name}.tar`), destination = join(f.root, name);
    const script = `import tarfile,sys,io\nwith tarfile.open(sys.argv[1],'w') as t:\n data=bytes(int(sys.argv[3]))\n for n in range(int(sys.argv[2])):\n  i=tarfile.TarInfo('assets/pack-'+str(n)+'.txt'); i.size=len(data); t.addfile(i,io.BytesIO(data))\n`;
    assert.equal(spawnSync('python3', ['-c', script, archive, String(count), String(size)]).status, 0);
    const result = spawnSync('python3', [unpack, archive, destination], { encoding: 'utf8' });
    if (accepted) assert.equal(result.status, 0, result.stderr);
    else { assert.notEqual(result.status, 0); assert.match(result.stderr, /Package size limit/); }
  }
});
