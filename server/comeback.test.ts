// OWNER: growth — comeback mail on the server: consent, the schedule, exactly once, the nudge, unsubscribing per type and
// for everything, blocked and muted senders, the zero-work paths, and a store from before the feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { ENDPOINT } from './growth/email/zeptomail.ts';
import { comebackMail } from './growth/email/comeback.ts';
import { NUDGE_NOTE } from './growth/comeback.ts';
import { mailRecipientOf } from './growth/recipient.ts';
import { loadCityContent, registerCityForTest } from '../src/game/cities/registry.ts';
import { upcomingEvents } from '../src/game/calendar.ts';
import { fictionalCity } from '../src/game/cities/testing/fictionalCity.test-fixture.ts';
import type { TestContext } from 'node:test';
import type { ComebackView, HelloResult, OutreachOperatorResponse, OutreachRunResponse } from '../src/types/growth.ts';
import type { Plan } from '../src/game/comeback.ts';
import type { Db, GrowthCollection } from './types.ts';

const HOUR = 3600000, DAY = 86400000;
const TOKEN = 'operator-token-for-comeback-tests-012345';
const LIVE: Record<string, string> = { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street' };
/** The fixture clock starts at 100000 ms: 01:01 Lagos on Thursday 1 January 1970 (day 0). */

type Dict = Record<string, unknown>;
type Who = { cookie: string; id: string };
type Plain = { status: number; error: string; ok: boolean; code: string; reason: string; note: string; comeback: ComebackView; removed: boolean };
interface Mail { personalizations: { to: { email: string }[] }[]; subject: string; headers: Record<string, string>; content: { type: string; value: string }[] }
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };

async function harness(t: TestContext, { env = LIVE, respond }: { env?: Record<string, string>; respond?: () => number } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetchFake = async (url: string, init: RequestInit): Promise<Response> => { calls.push({ url: String(url), body: String(init.body) }); return new Response(null, { status: respond ? respond() : 202 }); };
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', env, fetch: fetchFake });
  const json = async <R>(res: Response) => ({ status: res.status, ...((await res.json()) as Dict) }) as unknown as Plain & R;
  const post = async <R = object>(path: string, body: unknown, who?: Who) => json<R>(await f.request(path, body, who?.cookie));
  const get = async <R = object>(path: string, who?: Who) => json<R>(await f.request(path, null, who?.cookie));
  const mod = async <R = object>(path: string, body?: unknown) => json<R>(await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const hello = (who: Who) => post<Extract<HelloResult, { ok: true }>>('/api/growth/hello', { cityId: 'lagos' }, who);
  const player = async (name: string) => { const who = await f.device(name); await f.request('/api/life?city=lagos', null, who.cookie); await hello(who); await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, who); await get('/api/social/me', who); return who; };
  const run = () => mod<OutreachRunResponse>('/api/mod/growth/outreach/run', {});
  const mails = (): Mail[] => calls.filter((call) => call.url === ENDPOINT).map((call) => JSON.parse(call.body) as Mail);
  const comebackMails = () => mails().filter((mail) => !/^(Confirm your e-mail|You are in)/.test(mail.subject));
  const linkIn = (mail: Mail, path: string): string => must(new RegExp(`https://play\\.example(${path}\\?t=[A-Za-z0-9_.-]+)`).exec(must(mail.content[0], 'text part').value)?.[1], 'a link');
  const page = async (path: string, method = 'GET', body?: string) => { const res = await fetch(f.base + path, { method, ...(body ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : {}) }); return { status: res.status, html: await res.text() }; };
  const optIn = async (who: Who, email: string) => {
    await post('/api/growth/email', { email, consent: true }, who);
    await page(linkIn(must(mails().at(-1), 'a confirmation'), '/e/confirm'), 'POST');
  };
  /** Only the named types stay on, so a test is about one kind of mail (the calendar always has something coming). */
  const only = (who: Who, ...on: string[]) => post('/api/growth/comeback', { cityId: 'lagos', types: Object.fromEntries(['needs', 'friends', 'milestones', 'events', 'away', 'week'].map((key) => [key, on.includes(key)])) }, who);
  const growth = () => f.server.store.read((db) => structuredClone<Partial<GrowthCollection>>(db.growth ?? {}));
  const edit = (fn: (db: Db) => void) => f.server.store.transact((db) => { fn(db); });
  /** Change a player's stored life (their needs, job, upgrade) as a long absence leaves it. */
  const life = (who: Who, fn: (state: import('../src/types/life.ts').LifeState) => void) => edit((db) => { const session = Object.values(db.sessions).find((item) => item.publicId === who.id); fn(must(session?.cities.lagos, 'a life').state); });
  const befriend = async (a: Who, b: Who) => { await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a); await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b); };
  /** Move the clock to a Lagos day (0 = Thursday 1 January 1970) and hour. Never backwards. */
  const go = (day: number, hour = 12) => { const target = Date.UTC(1970, 0, 1 + day, hour - 1); assert.ok(target >= f.now(), 'time only goes forward'); f.advance(target - f.now()); };
  return { f, calls, post, get, mod, hello, player, run, mails, comebackMails, linkIn, page, optIn, only, growth, edit, life, befriend, go };
}
type Harness = Awaited<ReturnType<typeof harness>>;
const lowHunger = (h: Harness, who: Who) => h.life(who, (state) => { state.needs.hunger = 12; });

