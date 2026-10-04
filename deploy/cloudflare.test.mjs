import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build: esbuild } = require('esbuild');
const build = process.env.JOINALLWORLD_BUNDLER_ROLLUP ? async options => {
 const { rollup } = await import('rollup');
 const bundle = await rollup({ input: options.entryPoints[0], external: options.external });
 await bundle.write({ file: options.outfile, format: 'esm' }); await bundle.close();
} : esbuild;

async function fixture(t, overrides = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-do-test-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.js', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-conformance', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-conformance' }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } }, ...overrides };
  let mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true });
  const sockets = [];
  t.after(async () => { for (const socket of sockets) try { socket.close(); } catch {} await mf.dispose(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  async function request(path, body, cookie, headers = {}) {
    return mf.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  }
  async function device(name) {
    const response = await request('/api/session', { name });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Secure/);
    const body = await response.json();
    return { ...body.session, cookie: setCookie.split(';')[0] };
  }
  const action = (device, fields) => request('/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', ...fields }, device.cookie);
  const life = async device => (await (await request('/api/life?city=lagos', null, device.cookie)).json()).state;
  async function socket(device) {
    const response = await mf.dispatchFetch(origin + '/socket', { headers: { origin, cookie: device.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket;
    const queue = [], pending = [], heartbeats = [];
    ws.addEventListener('message', event => { const item = JSON.parse(event.data); if (item.type === 'heartbeat') { heartbeats.push(Date.now()); ws.send(JSON.stringify({type:'heartbeat-ack'})); return; } const listener = pending.shift(); if (listener) listener(item); else queue.push(item); });
    ws.accept(); sockets.push(ws);
    return { ws, heartbeats, send: message => ws.send(JSON.stringify(message)), next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Socket message timeout')), 3000); pending.push(item => { clearTimeout(timer); resolve(item); }); }) };
  }
  const storage = () => mf.unsafeGetDurableObjectStorage('joinallworld-conformance', 'JoinAllworldState', { name: 'joinallworld-v1' });
  const upgrade = headers => mf.dispatchFetch(origin + '/socket', { headers: { upgrade: 'websocket', ...headers } });
  return { atHost: (host,path,method='GET') => mf.dispatchFetch(host+path,{method}), request, device, action, life, socket, storage, upgrade, origin, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-conformance', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }), restart: async () => { for (const socket of sockets) socket.close(); await mf.dispose(); mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true }); await mf.ready; } };
}

test('Cloudflare: public IDs, origin isolation, atomic duplicate fare, replay window and restart durability', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  assert.notEqual(a.id, a.cookie.slice(4));
  assert.equal((await f.request('/api/life?city=lagos')).status, 401);
  assert.equal((await f.request('/api/session', { name: 'Mallory' }, null, { origin: 'https://evil.test' })).status, 403);
  const action = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  const values = await Promise.all([f.action(a, action), f.action(a, action)]).then(results => Promise.all(results.map(x => x.json())));
  assert.deepEqual(values.map(x => x.state.cash), [4600, 4600]); assert.equal(values.filter(x => x.duplicate).length, 1);
  assert.equal((await f.life(b)).cash, 5000);
  const before = JSON.stringify(await (await f.storage()).exec('SELECT value FROM sessions'));
  const conflict = await f.action(a, { ...action, id: 'park' }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'action_id_conflict');
  assert.equal(JSON.stringify(await (await f.storage()).exec('SELECT value FROM sessions')), before);
  const expired = await f.action(a, { ...action, actionId: `${Date.now() - 86401000}:${randomUUID()}` }); assert.equal(expired.status, 409); assert.equal((await expired.json()).error, 'action_expired');
  const future = await f.action(a, { ...action, actionId: `${Date.now() + 60000}:${randomUUID()}` }); assert.equal(future.status, 409); assert.equal((await future.json()).error, 'action_expired');
  await f.restart(); assert.equal((await f.life(a)).cash, 4600);
  assert.equal((await (await f.action(a, action)).json()).duplicate, true);
});

test('Cloudflare: settlement once across restart, sliding expiry, expired token never reads archived life', async t => {
  const f = await fixture(t), a = await f.device('Ada');
  await f.action(a, { type: 'spot', id: 'trees' }); await f.action(a, { type: 'activity', id: 'chill' });
  const storage = await f.storage();
  const rows = await storage.exec('SELECT value FROM sessions');
  const session = JSON.parse(rows[0].value);
  session.cities.lagos.updatedAt -= 12000; session.expiresAt = Date.now() + 60000;
  await storage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(session), session.expiresAt, a.cookie.slice(4));
  await f.restart();
  assert.equal((await f.life(a)).needs.fun, 60); assert.equal((await f.life(a)).needs.fun, 60);
  const currentStorage = await f.storage();
  const renewed = JSON.parse((await currentStorage.exec('SELECT value FROM sessions'))[0].value);
  assert.ok(renewed.expiresAt > Date.now() + 29 * 86400000);
  renewed.expiresAt = Date.now() - 1;
  await currentStorage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(renewed), renewed.expiresAt, a.cookie.slice(4));
  assert.equal((await f.request('/api/session', null, a.cookie)).status, 401);
  const fresh = await f.device('New life'); assert.notEqual(fresh.id, a.id);
  const archives = await currentStorage.exec('SELECT value FROM archived_lives');
  assert.equal(archives.length, 1); assert.equal(JSON.parse(archives[0].value).cities.lagos.state.needs.fun, 60);
  assert.ok(!archives[0].value.includes(a.cookie.slice(4)));
});

test('Cloudflare: two clients presence, chat dedupe, signaling isolation and travel eviction', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' });
  const solo = await x.next(); assert.equal(solo.members.length, 1); assert.ok(!JSON.stringify(solo).includes(a.cookie.slice(4))); assert.equal(solo.members[0].muted, true);
  y.send({ type: 'join', cityId: 'ibadan', venueId: 'park' }); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await x.next()).code, 'peer_not_in_room');
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await y.next()).from, a.id);
  const chat = { type: 'chat', body: 'Hello', clientId: randomUUID() };
  x.send(chat); const first = await x.next(); assert.equal((await y.next()).id, first.id); assert.ok(!JSON.stringify(first).includes(a.cookie.slice(4)));
  const receipts = await (await f.storage()).exec('SELECT value FROM chat_receipts');
  assert.ok(!JSON.stringify(receipts).includes('Hello')); assert.ok(!JSON.stringify(receipts).includes('Ada'));
  await f.hibernate();
  x.send(chat); assert.equal((await x.next()).id, first.id);
  x.send({ type: 'voice-state', enabled: true, muted: true });
  assert.equal((await x.next()).members.find(member => member.id === a.id).muted, true); await y.next();
  await f.hibernate();
  y.send({ type: 'voice-state', enabled: true, muted: true });
  assert.equal((await x.next()).members.filter(member => member.enabled).length, 2); await y.next();
  x.send({ type: 'chat', body: '', clientId: 'bad-chat' }); assert.equal((await x.next()).clientId, 'bad-chat');
  await f.action(a, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await x.next()).code, 'venue_mismatch'); assert.equal((await y.next()).members.length, 1);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'library' }); assert.equal((await x.next()).code, 'venue_mismatch');
});

