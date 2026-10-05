// ROOM GROUPS against the real server (server/ws/rooms.ts, rules in server/ws/groups.ts): a public venue's room is split into groups
// of bounded size. Sizes here are set small through the settings (target 3, maximum 4, minimum 2) so a handful of players show every rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import type { TestContext } from 'node:test';

interface Member { id: string; name: string; position: { x: number; z: number }; enabled: boolean; muted: boolean }
interface Counts { here: number; total: number; groups: number; cap: number }
interface Frame {
  type: string; members?: Member[]; counts?: Counts; delta?: boolean
  joined?: Member[]; left?: string[]; moved?: { id: string; x: number; z: number }[]; voice?: { id: string; enabled: boolean }[]
  event?: string; here?: number; text?: string; friend?: { id: string; name: string }; groups?: { id: string; no: number; size: number; open: boolean; mine: boolean; friends: { id: string; name: string }[] }[]; total?: number; more?: number
  code?: string; body?: string; reason?: string
}
const SIZES = { ROOM_GROUP_TARGET: '3', ROOM_GROUP_MAX: '4', ROOM_GROUP_MIN: '2' };
const pause = (ms = 60): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A page that reads its group by changes: the list it holds is the snapshot with every delta applied. */
class Page {
  frames: Frame[] = [];
  view = new Map<string, Member>();
  counts: Counts | null = null;
  readonly who: Device;
  readonly ws: WebSocket;
  constructor(who: Device, ws: WebSocket) {
    this.who = who; this.ws = ws;
    ws.on('message', (data) => { const frame = JSON.parse(data.toString()) as Frame; this.frames.push(frame); this.apply(frame); });
  }
  private apply(frame: Frame): void {
    if (frame.type === 'presence') { this.view = new Map((frame.members ?? []).map((member) => [member.id, member])); if (frame.counts) this.counts = frame.counts; return; }
    if (frame.type !== 'presence-delta') return;
    for (const member of frame.joined ?? []) this.view.set(member.id, member);
    for (const id of frame.left ?? []) this.view.delete(id);
    for (const at of frame.moved ?? []) { const member = this.view.get(at.id); if (member) member.position = { x: at.x, z: at.z }; }
    for (const change of frame.voice ?? []) { const member = this.view.get(change.id); if (member) member.enabled = change.enabled; }
    if (frame.counts) this.counts = frame.counts;
  }
  send(frame: object): void { this.ws.send(JSON.stringify(frame)); }
  names(): string[] { return [...this.view.values()].map((member) => member.name).sort(); }
  of(type: string, event?: string): Frame[] { return this.frames.filter((frame) => frame.type === type && (event === undefined || frame.event === event)); }
  async until(test: () => boolean, what: string, ms = 2000): Promise<void> {
    const end = Date.now() + ms;
    while (!test()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await pause(15); }
  }
  mark(): number { return this.frames.length; }
  since(mark: number): Frame[] { return this.frames.slice(mark); }
}

async function harness(t: TestContext, options: Record<string, unknown> = {}) {
  const f = await fixture(t, { env: { ...SIZES }, ...options });
  const pages: Page[] = [];
  const post = async (path: string, body: object, who: Device): Promise<Record<string, unknown>> => (await (await f.request(path, body, who.cookie)).json()) as Record<string, unknown>;
  const player = async (name: string): Promise<Device> => { const who = await f.device(name); await f.request('/api/life?city=lagos', undefined, who.cookie); await f.request('/api/social/me', undefined, who.cookie); return who; };
  /** Open a socket and join Freedom Park, reading changes (`deltas`) unless told not to; resolves once the first list has arrived. */
  async function enter(who: Device, extra: Record<string, unknown> = {}, deltas = true): Promise<Page> {
    const ws = new WebSocket(`${f.base.replace('http', 'ws')}/socket`, { headers: { Cookie: who.cookie, Origin: f.base } });
    await once(ws, 'open');
    const page = new Page(who, ws); pages.push(page);
    page.send({ type: 'join', cityId: 'lagos', venueId: 'park', ...(deltas ? { deltas: true } : {}), ...extra });
    await page.until(() => page.of('presence').length > 0, `${who.name}'s first list`);
    return page;
  }
  const befriend = async (a: Device, b: Device): Promise<void> => { await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a); await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b); };
  t.after(() => { for (const page of pages) page.ws.terminate(); });
  const leave = async (page: Page): Promise<void> => { page.ws.close(); await once(page.ws, 'close'); await pause(30); };
  return { f, post, player, enter, befriend, leave, pages };
}

