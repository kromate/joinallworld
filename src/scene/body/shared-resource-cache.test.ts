import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedResourceCache } from './shared-resource-cache.ts';

function kitLifetime() {
  let cleanup: (() => void) | null = null;
  const cache = createSharedResourceCache<{ key: string }>((dispose) => { cleanup = dispose; return () => true; }, (value) => released.push(value.key));
  const released: string[] = [];
  return { cache, released, disposeKit() { cleanup?.(); } };
}

test('concurrent users of one family share one in-flight parsed resource per Kit', async () => {
  const { cache } = kitLifetime();
  let calls = 0, resolve!: (value: { key: string }) => void;
  const make = () => { calls++; return new Promise<{ key: string }>((done) => { resolve = done; }); };
  const one = cache.load('male', make), two = cache.load('male', make);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ key: 'male-template' });
  assert.strictEqual(await one, await two);
});

test('a rejected parse is evicted so the next actor can retry', async () => {
  const { cache } = kitLifetime();
  await assert.rejects(cache.load('female', async () => { throw new Error('offline'); }), /offline/);
  const result = await cache.load('female', async () => ({ key: 'female-template' }));
  assert.equal(result.key, 'female-template');
});

test('same-task teardown cancels a queued shared fetch before its loader starts', async () => {
  for (const viaKit of [false, true]) {
    const state = kitLifetime();
    let calls = 0;
    const make = async () => { calls += 1; return { key: 'must-not-fetch' }; };
    const first = state.cache.load('male', make), second = state.cache.load('male', make);
    assert.strictEqual(first, second, 'concurrent actors still share the queued request');
    if (viaKit) state.disposeKit(); else state.cache.dispose();
    await assert.rejects(first, /disposed/);
    await assert.rejects(second, /disposed/);
    assert.equal(calls, 0, 'closing before the loader task must not fetch or parse a model');
    assert.deepEqual(state.released, [], 'no resource was allocated');
  }
});

test('Kit teardown releases each retained family exactly once and rejects late completions', async () => {
  const state = kitLifetime();
  await state.cache.load('male', async () => ({ key: 'male-template' }));
  await state.cache.load('female', async () => ({ key: 'female-template' }));
  state.disposeKit();
  state.cache.dispose();
  assert.deepEqual(state.released.sort(), ['female-template', 'male-template']);
  await assert.rejects(state.cache.load('male', async () => ({ key: 'late' })), /disposed/);

  const pendingState = kitLifetime();
  let finish!: (value: { key: string }) => void;
  const pending = pendingState.cache.load('late', () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  pendingState.disposeKit();
  finish({ key: 'late-template' });
  await assert.rejects(pending, /disposed while loading/);
  assert.deepEqual(pendingState.released, ['late-template']);
});

test('teardown during decoder wait and during a clips wait both stop before cloning a released template', async () => {
  const decoderState = kitLifetime();
  let readyDecoder!: () => void;
  const decoderReady = new Promise<void>((resolve) => { readyDecoder = resolve; });
  const bodyWork = (async () => { await decoderReady; decoderState.cache.assertOpen(); return decoderState.cache.load('male', async () => ({ key: 'must-not-load' })); })();
  decoderState.disposeKit(); readyDecoder();
  await assert.rejects(bodyWork, /disposed/);
  assert.deepEqual(decoderState.released, []);

  const clipsState = kitLifetime();
  const template = await clipsState.cache.load('female', async () => ({ key: 'female-template' }));
  let readyClips!: () => void;
  const clipsReady = new Promise<void>((resolve) => { readyClips = resolve; });
  const allWork = Promise.all([Promise.resolve(template), clipsReady]);
  clipsState.disposeKit(); readyClips();
  const [releasedTemplate] = await allWork;
  assert.throws(() => clipsState.cache.assertOpen(), /disposed/);
  assert.equal(releasedTemplate, template);
  assert.deepEqual(clipsState.released, ['female-template']);
});
