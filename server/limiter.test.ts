// OWNER: foundation — the rate limiter (server/limiter.ts): windows, classes, and what a full table does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITER_CAPS, createMemoryLimiter, limiterClass } from './limiter.ts';
import { fixture } from './test-fixture.ts';
import type { RouteContext, RouteHandler, RouteKey } from './types.ts';

test('a key allows `count` calls per window, each key with its own window; peek counts nothing', () => {
  let time = 1000;
  const limiter = createMemoryLimiter({ now: () => time });
  for (let i = 0; i < 3; i++) assert.equal(limiter.allow('a', 3), true);
  assert.equal(limiter.allow('a', 3), false); assert.equal(limiter.allow('b', 3), true);
  assert.equal(limiter.peek('a', 3), false); assert.equal(limiter.peek('b', 3), true);
  for (let i = 0; i < 10; i++) assert.equal(limiter.peek('never-seen', 1), true);
  assert.deepEqual(limiter.sizes(), { core: 2, account: 0 }, 'peeking created no row');
  time += 60000;
  assert.equal(limiter.peek('a', 3), true); assert.equal(limiter.allow('a', 3), true, 'the window passed');
  assert.equal(limiter.allow('long', 1, 600000), true); time += 300000; assert.equal(limiter.allow('long', 1, 600000), false, 'a long window is not cut short');
});

test('keys an outsider can mint are a class of their own, with their own bound', () => {
  assert.equal(limiterClass('account:reset:to:abc'), 'account'); assert.equal(limiterClass('account:sign-in:1.2.3.4'), 'account');
  for (const key of ['http:1.2.3.4', 'http-ip:x', 'upgrade:1.2.3.4', 'ws:id', 'mod:fail:x', 'voice-config:id', 'accounting']) assert.equal(limiterClass(key), 'core', key);
  const limiter = createMemoryLimiter({ now: () => 1000, caps: { core: 50, account: 20 } });
  for (let i = 0; i < 500; i++) limiter.allow(`account:reset:to:${i}`, 3, 3600000);
  assert.ok(limiter.sizes().account <= 20, 'the account class stays inside its bound');
  assert.equal(limiter.sizes().core, 0, 'and takes nothing from the core class');
  assert.equal(limiter.allow('http:new-visitor', 600), true);
});

test('a full table makes room by dropping what expires soonest: a newcomer is never refused, long windows and the operator’s rows survive', () => {
  let time = 1000;
  const limiter = createMemoryLimiter({ now: () => time, caps: { core: 100, account: 100 } });
  assert.equal(limiter.allow('mod:fail:operator', 5, 600000), true);
  for (let i = 0; i < 5; i++) limiter.allow('long-window', 5, 3600000);
  for (let i = 0; i < 98; i++) limiter.allow(`http:flood-${i}`, 600, 60000 + i);
  assert.equal(limiter.sizes().core, 100);
  // The table is full of live rows. A new visitor is still admitted …
  for (let i = 0; i < 300; i++) assert.equal(limiter.allow(`http:visitor-${i}`, 600), true, `visitor ${i}`);
  assert.ok(limiter.sizes().core <= 100);
  // … the rows that were dropped were the ones about to expire anyway, not the long window or the operator's.
  assert.equal(limiter.allow('long-window', 5, 3600000), false, 'the hour-long window kept its count');
  assert.equal(limiter.peek('mod:fail:operator', 2), true); limiter.allow('mod:fail:operator', 5, 600000);
  assert.equal(limiter.peek('mod:fail:operator', 2), false, 'the operator’s row was never dropped: its count went on from 1 to 2');
  // Expired rows go first, before anything live is dropped.
  time += 61000;
  limiter.allow('http:after', 600);
  assert.ok(limiter.sizes().core < 100);
  assert.equal(LIMITER_CAPS.core, 10000);
});

test('Node host: with the limiter full of other people’s keys, a new visitor still gets a session and plays', async t => {
  let ctx: RouteContext | undefined;
  const filler = (context: RouteContext): Record<RouteKey, RouteHandler> => { ctx = context; return {}; };
  const { ROUTE_MODULES } = await import('./routes/index.ts');
  const f = await fixture(t, { routes: [...ROUTE_MODULES, filler] });
  assert.ok(ctx);
  for (let i = 0; i < LIMITER_CAPS.core + 500; i++) ctx.allow(`upgrade:flood-${i}`, 60, 3600000);
  for (let i = 0; i < LIMITER_CAPS.account + 500; i++) ctx.allow(`account:reset:to:flood-${i}`, 3, 3600000);
  assert.equal(ctx.peek?.('http:127.0.0.1', 600), true);
  const ada = await f.device('Ada');
  assert.match(ada.cookie, /^sid=/);
  assert.equal((await f.request('/api/life?city=lagos', null, ada.cookie)).status, 200);
  assert.equal(ctx.allow('account:sign-in:203.0.113.9', 10), true, 'and an account key of a new address is admitted too');
});
