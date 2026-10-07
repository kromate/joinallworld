// OWNER: social — REALISM R13, a regular's offer to introduce two players (server/social/introductions.ts, service.people / service.introduce).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { INTRO_TOLD_KEPT, TOLD_FOR_MS, VENUES_KEPT, VISIT_GAP_MS, forgetVisits, introductionFor, markTold, noteVisit, seenApart } from './social/introductions.ts';
import type { SocialPlayerRecord } from './types.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Reply { status: number; ok: boolean; code: string; reason: string; players: { id: string }[]; introduction?: { id: string; name: string }; prefs: { introductions: string }; requests: { in: { id: string }[] }; [key: string]: unknown }
const MIN = 60_000;
const answer = async (res: Response): Promise<Reply> => ({ status: res.status, ...((await res.json()) as object) } as Reply);
const get = async (f: Fixture, path: string, who: Device): Promise<Reply> => answer(await f.request(path, null, who.cookie));
const post = async (f: Fixture, path: string, body: unknown, who: Device): Promise<Reply> => answer(await f.request(path, body, who.cookie));
const listing = (f: Fixture, who: Device): Promise<Reply> => get(f, '/api/social/people?city=lagos', who);
const turn = (f: Fixture, who: Device, introductions: 'on' | 'off'): Promise<Reply> => post(f, '/api/social/prefs', { introductions }, who);
async function met<const N extends readonly string[]>(f: Fixture, names: N): Promise<{ [K in keyof N]: Device }> {
  const made: Device[] = [];
  for (const name of names) { const who = await f.device(name); await get(f, '/api/social/me', who); made.push(who); }
  return made as { [K in keyof N]: Device };
}
const stored = async (f: Fixture, who: Device): Promise<SocialPlayerRecord> => {
  await f.flush();
  const db = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as { social: { players: Record<string, SocialPlayerRecord> } };
  const found = db.social.players[who.id];
  if (!found) throw new Error('no social record');
  return found;
};
/** Ada and Bola are in the park, each seen on two separate visits that did not overlap, so a regular has seen them apart. Returns the open sockets. */
async function seenApartInPark(f: Fixture, ada: Device, bola: Device): Promise<{ close: () => void }> {
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  await listing(f, ada);              // minute 0: Ada's first visit
  f.advance(10 * MIN);
  await listing(f, bola);             // minute 10: Bola's first visit
  f.advance(15 * MIN);
  await listing(f, ada);              // minute 25: Ada's second visit (the one before spanned minute 0)
  f.advance(15 * MIN);
  await listing(f, bola);             // minute 40: Bola's second visit (the one before spanned minute 10)
  return { close: () => { a.ws.close(); b.ws.close(); } };
}

const record = (extra: Partial<SocialPlayerRecord> = {}): SocialPlayerRecord => ({ name: 'X', introductions: 'on', ...extra } as SocialPlayerRecord);

test('visits are counted only with the setting on, a gap makes a new visit, and the record is bounded', () => {
  const off = record(); delete off.introductions;
  noteVisit(off, 'lagos:park', 1000);
  assert.equal(off.introVisits, undefined, 'nothing is kept when the setting is off');
  const p = record();
  noteVisit(p, 'lagos:park', 1000);
  noteVisit(p, 'lagos:park', 1000 + VISIT_GAP_MS - 1);
  assert.deepEqual(p.introVisits?.['lagos:park'], { n: 1, from: 1000, at: 1000 + VISIT_GAP_MS - 1 });
  noteVisit(p, 'lagos:park', 1000 + 2 * VISIT_GAP_MS);
  assert.deepEqual(p.introVisits?.['lagos:park'], { n: 2, from: 1000 + 2 * VISIT_GAP_MS, at: 1000 + 2 * VISIT_GAP_MS, pf: 1000, pt: 1000 + VISIT_GAP_MS - 1 });
  for (let i = 0; i < VENUES_KEPT + 10; i += 1) noteVisit(p, `lagos:v${i}`, 10_000_000 + i);
  assert.equal(Object.keys(p.introVisits ?? {}).length, VENUES_KEPT);
  forgetVisits(p);
  assert.equal(p.introVisits, undefined);
});

test('a damaged old visit record is rebuilt rather than trusted', () => {
  const p = record({ introVisits: { 'lagos:park': { n: 'x', from: null, at: 5 } as never } });
  noteVisit(p, 'lagos:park', 9000);
  assert.deepEqual(p.introVisits?.['lagos:park'], { n: 1, from: 9000, at: 9000 });
});

test('two players are seen apart only when each came before and the earlier visits did not overlap', () => {
  const span = (pf?: number, pt?: number): SocialPlayerRecord => record(pf === undefined ? { introVisits: { k: { n: 1, from: 1, at: 1 } } } : { introVisits: { k: { n: 2, from: 100, at: 100, pf, pt } } });
  assert.equal(seenApart(span(0, 5), span(10, 15), 'k'), true);
  assert.equal(seenApart(span(10, 15), span(0, 5), 'k'), true);
  assert.equal(seenApart(span(0, 12), span(10, 15), 'k'), false, 'overlapping visits are one meeting, not two');
  assert.equal(seenApart(span(), span(10, 15), 'k'), false, 'a first visit has nothing before it');
  assert.equal(seenApart(span(0, 5), record(), 'k'), false);
});

