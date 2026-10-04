// INVITATIONS AND SHARING ON THE NODE HOST, in one place: the house link, ?join=, the share page a crawler reads, the
// first message of a new chat, knock and let-in. The same sequence runs against the Worker runtime in
// deploy/cloudflare.test.ts ("Invitations on the Worker", "Combined game on the Worker"); the referral payout and the
// table invite are played end to end by scripts/new-player.ts on Node and by the combined-game test on the Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { joinIdFrom, linkParts } from '../src/quick-start/model.ts';
import { presetLook } from '../src/quick-start/look-model.ts';

type Frame = Record<string, unknown>;
interface Who { name: string; cookie: string; id: string }
interface Named { name: string }
/** What the tests read of an answer or a socket frame: all optional, an error answer has none of it. */
interface Reply {
  status: number; ok?: boolean; code?: string; error?: string; duplicate?: boolean; invitePath?: string; me?: Named
  share?: { path: string; code: string }; conv?: { id: string; with: string }; message?: { body: string }; hostStatus?: string; host?: Named
  from?: { id: string; name: string }; by?: Named; answer?: string; members?: Named[]; type?: string
}
const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null;
const replyOf = (body: unknown, status: number): Reply => ({ ...(isRecord(body) ? body : {}), status });
const CITY = 'lagos', ORIGIN = 'https://play.example';
const INDEX = '<!doctype html><html><head><title>Allworld • Your city story</title><meta property="og:image" content="/og/allworld.jpg"><meta name="twitter:image" content="/og/allworld.jpg"></head><body></body></html>';

