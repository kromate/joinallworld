// OWNER: social — requests for money in a direct chat (src/moneyRequest.ts, server/social/service.ts requestMoney / answerMoneyRequest).
// Over real HTTP against a real server with a controllable clock. Paying a request is a gift, so the gift rules are checked here too:
// the limits are the gift limits, a refusal leaves the request waiting, and a request is settled once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { createServer } from './server.ts';
import { LIMITS } from './social/service.ts';
import { MONEY_REQUEST } from '../src/moneyRequest.ts';
import { TRANSFER_LIMITS } from '../src/game/content/npcs.ts';
import { SHIFT_SECONDS } from '../src/game/content/jobs.ts';
import { peerTransferId } from './economy/effects.ts';
import type { Message, MoneyRequestView } from '../src/types/social.ts';

const HOUR = 3600000, MINUTE = 60000;
type Fixture = Awaited<ReturnType<typeof fixture>>;
/** The fields these tests read from any social answer. */
interface Reply {
  status: number; ok: boolean; code: string; reason: string; error: string; duplicate: boolean
  request: MoneyRequestView; message: Message; messages: Message[]; receipt: string; amount: number; balance: number
  state: { cash: number; social: { earned: number } }
  conversations: { id: string; with: string | null }[]
}
const answer = async (res: Response): Promise<Reply> => ({ status: res.status, ...((await res.json()) as Partial<Reply>) } as Reply);
const get = async (f: Fixture, path: string, who?: Device): Promise<Reply> => answer(await f.request(path, null, who?.cookie));
const post = async (f: Fixture, path: string, body: unknown, who?: Device): Promise<Reply> => answer(await f.request(path, body, who?.cookie));
const people = async (f: Fixture, names: string[]): Promise<Device[]> => {
  const out: Device[] = [];
  for (const name of names) { const who = await f.device(name); await get(f, '/api/social/me', who); out.push(who); }
  return out;
};
const befriend = async (f: Fixture, a: Device, b: Device): Promise<void> => {
  assert.equal((await post(f, '/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).code, 'requested');
  assert.equal((await post(f, '/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).code, 'accepted');
};
/** One paid shift: ₦3,000 earned from work, the money a gift is made from. */
async function earn(f: Fixture, who: Device): Promise<void> {
  assert.equal((await f.action(who.cookie, { type: 'apply-job', id: 'teaching' })).code, 'applied');
  await f.action(who.cookie, { type: 'spot', id: 'work' });
  assert.equal((await f.action(who.cookie, { type: 'activity', id: 'teaching-shift' })).code, 'started');
  f.advance(SHIFT_SECONDS * 1000);
  assert.equal((await get(f, '/api/life?city=lagos', who)).state.social.earned, 3000);
}
const ask = (f: Fixture, from: Device, to: Device, extra: Record<string, unknown> = {}) => post(f, '/api/social/money-requests', { to: to.id, amount: 500, clientId: f.id(), ...extra }, from);
const settle = (f: Fixture, who: Device, id: string, op: 'pay' | 'decline' | 'cancel', extra: Record<string, unknown> = {}) => post(f, '/api/social/money-requests/answer', { id, op, cityId: 'lagos', clientId: f.id(), ...extra }, who);
const cash = async (f: Fixture, who: Device): Promise<number> => (await get(f, '/api/life?city=lagos', who)).state.cash;
const thread = async (f: Fixture, who: Device, other: Device): Promise<Message[]> => {
  const conv = (await get(f, '/api/social/conversations', who)).conversations.find((item) => item.with === other.id);
  return conv ? (await get(f, `/api/social/conversations/${encodeURIComponent(conv.id)}`, who)).messages : [];
};
const requestIn = async (f: Fixture, who: Device, other: Device, id: string): Promise<MoneyRequestView | undefined> => (await thread(f, who, other)).find((line) => line.request?.id === id)?.request;
/** Ada (who has earned ₦3,000 and can give) and Bola, friends; Bola asks Ada. */
async function pair(f: Fixture) {
  const [ada, bola] = await people(f, ['Ada', 'Bola']) as [Device, Device];
  await befriend(f, ada, bola);
  await earn(f, ada);
  return { ada, bola };
}

test('a request is a typed card in both threads: amount, note, state, and who may do what', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const made = await ask(f, bola, ada, { amount: 800, note: 'for the gas' });
  assert.deepEqual([made.status, made.code], [200, 'requested']);
  const id = made.request.id;
  assert.deepEqual(made.request, { id, amount: 800, note: 'for the gas', state: 'open', mine: true, expiresAt: f.now() + MONEY_REQUEST.expiresMs, payable: false });
  assert.equal(made.message.request?.id, id);
  const asker = await thread(f, bola, ada), payer = await thread(f, ada, bola);
  assert.deepEqual([asker.at(-1)?.request?.mine, asker.at(-1)?.request?.payable], [true, false]);
  assert.deepEqual([payer.at(-1)?.request?.mine, payer.at(-1)?.request?.payable, payer.at(-1)?.request?.amount, payer.at(-1)?.request?.note], [false, true, 800, 'for the gas']);
  assert.match(payer.at(-1)?.body ?? '', /Asked for ₦800/);
  assert.equal(payer.at(-1)?.gift, undefined, 'it is not a gift line');
  // The money has not moved, and the card cannot be edited, deleted or forwarded as words.
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [8000, 5000]);
  const line = payer.at(-1)!;
  assert.equal((await post(f, `/api/social/conversations/${encodeURIComponent(line.conv)}/message`, { seq: line.seq, op: 'delete', version: 0, clientId: f.id() }, bola)).code, 'not_allowed');
  // What is stored: one record, apart from the chat.
  const stored = await f.server.store.read((db) => JSON.parse(JSON.stringify(db.social?.moneyRequests)) as Record<string, unknown>);
  assert.deepEqual(stored[id], { id, from: bola.id, to: ada.id, n: 800, note: 'for the gas', at: f.now(), expires: f.now() + MONEY_REQUEST.expiresMs, state: 'open', conv: line.conv, seq: line.seq });
});

test('a request is refused for strangers, yourself, a bad amount, a bad note, and a repeated id changes nothing', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await people(f, ['Ada', 'Bola', 'Chi']) as [Device, Device, Device];
  await befriend(f, ada, bola);
  assert.equal((await ask(f, bola, chi)).code, 'friends_only');
  assert.equal((await ask(f, bola, bola)).code, 'self');
  for (const amount of [0, -5, 2.5, '500', null, 1e21]) assert.equal((await ask(f, bola, ada, { amount })).status, 400, String(amount));
  assert.equal((await ask(f, bola, ada, { amount: TRANSFER_LIMITS.min - 1 })).code, 'amount_too_small');
  assert.equal((await ask(f, bola, ada, { amount: TRANSFER_LIMITS.maxPerTransfer + 1 })).code, 'amount_too_large');
  assert.equal((await ask(f, bola, ada, { note: 'x'.repeat(MONEY_REQUEST.noteMax + 1) })).error, 'invalid_note');
  assert.equal((await ask(f, bola, ada, { note: 'the retards' })).code, 'text_blocked');
  assert.equal((await ask(f, bola, ada, { note: 'WhatsApp: 08012345678' })).code, 'contact_not_allowed');
  assert.equal((await ask(f, bola, ada, { note: 'join at spam.com' })).code, 'links_not_allowed');
  assert.equal((await post(f, '/api/social/money-requests', { to: ada.id, amount: 500 }, bola)).error, 'client_id_required');
  assert.equal(await f.server.store.read((db) => db.social?.moneyRequests), undefined, 'refusals stored nothing');
  const clientId = f.id();
  const first = await ask(f, bola, ada, { clientId });
  const again = await ask(f, bola, ada, { clientId });
  assert.deepEqual([again.code, again.duplicate, again.request.id], ['requested', true, first.request.id]);
  assert.equal((await ask(f, bola, ada, { clientId, amount: 600 })).status, 409);
  assert.equal((await thread(f, ada, bola)).filter((line) => line.request).length, 1);
});

test('paying settles once, as a gift, and the paid request carries the transfer receipt', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const { request } = await ask(f, bola, ada, { amount: 700 });
  const clientId = f.id(), transferId = peerTransferId(ada.id, clientId);
  const paid = await settle(f, ada, request.id, 'pay', { clientId });
  assert.deepEqual([paid.code, paid.amount, paid.balance, paid.receipt, paid.request.state, paid.request.receipt], ['paid', 700, 7300, transferId, 'paid', transferId]);
  const wallet = async () => (await f.server.store.read((db) => db.walletEffects?.filter((row) => row.transferId === transferId).map((row) => [row.publicId, row.amount]))) ?? [];
  await get(f, '/api/social/me', bola);
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [7300, 5700]);
  assert.deepEqual(await wallet(), [[ada.id, -700], [bola.id, 700]]);
  // The same call again: the same answer, no second payment.
  const replay = await settle(f, ada, request.id, 'pay', { clientId });
  assert.deepEqual([replay.code, replay.duplicate, replay.receipt, replay.balance], ['paid', true, transferId, 7300]);
  // A different call (a new id) finds it already paid.
  const second = await settle(f, ada, request.id, 'pay');
  assert.deepEqual([second.ok, second.code], [false, 'request_paid']);
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [7300, 5700]);
  assert.equal((await wallet()).length, 2);
  // Both threads now say so, and the payment is an ordinary gift line.
  for (const [who, other] of [[ada, bola], [bola, ada]] as const) {
    const lines = await thread(f, who, other);
    assert.deepEqual([lines.find((line) => line.request)?.request?.state, lines.find((line) => line.request)?.request?.payable, lines.at(-1)?.gift?.amount], ['paid', false, 700]);
  }
  // A paid request cannot be declined or cancelled either; a stranger to it, and the asker, cannot pay it.
  assert.equal((await settle(f, ada, request.id, 'decline')).code, 'request_paid');
  assert.equal((await settle(f, bola, request.id, 'cancel')).code, 'request_paid');
  assert.equal((await settle(f, bola, request.id, 'pay')).code, 'unknown_request');
  assert.equal((await settle(f, ada, 'MR-999', 'pay')).code, 'unknown_request');
  assert.equal((await settle(f, ada, request.id, 'refund' as 'pay')).error, 'invalid_op');
  assert.equal((await settle(f, ada, 'nonsense', 'pay')).error, 'invalid_request');
  // One id is one operation: it cannot be reused for another request or kind.
  const other = await ask(f, bola, ada, { amount: 300 });
  assert.equal((await settle(f, ada, other.request.id, 'pay', { clientId })).status, 409);
});

