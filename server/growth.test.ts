// OWNER: growth — the growth routes against a real server: share links and their preview page,
// referral (and what cannot be farmed), the age question and consent, and the operator's metrics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { REFERRAL } from '../src/game/content/growth.ts';
import { LIMITS } from './growth/data.ts';
import { sharePageHtml } from './growth/share.ts';
import { shareText, sharePreview, shareCard, shareCodeFrom, cleanFacts } from '../src/game/share-model.ts';
import { awayCard, composeDigest, topLines, DIGEST } from '../src/game/digest.ts';

const DAY = 86400000;
const TOKEN = 'operator-token-for-growth-tests-0123456789';
const device = (n) => `device-token-${String(n).padStart(8, '0')}-abcdef`;

async function harness(t, options = {}) {
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', ...options });
  const json = async (res) => ({ status: res.status, ...(await res.json()) });
  const post = async (path, body, who) => json(await f.request(path, body, who?.cookie));
  const get = async (path, who) => json(await f.request(path, null, who?.cookie));
  const life = async (who) => (await get('/api/life?city=lagos', who)).state;
  const hello = (who, n) => post('/api/growth/hello', { cityId: 'lagos', ...(n === undefined ? {} : { device: device(n) }) }, who);
  /** One paid shift at the community desk: a Lagos day worked. */
  const work = async (who) => {
    await f.action(who.cookie, { type: 'apply-job', payload: { id: 'community-helper' } });
    await f.action(who.cookie, { type: 'spot', payload: { id: 'work' } });
    const started = await f.action(who.cookie, { type: 'activity', payload: { id: 'helper-shift' } });
    assert.equal(started.ok, true, started.reason);
    f.advance(21000);
    return life(who);
  };
  const player = async (name, n) => { const who = await f.device(name); await life(who); if (n !== undefined) await hello(who, n); return who; };
  const mod = async (path) => json(await fetch(f.base + path, { headers: { Authorization: `Bearer ${TOKEN}` } }));
  const lines = (state, prefix) => state.ledger.filter((line) => line.reason.startsWith(prefix));
  return { f, post, get, life, hello, work, player, mod, lines };
}

test('share: a link is made from the sharer’s own facts, found again instead of duplicated, and bounded per day', async (t) => {
  const { f, post, get, player } = await harness(t);
  const ada = await player('Ada', 1);
  const made = await post('/api/growth/share', { cityId: 'lagos', kind: 'missions' }, ada);
  assert.equal(made.ok, true);
  assert.match(made.share.code, /^[a-z0-9]{10}$/);
  assert.deepEqual([made.share.path, made.share.facts.name, made.share.facts.kind, made.share.facts.city], [`/s/${made.share.code}`, 'Ada', 'missions', 'Lagos']);
  // The client cannot put words into a share: unknown fields are ignored, an unknown kind is refused.
  const again = await post('/api/growth/share', { cityId: 'lagos', kind: 'missions', name: '<b>Evil</b>', facts: { name: 'Evil' }, done: 99 }, ada);
  assert.deepEqual([again.share.code, again.share.facts.name], [made.share.code, 'Ada']);
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'nope' }, ada)).status, 400);
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'event', event: '../x' }, ada)).status, 400);
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'table' }, ada)).code, 'nothing_to_share');
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' })).status, 401);
  // Anyone may ask what a link is about; it names the sharer by public id and name and nothing else.
  const about = await get(`/api/growth/share/${made.share.code}`);
  assert.deepEqual([about.ok, about.kind, about.by], [true, 'missions', { id: ada.id, name: 'Ada' }]);
  assert.equal(JSON.stringify(about).includes(ada.cookie.slice(4)), false);
  assert.equal((await get('/api/growth/share/aaaaaaaaaa')).code, 'unknown_link');
  // The daily limit counts new links only, and a link dies after 30 days.
  const kinds = ['invite', 'house', 'week'];
  for (const kind of kinds) assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind }, ada)).ok, true);
  for (let day = 1; day < 3; day++) { f.advance(DAY); for (const kind of ['invite', 'house', 'week', 'missions']) await post('/api/growth/share', { cityId: 'lagos', kind }, ada); }
  const stored = await f.server.store.read((db) => db.growth);
  assert.equal(Object.keys(stored.shares).length, 12);
  assert.ok(Object.values(stored.shares).every((share) => share.by === ada.id && !JSON.stringify(share).includes(ada.cookie.slice(4))), 'only the public id is stored');
  f.advance(31 * DAY);
  assert.equal((await get(`/api/growth/share/${made.share.code}`)).code, 'unknown_link');
});