test('Cloudflare: socket auth, expired open connection and disconnect after hibernation', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  assert.equal((await f.upgrade({ cookie: a.cookie })).status, 403);
  assert.equal((await f.upgrade({ cookie: a.cookie, origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.upgrade({ origin: f.origin })).status, 401);
  assert.equal((await f.request('/socket', null, a.cookie)).status, 403);
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  await f.hibernate();
  const storage = await f.storage();
  const row = (await storage.exec('SELECT value FROM sessions WHERE secret = ?', a.cookie.slice(4)))[0];
  const session = JSON.parse(row.value); session.expiresAt = Date.now() - 1;
  await storage.exec('UPDATE sessions SET value=?,expires_at=? WHERE secret=?', JSON.stringify(session), session.expiresAt, a.cookie.slice(4));
  x.send({ type: 'chat', body: 'Expired', clientId: 'expired' });
  assert.equal((await x.next()).code, 'device_session_required'); assert.equal((await y.next()).members.length, 1);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: a.cookie })).status, 401);
});

test('Cloudflare: voice cap, per-session socket cap, durable rate-limit rejection', async t => {
  const f = await fixture(t), members = [];
  for (let index = 0; index < 9; index++) {
    const device = await f.device(`Voice ${index}`), socket = await f.socket(device);
    socket.send({ type: 'join', cityId: 'lagos', venueId: 'park' });
    for (const member of members) await member.next(); await socket.next();
    socket.send({ type: 'voice-state', enabled: true, muted: true });
    if (index < 8) { for (const member of members) await member.next(); await socket.next(); }
    else assert.equal((await socket.next()).code, 'voice_room_full');
    members.push(socket);
  }
  const device = await f.device('Many tabs');
  for (let count = 0; count < 8; count++) await f.socket(device);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: device.cookie })).status, 503);
  const storage = await f.storage();
  await f.request("/api/session", null, device.cookie);
  await storage.exec("UPDATE rate_limits SET count=600 WHERE key LIKE 'http:session:%'");
  await f.hibernate();
  assert.equal((await f.request('/api/session', null, device.cookie)).status, 429);
  assert.equal((await f.request('/api/session', null, device.cookie, { 'cf-connecting-ip': '192.0.2.44' })).status, 429);
});