test('the payer can decline and the asker can cancel; neither can be undone, and neither can be done by the other side', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const first = (await ask(f, bola, ada)).request.id;
  assert.equal((await settle(f, bola, first, 'decline')).code, 'unknown_request', 'only the one asked can decline');
  assert.equal((await settle(f, ada, first, 'cancel')).code, 'unknown_request', 'only the asker can cancel');
  const declined = await settle(f, ada, first, 'decline');
  assert.deepEqual([declined.code, declined.request.state, declined.request.payable], ['declined', 'declined', false]);
  assert.equal((await settle(f, ada, first, 'pay')).code, 'request_declined');
  assert.equal((await requestIn(f, bola, ada, first))?.state, 'declined');
  const next = (await ask(f, bola, ada)).request.id;
  const cancelled = await settle(f, bola, next, 'cancel');
  assert.deepEqual([cancelled.code, cancelled.request.state], ['cancelled', 'cancelled']);
  assert.equal((await settle(f, ada, next, 'pay')).code, 'request_cancelled');
  assert.equal((await requestIn(f, ada, bola, next))?.payable, false);
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [8000, 5000], 'no money moved');
});

test('a request lapses after its time: it reads as expired and can no longer be paid, declined or cancelled', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const id = (await ask(f, bola, ada)).request.id;
  f.advance(MONEY_REQUEST.expiresMs - 1);
  assert.equal((await requestIn(f, ada, bola, id))?.state, 'open');
  f.advance(1);
  assert.deepEqual([(await requestIn(f, ada, bola, id))?.state, (await requestIn(f, ada, bola, id))?.payable, (await requestIn(f, bola, ada, id))?.state], ['expired', false, 'expired']);
  assert.equal((await settle(f, ada, id, 'pay')).code, 'request_expired');
  assert.equal((await settle(f, ada, id, 'decline')).code, 'request_expired');
  assert.equal((await settle(f, bola, id, 'cancel')).code, 'request_expired');
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [8000, 5000]);
  // The asker may ask again once it has lapsed.
  assert.equal((await ask(f, bola, ada)).code, 'requested');
});