async function setup(t: Parameters<typeof fixture>[0]) {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-invites-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, 'og'));
  await writeFile(join(dist, 'index.html'), INDEX);
  await writeFile(join(dist, 'og', 'allworld.jpg'), 'jpg');
  const f = await fixture(t, { distDir: dist, publicOrigin: ORIGIN, env: {} });
  const call = async (path: string, body: Frame | null, who?: Who): Promise<Reply> => { const response = await f.request(path, body, who?.cookie); return replyOf(await response.json(), response.status); };
  const act = (who: Who, type: string, payload?: Frame) => call('/api/action', { actionId: f.id(), cityId: CITY, type, ...(payload ? { payload } : {}) }, who);
  /** What the landing does when Play is tapped, then (optionally) settling in. */
  async function play(name: string, { lga }: { lga?: string } = {}): Promise<Who> {
    const opened = await f.request('/api/session', { name, onboarding: true });
    const opening: unknown = await opened.json(), session = isRecord(opening) ? opening.session : undefined;
    const who: Who = { name, cookie: (opened.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: isRecord(session) && typeof session.id === 'string' ? session.id : '' };
    await call(`/api/life?city=${CITY}`, null, who);
    assert.equal((await act(who, 'onboarding.quick-start', { look: presetLook('owambe') })).code, 'playing');
    const steps: [string, Frame, string][] = [['onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }, 'traits_saved'], ['onboarding.dream', { dream: 'everybodys-padi' }, 'dream_saved'], ['onboarding.lottery', {}, 'rolled'], ['onboarding.home', { lga, via: 'manual' }, 'life_started']];
    if (lga) for (const [type, payload, code] of steps) assert.equal((await act(who, type, payload)).code, code);
    assert.equal((await call('/api/social/me', null, who)).me?.name, name);
    return who;
  }
  async function peer(who: Who) {
    const socket = await f.socket(who);
    const until = async (type: string, tries = 40): Promise<Reply> => { for (let i = 0; i < tries; i++) { const message = await socket.next(); if (isRecord(message) && message.type === type) return replyOf(message, 0); } throw Error(`No ${type} frame`); };
    return { send: (message: Frame) => socket.ws.send(JSON.stringify(message)), until };
  }
  return { f, call, act, play, peer };
}

test('a house link and a share link: the game page for a person, a script-free preview for a crawler, the same ids for the landing', async (t) => {
  const { f, call, play } = await setup(t);
  const ada = await play('Ada', { lga: 'ikeja' });
  assert.equal((await call('/api/social/me', null, ada)).invitePath, `/v/${ada.id}`);
  // /v/<public id> is the game's own page (the landing reads the id from the address); its preview image is absolute.
  const house = await fetch(`${f.base}/v/${ada.id}`), page = await house.text();
  assert.equal(house.status, 200);
  assert.match(page, /<title>Allworld/);
  assert.match(page, /<meta property="og:image" content="https:\/\/play\.example\/og\/allworld\.jpg">/);
  assert.match(page, /<meta name="twitter:image" content="https:\/\/play\.example\/og\/allworld\.jpg">/);
  assert.equal(joinIdFrom(`/v/${ada.id}`, ''), ada.id);
  assert.equal(joinIdFrom('/', `?join=${ada.id}`), ada.id);
  // A share link: what a crawler that runs no script receives.
  const shared = await call('/api/growth/share', { cityId: CITY, kind: 'house' }, ada);
  assert.deepEqual([shared.ok, shared.share?.path], [true, `/s/${shared.share?.code}`], JSON.stringify(shared));
  const preview = await fetch(`${f.base}/s/${shared.share?.code}`, { redirect: 'manual' }), html = await preview.text();
  assert.deepEqual([preview.status, preview.headers.get('set-cookie'), preview.headers.get('x-frame-options'), preview.headers.get('referrer-policy')], [200, null, 'DENY', 'no-referrer']);
  assert.match(preview.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.ok(!/<script/i.test(html) && !/\son[a-z]+=/i.test(html));
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  assert.match(meta('og:title') ?? '', /Ada/);
  assert.deepEqual([meta('og:type'), meta('og:site_name'), meta('og:url'), meta('og:image'), meta('twitter:card')], ['website', 'Allworld', `${ORIGIN}/s/${shared.share?.code}`, `${ORIGIN}/og/allworld.jpg`, 'summary_large_image']);
  const target = (/<meta http-equiv="refresh" content="0;url=([^"]+)"/.exec(html)?.[1] ?? '').replaceAll('&amp;', '&');
  const url = new URL(target, ORIGIN);
  assert.deepEqual({ join: joinIdFrom(url.pathname, url.search), ...linkParts(url.pathname, url.search) }, { join: ada.id, ref: shared.share?.code, table: null });
  assert.equal((await fetch(`${f.base}/s/zzzzzzzz`)).status, 404);
});

test('friend request, the first message of a new chat, knock and let-in, and ?join= — over sockets', async (t) => {
  const { call, play, peer } = await setup(t);
  const ada = await play('Ada', { lga: 'ikeja' }), bola = await play('Bola');
  const a = await peer(ada), b = await peer(bola);
  b.send({ type: 'friend-request', to: ada.id, cityId: CITY });
  assert.deepEqual([(await b.until('friend-result')).code, (await a.until('friend-request')).from?.name], ['requested', 'Bola']);
  assert.equal((await call('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada)).code, 'accepted');
  assert.equal((await b.until('friend-accepted')).by?.name, 'Ada');
  // The first message of a conversation names who it is with: an open new chat on the other side adopts it (social-client.js).
  const dm = { to: bola.id, body: 'Come and see my place', clientId: 'invite-first-message' };
  const sent = await call('/api/social/messages', dm, ada), again = await call('/api/social/messages', dm, ada);
  assert.deepEqual([sent.code, again.duplicate], ['sent', true]);
  const first = await b.until('dm');
  assert.deepEqual([first.conv?.with, first.conv?.id, first.message?.body], [ada.id, sent.conv?.id, 'Come and see my place']);
  // Knock → let in → the host's Home room.
  b.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
  assert.equal((await b.until('error')).code, 'not_a_guest');
  a.send({ type: 'join', cityId: CITY, venueId: 'home' }); await a.until('presence');
  // ?join=<Ada>: she is at home, which is private — the landing is told so (it offers a knock), and nobody is moved.
  const asked = await call('/api/social/join', { host: ada.id, cityId: CITY }, bola);
  assert.deepEqual([asked.ok, asked.code, asked.hostStatus, asked.host?.name], [true, 'at_home', 'home', 'Ada'], JSON.stringify(asked));
  assert.equal((await call('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola)).code, 'knocking');
  assert.deepEqual((await a.until('invite-knock')).from, { id: bola.id, name: 'Bola' });
  assert.equal((await call('/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada)).code, 'accepted');
  assert.equal((await b.until('invite-answer')).answer, 'accepted');
  b.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
  assert.deepEqual(((await b.until('presence')).members ?? []).map((member) => member.name).sort(), ['Ada', 'Bola']);
  assert.equal((await call('/api/social/house/leave', { host: ada.id }, bola)).code, 'left');
  assert.equal((await b.until('error')).code, 'visit_ended');
});