test('Cloudflare: proximity survives hibernation, movement avoids SQL writes and private homes stay isolated', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  const storage = await f.storage();
  const before = JSON.stringify(await storage.exec('SELECT * FROM sessions'));
  x.send({ type: 'move', x: 12, z: 0 });
  assert.deepEqual((await x.next()).members.find(m => m.id === a.id).position, { x: 12, z: 0 }); await y.next();
  assert.equal(JSON.stringify(await storage.exec('SELECT * FROM sessions')), before);
  await f.hibernate();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await x.next()).code, 'peer_out_of_range');
  x.send({ type: 'move', x: 11, z: 0 }); await x.next(); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await y.next()).from, a.id);
  x.send({ type: 'move', x: 21, z: 0 }); assert.equal((await x.next()).code, 'invalid_position');
  for (let i = 0; i < 3; i++) { x.send({ type: 'move', x: i, z: 0 }); await x.next(); await y.next(); }
  x.send({ type: 'move', x: 0, z: 0 }); assert.equal((await x.next()).code, 'move_rate_limited');
  const currentStorage = await f.storage();
  for (const row of await currentStorage.exec('SELECT secret,value FROM sessions')) {
    const session = JSON.parse(row.value); session.cities.lagos.state.location = 'home'; session.cities.lagos.state.activeAction = null;
    await currentStorage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), row.secret);
  }
  x.send({ type: 'join', cityId: 'lagos', venueId: 'home' }); await y.next(); assert.equal((await x.next()).members.length, 1);
  y.send({ type: 'join', cityId: 'lagos', venueId: 'home' }); assert.equal((await y.next()).members.length, 1);
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await x.next()).code, 'peer_not_in_room');
  const voice = await (await f.request('/api/voice-config', null, a.cookie)).json(); assert.equal(voice.turnConfigured, false); assert.equal(voice.radius, 12);
});

test('Cloudflare: twelve devices behind one IP retain independent HTTP allowance and receipts stay outside hot sessions', async t => {
  const f = await fixture(t);
  const devices = [];
  for (let i = 0; i < 12; i++) devices.push(await f.device(`Player ${i}`));
  for (const device of devices) for (let i = 0; i < 51; i++) assert.equal((await f.request('/api/session', null, device.cookie)).status, 200);
  const a = devices[0];
  const action = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  assert.equal((await (await f.action(a, action)).json()).state.cash, 4600);
  const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(4)))[0].value);
  assert.equal(session.actions, undefined);
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM action_receipts'))[0].n, 1);
  await f.hibernate();
  assert.equal((await (await f.action(a, action)).json()).duplicate, true);
  assert.equal((await f.request('/api/voice-config', null, devices[1].cookie)).status, 403);
  const socket = await f.socket(devices[1]); socket.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await socket.next();
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/api/voice-config', null, devices[1].cookie)).status, 200);
  assert.equal((await f.request('/api/voice-config', null, devices[1].cookie)).status, 429);
});