test('consent: confirming starts the preference on with the sentence; without an address nothing can be switched on; older addresses start off', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  assert.deepEqual(await h.post('/api/growth/comeback', { cityId: 'lagos', on: true }, ada), { status: 200, ok: false, code: 'no_address', reason: 'Confirm an e-mail address first. Phone, Stay in touch.', serverTime: h.f.now() });
  assert.equal((await h.hello(ada)).contact.comeback.on, false);
  await h.post('/api/growth/email', { email: 'ada@example.com', consent: true }, ada);
  assert.equal((await h.hello(ada)).contact.comeback.on, false, 'not before the address is confirmed');
  const link = h.linkIn(must(h.mails().at(-1)), '/e/confirm');
  const shown = await h.page(link);
  assert.match(shown.html, /We’ll send you a few e-mails a week at most about your character\. Change this any time\./);
  const done = await h.page(link, 'POST');
  assert.match(done.html, /a few e-mails a week at most about your character/);
  const view = (await h.hello(ada)).contact.comeback;
  assert.deepEqual([view.on, view.pausedUntil, Object.values(view.types).every(Boolean)], [true, 0, true]);
  // A switch: validated, and "pause all" is thirty days.
  assert.equal((await h.post('/api/growth/comeback', { cityId: 'lagos', types: { cheese: true } }, ada)).error, 'invalid_comeback');
  assert.equal((await h.post('/api/growth/comeback', { cityId: 'lagos', on: 'yes' }, ada)).error, 'invalid_comeback');
  const paused = await h.post('/api/growth/comeback', { cityId: 'lagos', pause: true }, ada);
  assert.equal(paused.comeback.pausedUntil, h.f.now() + 30 * DAY);
  assert.equal((await h.post('/api/growth/comeback', { cityId: 'lagos', pause: false }, ada)).comeback.pausedUntil, 0);
  // An address confirmed before this feature: no record, so the preference is off, and nothing is sent until it is switched on.
  const bola = await h.player('Bola');
  await h.optIn(bola, 'bola@example.com');
  await h.edit((db) => { delete db.growth?.comeback; });
  assert.equal((await h.hello(bola)).contact.comeback.on, false);
  await h.life(bola, (state) => { state.needs.hunger = 5; });
  h.go(2); await h.run();
  assert.equal(h.comebackMails().filter((mail) => /Bola/.test(mail.subject)).length, 0);
  assert.equal((await h.post('/api/growth/comeback', { cityId: 'lagos', on: true }, bola)).comeback.on, true);
  h.go(3); await h.run();
  assert.equal(h.comebackMails().filter((mail) => mail.subject === 'Bola is hungry').length, 1);
});

