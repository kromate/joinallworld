// OWNER: growth — an invite from end to end on the server: the share link a player makes, the page
// a friend's chat app and browser open, the public lookup the first screen uses to name the
// inviter, the referral being attached when the friend has made a life, and the inviter's count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { sharePageHtml } from './growth/share.ts';
import { progressLine } from '../src/app/features/growth/inviteModel.ts';
import type { TestContext } from 'node:test';
import type { HelloResult, ShareFacts } from '../src/types/growth.ts';

type Dict = Record<string, unknown>;
interface Plain { status: number; ok: boolean; code: string; reason: string; duplicate: boolean; by: unknown; kind: string; facts: Partial<ShareFacts> }
type Hello = Plain & Extract<HelloResult, { ok: true }>;
type Shared = Plain & { share: { code: string; path: string; facts: ShareFacts } };
const device = (n: number) => `device-token-${String(n).padStart(8, '0')}-abcdef`;

async function harness(t: TestContext) {
  const f = await fixture(t, { publicOrigin: 'https://play.example' });
  const post = async <R = object>(path: string, body: unknown, who?: { cookie: string }) => {
    const res = await f.request(path, body, who?.cookie);
    return { status: res.status, ...((await res.json()) as Dict) } as unknown as Plain & R;
  };
  const get = async <R = object>(path: string, who?: { cookie: string }) => {
    const res = await f.request(path, null, who?.cookie);
    return { status: res.status, ...((await res.json()) as Dict) } as unknown as Plain & R;
  };
  const page = async (path: string) => { const res = await f.request(path); return { status: res.status, html: await res.text() }; };
  const player = async (name: string, n: number) => {
    const who = await f.device(name);
    await get('/api/life?city=lagos', who);
    await post<Hello>('/api/growth/hello', { cityId: 'lagos', device: device(n) }, who);
    return who;
  };
  const hello = (who: { cookie: string }, n: number) => post<Hello>('/api/growth/hello', { cityId: 'lagos', device: device(n) }, who);
  return { f, post, get, page, player, hello };
}

test('invite: the link names its inviter publicly, the page sends a friend on, and the friend’s life counts for the inviter', async (t) => {
  const { post, get, page, player, hello } = await harness(t);
  const ada = await player('Ada', 1);
  const made = await post<Shared>('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada);
  assert.equal(made.ok, true);
  const { code, path } = made.share;
  assert.equal(path, `/s/${code}`);

  // The page a crawler and a person open: a preview in the sharer's name, and a way on to the game with the code.
  const opened = await page(path);
  assert.equal(opened.status, 200);
  assert.match(opened.html, /<meta property="og:title" content="Join Ada in Allworld">/);
  assert.match(opened.html, new RegExp(`content="0;url=/\\?join=${ada.id}&amp;ref=${code}"`));

  // The first screen has no session yet: it asks who the code belongs to, and gets a name only.
  const about = await get<{ by: { id: string; name: string }; facts: Partial<ShareFacts> }>(`/api/growth/share/${code}`);
  assert.deepEqual([about.ok, about.kind, about.by.name, about.by.id], [true, 'invite', 'Ada', ada.id]);
  assert.equal((await get(`/api/growth/share/zzzzzzzzzz`)).code, 'unknown_link');
  assert.equal((await get(`/api/growth/share/<b>`)).status, 400, 'a malformed code is refused');

  // Before anyone has come through it, the inviter's count is empty.
  let view = await hello(ada, 1);
  assert.equal(progressLine(view.referral), 'No friends have joined yet');

  // The friend makes a life and the landing attaches the code: the inviter's count rises at once.
  const tunde = await player('Tunde', 2);
  const linked = await post<Plain>('/api/growth/referral/link', { cityId: 'lagos', code, device: device(2) }, tunde);
  assert.deepEqual([linked.ok, linked.code, linked.by], [true, 'linked', 'Ada']);
  view = await hello(ada, 1);
  assert.equal(progressLine(view.referral), '1 friend joined');
  assert.deepEqual(view.referral.invited.map((friend) => [friend.name, friend.state]), [['Tunde', 'joined']]);
  assert.equal(view.referral.counted, 0, 'nothing counts until the friend has really played');

  // The friend sees whose link it was, and the same request again changes nothing.
  assert.equal((await hello(tunde, 2)).referral.by?.name, 'Ada');
  assert.equal((await post<Plain>('/api/growth/referral/link', { cityId: 'lagos', code, device: device(2) }, tunde)).duplicate, true);
  assert.equal(progressLine((await hello(ada, 1)).referral), '1 friend joined');

  // A second friend on another phone makes it two; the same phone as the inviter does not count.
  const bola = await player('Bola', 3);
  assert.equal((await post<Plain>('/api/growth/referral/link', { cityId: 'lagos', code, device: device(3) }, bola)).code, 'linked');
  const same = await player('Chidi', 1);
  assert.equal((await post<Plain>('/api/growth/referral/link', { cityId: 'lagos', code, device: device(1) }, same)).code, 'same_device');
  assert.equal(progressLine((await hello(ada, 1)).referral), '2 friends joined');
});

test('invite: the preview page escapes every value it writes, even a hostile name', () => {
  const html = sharePageHtml({ by: '11111111-2222-4333-8444-555555555555', facts: { kind: 'invite', name: '"><script>x</script>', district: '', city: 'Lagos' } as ShareFacts }, 'abcdefghij', 'https://play.example');
  assert.ok(!html.includes('<script>') && !html.includes('"><script'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.match(html, /content="0;url=\/\?join=11111111-2222-4333-8444-555555555555&amp;ref=abcdefghij"/);
});