test('Cloudflare: gradual home nap cancellation survives eviction without repeating gains', async t => {
  const f = await fixture(t), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  session.cities.lagos.state.location = 'home'; session.cities.lagos.state.needs.energy = 20;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await (await f.action(a, { type: 'spot', id: 'bedroom' })).json()).ok, true);
  assert.equal((await (await f.action(a, { type: 'activity', id: 'nap' })).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  started.cities.lagos.updatedAt -= 3000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(4));
  await f.hibernate();
  const cancelled = await (await f.action(a, { type: 'cancel' })).json(); assert.equal(cancelled.ok, true); assert.equal(cancelled.state.activeAction, null);
  assert.ok(cancelled.state.needs.energy >= 26 && cancelled.state.needs.energy < 28);
  await f.restart();
  const after = await f.life(a); assert.equal(after.needs.energy, cancelled.state.needs.energy);
});

test('Cloudflare: real static HTML receives response security and cache headers', async t => {
  const f = await fixture(t); const response = await f.request('/');
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-cache'); assert.match(await response.text(), /Allworld/);
});

test('Cloudflare: pre-job saves hydrate and award a completed shift once after restart', async t => {
  const f = await fixture(t), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  delete session.cities.lagos.state.job; delete session.cities.lagos.state.completedShifts;
  session.cities.lagos.state.homeOwned = true; session.cities.lagos.state.spot = 'work'; session.cities.lagos.updatedAt = 'malformed';
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await f.life(a)).completedShifts, 0);
  assert.equal((await (await f.action(a, { type: 'apply-job', id: 'community-helper' })).json()).ok, true);
  const shift = { type: 'activity', id: 'helper-shift', actionId: `${Date.now()}:${randomUUID()}` };
  assert.equal((await (await f.action(a, shift)).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); started.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(4));
  assert.equal((await f.life(a)).completedShifts, 0);
  await f.restart(); storage = await f.storage();
  const halfway = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); halfway.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(halfway), a.cookie.slice(4));
  const done = await f.life(a); assert.equal(done.cash, 5300); assert.equal(done.completedShifts, 1); assert.equal(done.homeOwned, true);
  assert.equal((await (await f.action(a, shift)).json()).duplicate, true); assert.equal((await f.life(a)).cash, 5300);
});


test('Cloudflare: only two nominated relay testers mint, global budget survives hibernation, errors hide secrets', async t => {
  const publicId = '11111111-1111-4111-8111-111111111111'; let calls = 0; let providerFailure;
  const f = await fixture(t, { bindings: { TURN_TEST_PUBLIC_IDS: publicId, TURN_KEY_ID: 'a'.repeat(32), TURN_API_TOKEN: 'synthetic-api-secret' }, outboundService: async request => {
    calls++; try { assert.equal(new URL(request.url).origin, 'https://rtc.live.cloudflare.com'); assert.deepEqual(await request.json(), { ttl: 600 }); } catch (error) { providerFailure = error.message; }
    return new Response(JSON.stringify({ iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'synthetic-user', credential: 'synthetic-short-lived' }] }), { status: 201 });
  } });
  const a = await f.device('Tester'), b = await f.device('Other'); const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(4)))[0].value); session.publicId = publicId;
  await storage.exec('UPDATE sessions SET public_id=?,value=? WHERE secret=?', publicId, JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 403); assert.equal(calls, 0);
  const x = await f.socket(a), y = await f.socket(b); x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  assert.equal((await (await f.request('/api/voice-config', null, b.cookie)).json()).turnConfigured, false); assert.equal(calls, 0);
  const response = await f.request('/api/voice-config', null, a.cookie); const body = await response.json(); assert.equal(response.status, 200, body.error); assert.equal(providerFailure, undefined); assert.equal(calls, 1); assert.equal(body.turnConfigured, true); assert.equal(JSON.stringify(body).includes('synthetic-api-secret'), false); assert.equal(calls, 1);
  await storage.exec('UPDATE turn_budget SET issued=8'); await f.hibernate();
  const limited = await f.request('/api/voice-config', null, a.cookie); assert.equal(limited.status, 429); assert.equal((await limited.json()).error, 'relay_test_limit'); assert.equal(calls, 1);
});