test('a need alert: the worst need only, in the character’s voice, with one button and the three controls', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada Okafor');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs');
  await h.life(ada, (state) => { state.needs.hunger = 30; state.needs.energy = 5; state.needs.social = 80; });
  h.go(2); await h.run();
  const mail = must(h.comebackMails()[0]);
  assert.equal(mail.subject, 'Ada is tired', 'the worst of hunger, energy and social');
  const text = must(mail.content[0]).value, html = must(mail.content[1]).value;
  assert.match(text, /Let Ada rest: https:\/\/play\.example\/\?go=needs/);
  assert.match(text, /Stop e-mails about my character’s needs: https:\/\/play\.example\/e\/unsub\?t=/);
  assert.match(text, /Unsubscribe from everything: https:\/\/play\.example\/e\/unsub\?t=/);
  assert.match(text, /Change what I get: https:\/\/play\.example\/\?go=touch/);
  assert.match(text, /a digital world you can live in/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(must(mail.headers['List-Unsubscribe']), /^<https:\/\/play\.example\/e\/unsub\?t=[A-Za-z0-9_.-]+>$/);
  assert.equal((html.match(/<a /g) ?? []).length, 4, 'one button and three footer links');
  assert.equal(/<img|<script|<link|url\(|http:\/\//i.test(html), false, 'no image, tracking pixel or third-party asset');
  assert.equal(/example\.com/.test(text + html), false, 'no address in the body');
  // Asked again, and an hour on: nothing (claimed), and the cooldown holds for three days.
  for (let i = 0; i < 3; i++) { await h.run(); h.f.advance(HOUR); }
  assert.equal(h.comebackMails().length, 1);
});

test('someone waiting: friends named, counts only, no message text; a blocked or muted sender never triggers', async (t) => {
  const h = await harness(t);
  const [ada, bola, chidi, dayo] = [await h.player('Ada'), await h.player('Bola'), await h.player('Chidi'), await h.player('Dayo')] as [Who, Who, Who, Who];
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'friends');
  await h.befriend(ada, bola); await h.befriend(ada, chidi); await h.befriend(ada, dayo);
  h.go(1);
  for (const [who, body] of [[bola, 'SECRET-BODY-ONE jollof tonight?'], [chidi, 'SECRET-BODY-TWO'], [dayo, 'SECRET-BODY-THREE']] as const) {
    assert.equal((await h.post('/api/social/messages', { to: ada.id, body, clientId: h.f.id() }, who)).ok, true);
  }
  // Ada blocks Chidi and an operator mutes Dayo after they wrote: neither counts, however unread.
  assert.equal((await h.post('/api/social/block', { id: chidi.id, cityId: 'lagos' }, ada)).ok, true);
  assert.equal((await h.mod('/api/mod/mutes', { id: dayo.id, minutes: 10000, reason: 'test' })).ok, true);
  h.go(2);
  await h.run();
  const mail = must(h.comebackMails()[0]);
  assert.equal(mail.subject, 'Bola is waiting for you');
  const all = JSON.stringify(mail);
  for (const secret of ['SECRET-BODY', 'jollof', 'Chidi', 'Dayo']) assert.equal(all.includes(secret), false, secret);
  assert.match(must(mail.content[0]).value, /1 message from your friends/);
  assert.match(must(mail.content[0]).value, /\?go=messages/);
  // A friend request from a stranger counts, unnamed.
  const eve = await h.player('Eve');
  assert.equal((await h.post('/api/social/friends/request', { to: ada.id, cityId: 'lagos' }, eve)).ok, true);
  h.go(6); await h.run();
  const second = must(h.comebackMails()[1]);
  assert.equal(second.subject, 'Someone wants to be your friend in Allworld');
  assert.equal(JSON.stringify(second).includes('Eve'), false);
});