test('an offer needs both players to have it on, skips anyone already told about, and the told list is bounded', () => {
  const me = record({ introVisits: { k: { n: 2, from: 100, at: 100, pf: 0, pt: 5 } } });
  const them = (id: string, extra: Partial<SocialPlayerRecord> = {}): { id: string; record: SocialPlayerRecord } => ({ id, record: record({ introVisits: { k: { n: 2, from: 100, at: 100, pf: 10, pt: 15 } }, ...extra }) });
  const quiet = them('a'); delete quiet.record.introductions;
  assert.equal(introductionFor(me, [quiet], 'k', 200), null, 'the other player has it off');
  assert.equal(introductionFor(me, [them('c'), them('b')], 'k', 200), 'b', 'the lowest id wins, so the offer is steady');
  const off = record({ introVisits: me.introVisits }); delete off.introductions;
  assert.equal(introductionFor(off, [them('b')], 'k', 200), null, 'the caller has it off');
  markTold(me, 'b', 200);
  assert.equal(introductionFor(me, [them('b')], 'k', 300), null);
  assert.equal(introductionFor(me, [them('d')], 'k', 300), null, 'one answered offer a day');
  assert.equal(introductionFor(me, [them('d')], 'k', 200 + 86_400_000 + 1), 'd');
  assert.equal(introductionFor(me, [them('b')], 'k', 200 + TOLD_FOR_MS + 1), 'b', 'offered again a week on');
  for (let i = 0; i < INTRO_TOLD_KEPT + 8; i += 1) markTold(me, `p${i}`, 1000 + i);
  assert.equal(Object.keys(me.introTold ?? {}).length, INTRO_TOLD_KEPT);
});

test('introductions are off by default, old saves load unchanged, and nobody is offered anyone', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await met(f, ['Ada', 'Bola']);
  assert.equal((await get(f, '/api/social/me', ada)).prefs.introductions, 'off');
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  const seen = await listing(f, ada);
  assert.equal(seen.introduction, undefined);
  assert.equal((await stored(f, ada)).introVisits, undefined, 'a player with it off has no visit record');
  assert.equal((await post(f, '/api/social/prefs', { introductions: 'maybe' }, ada)).status, 400);
  assert.equal((await post(f, '/api/social/introduction', { to: bola.id, cityId: 'lagos', answer: 'accept' }, ada)).code, 'no_introduction');
  a.ws.close(); b.ws.close();
});

test('a regular offers an introduction to a stranger seen on a separate visit; saying hello sends an ordinary friend request', async (t) => {
  const f = await fixture(t);
  const [ada, bola, chi] = await met(f, ['Ada', 'Bola', 'Chidi']);
  for (const who of [ada, bola]) assert.equal((await turn(f, who, 'on')).prefs.introductions, 'on');
  const c = await f.joinRoom(chi);
  const open = await seenApartInPark(f, ada, bola);
  const offered = await listing(f, ada);
  assert.deepEqual(offered.introduction, { id: bola.id, name: 'Bola' });
  assert.deepEqual((await listing(f, bola)).introduction, { id: ada.id, name: 'Ada' });
  // Chidi has not turned it on: he is in the room and in the list, but is never the subject of an offer, and nobody is named to him.
  const aloof = await listing(f, chi);
  assert.equal(aloof.introduction, undefined);
  assert.ok(offered.players.some((player) => player.id === chi.id));
  // A player who is here but not on offer is refused the same way as an expired offer.
  assert.equal((await post(f, '/api/social/introduction', { to: chi.id, cityId: 'lagos', answer: 'accept' }, ada)).code, 'no_introduction');
  assert.equal((await post(f, '/api/social/introduction', { to: bola.id, cityId: 'lagos', answer: 'perhaps' }, ada)).status, 400);
  const done = await post(f, '/api/social/introduction', { to: bola.id, cityId: 'lagos', answer: 'accept' }, ada);
  assert.equal(done.code, 'requested');
  assert.deepEqual((await get(f, '/api/social/me', bola)).requests.in.map((request) => request.id), [ada.id]);
  assert.equal((await listing(f, ada)).introduction, undefined, 'not offered again once answered');
  open.close(); c.ws.close();
});

test('turning a pair down is remembered, and a blocked player is never offered', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await met(f, ['Ada', 'Bola']);
  for (const who of [ada, bola]) await turn(f, who, 'on');
  const open = await seenApartInPark(f, ada, bola);
  assert.equal((await post(f, '/api/social/introduction', { to: bola.id, cityId: 'lagos', answer: 'decline' }, ada)).code, 'declined');
  assert.equal((await listing(f, ada)).introduction, undefined);
  assert.deepEqual((await listing(f, bola)).introduction, { id: ada.id, name: 'Ada' }, 'only the one who answered stops being offered');
  assert.equal((await post(f, '/api/social/block', { id: ada.id, cityId: 'lagos' }, bola)).code, 'blocked');
  assert.equal((await listing(f, bola)).introduction, undefined);
  open.close();
});

test('switching it off deletes the visit record and ends the offers', async (t) => {
  const f = await fixture(t);
  const [ada, bola] = await met(f, ['Ada', 'Bola']);
  for (const who of [ada, bola]) await turn(f, who, 'on');
  const open = await seenApartInPark(f, ada, bola);
  assert.ok((await stored(f, ada)).introVisits, 'kept while it is on');
  assert.equal((await turn(f, ada, 'off')).prefs.introductions, 'off');
  const after = await stored(f, ada);
  assert.deepEqual([after.introductions, after.introVisits], [undefined, undefined]);
  assert.equal((await listing(f, bola)).introduction, undefined, 'the other player is no longer offered someone who has it off');
  open.close();
});