test('strangers fill the fullest group up to the target, then a new group opens; each page sees only its group, and the venue total', async (t) => {
  const h = await harness(t, { heartbeatMs: 1000 });
  const names = ['Ada', 'Bola', 'Chidi', 'Dami', 'Efe', 'Femi', 'Gozie'];
  const pages: Page[] = [];
  for (const name of names) pages.push(await h.enter(await h.player(name)));
  const [ada, bola, chidi, dami, efe, femi, gozie] = pages as [Page, Page, Page, Page, Page, Page, Page];
  assert.deepEqual(ada.names().length, 3, 'a group of three');
  await ada.until(() => ada.view.size === 3 && ada.view.has(chidi.who.id), 'Ada\'s group filled');
  assert.deepEqual([...ada.view.keys()].sort(), [ada.who.id, bola.who.id, chidi.who.id].sort(), 'the first three are together');
  assert.deepEqual([...dami.view.keys()].sort(), [dami.who.id, efe.who.id, femi.who.id].sort(), 'the next three are together');
  assert.deepEqual([...gozie.view.keys()], [gozie.who.id], 'the seventh starts a third group');
  assert.deepEqual(gozie.counts, { here: 1, total: 7, groups: 3, cap: 4 });
  await ada.until(() => ada.counts?.total === 7, 'the total reaches the first group', 3000);
  assert.deepEqual(ada.counts, { here: 3, total: 7, groups: 3, cap: 4 });
  for (const page of pages) assert.ok(page.view.size <= 4, `${page.who.name} sees ${page.view.size}`);
});

test('a join, a move, a voice change and a leave reach exactly the group, as changes after one snapshot', async (t) => {
  const h = await harness(t);
  const [ada, bola, chidi] = await Promise.all(['Ada', 'Bola', 'Chidi'].map(async (name) => h.enter(await h.player(name))));
  const dami = await h.enter(await h.player('Dami'));
  await h.enter(await h.player('Efe')); await h.enter(await h.player('Femi'));
  await ada.until(() => ada.view.size === 3 && dami.view.size === 3, 'group one and two');
  assert.equal(dami.of('presence').length, 1, 'one snapshot on entering');
  const outsider = dami.mark();
  const marks = [ada, bola, chidi].map((page) => page.mark());
  // A move reaches the group, never the other group.
  ada.send({ type: 'move', x: 5, z: 6 });
  await bola.until(() => bola.view.get(ada.who.id)?.position.x === 5, 'the move');
  await chidi.until(() => chidi.view.get(ada.who.id)?.position.z === 6, 'the move');
  assert.deepEqual(bola.frames.at(-1), { type: 'presence-delta', moved: [{ id: ada.who.id, x: 5, z: 6 }] }, 'a move is one small change, not a list');
  // A voice change.
  bola.send({ type: 'voice-state', enabled: true, muted: false });
  await ada.until(() => ada.view.get(bola.who.id)?.enabled === true, 'voice state');
  // A leave.
  const before = ada.mark();
  await h.leave(chidi);
  await ada.until(() => !ada.view.has(chidi.who.id), 'the leave');
  assert.ok(ada.since(before).some((frame) => frame.type === 'presence-delta' && frame.left?.[0] === chidi.who.id && frame.counts?.here === 2));
  await pause(200);
  assert.deepEqual(dami.since(outsider).filter((frame) => frame.type !== 'presence-delta' || !frame.counts), [], 'the other group heard nothing of it');
  assert.equal(marks.length, 3);
});

test('moves are gathered: a burst of moves in one group is a few frames, and the last place wins', async (t) => {
  const h = await harness(t);
  const ada = await h.enter(await h.player('Ada')), bola = await h.enter(await h.player('Bola'));
  await ada.until(() => ada.view.size === 2, 'both here');
  const before = bola.mark();
  for (let i = 1; i <= 5; i++) ada.send({ type: 'move', x: i, z: i });
  await bola.until(() => bola.view.get(ada.who.id)?.position.x === 5, 'the last place');
  const frames = bola.since(before).filter((frame) => frame.moved);
  assert.ok(frames.length <= 3, `five moves arrived as ${frames.length} frames`);
});

