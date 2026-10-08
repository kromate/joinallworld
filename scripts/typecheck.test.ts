import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';

// Run the actual wrapper against bounded fake compiler processes. These tests verify process
// completion and diagnostic ownership; they do not replace compilation of the real projects.
function fixture(t: TestContext, compiler: string, baseline: Record<string, Record<string, Record<string, number>>> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'world-typecheck-wrapper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'tsconfig'));
  mkdirSync(join(root, 'node_modules/vue-tsc/bin'), { recursive: true });
  const source = new URL('./typecheck.ts', import.meta.url);
  const target = join(root, 'scripts/typecheck.ts');
  copyFileSync(source, target);
  assert.deepEqual(readFileSync(target), readFileSync(source), 'execute the exact current wrapper');
  writeFileSync(join(root, 'tsconfig/baseline.json'), JSON.stringify({ projects: baseline }));
  writeFileSync(join(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), compiler);
  return () => spawnSync(process.execPath, ['--experimental-strip-types', target, '--serial'], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
  });
}

test('typecheck wrapper cannot declare a quiet failing compiler clean', t => {
  const run = fixture(t, 'process.exit(1);');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compiler exited 1 without readable TypeScript diagnostics/);
  assert.doesNotMatch(result.stdout, /Typecheck clean/);
});

test('typecheck wrapper cannot declare a compiler terminated by signal clean', t => {
  const run = fixture(t, "process.kill(process.pid, 'SIGTERM');");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compiler did not complete \(SIGTERM\)/);
  assert.doesNotMatch(result.stdout, /Typecheck clean/);
});

test('typecheck wrapper rejects failure text outside TypeScript diagnostic syntax', t => {
  const run = fixture(t, "process.stderr.write('fatal: compiler could not start\\n'); process.exit(2);");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compiler exited 2.*fatal: compiler could not start/);
  assert.doesNotMatch(result.stdout, /Typecheck clean/);
});

test('typecheck wrapper still reconciles imported diagnostics in the owning project', t => {
  const run = fixture(t, `
    const config = process.argv.at(-1);
    if (config.endsWith('engine.json') || config.endsWith('server.json')) {
      process.stdout.write('server/legacy.js(1,1): error TS9999: retained baseline diagnostic\\n');
      process.exit(1);
    }
  `, { server: { 'server/legacy.js': { TS9999: 1 } } });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Typecheck clean: 5 projects/);
  assert.match(result.stdout, /1 baselined/);
});

test('typecheck wrapper still rejects new owned TypeScript errors', t => {
  const run = fixture(t, `
    if (process.argv.at(-1).endsWith('test.json')) {
      process.stdout.write('src/map3d/geo/new.test.ts(1,1): error TS2532: Object is possibly undefined.\\n');
      process.exit(1);
    }
  `);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /new.test.ts:1:1 TS2532/);
  assert.doesNotMatch(result.stdout, /Typecheck clean/);
});

test('typecheck wrapper accepts all five terminal clean compiler runs', t => {
  const result = fixture(t, 'process.exit(0);')();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Typecheck clean: 5 projects/);
});


test('typecheck wrapper rejects abnormal exit even when imported diagnostics look baselined', t => {
  const run = fixture(t, `
    process.stdout.write('server/legacy.js(1,1): error TS9999: retained baseline diagnostic\\n');
    process.exit(17);
  `, { server: { 'server/legacy.js': { TS9999: 1 } } });
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /compiler exited unexpected status 17/);
  assert.doesNotMatch(result.stdout, /Typecheck clean/);
});
