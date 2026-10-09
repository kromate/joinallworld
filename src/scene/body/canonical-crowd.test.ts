import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicalCrowd } from './canonical-crowd.ts';
import type { CanonicalCrowdSpec } from './canonical-crowd.ts';
import { normalizeLook } from '../characters.ts';

const spec = (id = 'guest-a', extra: Partial<CanonicalCrowdSpec> = {}): CanonicalCrowdSpec => ({
  id, seed: id, look: { body: 'woman', hair: 'afro', outfit: 'casual', outfitColor: '#2f9d98' },
  x: 1, y: 0.03, z: 2, ry: 0, scale: 1, ...extra,
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Actor {
  disposed = 0;
  placement: CanonicalCrowdSpec | null = null;
  mounted: string | null = null;
  dispose() { this.disposed += 1; }
}
function harness() {
  const requests: { spec: CanonicalCrowdSpec; wait: ReturnType<typeof deferred<Actor>> }[] = [];
  const errors: unknown[] = [];
  let changes = 0, active = 0, maxActive = 0;
  const crowd = createCanonicalCrowd<Actor>({
    load(input) {
      const wait = deferred<Actor>(); requests.push({ spec: input, wait });
      active += 1; maxActive = Math.max(active, maxActive);
      return wait.promise.finally(() => { active -= 1; });
    },
    place(actor, input) { actor.placement = input; },
    mount(actor, id) { actor.mounted = id; },
    changed() { changes += 1; },
    failed(_id, error) { errors.push(error); },
  });
  return { crowd, requests, errors, get changes() { return changes; }, get maxActive() { return maxActive; },
    resolve(index: number) { const request = requests[index]; assert.ok(request); const actor = new Actor(); request.wait.resolve(actor); return actor; } };
}

test('canonical crowd starts after the renderer gate and clones only one person at a time', async () => {
  const h = harness(); h.crowd.sync([spec(), spec('guest-b')]);
  assert.equal(h.requests.length, 0);
  h.crowd.start(); h.crowd.start(); assert.equal(h.requests.length, 1);
  const first = h.resolve(0); await tick();
  assert.equal(h.requests.length, 2); assert.equal(h.crowd.get('guest-a'), first);
  const second = h.resolve(1); await tick();
  assert.equal(h.maxActive, 1); assert.equal(h.changes, 2);
  assert.deepEqual(h.crowd.counts, { desired: 2, canonical: 2, procedural: 0, loading: 0 });
  h.crowd.dispose(); assert.equal(first.disposed, 1); assert.equal(second.disposed, 1);
});

test('a look change during loading cannot commit a stale body or retain its resources', async () => {
  const h = harness(); h.crowd.sync([spec()]); h.crowd.start();
  h.crowd.sync([spec('guest-a', { look: { body: 'man', outfit: 'office' } })]);
  const stale = h.resolve(0); await tick();
  assert.equal(stale.disposed, 1); assert.equal(stale.mounted, null); assert.equal(h.changes, 0);
  assert.equal(h.requests.length, 2);
  assert.equal((h.requests[1]!.spec.look as { body: string }).body, 'man');
  const current = h.resolve(1); await tick();
  assert.equal(h.crowd.get('guest-a'), current); h.crowd.dispose(); assert.equal(current.disposed, 1);
});

test('removal then reuse of the same public id cannot revive an earlier scene entry', async () => {
  const h = harness(); h.crowd.sync([spec()]); h.crowd.start();
  h.crowd.sync([]); h.crowd.sync([spec('guest-a', { x: 7 })]);
  const stale = h.resolve(0); await tick(); assert.equal(stale.disposed, 1); assert.equal(h.crowd.get('guest-a'), null);
  h.crowd.sync([spec('guest-a', { x: 9, scale: 1.3 })]);
  const latest = h.resolve(1); await tick();
  assert.equal(latest.placement?.x, 9); assert.equal(latest.placement?.scale, 1.3);
  assert.equal(h.requests.length, 2); h.crowd.dispose();
});

test('disposing a scene during fetch rejects late actors and cannot start another clone', async () => {
  const h = harness(); h.crowd.sync([spec(), spec('guest-b')]); h.crowd.start();
  h.crowd.dispose(); h.crowd.dispose(); h.crowd.start(); h.crowd.retry(); h.crowd.sync([spec('guest-c')]);
  const late = h.resolve(0); await tick();
  assert.equal(late.disposed, 1); assert.equal(late.mounted, null); assert.equal(h.changes, 0);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.crowd.counts, { desired: 0, canonical: 0, procedural: 0, loading: 0 });
});

test('failed loads leave fallback available without a retry loop and allow explicit recovery', async () => {
  const h = harness(); h.crowd.sync([spec()]); h.crowd.start();
  h.requests[0]!.wait.reject(new Error('fetch failed')); await tick();
  h.crowd.start(); h.crowd.sync([spec()]); await tick();
  assert.equal(h.requests.length, 1); assert.equal(h.errors.length, 1); assert.equal(h.crowd.counts.procedural, 1);
  h.crowd.retry(); assert.equal(h.requests.length, 2);
  const recovered = h.resolve(1); await tick(); assert.equal(h.crowd.get('guest-a'), recovered); h.crowd.dispose();
});

test('position and scale updates preserve a committed look without refetching or replacing it', async () => {
  const h = harness(); h.crowd.sync([spec()]); h.crowd.start(); const actor = h.resolve(0); await tick();
  h.crowd.sync([spec('guest-a', { x: -4, z: 6, ry: 1, scale: 0.8 })]);
  assert.equal(h.requests.length, 1); assert.equal(h.crowd.get('guest-a'), actor); assert.equal(actor.disposed, 0);
  assert.equal(actor.placement?.x, -4); assert.equal(actor.placement?.scale, 0.8); h.crowd.dispose();
});

test('in-flight look data is an owned snapshot and invalid duplicate placements never clone twice', async () => {
  const h = harness(); const look = { body: 'woman', outfitColor: '#2f9d98' };
  h.crowd.sync([spec('guest-a', { look }), spec('guest-a'), spec('bad', { scale: NaN })]); h.crowd.start();
  const frozen = JSON.stringify(h.requests[0]!.spec.look); look.outfitColor = '#ff0000';
  assert.equal(JSON.stringify(h.requests[0]!.spec.look), frozen); assert.equal(h.crowd.counts.desired, 1);
  h.resolve(0); await tick(); assert.equal(h.requests.length, 1); h.crowd.dispose();
});

test('an NPC retains its stable source seed and seed-normalized look through the queued load', async () => {
  const h = harness();
  const npc = spec('npc:market-regular', { seed: 'market-regular', look: null });
  h.crowd.sync([npc]); h.crowd.start();
  assert.equal(h.requests[0]!.spec.id, 'npc:market-regular');
  assert.equal(h.requests[0]!.spec.seed, 'market-regular');
  assert.deepEqual(h.requests[0]!.spec.look, normalizeLook(null, 'market-regular'));
  const actor = h.resolve(0); await tick();
  assert.equal(h.crowd.get('npc:market-regular'), actor);
  h.crowd.dispose();
});

test('a failed mount or commit callback disposes the candidate instead of retaining an invisible actor', async () => {
  for (const failure of ['mount', 'changed'] as const) {
    const actor = new Actor(), errors: unknown[] = [];
    const crowd = createCanonicalCrowd({
      load: async () => actor, place() {}, mount() { if (failure === 'mount') throw new Error(failure); },
      changed() { if (failure === 'changed') throw new Error(failure); }, failed(_id, error) { errors.push(error); },
    });
    crowd.sync([spec()]); crowd.start(); await tick();
    assert.equal(crowd.get('guest-a'), null); assert.equal(actor.disposed, 1); assert.equal(errors.length, 1);
    crowd.dispose(); assert.equal(actor.disposed, 1);
  }
});

test('cached actors yield between clones while retaining one loader and doing no work after completion', async () => {
  const loads: CanonicalCrowdSpec[] = [], boundaries: ReturnType<typeof deferred<void>>[] = [];
  const crowd = createCanonicalCrowd({
    load: async (input) => { loads.push(input); return new Actor(); },
    place() {}, mount() {}, changed() {},
    yieldBetweenActors() { const boundary = deferred<void>(); boundaries.push(boundary); return boundary.promise; },
  });
  try {
    crowd.sync([spec('first'), spec('second'), spec('third')]); crowd.start(); await tick();
    assert.equal(loads.length, 1, 'a resolved cache cannot clone the entire crowd in one promise chain');
    assert.equal(boundaries.length, 1);
    crowd.start();
    crowd.sync([spec('first'), spec('second', { x: 7 }), spec('third')]);
    assert.equal(loads.length, 1, 'a repeated render cannot start a second pump during yielding');
    boundaries[0]!.resolve(); await tick();
    assert.equal(loads.length, 2); assert.equal(loads[1]!.x, 7, 'the next task sees latest placement');
    boundaries[1]!.resolve(); await tick();
    assert.equal(loads.length, 3); assert.equal(boundaries.length, 2, 'no trailing task is queued after the final actor');
    assert.deepEqual(crowd.counts, { desired: 3, canonical: 3, procedural: 0, loading: 0 });
    crowd.start(); crowd.retry(); await tick();
    assert.equal(loads.length, 3); assert.equal(boundaries.length, 2, 'settled crowds stay idle');
  } finally { crowd.dispose(); }
});

test('disposal during an inter-actor task boundary prevents the next clone', async () => {
  const boundary = deferred<void>(), actors: Actor[] = [];
  const crowd = createCanonicalCrowd({
    load: async () => { const actor = new Actor(); actors.push(actor); return actor; },
    place() {}, mount() {}, changed() {}, yieldBetweenActors: () => boundary.promise,
  });
  crowd.sync([spec('first'), spec('second')]); crowd.start(); await tick();
  assert.equal(actors.length, 1);
  crowd.dispose(); boundary.resolve(); await tick();
  assert.equal(actors.length, 1); assert.equal(actors[0]!.disposed, 1);
  assert.deepEqual(crowd.counts, { desired: 0, canonical: 0, procedural: 0, loading: 0 });
});

test('a commit callback can retire its scene or identity before throwing without double disposal', async () => {
  for (const action of ['remove', 'replace', 'dispose'] as const) {
    const actors: Actor[] = [], errors: unknown[] = [];
    let crowd: ReturnType<typeof createCanonicalCrowd<Actor>>;
    crowd = createCanonicalCrowd({
      load: async () => { const actor = new Actor(); actors.push(actor); return actor; },
      place(actor, input) { actor.placement = input; }, mount() {},
      changed() {
        if (actors.length !== 1) return;
        if (action === 'remove') crowd.sync([]);
        else if (action === 'replace') crowd.sync([spec('guest-a', { look: { body: 'man', outfit: 'office' } })]);
        else crowd.dispose();
        throw new Error('retired commit');
      },
      failed(_id, error) { errors.push(error); },
    });
    crowd.sync([spec()]); crowd.start(); await tick();
    assert.equal(actors[0]!.disposed, 1);
    assert.equal(errors.length, 0, 'an obsolete commit must not fail its replacement');
    if (action === 'replace') {
      assert.equal(actors.length, 2);
      assert.equal(crowd.get('guest-a'), actors[1]);
      assert.equal((actors[1]!.placement!.look as { body: string }).body, 'man');
    } else assert.equal(crowd.counts.desired, 0);
    crowd.dispose();
    assert.ok(actors.every(actor => actor.disposed === 1));
  }
});

test('appearance changes from placement or mounting cannot commit an obsolete actor', async () => {
  for (const stage of ['place', 'mount'] as const) {
    const actors: Actor[] = [];
    let changes = 0;
    let crowd: ReturnType<typeof createCanonicalCrowd<Actor>>;
    const replace = (actor: Actor) => {
      if (actor === actors[0]) crowd.sync([spec('guest-a', { look: { body: 'man', outfit: 'office' }, x: 8 })]);
    };
    crowd = createCanonicalCrowd({
      load: async () => { const actor = new Actor(); actors.push(actor); return actor; },
      place(actor, input) { actor.placement = input; if (stage === 'place') replace(actor); },
      mount(actor, id) { actor.mounted = id; if (stage === 'mount') replace(actor); },
      changed() { changes += 1; },
    });
    crowd.sync([spec()]); crowd.start(); await tick();
    assert.equal(actors.length, 2); assert.equal(actors[0]!.disposed, 1);
    if (stage === 'place') assert.equal(actors[0]!.mounted, null);
    assert.equal(changes, 1, 'only the current identity may announce a committed body');
    assert.equal(crowd.get('guest-a'), actors[1]); assert.equal(actors[1]!.placement!.x, 8);
    crowd.dispose(); assert.ok(actors.every(actor => actor.disposed === 1));
  }
});

test('a committed placement callback that replaces its actor then throws preserves the replacement', async () => {
  const actors: Actor[] = [], errors: unknown[] = [];
  let replace = false;
  let crowd: ReturnType<typeof createCanonicalCrowd<Actor>>;
  crowd = createCanonicalCrowd({
    load: async () => { const actor = new Actor(); actors.push(actor); return actor; },
    place(actor, input) {
      actor.placement = input;
      if (replace && actor === actors[0]) {
        replace = false;
        crowd.sync([spec('guest-a', { look: { body: 'man' }, x: 9 })]);
        throw new Error('old placement');
      }
    },
    mount() {}, changed() {}, failed(_id, error) { errors.push(error); },
  });
  crowd.sync([spec()]); crowd.start(); await tick();
  replace = true;
  assert.doesNotThrow(() => crowd.sync([spec('guest-a', { x: 4 })]));
  await tick();
  assert.equal(errors.length, 0); assert.equal(actors[0]!.disposed, 1);
  assert.equal(crowd.get('guest-a'), actors[1]); assert.equal(actors[1]!.placement!.x, 9);
  crowd.dispose(); assert.ok(actors.every(actor => actor.disposed === 1));
});

test('a disposal callback can supply a newer crowd without an outer sync overwriting it', async () => {
  const actors: Actor[] = [];
  let crowd: ReturnType<typeof createCanonicalCrowd<Actor>>;
  class ReentrantActor extends Actor {
    override dispose() {
      super.dispose();
      if (this === actors[0]) crowd.sync([
        spec('guest-a', { look: { body: 'man', outfit: 'office' }, x: 9 }), spec('guest-b'),
      ]);
    }
  }
  crowd = createCanonicalCrowd({
    load: async () => { const actor = new ReentrantActor(); actors.push(actor); return actor; },
    place(actor, input) { actor.placement = input; }, mount() {}, changed() {},
  });
  crowd.sync([spec(), spec('guest-b')]); crowd.start(); await tick();
  const retainedGuest = crowd.get('guest-b'); assert.ok(retainedGuest);
  crowd.sync([spec('guest-a', { look: { body: 'woman', outfit: 'sporty' }, x: 4 })]);
  await tick();
  assert.equal(actors[0]!.disposed, 1); assert.equal(crowd.get('guest-b'), retainedGuest);
  assert.equal(crowd.get('guest-a')!.placement!.x, 9);
  assert.equal((crowd.get('guest-a')!.placement!.look as { body: string }).body, 'man');
  crowd.dispose(); assert.ok(actors.every(actor => actor.disposed === 1));
});