test('the nudge: friends only, away two days, once a week per friend, the same answer whether or not they have an address, blocks respected', async (t) => {
  const h = await harness(t);
  const [ada, bola, chidi] = [await h.player('Ada'), await h.player('Bola'), await h.player('Chidi')] as [Who, Who, Who];
  await h.optIn(bola, 'bola@example.com'); await h.only(bola, 'friends');
  await h.befriend(ada, bola); await h.befriend(ada, chidi);
  const nudge = (to: Who) => h.post('/api/growth/nudge', { cityId: 'lagos', to: to.id }, ada);
  assert.equal((await nudge(bola)).code, 'not_away', 'Bola was here a moment ago');
  assert.equal((await h.post('/api/growth/nudge', { cityId: 'lagos', to: 'nope' }, ada)).error, 'invalid_player');
  assert.equal((await h.post('/api/growth/nudge', { cityId: 'lagos', to: ada.id }, ada)).error, 'invalid_player');
  const stranger = await h.player('Stranger');
  h.go(3);
  assert.equal((await h.post('/api/growth/nudge', { cityId: 'lagos', to: stranger.id }, ada)).code, 'not_friends');
  const withAddress = await nudge(bola), without = await nudge(chidi);
  assert.deepEqual([withAddress.code, without.code, withAddress.note, without.note], ['nudged', 'nudged', NUDGE_NOTE, NUDGE_NOTE], 'nothing says who has an address');
  assert.deepEqual(Object.keys((await h.hello(ada)).contact.comeback.nudged).sort(), [bola.id, chidi.id].sort());
  const again = await nudge(bola);
  assert.equal(again.code, 'cooldown');
  assert.match(again.reason, /again in 7 days/);
  // A blocked friend cannot be nudged, and a nudge never arrives from someone who has since blocked.
  assert.equal((await h.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, chidi)).ok, true);
  h.go(4); await h.run();
  assert.equal((await nudge(chidi)).code, 'not_friends');
  // Bola's mail: the friend's name and the button to People.
  const mail = must(h.comebackMails()[0]);
  assert.equal(mail.subject, 'Ada is waiting for you in Allworld');
  assert.match(must(mail.content[0]).value, /\?go=people/);
  // The nudge limit: five an hour.
  for (let i = 0; i < 5; i++) await h.player(`Extra${i}`);
});

