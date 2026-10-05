// OWNER: foundation — the rate limiter (server/limiter.ts): windows, classes, and what a full table does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITER_CAPS, PROTECTED_PREFIXES, createMemoryLimiter, limiterClass, limiterProtects } from './limiter.ts';
import { fixture } from './test-fixture.ts';
import type { RouteContext, RouteHandler, RouteKey } from './types.ts';

test('a key allows `count` calls per window, each key with its own window; peek counts nothing', () => {
  let time = 1000;
  const limiter = createMemoryLimiter({ now: () => time });
  for (let i = 0; i < 3; i++) assert.equal(limiter.allow('a', 3), true);
  assert.equal(limiter.allow('a', 3), false); assert.equal(limiter.allow('b', 3), true);
  assert.equal(limiter.peek('a', 3), false); assert.equal(limiter.peek('b', 3), true);
  for (let i = 0; i < 10; i++) assert.equal(limiter.peek('never-seen', 1), true);
  assert.deepEqual(limiter.sizes(), { short: 2, long: 0, protected: 0 }, 'peeking created no row');
  time += 60000;
  assert.equal(limiter.peek('a', 3), true); assert.equal(limiter.allow('a', 3), true, 'the window passed');
  assert.equal(limiter.allow('long', 1, 600000), true); time += 300000; assert.equal(limiter.allow('long', 1, 600000), false, 'a long window is not cut short');
});

test('rows are kept by window and by what the key guards: short, long, protected', () => {
  assert.equal(limiterClass('http:1.2.3.4'), 'short'); assert.equal(limiterClass('growth:email:a@b.c', 3600000), 'long');
  for (const key of ['mod:1.2.3.4', 'mod-fail:all', 'mod-fail:1.2.3.4', 'account:sign-in:1.2.3.4', 'account:reset:to:abc']) { assert.equal(limiterClass(key, 600000), 'protected', key); assert.equal(limiterProtects(key), true, key); }
  for (const key of ['http:1.2.3.4', 'ws:id', 'modest:x', 'accounting', 'account:other:x', 'moderator:x']) assert.equal(limiterProtects(key), false, key);
  assert.ok(PROTECTED_PREFIXES.includes('mod-fail:') && PROTECTED_PREFIXES.includes('mod:'));
  const limiter = createMemoryLimiter({ now: () => 1000, caps: { short: 50, long: 20, protected: 30 } });
  for (let i = 0; i < 500; i++) limiter.allow(`growth:email:${i}`, 3, 3600000);
  assert.ok(limiter.sizes().long <= 20, 'the long class stays inside its bound');
  assert.equal(limiter.sizes().short, 0, 'and takes nothing from the short class');
  assert.equal(limiter.allow('http:new-visitor', 600), true);
  for (let i = 0; i < 100; i++) limiter.allow(`http:flood-${i}`, 600);
  assert.ok(limiter.sizes().short <= 50 && limiter.sizes().long <= 20, 'a flood of short rows takes nothing from the long class');
});

test('a full table makes room by dropping what expires soonest; protected rows are never dropped, and a full protected class refuses new keys', () => {
  let time = 1000;
  const limiter = createMemoryLimiter({ now: () => time, caps: { short: 100, long: 100, protected: 10 } });
  for (let i = 0; i < 100; i++) limiter.allow('mod-fail:all', 100, 600000);
  assert.equal(limiter.allow('mod-fail:all', 100, 600000), false, 'at its cap');
  for (let i = 0; i < 5; i++) limiter.allow('growth:email:me', 5, 3600000);
  for (let i = 0; i < 98; i++) limiter.allow(`http:flood-${i}`, 600, 60000 - i);
  for (let i = 0; i < 300; i++) assert.equal(limiter.allow(`http:visitor-${i}`, 600), true, `visitor ${i}`);
  for (let i = 0; i < 300; i++) limiter.allow(`growth:email:other-${i}`, 6, 3600000 + i);
  assert.ok(limiter.sizes().short <= 100 && limiter.sizes().long <= 100);
  assert.equal(limiter.allow('mod-fail:all', 100, 600000), false, 'the failed-token window survived the floods');
  assert.equal(limiter.peek('mod-fail:all', 100), false);
  // The protected class: fill it with live rows; a new key is refused, existing ones go on counting, nothing is dropped.
  for (let i = 0; i < 9; i++) limiter.allow(`mod-fail:ip-${i}`, 10, 600000);
  assert.equal(limiter.sizes().protected, 10);
  assert.equal(limiter.allow('mod-fail:new-address', 10, 600000), false, 'full of live protected rows: a new key fails closed');
  assert.equal(limiter.allow('mod-fail:ip-0', 10, 600000), true);
  assert.equal(limiter.sizes().protected, 10);
  // Expired rows go first, before anything live is dropped; once they expire the protected class takes keys again.
  time += 601000;
  assert.equal(limiter.allow('mod-fail:new-address', 10, 600000), true);
  assert.ok(limiter.sizes().protected < 10);
  assert.equal(LIMITER_CAPS.short, 10000);
});

test('Node host: with the limiter full of other people’s keys, a new visitor still gets a session and plays', async t => {
  let ctx: RouteContext | undefined;
  const filler = (context: RouteContext): Record<RouteKey, RouteHandler> => { ctx = context; return {}; };
  const { ROUTE_MODULES } = await import('./routes/index.ts');
  const f = await fixture(t, { routes: [...ROUTE_MODULES, filler] });
  assert.ok(ctx);
  for (let i = 0; i < LIMITER_CAPS.short + 500; i++) ctx.allow(`upgrade:flood-${i}`, 60, 3600000);
  for (let i = 0; i < LIMITER_CAPS.long + 500; i++) ctx.allow(`growth:email:flood-${i}`, 3, 3600000);
  ctx.allow('mod-fail:all', 100, 600000);
  assert.equal(ctx.peek?.('http:127.0.0.1', 600), true);
  const ada = await f.device('Ada');
  assert.match(ada.cookie, /^sid=/);
  assert.equal((await f.request('/api/life?city=lagos', null, ada.cookie)).status, 200);
  assert.equal(ctx.allow('account:sign-in:203.0.113.9', 10), true, 'and an account key of a new address is admitted too');
  assert.equal(ctx.peek?.('mod-fail:all', 100), true);
});