test('paying obeys the gift limits and a refusal leaves the request waiting to be paid', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  // More than the payer has earned: the same refusal a gift gets.
  const big = (await ask(f, bola, ada, { amount: 4000 })).request.id;
  const refused = await settle(f, ada, big, 'pay');
  assert.deepEqual([refused.ok, refused.code], [false, 'gift_exceeds_earned']);
  assert.match(refused.reason, /You can still give ₦3,000/);
  assert.equal((await requestIn(f, ada, bola, big))?.state, 'open');
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [8000, 5000]);
  assert.equal((await settle(f, bola, big, 'cancel')).code, 'cancelled');
  // The daily limit of three gifts: the fourth payment, request or not, is refused.
  f.advance(MINUTE);
  for (let i = 0; i < TRANSFER_LIMITS.dailyCount; i += 1) {
    f.advance(MINUTE);
    assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 100, cityId: 'lagos', clientId: f.id() }, ada)).code, 'sent');
  }
  f.advance(MINUTE);
  const late = (await ask(f, bola, ada, { amount: 200 })).request.id;
  const limit = await settle(f, ada, late, 'pay');
  assert.deepEqual([limit.ok, limit.code], [false, 'daily_transfer_limit']);
  assert.equal((await requestIn(f, bola, ada, late))?.state, 'open');
  assert.equal((await post(f, '/api/social/transfers', { to: bola.id, amount: 200, cityId: 'lagos', clientId: f.id() }, ada)).code, 'daily_transfer_limit', 'a plain gift is refused the same way');
  // A request never raised the limit: nothing was sent beyond the three gifts.
  assert.equal(await cash(f, ada), 8000 - 300);
});