test('a nudge from a friend who then blocked the player does not become a mail', async (t) => {
  const h = await harness(t);
  const [ada, bola] = [await h.player('Ada'), await h.player('Bola')] as [Who, Who];
  await h.optIn(bola, 'bola@example.com'); await h.only(bola, 'friends');
  await h.befriend(ada, bola);
  h.go(3);
  assert.equal((await h.post('/api/growth/nudge', { cityId: 'lagos', to: bola.id }, ada)).code, 'nudged');
  assert.equal((await h.post('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola)).ok, true);
  h.go(4); await h.run();
  assert.equal(h.comebackMails().length, 0);
});

test('policy on the server: quiet hours, one a day, back-off after three mails with no visit, five and then silence', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs');
  await lowHunger(h, ada);
  // 21:30 on the second day: it is night, so nothing, however many times it is asked.
  h.go(1, 21.5); for (let i = 0; i < 3; i++) await h.run();
  assert.equal(h.comebackMails().length, 0);
  // 08:30 on day two: the first mail. Four hours later and the next day: nothing (a day, and three days between need alerts).
  h.go(2, 8.5); await h.run();
  assert.deepEqual(h.comebackMails().map((mail) => mail.subject), ['Ada is hungry']);
  h.go(2, 12.5); await h.run(); h.go(3, 12); await h.run();
  assert.equal(h.comebackMails().length, 1);
  // Days five and eight: the second and third. Three with no visit in between: one every 14 days from here.
  h.go(5); await h.run(); h.go(8); await h.run();
  assert.equal(h.comebackMails().length, 3);
  for (const day of [11, 15, 20]) { h.go(day); await h.run(); }
  assert.equal(h.comebackMails().length, 3, 'back-off: nothing for 14 days');
  h.go(22); await h.run();
  assert.equal(h.comebackMails().length, 4, 'the fourth, 14 days after the third');
  // (A life that goes thirty days without a visit expires, so the longest run on a real server is these four and the goodbye.)
  // They come back: the run starts again.
  h.go(23); await h.hello(ada); await lowHunger(h, ada);
  h.go(25); await h.run();
  assert.equal(h.comebackMails().length, 5);
  assert.equal(new Set(h.comebackMails().map((mail) => mail.subject)).size, 1);
});

test('away steps on the server: 3 days, 7 days and a last note at 28, each once; then silence', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'away');
  h.go(2); await h.run();
  assert.equal(h.comebackMails().length, 0, 'under three days');
  h.go(3, 12); await h.run(); await h.run();
  h.go(7, 12); await h.run();
  h.go(10); await h.run();
  h.go(28, 12); await h.run(); await h.run();
  assert.deepEqual(h.comebackMails().map((mail) => mail.subject), ['Your world is still here', 'Ada, your world is still here', 'One last note from Allworld']);
  const last = must(h.comebackMails()[2]);
  assert.match(must(last.content[0]).value, /last e-mail you will get unless you come back/);
  h.go(29); await h.run(); h.go(29, 20); await h.run();
  assert.equal(h.comebackMails().length, 3, 'silence until they come back');
  // Back, and away again: the steps start over.
  h.go(29, 21); await h.hello(ada);
  h.go(33); await h.run();
  assert.equal(must(h.comebackMails()[3]).subject, 'Your world is still here');
  for (const mail of h.comebackMails()) assert.equal(/lose|miss you|hurry|last chance/i.test(must(mail.content[0]).value), false, 'no guilt');
});

test('exactly once: two ticks at the same moment, a restart in between, and a provider that fails', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs');
  await lowHunger(h, ada);
  h.go(2);
  const results = await Promise.all([h.run(), h.run(), h.run()]);
  assert.equal(h.comebackMails().length, 1, 'concurrent ticks claim once');
  assert.ok(results.some((result) => result.comeback?.jobs === 1));
  // The claim is in the stored ledger before anything is sent, so a restart that loses the in-memory state cannot send it again.
  const stored = must((await h.growth()).comeback?.[ada.id]);
  assert.deepEqual([stored.sent.length, stored.last.need !== undefined, stored.next > h.f.now()], [1, true, true]);
  h.go(2, 13); await h.run();
  assert.equal(h.comebackMails().length, 1);
});

test('exactly once across a provider failure: a refused mail is not tried again', async (t) => {
  let status = 202;
  const h = await harness(t, { respond: () => status });
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs');
  await lowHunger(h, ada);
  h.go(2); status = 401;
  const before = h.mails().length;
  await h.run(); await h.run();
  assert.equal(h.mails().length, before + 1, 'one attempt for the claimed mail');
  status = 202; h.go(2, 14); await h.run();
  assert.equal(h.mails().length, before + 1);
  const view = await h.mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.deepEqual([view.comeback.types.need?.queued, view.comeback.types.need?.sent, view.comeback.types.need?.failed], [1, 0, 1]);
});

