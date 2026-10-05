// ROOM GROUPS UNDER LOAD: a thousand players in one venue. Each page is sent the frames of its own group only (never more than
// the group maximum plus two members), and what the server sends per step — everybody moving once — is bounded by the size of
// a group, not of the venue. The "whole room" figure is what the room's member list cost before groups: one list of everybody
// to everybody on every move (docs/CAPACITY.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture } from './test-fixture.ts';
import { ROOM_GROUP_MAX, ROOM_GROUP_OVERFLOW } from '../src/game/roomGroups.ts';

const PLAYERS = Number(process.env['LOAD_PLAYERS'] || 1000);
interface Frame { type: string; members?: { id: string }[]; joined?: { id: string }[]; left?: string[]; moved?: { id: string }[]; voice?: { id: string }[] }
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

test(`${PLAYERS} players in one venue: every page hears of at most ${ROOM_GROUP_MAX + ROOM_GROUP_OVERFLOW} members, and a step costs a fraction of the whole-room list`, { timeout: 120000 }, async (t) => {
  const f = await fixture(t, { maxSockets: PLAYERS + 100, socketsPerAddress: PLAYERS + 100, maxActiveSessions: PLAYERS + 100 });
  const pages: { ws: WebSocket; id: string; seen: Set<string>; bytes: number; frames: number }[] = [];
  t.after(() => { for (const page of pages) page.ws.terminate(); });
  // Everyone arrives, a few at a time.
  for (let from = 0; from < PLAYERS; from += 50) {
    f.advance(61000); // one address may open 60 sockets a minute: the test clock lets the next batch in
    await Promise.all(Array.from({ length: Math.min(50, PLAYERS - from) }, async (_, offset) => {
      const device = await f.device(`Player${from + offset}`);
      const ws = new WebSocket(`${f.base.replace('http', 'ws')}/socket`, { headers: { Cookie: device.cookie, Origin: f.base } });
      const page = { ws, id: device.id, seen: new Set<string>(), bytes: 0, frames: 0 };
      pages.push(page);
      ws.on('message', (data) => {
        const text = data.toString();
        page.bytes += text.length; page.frames += 1;
        const frame = JSON.parse(text) as Frame;
        for (const member of [...(frame.members ?? []), ...(frame.joined ?? []), ...(frame.moved ?? []), ...(frame.voice ?? [])]) page.seen.add(member.id);
        for (const id of frame.left ?? []) page.seen.add(id);
      });
      await once(ws, 'open');
      ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park', deltas: true }));
    }));
  }
  const settled = async (): Promise<void> => { let last = -1; for (let i = 0; i < 100; i++) { const now = pages.reduce((sum, page) => sum + page.frames, 0); if (now === last) return; last = now; await pause(200); } };
  await settled();
  for (const page of pages) assert.ok(page.seen.size <= ROOM_GROUP_MAX + ROOM_GROUP_OVERFLOW, `a page heard of ${page.seen.size} members while joining`);
  const joinBytes = pages.reduce((sum, page) => sum + page.bytes, 0);

  // One step: every player moves once.
  for (const page of pages) { page.bytes = 0; page.frames = 0; }
  await Promise.all(pages.map(async (page, index) => { await pause(index % 40); page.ws.send(JSON.stringify({ type: 'move', x: (index % 17) - 8, z: (index % 13) - 6 })); }));
  await pause(400); await settled();
  const stepBytes = pages.reduce((sum, page) => sum + page.bytes, 0);
  const stepFrames = pages.reduce((sum, page) => sum + page.frames, 0);
  for (const page of pages) assert.ok(page.seen.size <= ROOM_GROUP_MAX + ROOM_GROUP_OVERFLOW, `a page heard of ${page.seen.size} members after the step`);

  // The whole-room list of a thousand members, sent to a thousand pages for every one of the thousand moves.
  const member = (id: string) => ({ id, name: 'Player000', position: { x: -8, z: -6 }, enabled: false, muted: true });
  const whole = JSON.stringify({ type: 'presence', members: pages.map((page) => member(page.id)) }).length;
  const wholeStep = whole * PLAYERS * PLAYERS;
  const factor = wholeStep / stepBytes;
  console.log(`ROOM GROUPS LOAD: ${PLAYERS} players. Joining: ${(joinBytes / 1e6).toFixed(2)} MB in all. One step (everyone moves once): ${stepFrames} frames, ${(stepBytes / 1e6).toFixed(2)} MB = ${Math.round(stepBytes / PLAYERS)} bytes per player; the whole-room list would be ${(wholeStep / 1e9).toFixed(1)} GB (${whole} bytes x ${PLAYERS} pages x ${PLAYERS} moves): ${Math.round(factor)} times more.`);
  assert.ok(stepBytes / PLAYERS < 12000, `a step costs ${Math.round(stepBytes / PLAYERS)} bytes per player`);
  assert.ok(stepFrames <= PLAYERS * 20, 'frames per page per step are bounded by the group, not the venue');
  assert.ok(factor > 1000, `the whole-room list would cost ${Math.round(factor)} times more`);
});