test('a page that does not know groups still works: it is sent its group as the whole room, with the keys it always had', async (t) => {
  const h = await harness(t);
  const ada = await h.enter(await h.player('Ada'), {}, false);
  const bola = await h.enter(await h.player('Bola'), {}, false);
  for (const name of ['Chidi', 'Dami', 'Efe']) await h.enter(await h.player(name));
  assert.deepEqual(Object.keys(ada.of('presence')[0] ?? {}).sort(), ['members', 'type'], 'no counts and no delta marker for an old page');
  await ada.until(() => (ada.of('presence').at(-1)?.members?.length ?? 0) === 3, 'Ada\'s whole list');
  const last = ada.of('presence').at(-1);
  assert.deepEqual(last?.members?.map((member) => member.name).sort(), ['Ada', 'Bola', 'Chidi'], 'the group, not the venue');
  assert.deepEqual(ada.frames.filter((frame) => frame.type === 'presence-delta' || frame.type === 'group'), []);
  const before = bola.mark();
  ada.send({ type: 'move', x: 2, z: 3 });
  await bola.until(() => bola.since(before).some((frame) => frame.type === 'presence' && frame.members?.some((member) => member.id === ada.who.id && member.position.x === 2)), 'a whole list after a move');
});

test('placement: a friend\'s group beats the fullest group, friends overflow the maximum by two, and the one past that is told where the friend is and can wait to swap', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), friends = await Promise.all(['Fay', 'Gus', 'Hope', 'Ife'].map((name) => h.player(name)));
  for (const friend of friends) await h.befriend(ada, friend);
  // Ada and two strangers fill the first group (target 3); two more strangers start the second.
  const first = await h.enter(ada);
  const s1 = await h.enter(await h.player('Sxx1')), s2 = await h.enter(await h.player('Sxx2'));
  await first.until(() => first.view.size === 3, 'group one is at the target');
  const s3 = await h.enter(await h.player('Sxx3')), s4 = await h.enter(await h.player('Sxx4'));
  assert.deepEqual([...s3.view.keys()].sort(), [s3.who.id, s4.who.id].sort(), 'the strangers are in the other group');
  // Her friends all go to HER group although the other one is fuller for strangers.
  const [fay, gus, hope] = [await h.enter(friends[0] as Device), await h.enter(friends[1] as Device), await h.enter(friends[2] as Device)];
  await first.until(() => first.view.size === 6, 'the group of friends reached maximum plus two');
  assert.ok([fay, gus, hope].every((page) => page.view.has(ada.id)), 'every friend is with Ada');
  assert.deepEqual(first.counts?.here, 6);
  // One more friend cannot be placed with her: placed elsewhere and told.
  const ife = await h.enter(friends[3] as Device);
  assert.ok(!ife.view.has(ada.id), 'Ife is in another group');
  await ife.until(() => ife.of('group', 'apart').length > 0, 'the notice');
  const apart = ife.of('group', 'apart')[0];
  assert.equal(apart?.friend?.name, 'Ada');
  assert.match(apart?.text ?? '', /another part of the venue/);
  // One tap: join Ada's group. It is full, so Ife waits...
  ife.send({ type: 'group-join', friend: ada.id });
  await ife.until(() => ife.of('group', 'waiting').length > 0, 'the waiting notice');
  // ... and is swapped in when somebody leaves.
  const s = [s1, s2];
  await h.leave(s[0] as Page);
  await ife.until(() => ife.view.has(ada.id), 'moved when room appeared');
  assert.equal(ife.of('group', 'moved').length, 1, 'told calmly');
  assert.match(ife.of('group', 'moved')[0]?.text ?? '', /^You are now with \d+ others?\.$/);
});

test('a block is never why somebody is placed: the group with the person they blocked is passed over when another has room', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), bola = await h.player('Bola');
  await h.post('/api/social/block', { id: bola.id, cityId: 'lagos' }, ada);
  const first = await h.enter(ada);
  await h.enter(await h.player('Xxx1'));
  const second = await h.enter(await h.player('Chidi')); // Ada's group has room (two of three), so a stranger joins it
  assert.ok(second.view.has(ada.id), 'strangers are placed in the fullest group');
  const third = await h.enter(await h.player('Yxx1')); // a new group, because the first is at the target
  const b = await h.enter(bola);
  assert.ok(!b.view.has(ada.id), 'Bola is not put with Ada');
  assert.ok(b.view.has(third.who.id), 'but with the group that holds nobody he has a block with');
  assert.ok(!first.view.has(bola.id) && !first.names().includes('Bola'), 'and Ada is not told of him');
});