test('unsubscribing: a page that only shows a button, then one type, then everything — the one-click POST needs no login', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs', 'away');
  await lowHunger(h, ada);
  h.go(2); await h.run();
  const mail = must(h.comebackMails()[0]);
  const stop = must(/Stop e-mails about my character’s needs: https:\/\/play\.example(\/e\/unsub\?t=[A-Za-z0-9_.-]+)/.exec(must(mail.content[0]).value))[1] ?? '';
  const header = must(/^<https:\/\/play\.example(\/e\/unsub\?t=[^>]+)>$/.exec(must(mail.headers['List-Unsubscribe'])))[1] ?? '';
  assert.notEqual(stop, header);
  const shown = await h.page(stop);
  assert.ok(shown.status === 200 && /Stop these<\/button>/.test(shown.html) && /needs/.test(shown.html));
  assert.equal((await h.get('/api/growth/hello' as string)).status >= 400, true);
  assert.equal((await h.hello(ada)).contact.comeback.types.needs, true, 'a GET changes nothing');
  assert.equal((await h.page(stop, 'POST', 'List-Unsubscribe=One-Click')).status, 200);
  const after = (await h.hello(ada)).contact;
  assert.deepEqual([after.comeback.types.needs, after.comeback.types.away, after.comeback.on, after.email?.confirmed], [false, true, true, true], 'only that type, and the address stays');
  assert.equal((await h.page(stop, 'POST')).status, 200, 'twice is still done');
  // A token of one kind cannot be used for another page's work: a forged type is refused.
  const dot = stop.lastIndexOf('.') + 1, forged = `${stop.slice(0, dot)}${stop[dot] === 'A' ? 'B' : 'A'}${stop.slice(dot + 1)}`;
  assert.equal((await h.page(forged, 'POST')).status, 400);
  // The List-Unsubscribe address (what a mail program POSTs) removes the address, as before.
  assert.equal((await h.page(header, 'POST', 'List-Unsubscribe=One-Click')).status, 200);
  const gone = (await h.hello(ada)).contact;
  assert.deepEqual([gone.email, gone.comeback.on], [null, false]);
  assert.equal(must((await h.growth()).comebackStats ? 1 : 0), 1);
  const view = await h.mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.equal(view.comeback.types.need?.unsubscribed, 1);
  assert.equal(view.comeback.types.all?.unsubscribed, 1);
  // Nothing more is sent, whatever happens.
  await lowHunger(h, ada); h.go(9); await h.run();
  assert.equal(h.comebackMails().length, 1);
});

test('the weekly digest shares the ledger and the switches: it counts as one mail, a pause or its own switch stops it', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada'), bola = await h.player('Bola'), chidi = await h.player('Chidi');
  for (const [who, address] of [[ada, 'ada@example.com'], [bola, 'bola@example.com'], [chidi, 'chidi@example.com']] as const) {
    await h.optIn(who, address);
    await h.life(who, (state) => { state.missions.stamps = { week: 0, days: 3, paid: false }; });
  }
  // Day 3 is Sunday 4 January 1970. Ada: the digest's own switch is off. Bola: paused. Chidi: nothing set.
  await h.post('/api/growth/comeback', { cityId: 'lagos', types: { week: false } }, ada);
  await h.post('/api/growth/comeback', { cityId: 'lagos', pause: true }, bola);
  h.go(3, 18); await h.run();
  const digests = () => h.mails().filter((mail) => /^Your week in/.test(mail.subject));
  assert.equal(digests().length, 1, 'only the player with no reason to hold it back');
  // It is one of the three: the ledger holds it, and the same hour of the same day does not send it twice.
  const stored = await h.growth();
  assert.deepEqual(must(stored.comeback?.[chidi.id]).sent.map((entry) => entry.type), ['week']);
  await h.run(); h.go(3, 19); await h.run();
  assert.equal(digests().length, 1);
  // Ada, whose digest is off, was still written to about her absence (that is a different switch), and the digest of Chidi counted against his day.
  assert.equal(h.comebackMails().some((mail) => mail.subject === 'Your world is still here'), true);
});