test('share page: a crawler that runs no script gets correct Open Graph tags, escaped, with absolute URLs', async (t) => {
  const { f, post, player } = await harness(t);
  const ada = await player("Ada O'Neil", 1);
  const { share } = await post('/api/growth/share', { cityId: 'lagos', kind: 'house' }, ada);
  const res = await fetch(`${f.base}/s/${share.code}`, { headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A' } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(res.headers.get('set-cookie'), null, 'the page sets no cookie');
  const tag = (property) => new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html)?.[1];
  assert.equal(tag('og:title'), 'Come to Ada O&#39;Neil’s house in Yaba, Lagos');
  assert.match(tag('og:description'), /No sign-up/);
  assert.equal(tag('og:url'), `https://play.example/s/${share.code}`);
  assert.equal(tag('og:image'), 'https://play.example/og/allworld.jpg');
  assert.deepEqual([tag('og:image:width'), tag('og:image:height'), tag('twitter:card'), tag('og:type')], ['1200', '630', 'summary_large_image', 'website']);
  assert.ok(html.indexOf('og:title') < html.indexOf('</head>') && html.indexOf('</head>') < 300000, 'the tags are in <head>, well inside the first 300 KB');
  assert.equal(/<script/i.test(html), false, 'no script: the preview does not depend on one');
  assert.ok(html.includes(`<meta http-equiv="refresh" content="0;url=/?join=${ada.id}&amp;ref=${share.code}">`), 'people are sent to the landing hook with the sharer and the share code');
  assert.ok(html.includes(`<a href="/?join=${ada.id}&amp;ref=${share.code}">Open Allworld</a>`));
  // An unknown, malformed or hostile code gives the general preview and never echoes the path.
  for (const path of ['/s/zzzzzzzzzz', '/s/%3Cscript%3Ealert(1)%3C/script%3E', '/s/', '/s/AAAA"onload="x']) {
    const other = await fetch(f.base + path);
    const text = await other.text();
    assert.equal(other.status, 404, path);
    assert.match(text, /<meta property="og:title" content="Allworld · Your city story">/);
    assert.equal(/alert|onload/i.test(text), false);
    assert.match(text, /content="0;url=\/"/);
  }
  // The page is pure: hostile facts and a hostile origin cannot put markup into it.
  const hostile = sharePageHtml({ by: '"><script>', facts: cleanFacts({ kind: 'invite', name: '"><img src=x onerror=1>', district: '<i>' }) }, 'abcdefghij', 'https://evil.example/"><script>');
  assert.equal(/<img|<i>|<script|evil\.example/.test(hostile), false);
  assert.match(hostile, /og:image" content="\/og\/allworld\.jpg"/);
  // Opened links are counted for the operator.
  const metrics = await (await fetch(`${f.base}/api/mod/growth/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.equal(metrics.totals['share.opened'], 1);
  assert.equal(metrics.totals['share.made.house'], 1);
});

test('share model: the text has the link on its own last line, the card is plain data, and a code is read from any link form', () => {
  const facts = { kind: 'missions', name: 'Ada', city: 'Lagos', done: 2, total: 3, days: 12, title: 'Settled in' };
  assert.equal(shareText(facts, 'https://play.example/s/abc123defg'), 'Allworld · day 12 in Lagos\n🟩🟩⬜ 2/3 missions\n⭐ Settled in\nhttps://play.example/s/abc123defg');
  assert.equal(shareText(facts).split('\n').length, 3, 'without a link there is no empty last line');
  assert.deepEqual(shareCard(facts), { kicker: 'ALLWORLD', squares: [true, true, false], footer: 'Play free in your browser', headline: '2/3 missions today', lines: ['Ada', '12 days in Lagos', 'Settled in'] });
  assert.equal(shareCard({ kind: 'week', name: 'Ada', stamps: 4, days: 9 }).squares.filter(Boolean).length, 4);
  for (const kind of ['invite', 'house', 'missions', 'week', 'table', 'event', 'nope', undefined]) {
    const preview = sharePreview({ kind, name: 'x'.repeat(200), event: 'e'.repeat(200) });
    assert.ok(preview.title.length <= 120 && preview.description.length <= 200 && shareText({ kind, name: 'Ada' }, 'L').endsWith('\nL'));
  }
  assert.deepEqual(['https://x.example/s/abc123defg', '/?s=abc123defg&x=1', '?join=11111111-2222-4333-8444-555555555555&ref=abc123defg', 'abc123defg', '/s/ABC', 'nope', null].map(shareCodeFrom), ['abc123defg', 'abc123defg', 'abc123defg', 'abc123defg', null, null, null]);
});

test('referral: both sides are paid once, only after real play; own link, a second link, the same device and an old life are refused', async (t) => {
  const { f, post, life, hello, work, player, lines } = await harness(t);
  const ada = await player('Ada', 1);
  const code = (await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada)).share.code;
  const link = (who, n, extra = {}) => post('/api/growth/referral/link', { cityId: 'lagos', code, device: device(n), ...extra }, who);

  assert.equal((await link(ada, 1)).code, 'own_link');
  const tunde = await player('Tunde');
  assert.equal((await post('/api/growth/referral/link', { cityId: 'lagos', code }, tunde)).status, 400, 'a device token is required');
  assert.equal((await link(tunde, 1)).code, 'same_device', 'the inviter’s own phone');
  const linked = await link(tunde, 2);
  assert.deepEqual([linked.ok, linked.code, linked.by], [true, 'linked', 'Ada']);
  assert.deepEqual([(await link(tunde, 2)).duplicate, (await link(tunde, 2)).ok], [true, true], 'the same request again is the same answer');
  const other = (await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, tunde)).share.code;
  assert.equal((await post('/api/growth/referral/link', { cityId: 'lagos', code: other, device: device(1) }, ada)).code, 'mutual_link', 'two players cannot invite each other');
  const bola = await player('Bola');
  assert.equal((await link(bola, 2)).code, 'same_device', 'a second life on the phone of a friend who already came through the link');
  assert.equal((await post('/api/growth/referral/link', { cityId: 'lagos', code: 'zzzzzzzzzz', device: device(3) }, bola)).code, 'unknown_link');

  // UNPLAYED ACCOUNTS PAY NOBODY. However often either side says hello, nothing is credited.
  for (let i = 0; i < 3; i++) { await hello(ada, 1); await hello(tunde, 2); }
  assert.deepEqual([lines(await life(ada), 'Referral').length, lines(await life(tunde), 'Welcome').length], [0, 0]);
  let view = await hello(ada, 1);
  assert.deepEqual(view.referral.invited.map((friend) => [friend.name, friend.state]), [['Tunde', 'joined']]);
  assert.deepEqual([view.referral.counted, view.referral.waiting], [0, 1]);

  // Day one of paid work: the newcomer's welcome gift, once.
  const before = (await life(tunde)).cash;
  assert.equal((await work(tunde)).civic.work.days, 1);
  const welcomed = await hello(tunde, 2);
  assert.deepEqual([welcomed.referral.by.name, welcomed.referral.by.welcomed, welcomed.referral.by.counted], ['Ada', true, false]);
  for (let i = 0; i < 3; i++) await hello(tunde, 2);
  let state = await life(tunde);
  assert.deepEqual([lines(state, 'Welcome gift').length, state.cash - before], [1, 300 + REFERRAL.welcome]);
  assert.ok(state.social.notices.some((notice) => notice.kind === 'referral' && /Ada/.test(notice.text)));
  assert.equal(lines(await life(ada), 'Referral').length, 0, 'the inviter is not paid for one day of work');

  // Day two: the referral counts, and the inviter is paid the next time she is here — once.
  f.advance(DAY);
  assert.equal((await work(tunde)).civic.work.days, 2);
  await hello(tunde, 2);
  const adaBefore = (await life(ada)).cash, stars = (await life(ada)).goals.stars;
  view = await hello(ada, 1);
  assert.deepEqual([view.referral.counted, view.referral.owed, view.referral.invited[0].state], [1, 0, 'counted']);
  for (let i = 0; i < 3; i++) { await hello(ada, 1); await hello(tunde, 2); }
  state = await life(ada);
  assert.deepEqual([lines(state, 'Referral reward').length, state.cash - adaBefore, state.goals.stars - stars], [1, REFERRAL.reward, REFERRAL.rewardStars]);
  assert.equal(lines(await life(tunde), 'Welcome gift').length, 1);

  // A life older than the window cannot be attached to anyone.
  const late = await player('Kemi');
  f.advance((REFERRAL.linkWithinDays + 1) * DAY);
  await life(late);
  assert.equal((await link(late, 9)).code, 'too_late');
  // Nothing identifying is stored: no cookie, no raw device token, no address.
  const stored = JSON.stringify(await f.server.store.read((db) => db.growth));
  for (const secret of [ada.cookie.slice(4), tunde.cookie.slice(4), device(1), device(2), '127.0.0.1']) assert.equal(stored.includes(secret), false);
});

test('referral: a burst of new lives from one network address stops counting after three in a week', async (t) => {
  const { f, post, player } = await harness(t);
  const ada = await player('Ada', 1);
  const code = (await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada)).share.code;
  const results = [];
  for (let n = 0; n < REFERRAL.perAddressPerWeek + 2; n++) {
    const friend = await player(`Friend ${n}`);
    results.push((await post('/api/growth/referral/link', { cityId: 'lagos', code, device: device(100 + n) }, friend)).code);
  }
  assert.deepEqual(results, ['linked', 'linked', 'linked', 'address_limit', 'address_limit']);
  // A week later the same network may bring friends again.
  f.advance(7 * DAY + 1000);
  const later = await player('Later');
  assert.equal((await post('/api/growth/referral/link', { cityId: 'lagos', code: (await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada)).share.code, device: device(200) }, later)).code, 'linked');
  const metrics = await (await fetch(`${f.base}/api/mod/growth/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.deepEqual([metrics.totals['referral.linked'], metrics.totals['referral.refused.address-limit']], [4, 2]);
});

test('hello: never creates a life, greets a return, and composes the digest as a preview only', async (t) => {
  const { f, post, hello, player } = await harness(t);
  const res = await f.request('/api/session', { name: 'Newbie', onboarding: true });
  const fresh = { cookie: res.headers.get('set-cookie').split(';')[0] };
  assert.equal((await post('/api/growth/hello', { cityId: 'lagos' }, fresh)).code, 'not_ready');
  assert.equal((await f.server.store.read((db) => Object.values(db.sessions).find((session) => session.name === 'Newbie').cities?.lagos)), undefined, 'no life was made by asking');
  assert.equal((await post('/api/growth/hello', { cityId: 'nowhere' }, fresh)).status, 400);
  assert.equal((await post('/api/growth/hello', { cityId: 'lagos' })).status, 401);
  const ada = await player('Ada');
  const first = await hello(ada, 1);
  assert.deepEqual([first.ok, first.away.hours, first.away.since, first.consent, first.digest.delivery], [true, 0, null, null, 'dry-run']);
  assert.ok(first.digest.subject.includes('Ada') && first.digest.tasks.length >= 1 && first.digest.tasks.length <= DIGEST.tasks && first.digest.lines.length <= DIGEST.maxLines);
  assert.ok(Array.isArray(first.events) && first.events.every((event) => event.title && event.venueLabel));
  f.advance(5 * 3600000);
  const back = await hello(ada, 1);
  assert.equal(back.away.hours, 5);
});

test('digest and away card: priority order, five lines at most, and never a card for a short absence', () => {
  const lines = [{ text: 'Rent is due Saturday', app: 'bank', at: 5 }, { text: 'Bola knocked at your door', app: 'invite', at: 1 }, { text: 'You were promoted', app: 'jobs', at: 9 },
    { text: 'Trivia night starts 8 pm', app: 'events', at: 2 }, { text: 'Bola knocked at your door', app: 'invite', at: 1 }, { text: 'Chidi sent a message', app: 'messages', at: 7 }, { text: 'A', app: 'jobs', at: 1 }, { text: '', app: 'jobs' }];
  const top = topLines(lines);
  assert.deepEqual([top.lines.map((line) => line.text), top.more], [['Chidi sent a message', 'Bola knocked at your door', 'Trivia night starts 8 pm', 'Rent is due Saturday', 'You were promoted'], 1]);
  assert.equal(awayCard({ hoursAway: 2.9, lines }), null);
  assert.equal(awayCard({ hoursAway: 50, lines: [] }), null, 'nothing to say is no card');
  const card = awayCard({ hoursAway: 50, lines, missions: { claimable: 2, daily: [] }, events: [{ live: true, key: 'k', title: 'Club night', venueLabel: 'Quilox', start: 3 }] });
  assert.deepEqual([card.title, card.lines.length, card.more], ['While you were away', 5, 3]);
  assert.match(card.sub, /2 days\. Nothing was taken/);
  assert.equal(/miss you|lose|lost|hurry/i.test(JSON.stringify(card)), false);
  const digest = composeDigest({ name: 'Ada', missions: { stamps: { days: 3, paid: false }, title: 'Settled in', weekly: [{ label: 'Eat ten meals', n: 4, count: 10, done: false }], daily: [{ label: 'Freshen up', done: false }, { label: 'Done', done: true }] },
    events: [{ title: 'Owambe', venueLabel: 'Freedom Park', start: 1 }], referral: { counted: 1, waiting: 2 } });
  assert.deepEqual(digest.tasks.map((task) => task.text), ['Eat ten meals (4/10)', 'Freshen up']);
  assert.ok(digest.lines[0].includes('friend') && digest.lines.length <= 5 && digest.caps.perWeek === 3 && /at most once a week/.test(digest.footer));
});

test('consent: the age question comes first, under-18 is never offered outside messages, and a minor cannot become an adult by asking again', async (t) => {
  const { post, hello, player, mod } = await harness(t);
  const ada = await player('Ada', 1), kid = await player('Kid', 2);
  assert.equal((await post('/api/growth/consent', { cityId: 'lagos', push: true }, ada)).status, 400, 'no age, no consent');
  assert.equal((await post('/api/growth/consent', { cityId: 'lagos', age: 'adult', push: 'yes' }, ada)).status, 400);
  const adult = await post('/api/growth/consent', { cityId: 'lagos', age: 'adult', push: true, email: true }, ada);
  assert.deepEqual([adult.ok, adult.consent.age, adult.consent.push, adult.consent.email], [true, 'adult', false, false], 'saying the age switches nothing on: each channel has its own step');
  assert.deepEqual([(await hello(ada, 1)).consent.push, (await hello(ada, 1)).contact.email], [false, null]);
  const minor = await post('/api/growth/consent', { cityId: 'lagos', age: 'minor', push: true, email: true }, kid);
  assert.deepEqual([minor.ok, minor.code, minor.consent.push, minor.consent.email], [false, 'under_18', false, false]);
  const retry = await post('/api/growth/consent', { cityId: 'lagos', age: 'adult', email: true }, kid);
  assert.deepEqual([retry.code, retry.consent.age, retry.consent.email], ['under_18', 'minor', false]);
  assert.equal((await post('/api/growth/consent', { cityId: 'lagos', age: 'minor' }, kid)).ok, true, 'saying only the age is fine');
  const totals = (await mod('/api/mod/growth/metrics')).totals;
  assert.deepEqual([totals['consent.adult'], totals['consent.minor']], [1, 1]);
});

test('metrics: operator only, daily totals and cohorts counted once per life per day, with no player data in the report', async (t) => {
  const { f, post, get, hello, work, player, mod } = await harness(t);
  assert.equal((await get('/api/mod/growth/metrics')).status, 401);
  const ada = await player('Ada', 1), bola = await player('Bola', 2);
  for (let i = 0; i < 4; i++) await hello(ada, 1);
  await work(ada); await hello(ada, 1);
  f.advance(DAY); await hello(ada, 1); await hello(ada, 1);           // only Ada comes back on day 1
  f.advance(2 * DAY); await hello(bola, 2);                             // Bola on day 3
  f.advance(4 * DAY); await hello(ada, 1);                              // Ada on day 7
  const report = await mod('/api/mod/growth/metrics?days=40');
  assert.equal(report.status, 200);
  const cohort = report.cohorts[0];
  assert.deepEqual([cohort.size, cohort.d1, cohort.d3, cohort.d7, cohort.d14, cohort.d30], [2, { returned: 1, rate: 50 }, { returned: 1, rate: 50 }, { returned: 1, rate: 50 }, null, null]);
  assert.deepEqual(report.days.map((day) => day.active), [2, 1, 1, 1]);
  assert.deepEqual([report.totals.new, report.totals['funnel.onboarded'], report.totals['funnel.job'], report.totals['funnel.shift'], report.tracked], [2, 2, 1, 1, 2]);
  assert.ok(report.totals.sessions >= 5 && report.totals.sessions <= 6, 'a hello after a quiet half hour is a new session; a burst is one');
  const text = JSON.stringify(report);
  for (const secret of [ada.id, bola.id, 'Ada', 'Bola', ada.cookie.slice(4), '127.0.0.1']) assert.equal(text.includes(secret), false, `the report carries no ${secret}`);
  // A browser may report a signal from the fixed list; anything else is not counted.
  assert.equal((await post('/api/growth/client', { signals: ['opera-mini', 'opera-mini', 'webgl-missing', 'evil.counter', 7] })).counted, 2);
  const after = await mod('/api/mod/growth/metrics');
  assert.deepEqual([after.totals['client.opera-mini'], after.totals['client.webgl-missing'], after.totals['client.evil.counter']], [1, 1, undefined]);
  // After its window a life is no longer followed individually: its record is deleted.
  f.advance(25 * DAY); assert.equal((await hello(ada, 1)).ok, true);
  assert.equal((await mod('/api/mod/growth/metrics')).tracked, 0);
  // Without a configured operator token the route does not exist.
  const closed = await fixture(t, {});
  assert.equal((await closed.request('/api/mod/growth/metrics')).status, 404);
  assert.ok(LIMITS.sharesPerDay === 20);
});

test('metrics count each thing once under one name, follow the merged first minute, and do not depend on telemetry', async (t) => {
  const { f, post, hello, mod } = await harness(t);
  const { FUNNEL, FUNNEL_ORDER, touch } = await import('./growth/metrics.ts');
  // The bit positions of the steps lives are already counted under never move: a new step is added at the end.
  assert.deepEqual(FUNNEL.map((step) => step.id), ['onboarded', 'goal-1', 'job', 'shift', 'goals-done', 'mission', 'table', 'day-two-work', 'settled']);
  assert.deepEqual([...FUNNEL_ORDER].sort(), FUNNEL.map((step) => step.id).sort());
  const chain = (await import('../src/game/content/goals.ts')).STARTER_GOALS.length;
  const done = FUNNEL.find((step) => step.id === 'goals-done');
  assert.deepEqual([chain, done.reached({ goals: { chain: 7 } }), done.reached({ goals: { chain } })], [10, false, true], 'the whole starter chain, not the old seven goals');
  // A new visitor as the quick start makes one: a guest is "onboarded" (arrived) once Play is confirmed, "settled" only after settling in.
  const opened = await f.request('/api/session', { name: 'Ngozi', onboarding: true });
  const ngozi = { cookie: opened.headers.get('set-cookie').split(';')[0], ...(await opened.json()).session };
  await f.request('/api/life?city=lagos', null, ngozi.cookie);
  assert.equal((await hello(ngozi, 7)).code, 'not_ready', 'a life still held for its look is not counted at all');
  const look = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
  assert.equal((await f.action(ngozi.cookie, { type: 'onboarding.quick-start', payload: { look } })).code, 'playing');
  for (let i = 0; i < 3; i++) await hello(ngozi, 7);
  let report = await mod('/api/mod/growth/metrics');
  assert.deepEqual([report.totals.new, report.totals.active, report.totals['funnel.onboarded'], report.totals['funnel.settled'], report.totals['funnel.goal-1']], [1, 1, 1, undefined, undefined]);
  assert.equal((await f.action(ngozi.cookie, { type: 'activity', payload: { id: 'play-ayo' } })).ok, true); f.advance(8000);
  for (const [type, payload] of [['onboarding.traits', { traits: ['musical', 'clean-pikin'] }], ['onboarding.dream', { dream: 'afrobeats-star' }], ['onboarding.lottery', {}], ['onboarding.home', { lga: 'ikeja', stay: true }]]) assert.equal((await f.action(ngozi.cookie, { type, payload })).ok, true, type);
  for (let i = 0; i < 3; i++) await hello(ngozi, 7);
  report = await mod('/api/mod/growth/metrics');
  assert.deepEqual([report.totals.new, report.totals.active, report.totals['funnel.onboarded'], report.totals['funnel.goal-1'], report.totals['funnel.settled']], [1, 1, 1, 1, 1], 'six hellos: one life, one active day, each step once');
  assert.deepEqual(report.funnel.map((row) => row.step), FUNNEL_ORDER);
  assert.deepEqual(report.funnel.slice(0, 3).map((row) => row.lives), [1, 1, 1]);
  // The report says what it is, and whether analytics is running beside it. Here telemetry is not configured at all.
  assert.deepEqual([report.source, report.analytics], ['first-party', 'not-configured']);
  // One act, one counter: a referral link is `referral.linked`, never also a share counter; a HEAD is not an opening.
  const ada = await f.device('Ada'); await f.request('/api/life?city=lagos', null, ada.cookie); await hello(ada, 1);
  const share = await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ada);
  assert.equal((await fetch(`${f.base}${share.share.path}`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${f.base}${share.share.path}`)).status, 200);
  assert.equal((await post('/api/growth/referral/link', { cityId: 'lagos', code: share.share.code, device: 'device-token-0000007' }, ngozi)).code, 'linked');
  report = await mod('/api/mod/growth/metrics');
  assert.deepEqual([report.totals['share.opened'], report.totals['referral.linked'], report.totals['share.joined']], [1, 1, undefined]);
  // A life too old to be followed is counted once a day, not once per visit.
  const g = { metrics: {} }, old = { civic: { since: 0 } }, day = 86400000, at = 100 * day;
  touch(g, at, 'old-life', old, null); touch(g, at + 1000, 'old-life', old, at); touch(g, at + 2000, 'old-life', old, at + 1000);
  touch(g, at + day, 'old-life', old, at + 2000);
  assert.deepEqual(Object.values(g.metrics.days).map((row) => row['active-untracked']), [1, 1]);
});

test('the operator’s numbers are the same with telemetry configured: nothing is forwarded, added or required', async (t) => {
  const { createServerTelemetry } = await import('./telemetry/index.ts');
  const sent = [];
  const telemetry = createServerTelemetry({ env: { TELEMETRY_ENV: 'production', POSTHOG_KEY: 'phc_projectkey123', SENTRY_DSN_SERVER: 'https://serverkey@o1.ingest.sentry.example/42' }, fetch: async (url, init) => { sent.push(String(init?.body ?? '')); return { ok: true, status: 200, text: async () => '' }; }, now: () => 0, flushMs: 60000 });
  const { f, hello, work, player, mod } = await harness(t, { telemetry });
  const ada = await player('Ada', 1);
  await work(ada); for (let i = 0; i < 3; i++) await hello(ada, 1);
  const report = await mod('/api/mod/growth/metrics');
  assert.deepEqual([report.analytics, report.source, report.totals.new, report.totals.active, report.totals['funnel.onboarded'], report.totals['funnel.shift']], ['also-configured', 'first-party', 1, 1, 1, 1]);
  await telemetry.flush();
  const out = sent.join('\n');
  for (const counter of ['funnel.onboarded', 'funnel.shift', 'share.opened', 'active-untracked']) assert.ok(!out.includes(counter), `${counter} is not sent to analytics`);
  assert.ok(!out.includes(ada.id), 'and nothing is recorded for a player who has not accepted analytics');
});

test('a share says where the sharer really lives: the local government of their own house, a rented district, or nothing for a guest', async (t) => {
  const { f, post, hello } = await harness(t);
  const look = { body: 'woman', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
  const opened = await f.request('/api/session', { name: 'Ngozi', onboarding: true });
  const ngozi = { cookie: opened.headers.get('set-cookie').split(';')[0], ...(await opened.json()).session };
  await f.request('/api/life?city=lagos', null, ngozi.cookie);
  assert.equal((await f.action(ngozi.cookie, { type: 'onboarding.quick-start', payload: { look } })).code, 'playing');
  await hello(ngozi, 9);
  const asGuest = await post('/api/growth/share', { cityId: 'lagos', kind: 'invite' }, ngozi);
  assert.deepEqual([asGuest.ok, asGuest.share.facts.district], [true, ''], 'a guest has no home: the card names the city only');
  for (const [type, payload] of [['onboarding.traits', { traits: ['musical', 'clean-pikin'] }], ['onboarding.dream', { dream: 'afrobeats-star' }], ['onboarding.lottery', {}], ['onboarding.home', { lga: 'surulere', stay: true }]]) assert.equal((await f.action(ngozi.cookie, { type, payload })).ok, true, type);
  const settled = await post('/api/growth/share', { cityId: 'lagos', kind: 'house' }, ngozi);
  assert.equal(settled.share.facts.district, 'Surulere', 'her own house is in Surulere — not the Yaba of a home she never rented');
  assert.match(sharePreview(settled.share.facts).title, /Surulere, Lagos/);
  // She rents in Mushin instead: now that is where she lives.
  assert.equal((await f.action(ngozi.cookie, { type: 'property.house-move', payload: { id: 'mushin' } })).ok, true);
  assert.equal((await post('/api/growth/share', { cityId: 'lagos', kind: 'house' }, ngozi)).share.facts.district, 'Mushin');
  // And the old Neighbours directory files an owner under "In their own house", never under a district they do not rent in.
  const { houseOf } = await import('./civic/residents.ts');
  assert.deepEqual([houseOf({ estate: { living: 'own' }, property: { house: 'yaba' } }), houseOf({ estate: { living: 'rent' }, property: { house: 'yaba' } }), houseOf({ property: { house: 'lekki' } })], ['own', 'yaba', 'lekki']);
});