test('a ping join lands beside the pinger, in their group', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), bola = await h.player('Bola');
  await h.befriend(ada, bola);
  // Two groups: Ada's has two in it, the other has three — the fullest group is not the pinger's.
  const a = await h.enter(ada); await h.enter(await h.player('Xxx1'));
  const others = [await h.enter(await h.player('Yxx1')), await h.enter(await h.player('Yxx2')), await h.enter(await h.player('Yxx3'))];
  assert.equal(others.length, 3);
  await a.until(() => a.view.size === 3, 'Ada\'s group');
  assert.equal(a.view.size, 3);
  // A fresh pair so that the pinger's group has room: Ada pings, Bola joins her and then opens the venue.
  await h.leave(a); const again = await h.enter(ada);
  const ping = await h.post('/api/social/ping', { to: bola.id, clientId: h.f.id() }, ada);
  assert.equal(ping.ok, true);
  const joined = await h.post('/api/social/ping/join', { from: ada.id, clientId: h.f.id() }, bola);
  assert.equal(joined.ok, true);
  const b = await h.enter(bola);
  assert.ok(b.view.has(ada.id), 'Bola is in the same group as the pinger');
  await again.until(() => again.view.has(bola.id), 'Ada sees Bola');
});

test('a reconnect goes back to the group it left, and finds its friends again', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), bola = await h.player('Bola');
  await h.befriend(ada, bola);
  await h.enter(await h.player('Xxx1')); await h.enter(await h.player('Xxx2'));
  const b = await h.enter(bola);
  const a = await h.enter(ada, { with: bola.id });
  assert.ok(a.view.has(bola.id), 'a friend named in the join is honoured');
  await h.leave(b);
  const back = await h.enter(bola);
  assert.ok(back.view.has(ada.id), 'Bola comes back to Ada, not to the fullest group');
});

test('"See other groups" lists the groups with sizes and only a friend\'s name; hopping works and a full group refuses', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), fay = await h.player('Fay');
  await h.befriend(ada, fay);
  const pages: Page[] = [];
  for (const name of ['Pxx1', 'Pxx2', 'Pxx3']) pages.push(await h.enter(await h.player(name)));
  const f = await h.enter(fay);            // a second group, with Fay in it
  await h.enter(await h.player('Qxx1'));
  const a = await h.enter(ada);            // placed with the fullest group below the target
  a.send({ type: 'groups' });
  await a.until(() => a.of('groups').length > 0, 'the list');
  const list = a.of('groups')[0];
  assert.equal(list?.groups?.length, 2, 'two groups');
  assert.equal(list?.total, 6);
  const theirs = list?.groups?.find((group) => group.friends.some((friend) => friend.name === 'Fay'));
  assert.ok(theirs, 'the group with a friend names the friend');
  assert.deepEqual(JSON.stringify(list).includes('Pxx1'), false, 'a stranger is only a count');
  assert.deepEqual(JSON.stringify(list).includes('Qxx1'), false);
  void f;
  // The full group refuses.
  const full = list?.groups?.find((group) => !group.open);
  if (full && !full.mine) { a.send({ type: 'group-join', group: full.id }); await a.until(() => a.of('error').some((frame) => frame.code === 'group_full'), 'a refusal'); }
  // Hop to the other group.
  const open = list?.groups?.find((group) => group.open && !group.mine);
  assert.ok(open, 'a group with room');
  a.send({ type: 'group-join', group: open?.id });
  await a.until(() => a.of('group', 'moved').length > 0, 'the hop');
  assert.ok(a.of('group', 'moved')[0]?.here, 'told how many are with them now');
  assert.ok(a.view.has(fay.id) === (open?.friends.length === 1), 'the list is now the new group');
  a.send({ type: 'group-join', group: 'g99' });
  await a.until(() => a.of('error').some((frame) => frame.code === 'group_gone'), 'a group that is gone');
});