test('zero work: not configured, nobody opted in, switched off', async (t) => {
  // Not configured: nothing is read or written, nothing is composed.
  const dry = await harness(t, { env: {} });
  const ada = await dry.player('Ada');
  await dry.post('/api/growth/email', { email: 'ada@example.com', consent: true }, ada);
  let reads = 0;
  const store = dry.f.server.store;
  const { transact, read } = store;
  store.transact = ((...args: Parameters<typeof transact>) => { reads++; return transact.apply(store, args); }) as typeof transact;
  store.read = ((...args: Parameters<typeof read>) => { reads++; return read.apply(store, args); }) as typeof read;
  dry.go(5);
  const result = await dry.run();
  assert.deepEqual(result.comeback, { ran: false, reason: 'not_configured' });
  assert.equal(reads <= 2, true, 'the operator route itself reads; the comeback tick adds nothing');
  store.transact = transact; store.read = read;
  assert.equal(dry.calls.length, 0);
  // Configured, but nobody has a confirmed address: one look, and then none until something changes.
  const h = await harness(t);
  const bola = await h.player('Bola');
  assert.deepEqual((await h.run()).comeback, { ran: true, jobs: 0 });
  assert.equal((await h.growth()).comeback, undefined, 'a server nobody has opted in on stores nothing');
  // The heartbeat path (not forced) is idle now: no store access at all.
  const s2 = h.f.server.store, t2 = s2.transact;
  let touched = 0;
  s2.transact = ((...args: Parameters<typeof t2>) => { touched++; return t2.apply(s2, args); }) as typeof t2;
  h.f.advance(HOUR); h.f.server.beat();
  await new Promise((resolve) => setTimeout(resolve, 40));
  s2.transact = t2;
  assert.equal(bola.id.length > 0 && touched, 0, 'idle: no store access at all');
});

test('the heartbeat drives it, and between due times a beat costs nothing', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com'); await h.only(ada, 'needs');
  await lowHunger(h, ada);
  h.go(2);
  h.f.server.beat();
  for (let i = 0; i < 50 && h.comebackMails().length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(h.comebackMails().map((mail) => mail.subject), ['Ada is hungry']);
  // Between due times a beat costs nothing: the rounds that opened the store do not grow.
  const passes = async () => (await h.mod<OutreachOperatorResponse>('/api/mod/growth/outreach')).comeback.passes;
  const before = await passes();
  for (let i = 0; i < 5; i++) { h.f.advance(2 * 60000); h.f.server.beat(); await new Promise((resolve) => setTimeout(resolve, 20)); }
  assert.equal(await passes(), before, 'five beats, no round');
  assert.equal(h.comebackMails().length, 1);
  // When the record is due again (a day on) a round happens; with nothing to send it sets the next look and goes quiet.
  h.go(3, 13); h.f.server.beat(); await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(await passes(), before + 1);
});

test('a database from before the feature: no comeback fields, a legacy contact, a player record without nudges', async (t) => {
  const h = await harness(t);
  const ada = await h.player('Ada');
  await h.optIn(ada, 'ada@example.com');
  await h.edit((db) => { const g = must(db.growth); delete g.comeback; delete g.comebackStats; for (const player of Object.values(g.players)) delete player.nudged; });
  const view = (await h.hello(ada)).contact.comeback;
  assert.deepEqual([view.on, view.nudged], [false, {}]);
  assert.equal((await h.run()).comeback?.ran, true);
  assert.equal((await h.mod<OutreachOperatorResponse>('/api/mod/growth/outreach')).comeback.waiting, 0);
  // A damaged record is repaired, not fatal.
  await h.edit((db) => { must(db.growth).comeback = { [ada.id]: { on: true, sent: 'x', keys: null, nudges: [1], types: 7 } as never }; });
  await lowHunger(h, ada); await h.only(ada, 'needs');
  h.go(2); await h.run();
  assert.equal(h.comebackMails().length, 1);
});

test('the recipient is one function: confirmed and adult only', () => {
  const contact = { email: 'a@example.com', confirmed: true, nonce: 'n', at: 1, confirmedAt: 1, welcomed: true, confirms: [], sends: [], periods: {}, preview: null };
  const players = { adult: { consent: { age: 'adult' as const, push: false, email: true, at: 1 } }, minor: { consent: { age: 'minor' as const, push: false, email: false, at: 1 } }, none: { consent: null } };
  const g = { contacts: { adult: contact, minor: contact, none: contact, pending: { ...contact, confirmed: false } }, players } as unknown as Pick<GrowthCollection, 'contacts' | 'players' | 'salt'>;
  assert.deepEqual(mailRecipientOf(g, 'adult'), { email: 'a@example.com', nonce: 'n', source: 'contact' });
  for (const id of ['minor', 'none', 'pending', 'ghost', '__proto__']) assert.equal(mailRecipientOf(g, id), null, id);
});