test('Recovery parity: Node and Worker share onboarding, social, blocking, civic, paid retry and authority refusals', async t=>{
 const {fixture:nodeFixture}=await import('../server/test-fixture.js');
 const edge=await fixture(t), node=await nodeFixture(t,{now:Date.now});
 async function sequence(f){
   const a=await f.device('Ada'),b=await f.device('Bola'),out=[];
   const call=async(path,body,who=a)=>{const r=await f.request(path,body,who?.cookie);const data=await r.json();return {status:r.status,...data};};
   for(const who of [a,b])await call('/api/social/me',null,who);
   out.push((await call('/api/social/friends/request',{to:b.id,cityId:'lagos'})).code);
   out.push((await call('/api/social/friends/answer',{from:a.id,accept:true,cityId:'lagos'},b)).code);
   const dm={to:b.id,body:'Hello friend',clientId:'portable-message'};
   const first=await call('/api/social/messages',dm);const retry=await call('/api/social/messages',dm);
   out.push([first.ok,retry.duplicate,first.message?.body]);
   out.push((await call('/api/social/block',{id:b.id,cityId:'lagos'})).code);
   out.push((await call('/api/social/messages',{...dm,clientId:'blocked-message'})).code);
   out.push((await call('/api/social/unblock',{id:b.id})).code);
   const action={actionId:`${Date.now()}:${randomUUID()}`,cityId:'lagos',type:'travel',id:'library',mode:'cab'};
   const paid=await call('/api/action',action),duplicate=await call('/api/action',action);
   out.push([paid.ok,paid.state.cash,duplicate.duplicate,duplicate.state.cash]);
   out.push((await call('/api/action',{...action,id:'park'})).error);
   const naked=await call('/api/action',{...action,actionId:`${Date.now()}:${randomUUID()}`,type:'civic.run'});out.push([naked.ok,naked.code,naked.state.cash]);
   out.push((await call('/api/civic/prefs',{richList:false})).status);
   out.push((await call('/api/civic/radio?city=lagos&venue=../bad')).error);
   out.push((await call('/api/auth/login',{email:'nobody@example.invalid'})).status);
   const created=await f.request('/api/session',{name:'Chidi',onboarding:true});const fresh={cookie:created.headers.get('set-cookie').split(';')[0]};
   out.push((await call('/api/action',{actionId:`${Date.now()}:${randomUUID()}`,cityId:'lagos',type:'spot',id:'trees'},fresh)).code);
   return out;
 }
 const expected=await sequence(node),actual=await sequence(edge);assert.deepEqual(actual,expected);
 assert.ok(expected.includes('blocked'));assert.ok(expected.includes('requested'));assert.ok(expected.includes('accepted'));assert.ok(expected.includes('onboarding_required'));
 await edge.restart();
});

test('Recovery Worker: SQL receipt failure rolls back debit; feature write failure does not acknowledge friendship',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');
 await f.life(a);for(const who of [a,b])assert.equal((await f.request('/api/social/me',null,who.cookie)).status,200);
 const storage=await f.storage();
 await storage.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON action_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
 const action={actionId:`${Date.now()}:${randomUUID()}`,type:'travel',id:'library',mode:'cab'};
 const failed=await f.action(a,action);assert.equal(failed.status,503);const refusal=await failed.json();assert.equal(refusal.error,'storage_unavailable');assert.match(refusal.reason,/nothing was changed/);assert.ok(!JSON.stringify(refusal).includes('injected'),'the SQL error itself is never sent');assert.equal((await f.life(a)).cash,5000);
 await storage.exec('DROP TRIGGER reject_receipt');
 assert.equal((await (await f.action(a,action)).json()).state.cash,4600);assert.equal((await (await f.action(a,action)).json()).duplicate,true);
 await storage.exec("CREATE TRIGGER reject_feature BEFORE UPDATE ON collections BEGIN SELECT RAISE(ABORT,'injected feature failure'); END");
 const friend=()=>f.request('/api/social/friends/request',{to:b.id,cityId:'lagos'},a.cookie);
 assert.equal((await friend()).status,503);await storage.exec('DROP TRIGGER reject_feature');
 const retry=await (await friend()).json();assert.equal(retry.code,'requested');assert.notEqual(retry.duplicate,true);
 await f.restart();assert.equal((await (await friend()).json()).duplicate,true);assert.equal((await f.life(a)).cash,4600);
});