test('a request cannot be made or paid across a block, and a block after the request ends it for good', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const id = (await ask(f, bola, ada)).request.id;
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).code, 'blocked');
  assert.equal((await settle(f, ada, id, 'pay')).ok, false);
  const asker = await requestIn(f, bola, ada, id);
  assert.deepEqual([asker?.state, asker?.payable], ['cancelled', false]);
  assert.equal((await ask(f, bola, ada)).code, 'blocked', 'the blocked cannot ask');
  assert.equal((await ask(f, ada, bola)).code, 'blocked', 'nor can the one who blocked');
  // Lifting the block does not bring the old request back.
  assert.equal((await post(f, '/api/social/unblock', { id: bola.id }, ada)).code, 'unblocked');
  assert.equal((await settle(f, ada, id, 'pay')).code, 'request_cancelled');
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [8000, 5000]);
  // The other direction: the asker blocks the payer, and the payer cannot pay.
  f.advance(MINUTE);
  await befriend(f, ada, bola);
  const again = await ask(f, bola, ada);
  assert.equal(again.code, 'requested');
  await post(f, '/api/social/block', { id: ada.id, cityId: 'lagos' }, bola);
  const refused = await settle(f, ada, again.request.id, 'pay');
  assert.deepEqual([refused.ok, await cash(f, ada)], [false, 8000]);
});

