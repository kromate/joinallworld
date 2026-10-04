// Recovery safety tests: a guest's socket enters a host's Home room only on a visit that is DURABLY
// stored, and in commit order with anything that takes the visit away again.
// Real HTTP and real sockets against a real server. The store's write is held back, released or made
// to fail through its test hook (createStore's `beforeWrite`), so each step is deterministic:
//   - success: while the host's "let them in" is still being written the guest's join shows nothing —
//     no presence to anyone — and the guest is admitted once the write has landed;
//   - failure: the write fails, the visit is undone, and the guest is never in the room;
//   - revoke: the host removes the guest while both are waiting for the disk; the guest is admitted
//     and then dropped, in that order, and never left standing in the room.
// Protocol only: rooms, presence and their errors. No audio or microphone is involved.
//
// ADAPTED TO THIS BRANCH (from the navigation lane's test of the same name; each place is marked):
//   - THE WRITE HOOK. There: createStore(dir, { beforeWrite }). Here the store takes `io`
//     ({ writeFile, rename }) for the same purpose, so the gate wraps writeFile.
//   - ONE STORE. There the scenarios also run with STORE_MODE=legacy. That mode was removed here
//     (createStore refuses it), so only 'grouped' runs.
//   - THE REFUSAL CODE. A join whose basis was undone by a failed write is answered there with
//     'room_unavailable'; here with the store's own 'storage_unavailable', the code every other
//     socket and HTTP refusal for a failed write already carries. In both the join may be sent again.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { fixture, flakyDisk } from './test-fixture.ts';
import type { PresenceFrame, ServerFrame } from '../src/types/protocol.ts';
import type { HouseView } from '../src/types/social.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isFrame = (value: unknown): value is ServerFrame => isRecord(value) && typeof value.type === 'string';
const presenceOf = (frame: ServerFrame): PresenceFrame => { if (frame.type !== 'presence') throw Error('presence expected'); return frame; };
/** A parsed JSON reply with its HTTP status: only the fields these scenarios read. */
interface Reply { status: number; code?: unknown; house?: HouseView }
const reply = async (res: Response): Promise<Reply> => { const body: unknown = await res.json(); if (!isRecord(body)) throw Error('JSON object expected'); return { ...body, status: res.status }; };
const houseOf = (r: Reply): HouseView => { if (!r.house) throw Error('house expected'); return r.house; };

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until<T>(check: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value as NonNullable<T>; await sleep(5); }
  throw Error('Condition never became true');
}
async function open(f: { base: string }, device: { cookie: string }) {
  const ws = new WebSocket(f.base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: f.base } });
  const messages: ServerFrame[] = [];
  ws.on('message', (data) => { const frame: unknown = JSON.parse(data.toString()); if (isFrame(frame)) messages.push(frame); });
  await once(ws, 'open');
  return { ws, messages, send: (message: object) => ws.send(JSON.stringify(message)) };
}
/** Holds the store's next write until released; optionally makes that one write fail. Idle unless armed. */
function writeGate() {
  let hold: Promise<void> | null = null, release: (() => void) | null = null, reached: (() => void) | null = null, fail = false;
  return {
    // (adapted: the store's `io.writeFile` instead of a `beforeWrite` hook)
    async writeFile(...args: Parameters<typeof writeFile>) {
      if (hold) {
        const waiting = hold;
        reached?.();
        await waiting;
        hold = null;
        if (fail) { fail = false; throw Object.assign(new Error('injected write failure'), { code: 'EIO' }); }
      }
      return writeFile(...args);
    },
    /** Hold the next write. Resolves when that write has been reached (its transaction is committed in memory, not on disk). */
    arm() { hold = new Promise<void>((done) => { release = done; }); return new Promise<void>((done) => { reached = done; }); },
    release() { release?.(); },
    failAndRelease() { fail = true; release?.(); },
  };
}