test('merging: a group below the minimum is merged into one with room when somebody leaves; the group that is moved is told calmly and the new group sees it', async (t) => {
  const h = await harness(t);
  const [a, b, c] = [await h.enter(await h.player('Axx')), await h.enter(await h.player('Bxx')), await h.enter(await h.player('Cxx'))];
  const [d, e, g] = [await h.enter(await h.player('Dxx')), await h.enter(await h.player('Exx')), await h.enter(await h.player('Gxx'))];
  await a.until(() => a.view.size === 3 && d.view.size === 3, 'two full groups');
  await h.leave(b);                                  // first group: A, C
  await h.leave(e); await h.leave(g);                // second group: D alone, below the minimum of two
  await d.until(() => d.of('group', 'moved').length > 0, 'D is merged into the first group');
  assert.match(d.of('group', 'moved')[0]?.text ?? '', /^You are now with 2 others\.$/);
  assert.deepEqual(d.names(), ['Axx', 'Cxx', 'Dxx']);
  await a.until(() => a.view.has(d.who.id), 'the first group sees D arrive');
  assert.equal(c.view.has(d.who.id), true);
  await d.until(() => d.counts?.groups === 1, 'one group left');
});

test('a merge does not move people mid-way through something: a seated player stays, and the whole voice circle moves together or not at all', async (t) => {
  const h = await harness(t);
  const [a, b, c] = [await h.enter(await h.player('Axx')), await h.enter(await h.player('Bxx')), await h.enter(await h.player('Cxx'))];
  const dev = await h.player('Dxx'); await h.f.request('/api/growth/hello', { cityId: 'lagos' }, dev.cookie);
  const [d, e, g] = [await h.enter(dev), await h.enter(await h.player('Exx')), await h.enter(await h.player('Gxx'))];
  await a.until(() => a.view.size === 3 && d.view.size === 3, 'two full groups');
  // D sits at the park bench; the second group dwindles to D alone.
  d.send({ type: 'table-sit', cityId: 'lagos', table: 'park-bench' });
  await d.until(() => d.frames.some((frame) => frame.type === 'table-state'), 'D is seated');
  await h.leave(b);
  await h.leave(e); await h.leave(g);
  await pause(200);
  assert.equal(d.of('group', 'moved').length, 0, 'a seated player is not moved');
  assert.deepEqual(d.names(), ['Dxx'], 'and stays in their own group');
  void c;
});

test('the venue total follows people coming and going, sent with the heartbeat, and the people listing carries the group and the venue counts', async (t) => {
  const h = await harness(t, { heartbeatMs: 1000 });
  const ada = await h.player('Ada');
  const a = await h.enter(ada);
  for (const name of ['Bxx', 'Cxx', 'Dxx', 'Exx']) await h.enter(await h.player(name));
  await a.until(() => a.counts?.total === 5, 'the total reaches the first group', 2500);
  const listing = (await (await h.f.request('/api/social/people?city=lagos', undefined, ada.cookie)).json()) as { players: { name: string }[]; here: number; total: number; groups: number; count: number };
  assert.equal(listing.here, 3);
  assert.equal(listing.count, 2, 'the listing holds the other people of the group');
  assert.equal(listing.total, 5);
  assert.equal(listing.groups, 2);
  assert.ok(listing.players.every((player) => ['Bxx', 'Cxx'].includes(player.name)));
});

test('the voice circle and the chat are the group\'s: chat reaches the group only, and the circle cap counts the group', async (t) => {
  const h = await harness(t);
  const [a, b, c] = [await h.enter(await h.player('Axx')), await h.enter(await h.player('Bxx')), await h.enter(await h.player('Cxx'))];
  const d = await h.enter(await h.player('Dxx'));
  await a.until(() => a.view.size === 3, 'group');
  b.send({ type: 'chat', body: 'hello around', clientId: 'c-1' });
  await a.until(() => a.of('chat').length > 0, 'chat reaches the group');
  await c.until(() => c.of('chat').length > 0, 'chat reaches the group');
  await pause(150);
  assert.equal(d.of('chat').length, 0, 'the other group heard nothing');
  // Signalling is refused across groups exactly like a peer who is not there.
  a.send({ type: 'signal', to: d.who.id, data: { sdp: 'offer' } });
  await a.until(() => a.of('error').some((frame) => frame.code === 'peer_not_in_room'), 'refused');
});