test('payment needs the friendship still: after an unfriend the request is refused and left pending', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const id = (await ask(f, bola, ada)).request.id;
  assert.equal((await post(f, '/api/social/friends/remove', { id: bola.id, cityId: 'lagos' }, ada)).ok, true);
  const refused = await settle(f, ada, id, 'pay');
  assert.deepEqual([refused.ok, refused.code], [false, 'friends_only']);
  assert.equal((await requestIn(f, ada, bola, id))?.state, 'open');
  assert.equal(await cash(f, ada), 8000);
});

test('requests are rate limited: one open per friend, three a day per friend, ten a day in all, and a few a minute', async (t) => {
  const f = await fixture(t);
  const [bola, ...friends] = await people(f, ['Bola', 'Ada', 'Chi', 'Dayo', 'Efe']) as [Device, ...Device[]];
  for (const friend of friends) await befriend(f, bola, friend);
  const [ada, chi, dayo, efe] = friends as [Device, Device, Device, Device];
  const first = await ask(f, bola, ada);
  assert.equal(first.code, 'requested');
  const open = await ask(f, bola, ada);
  assert.deepEqual([open.ok, open.code], [false, 'request_open']);
  // Per friend per day: cancel and ask again, three in all.
  for (let i = 1; i < MONEY_REQUEST.perPairPerDay; i += 1) {
    f.advance(MINUTE);
    assert.equal((await settle(f, bola, i === 1 ? first.request.id : (await thread(f, bola, ada)).filter((line) => line.request).at(-1)!.request!.id, 'cancel')).code, 'cancelled');
    assert.equal((await ask(f, bola, ada)).code, 'requested');
  }
  f.advance(MINUTE);
  const latest = (await thread(f, bola, ada)).filter((line) => line.request).at(-1)!.request!.id;
  await settle(f, bola, latest, 'cancel');
  const day = await ask(f, bola, ada);
  assert.deepEqual([day.ok, day.code], [false, 'request_limit']);
  assert.match(day.reason, new RegExp(`${MONEY_REQUEST.perPairPerDay} times a day`));
  // Ten a day in all: three friends take nine, the tenth is Efe's, the eleventh is refused.
  let made = MONEY_REQUEST.perPairPerDay;
  for (const friend of [chi, dayo]) for (let i = 0; i < MONEY_REQUEST.perPairPerDay; i += 1) {
    f.advance(MINUTE);
    const got = await ask(f, bola, friend);
    assert.equal(got.code, 'requested'); made += 1;
    await settle(f, bola, got.request.id, 'cancel');
  }
  f.advance(MINUTE);
  assert.equal((await ask(f, bola, efe)).code, 'requested'); made += 1;
  assert.equal(made, MONEY_REQUEST.perDay);
  f.advance(MINUTE);
  const over = await ask(f, bola, efe);
  assert.deepEqual([over.ok, over.code], [false, 'request_open']);
  const all = await ask(f, bola, ada);
  assert.deepEqual([all.ok, all.code], [false, 'request_limit']);
  // A day later the count has gone.
  f.advance(24 * HOUR);
  assert.equal((await ask(f, bola, ada)).code, 'requested');
});

test('requests made faster than the per-minute allowance are refused', async (t) => {
  const f = await fixture(t);
  const [bola, ada, chi] = await people(f, ['Bola', 'Ada', 'Chi']) as [Device, Device, Device];
  await befriend(f, bola, ada); await befriend(f, bola, chi);
  const codes: string[] = [];
  // Three to one friend and two to the other, each cancelled, all inside one minute.
  for (const friend of [ada, ada, ada, chi, chi]) {
    const got = await ask(f, bola, friend);
    codes.push(got.code);
    await settle(f, bola, got.request.id, 'cancel');
  }
  assert.deepEqual(codes, Array(MONEY_REQUEST.perMinute).fill('requested'));
  const sixth = await ask(f, bola, chi);
  assert.deepEqual([sixth.ok, sixth.code], [false, 'rate_limited']);
  f.advance(MINUTE + 1);
  assert.equal((await ask(f, bola, chi)).code, 'requested');
});