/** A host at home with an open door socket, and a guest who has knocked and is waiting for the answer. */
async function knocked(t: TestContext, mode: string) {
  const gate = writeGate();
  // Teardown must not depend on hook order. The fixture's own hook waits for the HTTP server to
  // close, and that waits for every socket — including the two this test opens itself — and for any
  // write still held by the gate. So stop() (release the gate, end our sockets) is idempotent and is
  // called from the test's `finally` and from a hook on each side of the fixture's.
  const opened: Awaited<ReturnType<typeof open>>[] = [];
  const stop = () => { gate.release(); for (const peer of opened) peer.ws.terminate(); };
  t.after(stop);
  const disk = flakyDisk(); disk.io.writeFile = gate.writeFile; // only the write is gated; rename stays the real one
  const f = await fixture(t, { disk, heartbeatMs: 60000 }); // no heartbeat sweep inside the test: nothing but the join decides
  t.after(stop);
  assert.equal(f.server.store.stats?.().mode, mode);
  const get = async (path: string, who: { cookie: string }) => reply(await f.request(path, null, who.cookie));
  const post = async (path: string, body: object, who: { cookie: string }) => reply(await f.request(path, body, who.cookie));
  const host = await f.device('Host'), guest = await f.device('Guest');
  for (const who of [host, guest]) await get('/api/social/me', who);
  await f.action(host.cookie, { type: 'travel', id: 'home', mode: 'trek' });
  f.advance(20000); // the longest trek is 18 seconds
  const h = await open(f, host); opened.push(h);
  const g = await open(f, guest); opened.push(g);
  h.send({ type: 'join', cityId: 'lagos', venueId: 'home' });
  await until(() => h.messages.find((message) => message.type === 'presence'));
  assert.equal((await post('/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');
  await f.flush();
  const ids = (message: ServerFrame) => presenceOf(message).members.map((member) => member.id).sort();
  const both = (message: ServerFrame) => message.type === 'presence' && [host.id, guest.id].every((id) => message.members.some((member) => member.id === id));
  /** Who the room really holds, read from a fresh presence frame the host's own move triggers. */
  let step = 0;
  const roomNow = async () => {
    h.messages.length = 0; step += 1;
    h.send({ type: 'move', x: step % 10, z: 0 });
    return ids(await until(() => h.messages.find((message) => message.type === 'presence')));
  };
  return {
    f, gate, host, guest, h, g, both, roomNow, stop,
    accept: () => post('/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host),
    remove: () => post('/api/social/house/leave', { host: host.id, guest: guest.id }, host),
    joinAsGuest: () => g.send({ type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id }),
    visit: async () => houseOf(await get(`/api/social/house/${host.id}`, guest)),
    errors: () => g.messages.flatMap((message) => message.type === 'error' ? [message.code] : []),
  };
}

/** One scenario: bounded in time, and the gate is released and our sockets ended whatever happens. */
type Setup = Awaited<ReturnType<typeof knocked>>;
const scenario = (mode: string, name: string, body: (setup: Setup) => Promise<void>) => test(`${mode}: ${name}`, { timeout: 20000 }, async (t) => {
  let setup: Setup | null = null;
  try { setup = await knocked(t, mode); await body(setup); } finally { setup?.stop(); }
});

for (const mode of ['grouped']) { // (adapted: there is one store here; 'legacy' was removed)
  scenario(mode, 'a guest is admitted only after the host’s accept is on disk; ordinary joins are unaffected', async ({ f, gate, host, guest, g, both, roomNow, accept, joinAsGuest, visit, errors }: Setup) => {
    // An ordinary join with nothing waiting for the disk is answered straight away, as before.
    const bystander = await f.device('Bystander');
    const park = await f.joinRoom(bystander);
    park.ws.terminate();
    await f.flush();

    const reached = gate.arm();
    const accepting = accept(); // committed in memory, its write held back
    await reached;
    joinAsGuest();
    await sleep(80);
    assert.deepEqual(g.messages.filter((message) => message.type === 'presence'), [], 'no presence for the guest while the accept is not on disk');
    assert.deepEqual(errors(), []);
    assert.deepEqual(await roomNow(), [host.id], 'and nobody else sees the guest in the room');

    gate.release();
    assert.equal((await accepting).code, 'accepted');
    await until(() => g.messages.find(both));
    assert.deepEqual(await roomNow(), [host.id, guest.id].sort());
    assert.equal((await visit()).role, 'guest');
    assert.deepEqual(errors(), []);
  });

  scenario(mode, 'when the accept’s write fails the guest is never in the room, and a retry admits them', async ({ gate, host, guest, g, both, roomNow, accept, joinAsGuest, visit, errors }: Setup) => {
    const reached = gate.arm();
    const accepting = accept();
    await reached;
    joinAsGuest();
    await sleep(80);
    assert.deepEqual(await roomNow(), [host.id]);

    gate.failAndRelease();
    assert.equal((await accepting).status, 503); // (adapted: a failed write is 503 storage_unavailable here; 500 there)
    // The join is answered with a refusal: the visit it read was undone (grouped), or was never committed (legacy).
    await until(() => errors().length);
    assert.deepEqual(errors(), ['storage_unavailable']); // (adapted: 'room_unavailable' there)
    assert.deepEqual(g.messages.filter((message) => message.type === 'presence'), [], 'the guest never received the room');
    assert.deepEqual(await roomNow(), [host.id], 'and was never in it');
    const house = await visit();
    assert.deepEqual([house.role, house.guests], ['none', []], 'no visit is stored');

    // The disk works again: the same accept commits, and the guest's next join is admitted.
    g.messages.length = 0;
    assert.equal((await accept()).code, 'accepted');
    joinAsGuest();
    await until(() => g.messages.find(both));
    assert.deepEqual(await roomNow(), [host.id, guest.id].sort());
  });

  scenario(mode, 'a guest removed while the accept is still being written is admitted and then dropped, never left in the room', async ({ gate, host, g, both, roomNow, accept, remove, joinAsGuest, visit, errors }: Setup) => {
    const reached = gate.arm();
    const accepting = accept();
    await reached;
    joinAsGuest(); // reads the accepted visit, which is not final yet
    await sleep(40);
    const removing = remove(); // the host takes it away again, also before anything is on disk
    await sleep(40);
    assert.deepEqual(g.messages.filter((message) => message.type === 'presence'), [], 'nothing is shown while neither is final');
    assert.deepEqual(await roomNow(), [host.id]);

    gate.release();
    assert.equal((await accepting).code, 'accepted');
    assert.equal((await removing).code, 'left');
    await until(() => errors().includes('visit_ended'));
    // In commit order: admitted on the accept, then dropped by the removal — not the other way round.
    const admittedAt = g.messages.findIndex(both), droppedAt = g.messages.findIndex((message) => message.type === 'error' && message.code === 'visit_ended');
    assert.ok(admittedAt >= 0 && admittedAt < droppedAt, `admitted (${admittedAt}) before dropped (${droppedAt})`);
    assert.deepEqual(errors(), ['visit_ended']);
    await sleep(60);
    assert.deepEqual(await roomNow(), [host.id], 'the guest is not left in the room');
    assert.equal((await visit()).role, 'none');
  });
}
