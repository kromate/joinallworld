// The "update is coming" notice: a signed announcement, shown to every connected player and to anyone who connects while it runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { fixture, flakyDisk } from './test-fixture.ts';
import type { TestSocket } from './test-fixture.ts';
import { noticeText, NOTICE_PUBLIC_KEY } from './notice.ts';
import type { NoticeFrame } from '../src/types/notice.ts';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x) };
};
type Keys = ReturnType<typeof pair>;
const nonce = (): string => randomBytes(12).toString('base64url');
function signed(keys: Keys, at: number, fields: { minutes?: number; issuedAt?: number; nonce?: string } = {}) {
  const body = { kind: 'update' as const, minutes: fields.minutes ?? 3, issuedAt: fields.issuedAt ?? at, nonce: fields.nonce ?? nonce() };
  return { ...body, sig: sign(null, Buffer.from(noticeText(body.kind, body.minutes, body.issuedAt, body.nonce)), keys.privateKey).toString('base64url') };
}
/** The next `notice` frame on a socket (the socket's other opening frames are skipped). */
async function noticeOn(socket: TestSocket): Promise<NoticeFrame> {
  for (let i = 0; i < 8; i += 1) { const frame = await socket.next(); if (frame.type === 'notice') return frame; }
  throw Error('no notice frame');
}
const quiet = async (socket: TestSocket): Promise<boolean> => { try { for (let i = 0; i < 8; i += 1) { if ((await socket.next()).type === 'notice') return false; } return true; } catch { return true; } };

test('a signed announcement reaches every open socket and a socket that opens later, and ends by itself', async (t) => {
  const keys = pair();
  const f = await fixture(t, { env: { NOTICE_PUBLIC_KEY: keys.publicKey }, buildId: 'build-one' });
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const a = await f.socket(ada), b = await f.socket(bola);
  const answer = await f.request('/api/notice', signed(keys, f.now(), { minutes: 4 }));
  assert.equal(answer.status, 200);
  const body = await answer.json() as { ok: boolean; minutes: number; until: number };
  assert.equal(body.ok, true); assert.equal(body.minutes, 4); assert.equal(body.until, f.now() + 4 * 60000);
  for (const socket of [a, b]) {
    const frame = await noticeOn(socket);
    assert.equal(frame.kind, 'update'); assert.equal(frame.minutes, 4); assert.equal(frame.until, body.until); assert.equal(frame.build, 'build-one'); assert.equal(frame.serverTime, f.now());
  }
  f.advance(60000);
  const late = await f.socket(await f.device('Cleo'));
  const seen = await noticeOn(late);
  assert.equal(seen.until, body.until); assert.equal(seen.serverTime, f.now());
  f.advance(3 * 60000);
  assert.equal(await quiet(await f.socket(await f.device('Dayo'))), true, 'it has ended');
});

test('nothing but a banner: no rows are written and the frame carries no text', async (t) => {
  const keys = pair(), disk = flakyDisk();
  const f = await fixture(t, { env: { NOTICE_PUBLIC_KEY: keys.publicKey }, disk });
  const a = await f.socket(await f.device('Ada'));
  await f.flush();
  const before = disk.writes;
  assert.equal((await f.request('/api/notice', signed(keys, f.now()))).status, 200);
  await f.flush();
  assert.equal(disk.writes, before);
  assert.deepEqual(Object.keys(await noticeOn(a)).sort(), ['build', 'id', 'kind', 'minutes', 'serverTime', 'type', 'until']);
});

test('a bad signature, a stale time, a replay, a wrong key and out-of-range fields are refused', async (t) => {
  const keys = pair();
  const f = await fixture(t, { env: { NOTICE_PUBLIC_KEY: keys.publicKey } });
  const a = await f.socket(await f.device('Ada'));
  // A refusal counts against the address: the clock moves past the window after each, so every case is judged on its own.
  const post = async (body: object) => { const res = await f.request('/api/notice', body); if (!res.ok) f.advance(11 * 60000); return { status: res.status, ...(await res.json() as { error?: string }) }; };
  const good = signed(keys, f.now());
  assert.equal((await post({ ...good, sig: good.sig.slice(0, -2) + (good.sig.endsWith('AA') ? 'BB' : 'AA') })).error, 'notice_unverified');
  assert.equal((await post({ ...good, minutes: 5 })).error, 'notice_unverified', 'the minutes are signed');
  assert.deepEqual(await post(signed(pair(), f.now())), { status: 401, error: 'notice_unverified', reason: 'The announcement was refused.' });
  assert.equal((await post(signed(keys, f.now() - 6 * 60000))).error, 'notice_stale');
  assert.equal((await post(signed(keys, f.now() + 6 * 60000))).error, 'notice_stale');
  assert.equal((await post(signed(keys, f.now(), { minutes: 0 }))).error, 'invalid_notice');
  assert.equal((await post(signed(keys, f.now(), { minutes: 16 }))).error, 'invalid_notice');
  assert.equal((await post(signed(keys, f.now(), { minutes: 2.5 }))).error, 'invalid_notice');
  assert.equal((await post({ ...signed(keys, f.now()), kind: 'message' })).error, 'invalid_notice');
  assert.equal((await post({})).error, 'invalid_notice');
  assert.equal(await quiet(a), true, 'nothing was announced');
  const fresh = signed(keys, f.now());
  assert.equal((await post(fresh)).status, 200);
  assert.equal((await post(fresh)).error, 'notice_replayed', 'the same announcement twice');
});

test('without a setting the built-in public key is the one used, and another key is a wrong key', async (t) => {
  assert.match(NOTICE_PUBLIC_KEY, /^[A-Za-z0-9_-]{43}$/);
  const f = await fixture(t);
  const res = await f.request('/api/notice', signed(pair(), f.now()));
  assert.equal(res.status, 401);
});

test('refused attempts are limited per address, then even a good one waits', async (t) => {
  const keys = pair();
  const f = await fixture(t, { env: { NOTICE_PUBLIC_KEY: keys.publicKey } });
  for (let i = 0; i < 5; i += 1) assert.equal((await f.request('/api/notice', signed(pair(), f.now()))).status, 401);
  assert.equal((await f.request('/api/notice', signed(keys, f.now()))).status, 429);
  f.advance(11 * 60000);
  assert.equal((await f.request('/api/notice', signed(keys, f.now()))).status, 200);
});
