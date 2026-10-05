// Property-style test of the server half of idempotency: a seeded random sequence of actions, every
// one of them sent more than once. A repeat must return the recorded outcome, change nothing, and
// still do so after the server restarts (the receipt is on disk before the first answer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { fixture } from './test-fixture.ts';
import { createServer } from './server.ts';
import { makeRng } from '../src/game/util.ts';
import { spotsOf } from '../src/life.ts';
import { VENUES } from '../src/game/content/venues.ts';
import type { AddressInfo } from 'node:net';
import type { SessionRecord } from './types.ts';
import type { LifeState } from '../src/types/life.ts';
import type { TimedId } from '../src/types/protocol.ts';
import type { ActionType } from '../src/types/actions.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const pick = <T>(rng: () => number, list: T[]): T => { const item = list[Math.floor(rng() * list.length)]; if (item === undefined) throw Error('nothing to pick'); return item; };
/** One POST /api/action body of this walk. */
interface WalkBody { actionId: string; cityId: 'lagos'; type: ActionType; payload?: Record<string, unknown> }
/** A parsed JSON reply with its HTTP status: only the fields this test reads. */
interface Reply { status: number; ok?: boolean; code?: unknown; error?: unknown; duplicate?: boolean; state?: LifeState; statement?: { reconciled: unknown; closing: unknown } }
const reply = async (res: Response): Promise<Reply> => { const body: unknown = await res.json(); if (!isRecord(body)) throw Error('JSON object expected'); return { ...body, status: res.status }; };
const stateOf = (r: Reply): LifeState => { if (!r.state) throw Error('no state'); return r.state; };
const isSession = (value: unknown): value is SessionRecord => isRecord(value) && isRecord(value.actions);
const portOf = (server: { address(): string | AddressInfo | null }): number => { const address = server.address(); if (!address || typeof address === 'string') throw Error('The server is not listening on a port'); return address.port; };

test('receipts replay exactly: every action sent twice is applied once, in memory and across a restart', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  const rng = makeRng('server-replay');
  const send = async (base: string, body: object) => reply(await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ada.cookie }, body: JSON.stringify(body) }));
  const stored = async (): Promise<SessionRecord> => { const doc: unknown = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')); const found = isRecord(doc) && isRecord(doc.sessions) ? doc.sessions[ada.cookie.slice(4)] : undefined; if (!isSession(found)) throw Error('session not stored'); return found; };
  let state = stateOf(await reply(await f.request('/api/life?city=lagos', null, ada.cookie)));
  const napOnly: { id: string }[] = [{ id: 'nap' }];
  const sent: { body: WalkBody; ok?: boolean; code?: unknown }[] = [];
  for (let i = 0; i < 80; i++) {
    f.advance(pick(rng, [1000, 6000, 15000, 60000, 400000]));
    const roll = rng();
    const body: WalkBody = { actionId: `${f.now()}:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, cityId: 'lagos',
      ...(roll < 0.3 ? { type: 'travel', payload: { id: pick(rng, Object.keys(VENUES)), mode: pick(rng, ['trek', 'danfo', 'cab', 'okada']) } }
        : roll < 0.45 ? { type: 'spot', payload: { id: pick(rng, spotsOf(state.location, 'lagos')).id } }
        : roll < 0.8 ? { type: 'activity', payload: { id: pick(rng, (spotsOf(state.location, 'lagos').find((spot) => spot.id === state.spot)?.activities ?? napOnly).concat(napOnly)).id } }
        : roll < 0.9 ? { type: 'cancel' } : { type: 'apply-job', payload: { id: pick(rng, ['community-helper', 'tech', 'teaching']) } }) };
    // First delivery, sometimes raced by its own retry.
    const racing = rng() < 0.3;
    const [first, raced] = racing ? await Promise.all([send(f.base, body), send(f.base, body)]) : [await send(f.base, body), null];
    assert.equal(first.status, 200, JSON.stringify(first));
    const original = first.duplicate ? raced : first;
    if (!original) throw Error('a repeat without a raced copy');
    if (racing && raced) assert.deepEqual([[first.duplicate, raced.duplicate].filter(Boolean).length, raced.ok, raced.code], [1, first.ok, first.code], 'of two racing copies exactly one is applied');
    // The receipt is on disk before the answer.
    const receipt = (await stored()).actions[body.actionId as TimedId];
    assert.deepEqual([receipt?.ok, receipt?.code, receipt?.type], [original.ok, original.code, body.type]);
    // A later repeat returns the same outcome and changes neither the wallet nor the ledger.
    const before = stateOf(original);
    const repeat = await send(f.base, body);
    assert.deepEqual([repeat.status, repeat.duplicate, repeat.ok, repeat.code], [200, true, original.ok, original.code], `${body.type} replayed`);
    assert.deepEqual([stateOf(repeat).cash, stateOf(repeat).ledger, stateOf(repeat).inventory], [before.cash, before.ledger, before.inventory]);
    // Reusing the id for something else is refused outright.
    const altered = await send(f.base, { ...body, type: 'travel', payload: { id: 'nowhere', mode: 'trek' } });
    if (!(body.type === 'travel' && body.payload?.id === 'nowhere')) assert.deepEqual([altered.status, altered.error], [409, 'action_id_conflict']);
    state = stateOf(repeat);
    sent.push({ body, ok: original.ok, code: original.code });
  }
  const opening = state.ledger[0];
  const ledgerTotal = state.ledger.reduce((sum, line) => sum + line.amount, 0);
  assert.ok(state.ledger.length > 0 && state.ledger.length < 60, 'every line of this walk is still in the ledger');
  assert.ok(sent.filter((entry) => entry.ok).length >= 25, 'the walk did real things');
  assert.equal(state.cash, (opening?.balance ?? NaN) - (opening?.amount ?? NaN) + ledgerTotal, 'cash is the opening balance plus every ledger line');
  // Restart on the same data: every receipt still answers, and nothing is applied a second time.
  await f.flush();
  const again = await createServer({ dataDir: f.dir, now: f.now, distDir: join(f.dir, 'none') });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(async () => { for (const ws of again.wss.clients) ws.terminate(); again.closeAllConnections(); await new Promise((done) => again.close(done)); });
  const base = `http://127.0.0.1:${portOf(again)}`;
  for (const entry of sent) {
    const replay = await send(base, entry.body);
    assert.deepEqual([replay.status, replay.duplicate, replay.ok, replay.code], [200, true, entry.ok, entry.code], `${entry.body.type} after restart`);
    assert.equal(stateOf(replay).cash, state.cash); assert.deepEqual(stateOf(replay).ledger, state.ledger);
  }
  const statement = (await reply(await fetch(`${base}/api/support/statement?city=lagos`, { headers: { Cookie: ada.cookie } }))).statement;
  assert.deepEqual([statement?.reconciled, statement?.closing], [true, state.cash]);
});
