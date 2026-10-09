import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { PLAYS } from './profile.ts'
import { readTeachingPractice, newTeachingPractice } from './living-world/teaching-state.ts'
import { readTeachingSnapshot, teachingFor } from './teaching-gate.ts'

const snapshot = (teaching: unknown) => ({ activeAction: { kind: 'activity', id: 'teaching-shift', teaching } })
const gateUrl = new URL('./teaching-gate.ts', import.meta.url).href
const hooks = `
export async function load(url, context, next) {
  if (/\\/src\\/game\\/profile\\.ts$/.test(url))
    return { format: 'module', source: 'export const PLAYS = false; export const LEFT_OUT = {};', shortCircuit: true };
  return next(url, context);
}`
const registerHooks = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}));`

test('ordinary activity snapshots do not request the teaching chunk', () => {
  const ordinary = { activeAction: { kind: 'activity', id: 'meal' } }
  assert.equal(teachingFor(ordinary), null)
  assert.equal(readTeachingSnapshot(ordinary), null)
  assert.equal(teachingFor({ activeAction: null }), null)
  assert.equal(teachingFor({ activeAction: { kind: 'travel', teaching: newTeachingPractice() } }), null)
})

test('playing hosts leave strict teaching reads to their direct parser', () => {
  const valid = newTeachingPractice()
  const marked = snapshot(valid)
  assert.equal(PLAYS, true, 'ordinary Node tests use the playing host profile')
  assert.equal(teachingFor(marked), null)
  assert.equal(readTeachingSnapshot(valid), null, 'the read-only parser is not installed on a playing host')
  assert.deepEqual(readTeachingPractice(valid), valid, 'the shared strict state reader accepts the authored current row')
  assert.equal(readTeachingPractice({ ...valid, version: 2 }), null, 'the strict reader rejects future state')
})

test('Node loader emulates the supported read-only profile and executes the actual lazy import path', () => {
  const probe = `
import assert from 'node:assert/strict';
const { readTeachingSnapshot, teachingFor } = await import(${JSON.stringify(gateUrl)});
const valid = { version: 1, lessonId: 'fractions-v1', revision: 1, stage: 'diagnose', feedback: null };
assert.equal(teachingFor({ activeAction: { kind: 'activity', id: 'meal' } }), null);
assert.equal(teachingFor({ activeAction: { kind: 'travel', teaching: valid } }), null);
let getterCalls = 0;
const hostile = {};
Object.defineProperty(hostile, 'activeAction', { enumerable: true, get() { getterCalls++; return { kind: 'activity', teaching: valid }; } });
assert.equal(teachingFor(hostile), null);
const kindGetter = {};
Object.defineProperty(kindGetter, 'kind', { enumerable: true, get() { getterCalls++; return 'activity'; } });
Object.defineProperty(kindGetter, 'teaching', { enumerable: true, value: valid });
assert.equal(teachingFor({ activeAction: kindGetter }), null);
const teachingGetter = { kind: 'activity' };
Object.defineProperty(teachingGetter, 'teaching', { enumerable: true, get() { getterCalls++; return valid; } });
assert.equal(teachingFor({ activeAction: teachingGetter }), null);
const hiddenMarker = { kind: 'activity' };
Object.defineProperty(hiddenMarker, 'teaching', { value: valid });
assert.equal(teachingFor({ activeAction: hiddenMarker }), null);
const hostileProxy = new Proxy({ activeAction: { kind: 'activity', teaching: valid } }, {
  getPrototypeOf() { throw new Error('hostile prototype trap'); }
});
assert.equal(teachingFor(hostileProxy), null);
assert.equal(getterCalls, 0);
const generationOnly = { activeAction: { kind: 'activity', teachingGeneration: 1 } };
const first = teachingFor(generationOnly), second = teachingFor(generationOnly);
assert.ok(first instanceof Promise);
assert.equal(first, second);
await first;
assert.deepEqual(readTeachingSnapshot(valid), valid);
assert.equal(readTeachingSnapshot(undefined), null);
assert.equal(readTeachingSnapshot({ ...valid, version: 2 }), null);
assert.equal(teachingFor({ activeAction: { kind: 'activity', teaching: valid } }), null);
process.stdout.write('readonly-teaching-gate-ok\\n');
`
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types', '--no-warnings', '--import',
    `data:text/javascript,${encodeURIComponent(registerHooks)}`, '--input-type=module', '--eval', probe,
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 })
  assert.equal(output, 'readonly-teaching-gate-ok\n')
})