test('a pending request survives a restart of the server and is paid once afterwards', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const id = (await ask(f, bola, ada, { amount: 900, note: 'dinner' })).request.id;
  await f.flush();
  f.server.closeAllConnections(); await new Promise((resolve) => f.server.close(resolve));
  await f.server.store.close?.();
  const again = await createServer({ dataDir: f.dir, now: f.now, sessionTtlMs: 2592000000 });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  const stop = async (): Promise<void> => { again.closeAllConnections(); await new Promise((resolve) => again.close(resolve)); await again.store.close?.(); };
  const call = async (path: string, body?: object, who?: Device): Promise<Reply> => {
    const res = await fetch(`http://127.0.0.1:${(again.address() as AddressInfo).port}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: who?.cookie ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return answer(res);
  };
  const conv = (await call('/api/social/conversations', undefined, ada)).conversations.find((item) => item.with === bola.id)!;
  const seen = (await call(`/api/social/conversations/${encodeURIComponent(conv.id)}`, undefined, ada)).messages.find((line) => line.request)?.request;
  assert.deepEqual([seen?.id, seen?.state, seen?.payable, seen?.note], [id, 'open', true, 'dinner']);
  const clientId = f.id();
  const paid = await call('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId }, ada);
  assert.deepEqual([paid.code, paid.balance, paid.receipt], ['paid', 7100, peerTransferId(ada.id, clientId)]);
  const replay = await call('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId }, ada);
  assert.deepEqual([replay.duplicate, replay.balance], [true, 7100]);
  assert.equal((await call('/api/social/money-requests/answer', { id, op: 'pay', cityId: 'lagos', clientId: f.id() }, ada)).code, 'request_paid');
  assert.equal((await call('/api/life?city=lagos', undefined, ada)).state.cash, 7100);
  await stop();
});

test('trimming a long chat cannot lose a pending request: it is still paid by its id, and stays paid', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const id = (await ask(f, bola, ada, { amount: 400 })).request.id;
  for (let i = 0; i < LIMITS.history + 5; i += 1) {
    if (i % 25 === 0) f.advance(MINUTE);
    assert.equal((await post(f, '/api/social/messages', { to: ada.id, body: `line ${i}`, clientId: f.id() }, bola)).code, 'sent');
  }
  const lines = await thread(f, ada, bola);
  assert.ok(!lines.some((line) => line.request?.id === id), 'the card has been trimmed out of the thread');
  const paid = await settle(f, ada, id, 'pay');
  assert.deepEqual([paid.code, paid.amount, paid.request.state], ['paid', 400, 'paid']);
  assert.equal((await settle(f, ada, id, 'pay')).code, 'request_paid');
  assert.equal(await cash(f, ada), 7600);
});

test('a closed request is forgotten after two days; its card keeps how it ended, and it can no longer be answered', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const paidId = (await ask(f, bola, ada)).request.id;
  assert.equal((await settle(f, ada, paidId, 'pay')).code, 'paid');
  f.advance(MINUTE);
  const lapsedId = (await ask(f, bola, ada)).request.id;
  f.advance(MONEY_REQUEST.keepMs + LIMITS.sweepMs + HOUR);
  await get(f, '/api/social/me', ada); await get(f, '/api/social/me', bola);
  await f.server.store.transact((db) => { if (db.social) db.social.sweptAt = 0; });
  await get(f, '/api/social/me', ada);
  assert.equal(await f.server.store.read((db) => db.social?.moneyRequests), undefined, 'both records are gone');
  assert.equal((await requestIn(f, ada, bola, paidId))?.state, 'paid');
  assert.equal((await requestIn(f, ada, bola, lapsedId))?.state, 'expired');
  assert.equal((await settle(f, ada, lapsedId, 'pay')).code, 'unknown_request');
});

test('both players are told live: the card arrives on a socket, and its change after payment follows', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  const [adaSocket, bolaSocket] = [await f.socket(ada), await f.socket(bola)];
  const next = async (peer: Awaited<ReturnType<Fixture['socket']>>, type: string) => { for (let i = 0; i < 100; i += 1) { const frame = await peer.next(); if (frame.type === type) return frame; } throw Error(`no ${type}`); };
  const id = (await ask(f, bola, ada)).request.id;
  const arrived = await next(adaSocket, 'dm');
  assert.equal(arrived.type === 'dm' ? arrived.message.request?.id : null, id);
  assert.equal(arrived.type === 'dm' ? arrived.message.request?.payable : null, true);
  await settle(f, ada, id, 'pay');
  for (const peer of [adaSocket, bolaSocket]) {
    const changed = await next(peer, 'message-changed');
    assert.equal(changed.type === 'message-changed' ? changed.message.request?.state : null, 'paid');
  }
});

test('paying keeps a money-class receipt: a flood of light receipts neither blocks nor evicts it, and a replay never pays twice', async (t) => {
  const LIGHT = 12, limits = { perPlayer: 50, global: 30, lightPerPlayer: LIGHT, lightGlobal: 20 };
  const f = await fixture(t, { receiptLimits: limits });
  const { ada, bola } = await pair(f);
  const clientId = f.id(), transferId = peerTransferId(ada.id, clientId);
  const first = await ask(f, bola, ada, { amount: 700 });
  const paid = await settle(f, ada, first.request.id, 'pay', { clientId });
  assert.equal(paid.code, 'paid');
  const kinds = async () => (await f.server.store.read((db) => Object.values(db.sessions).flatMap((record) => Object.values(record.once ?? {}).map((receipt) => receipt.kind)))) ?? [];
  assert.equal((await kinds()).filter((kind) => kind === 'money.pay').length, 1, 'the payment is a money receipt, not a light one');
  // Fill Ada's light allowance with receipts that are still live: light work is refused, money is not.
  await f.server.store.transact((db) => {
    const record = Object.values(db.sessions).find((item) => item.publicId === ada.id)!;
    const once = (record.once ??= {});
    for (let i = 0; i < LIGHT; i++) once[`${f.now()}:00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`] = { at: f.now(), kind: 'money.answer', fp: 'synthetic', result: { ok: true, code: 'probe' } };
  });
  assert.deepEqual([(await settle(f, ada, 'MR-999', 'decline')).status, (await ask(f, ada, bola)).status], [429, 429], 'light work is refused');
  const replay = await settle(f, ada, first.request.id, 'pay', { clientId });
  assert.deepEqual([replay.code, replay.duplicate, replay.receipt, replay.balance], ['paid', true, transferId, 7300], 'the receipt was kept and answers again');
  assert.equal((await kinds()).filter((kind) => kind === 'money.pay').length, 1, 'nothing was evicted');
  // Past the window the id itself is refused, so a replay is never run again; the request is already paid either way.
  f.advance(25 * HOUR);
  const late = await settle(f, ada, first.request.id, 'pay', { clientId });
  assert.equal(late.ok === true && !late.duplicate, false, 'not paid a second time');
  await get(f, '/api/social/me', bola);
  assert.deepEqual([await cash(f, ada), await cash(f, bola)], [7300, 5700]);
  const rows = await f.server.store.read((db) => db.walletEffects?.filter((row) => row.transferId === transferId).length);
  assert.equal(rows, 2, 'one debit and one credit, ever');
});

test('the first request between two friends who have never written makes the chat and shows the card to both', async (t) => {
  const f = await fixture(t);
  const { ada, bola } = await pair(f);
  assert.equal((await get(f, '/api/social/conversations', bola)).conversations.some((item) => item.with === ada.id), false, 'no chat yet');
  const made = await ask(f, bola, ada, { amount: 400, note: 'First' });
  assert.equal(made.code, 'requested');
  assert.equal(made.message.conv.includes('#'), false);
  for (const [who, other, mine] of [[bola, ada, true], [ada, bola, false]] as const) {
    const lines = await thread(f, who, other);
    assert.deepEqual([lines.length, lines[0]?.request?.amount, lines[0]?.request?.mine, lines[0]?.conv], [1, 400, mine, made.message.conv]);
  }
});