test('Recovery Worker: committed block changes presence and survives hibernation before signaling',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');
 for(const who of [a,b])await f.request('/api/social/me',null,who.cookie);
 const x=await f.socket(a),y=await f.socket(b);
 x.send({type:'join',cityId:'lagos',venueId:'park'});await x.next();y.send({type:'join',cityId:'lagos',venueId:'park'});await x.next();await y.next();
 const response=await f.request('/api/social/block',{id:b.id,cityId:'lagos'},a.cookie);assert.equal((await response.json()).code,'blocked');
 assert.deepEqual((await x.next()).members.map(m=>m.id),[a.id]);assert.deepEqual((await y.next()).members.map(m=>m.id),[b.id]);
 await f.hibernate();x.send({type:'signal',to:b.id,data:{candidate:'synthetic'}});assert.equal((await x.next()).code,'peer_not_in_room');
});

test('Review B1: a new socket never postpones the already scheduled heartbeat',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');const x=await f.socket(a),opened=Date.now();
 await new Promise(resolve=>setTimeout(resolve,6000));await f.socket(b);
 await new Promise(resolve=>setTimeout(resolve,5500));
 assert.ok(x.heartbeats.length>=1,'first alarm must run despite the later upgrade');assert.ok(x.heartbeats[0]<opened+11500);
});
test('Review B2: expired rate keys free capacity at their own windows; long windows remain enforced',async t=>{
 const f=await fixture(t);await f.device('Ada');const storage=await f.storage(),now=Date.now();
 await storage.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO rate_limits(key,started_at,count,expires_at) SELECT 'expired-'||x,?,1,? FROM n",now-1000,now-1);
 await storage.exec('INSERT INTO rate_limits(key,started_at,count,expires_at) VALUES(?,?,?,?)','long-window',now-1000,5,now+86400000);
 assert.equal((await f.request('/api/health',null,null,{'cf-connecting-ip':'192.0.2.79'})).status,200);
 assert.equal((await storage.exec("SELECT COUNT(*) AS count FROM rate_limits WHERE key LIKE 'expired-%'"))[0].count,0);
 assert.equal((await storage.exec("SELECT count FROM rate_limits WHERE key='long-window'"))[0].count,5);
});
test('Review B3: heartbeat acknowledgements hit the frame limiter before session storage reads',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),x=await f.socket(a),storage=await f.storage();
 await storage.exec('INSERT INTO rate_limits(key,started_at,count,expires_at) VALUES(?,?,?,?)',`ws:${a.id}`,Date.now(),600,Date.now()+60000);
 // If session validation runs first, malformed storage yields an internal error instead.
 await storage.exec('UPDATE sessions SET value=? WHERE secret=?','malformed-json',a.cookie.slice(4));
 x.send({type:'heartbeat-ack'});assert.equal((await x.next()).code,'rate_limited');
 assert.equal((await storage.exec('SELECT count FROM rate_limits WHERE key=?',`ws:${a.id}`))[0].count,601);
});


test('Continuity preparation: old-character bridge is apex-only, safe-method-only and uncached',async t=>{
 const f=await fixture(t);
 const response=await f.atHost('https://joinallworld.com','/old-character.html');assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('content-security-policy'),/connect-src https:\/\/v1\.joinallworld\.com/);
 assert.match(await response.text(),/Continue with my character/);
 const head=await f.atHost('https://joinallworld.com','/old-character.html','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await f.atHost('https://joinallworld.com','/old-character.html','POST')).status,405);
 assert.equal((await f.atHost('https://joinallworld.test','/old-character.html')).status,404);
});