test('templates: a hostile name or title is escaped, and every type reads well', () => {
  const links = { origin: 'https://play.example', stopUrl: 'https://play.example/e/unsub?t=a', unsubscribeUrl: 'https://play.example/e/unsub?t=b' };
  const hostile = '<img src=x onerror=alert(1)> & "q"';
  const plans: Plan[] = [
    { type: 'need', key: 'k', need: 'hunger', go: 'needs' },
    { type: 'waiting', key: 'k', names: [hostile], messages: 1, gifts: 0, requests: 0, newest: 1, go: 'messages' },
    { type: 'nudge', key: 'k', names: [hostile], newest: 1, go: 'people' },
    { type: 'event', key: 'k', title: hostile, venue: hostile, start: 100000 + 10 * HOUR, go: 'events' },
    { type: 'milestone', key: 'k', what: 'shift', label: hostile, go: 'career' },
    { type: 'away', key: 'k', step: 7, go: 'needs', facts: [hostile] },
  ];
  for (const plan of plans) {
    const mail = comebackMail({ plan, name: hostile, now: 100000, links, contact: 'Allworld <x>' });
    assert.equal(/<img|<x>/.test(mail.html), false, `${plan.type}: nothing a player wrote is HTML`);
    assert.equal(mail.html.includes('&lt;'), true, plan.type);
    assert.match(mail.text, /https:\/\/play\.example\/\?go=/);
  }
});

test('per city: a character in another city is written about its own city only — its events, its facts, never Lagos', async (t) => {
  const installed = registerCityForTest(fictionalCity);
  t.after(() => installed.dispose());
  await loadCityContent(fictionalCity.id);
  const h = await harness(t);
  const [ada, zed] = [await h.player('Ada'), await h.player('Zed')] as [Who, Who];
  await h.optIn(ada, 'ada@example.com'); await h.optIn(zed, 'zed@example.com');
  await h.only(ada, 'events'); await h.only(zed, 'events', 'away');
  // Zed's character lives in the other city (its own life there; the Lagos one is still stored).
  await h.edit((db) => {
    const session = must(Object.values(db.sessions).find((item) => item.publicId === zed.id), 'a session');
    const there = structuredClone(must(session.cities.lagos, 'a life'));
    there.state.estate.city = fictionalCity.id; there.state.goals.wishes = [];
    session.cities[fictionalCity.id] = there;
    session.character = { v: 1, city: fictionalCity.id };
  });
  // The first day with a Lagos event starting within the next 24 hours, two days or more from the start.
  let day = 2;
  while (day < 30 && !upcomingEvents(Date.UTC(1970, 0, 1 + day, 11), 1, 'lagos').length) day++;
  assert.ok(day < 30, 'the calendar has an event');
  h.go(day, 11);
  await h.run();
  const to = (email: string) => h.comebackMails().filter((mail) => mail.personalizations[0]?.to[0]?.email === email);
  assert.equal(to('ada@example.com').length, 1, 'the Lagos character is told about its Lagos event');
  assert.match(must(to('ada@example.com')[0]).subject, /starts/);
  assert.deepEqual(to('zed@example.com').filter((mail) => /starts/.test(mail.subject)), [], 'the other city has none of Lagos events');
  // Away mails for the other city never name Lagos, in the subject or the body.
  h.go(day + 4, 11); await h.run();
  const mine = to('zed@example.com');
  assert.ok(mine.length >= 1, 'an away mail was sent');
  for (const mail of mine) assert.equal(/lagos/i.test(JSON.stringify(mail)), false, mail.subject);
});
