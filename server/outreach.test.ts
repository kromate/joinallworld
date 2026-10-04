// OWNER: growth — e-mail and web push: consent, double opt-in, unsubscribe, caps, quiet hours,
// exactly-once per period, provider failures, dry-run, the RFC 8291 vector and subscription cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { OUTREACH, EMAIL_CONSENT, planMessage, checkEmail, maskEmail, channelUrl, inQuietHours } from '../src/game/outreach.ts';
import { b64u, encrypt, cleanSubscription, validEndpoint, generateKeys, vapidAuthorization, sendPush } from './growth/webpush.ts';
import { sendMail, ENDPOINT, RETRIES } from './growth/email/zeptomail.ts';
import { confirmMail, awayMail, weekMail } from './growth/email/templates.ts';
import type { TestContext } from 'node:test';
import type { HelloResult, OutreachOperatorResponse, OutreachRunResponse, GrowthMetricsResponse } from '../src/types/growth.ts';
import type { GrowthCollection } from './types.ts';
import type { PlanInput } from '../src/game/outreach.ts';

const HOUR = 3600000, DAY = 86400000;
const TOKEN = 'operator-token-for-outreach-tests-012345';
/** The fixture's clock starts at 100000 ms: 01:01 Lagos time on a Thursday. Noon that day is outside quiet hours. */
const TO_NOON = 11 * HOUR;
const UA = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
const subscription = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: UA });

type Dict = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Who { cookie: string; id: string }
/** Every JSON answer: its status, and what an error or refusal carries. The success shapes are intersected on (src/types/growth.ts). */
interface Plain { status: number; error: string; ok: boolean; code: string; reason: string; removed: boolean; off: boolean }
type Hello = Plain & Extract<HelloResult, { ok: true }>;
/** The answer to asking for e-mail (EmailResult, as the one success shape: a refusal carries `code` alone). */
type Asked = Plain & { email: string; dryRun: boolean; confirmPath: string };
/** What a fake outside request is told, and answers with. */
interface Sent { headers: Record<string, string>; body: unknown }
interface Call { url: string; init: Sent }
interface Reply { status: number; headers?: Record<string, string> }
type Operator = Plain & OutreachOperatorResponse;
/** An e-mail as the provider receives it (server/growth/email/zeptomail.ts), with its Authorization header. */
interface Mail { personalizations: { to: { email: string }[] }[]; from: { email: string; name: string }; subject: string; headers: Record<string, string>; content: { type: string; value: string }[]; auth: string }
/** `.code` / `.reason` of an address check that may be a success (neither) or a refusal. */
const codeOf = (check: ReturnType<typeof checkEmail>): string | undefined => (check.ok ? undefined : check.code);
const reasonOf = (check: ReturnType<typeof checkEmail>): string => (check.ok ? '' : check.reason);
const consentOf = (view: Hello) => must(view.consent, 'consent');
const emailOf = (view: Hello) => must(view.contact.email, 'e-mail contact');
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected a ${what}`); return value; };

/** A server whose outside requests go to `calls` and are answered by `respond(url, init)`. */
async function harness(t: TestContext, { env = {}, respond }: { env?: Record<string, string>; respond?: (url: string, init: Sent, n: number) => Reply | Error } = {}) {
  const calls: Call[] = [];
  const fetchFake = async (url: string, init: RequestInit): Promise<Response> => { calls.push({ url: String(url), init: init as unknown as Sent }); const answer = (respond ?? ((): Reply => ({ status: 202 })))(String(url), init as unknown as Sent, calls.length); if (answer instanceof Error) throw answer; return new Response(null, { status: answer.status, headers: answer.headers ?? {} }); };
  const f = await fixture(t, { moderatorToken: TOKEN, publicOrigin: 'https://play.example', env, fetch: fetchFake });
  const json = async <R>(res: Response) => ({ status: res.status, ...((await res.json()) as Dict) }) as unknown as Plain & R;
  const post = async <R = object>(path: string, body: unknown, who?: Who) => json<R>(await f.request(path, body, who?.cookie));
  const mod = async <R = object>(path: string, body?: unknown) => json<R>(await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const hello = (who: Who) => post<Hello>('/api/growth/hello', { cityId: 'lagos' }, who);
  const player = async (name: string, age: string | null = 'adult') => { const who = await f.device(name); await f.request('/api/life?city=lagos', null, who.cookie); await hello(who); if (age) await post('/api/growth/consent', { cityId: 'lagos', age }, who); return who; };
  const run = () => mod<OutreachRunResponse>('/api/mod/growth/outreach/run', {});
  const stored = () => f.server.store.read((db) => structuredClone<Partial<GrowthCollection>>(db.growth ?? {}));
  const mails = (): Mail[] => calls.filter((call) => call.url === ENDPOINT).map((call) => ({ ...(JSON.parse(String(call.init.body)) as Omit<Mail, 'auth'>), auth: must(call.init.headers.Authorization, 'Authorization') }));
  const linkIn = (mail: Mail, path: string): string => must(new RegExp(`https://play\\.example(${path}\\?t=[A-Za-z0-9_.-]+)`).exec(must(mail.content[0], 'text part').value)?.[1], 'a link');
  const page = async (path: string, method = 'GET') => { const res = await fetch(f.base + path, { method }); return { status: res.status, html: await res.text(), cache: res.headers.get('cache-control') }; };
  return { f, calls, post, mod, hello, player, run, stored, mails, linkIn, page };
}
type Harness = Awaited<ReturnType<typeof harness>>;
const LIVE: Record<string, string> = { ZEPTOMAIL_AUTH: 'Zoho-enczapikey TESTKEY-not-a-real-key', EMAIL_FROM_ADDRESS: 'hello@mail.play.example', EMAIL_FROM_NAME: 'Allworld', EMAIL_CONTACT_LINE: 'Allworld, 1 Example Street, Lagos' };
const optIn = async (h: Harness, who: Who, email = 'ada@example.com') => {
  const asked = await h.post<Asked>('/api/growth/email', { email, consent: true }, who);
  const link = h.linkIn(must(h.mails().at(-1), 'a mail'), '/e/confirm');
  await h.page(link, 'POST');
  return { asked, link };
};

test('web push: the RFC 8291 example encrypts to the RFC’s bytes, and a subscription endpoint must be a browser’s push service', async () => {
  const body = await encrypt('When I grow up, I want to be a watermelon', UA,
    { salt: 'DGv6ra1nlYgDCS1FRnbzlw', publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' });
  assert.equal(b64u.encode(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  // Without the fixed values every message has its own salt and sender key.
  const [one, two] = [await encrypt('x', UA), await encrypt('x', UA)];
  assert.notEqual(b64u.encode(one), b64u.encode(two));
  assert.deepEqual([one.length, one[20], one[16], one[17], one[18], one[19]], [16 + 4 + 1 + 65 + 1 + 1 + 16, 65, 0, 0, 16, 0]);
  await assert.rejects(() => encrypt('x'.repeat(4000), UA), /one record/);
  // VAPID: a three-part ES256 token for the push service's origin, verifiable with the public key.
  const keys = await generateKeys();
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:ops@play.example', 1700000000000);
  const [, jwt = '', k] = must(/^vapid t=([^,]+), k=(.+)$/.exec(header), 'a VAPID header');
  const [head, claims, signature] = jwt.split('.');
  assert.equal(k, keys.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.decode(head))), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.decode(claims))), { aud: 'https://fcm.googleapis.com', exp: 1700000000 + 12 * 3600, sub: 'mailto:ops@play.example' });
  const raw = b64u.decode(keys.publicKey);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u.encode(raw.slice(1, 33)), y: b64u.encode(raw.slice(33)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u.decode(signature), new TextEncoder().encode(`${head}.${claims}`)), true);
  // Only the browsers' own push services: the server never posts to an address a client invents.
  for (const good of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://db5p.notify.windows.com/w/?token=x']) assert.equal(validEndpoint(good), true, good);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd', 7, null]) assert.equal(validEndpoint(bad), false, String(bad));
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'AAAA', auth: UA.auth } }), null);
  assert.deepEqual(cleanSubscription({ ...subscription(), extra: 1 }), { endpoint: subscription().endpoint, ...UA });
});

test('rules: one a day, three a week, never at night, back-off of 1, 3 then 7 days, stop after four, one per period', () => {
  const noon = 61 * DAY + 11 * HOUR; // 12:00 Lagos on day 61
  const plan = (input: Partial<PlanInput>) => planMessage({ now: noon, seen: noon - 30 * HOUR, sends: [], periods: {}, ...input });
  assert.deepEqual(plan({}), { kind: 'away', reason: 'away', period: 61 });
  assert.equal(plan({ seen: noon - 23 * HOUR }).reason, 'nothing_due', 'not before a day away');
  assert.equal(plan({ periods: { away: 61 } }).reason, 'nothing_due', 'one away message per Lagos day');
  assert.equal(plan({ seen: 0 }).reason, 'never_seen');
  for (const hour of [22, 23, 0, 3, 6]) assert.equal(planMessage({ now: 5 * DAY + (hour - 1) * HOUR, seen: 1, sends: [], periods: {} }).reason, 'quiet_hours', `${hour}:00 Lagos`);
  assert.deepEqual([inQuietHours(5 * DAY + 6 * HOUR), inQuietHours(5 * DAY + 20.9 * HOUR)], [false, false], '07:00 and 21:54 are fine');
  assert.equal(plan({ sends: [noon - 2 * HOUR] }).reason, 'day_cap');
  assert.equal(plan({ seen: noon - HOUR * 24 * 9, sends: [noon - 6 * DAY, noon - 4 * DAY, noon - 2 * DAY] }).reason, 'week_cap');
  // Back-off counts messages since the player was last here.
  const gone = noon - 40 * DAY;
  assert.equal(plan({ seen: gone, sends: [noon - 23 * HOUR - DAY] }).kind, 'away', 'one unanswered: a day later');
  assert.equal(plan({ seen: gone, sends: [noon - 10 * DAY, noon - 2 * DAY] }).reason, 'backoff', 'two unanswered: three days');
  assert.equal(plan({ seen: gone, sends: [noon - 10 * DAY, noon - 3 * DAY - HOUR] }).kind, 'away');
  assert.equal(plan({ seen: gone, sends: [noon - 30 * DAY, noon - 20 * DAY, noon - 6 * DAY] }).reason, 'backoff', 'three unanswered: seven days');
  assert.equal(plan({ seen: gone, sends: [noon - 30 * DAY, noon - 20 * DAY, noon - 8 * DAY] }).kind, 'away');
  assert.equal(plan({ seen: gone, sends: [noon - 39 * DAY, noon - 30 * DAY, noon - 20 * DAY, noon - 8 * DAY] }).reason, 'stopped', 'four with no visit: nothing more until they return');
  // The weekly summary: Sunday evening, once a week, only for someone who played that week.
  const sunday = 3 * DAY + 17 * HOUR; // Sunday 4 January 1970, 18:00 Lagos
  assert.deepEqual(planMessage({ now: sunday, seen: sunday - HOUR, sends: [], periods: {}, playedThisWeek: true }), { kind: 'week', reason: 'weekly', period: 0 });
  assert.equal(planMessage({ now: sunday, seen: sunday - HOUR, sends: [], periods: { week: 0 }, playedThisWeek: true }).reason, 'nothing_due');
  assert.equal(planMessage({ now: sunday, seen: sunday - HOUR, sends: [], periods: {}, playedThisWeek: false }).reason, 'nothing_due');
  assert.deepEqual([OUTREACH.perDay, OUTREACH.perWeek, OUTREACH.backoffDays, OUTREACH.maxPerAbsence], [1, 3, [1, 3, 7], 4]);
});

test('address check, masking and the channel link', () => {
  assert.deepEqual(checkEmail('  Ada.Obi+game@Example.COM '), { ok: true, email: 'Ada.Obi+game@example.com' });
  for (const bad of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'a da@example.com', 'ada@exa mple.com', 'ada@example.com\r\nBcc: x@y.z', '<ada@example.com>', 'ada..obi@example.com', `${'a'.repeat(65)}@example.com`, null, 7, {}]) assert.equal(codeOf(checkEmail(bad)), 'invalid_email', String(bad));
  assert.deepEqual([codeOf(checkEmail('ada@gmial.com')), codeOf(checkEmail('ada@mailinator.com'))], ['email_typo', 'email_disposable']);
  assert.match(reasonOf(checkEmail('ada@gmial.com')), /ada@gmail\.com/);
  assert.equal(maskEmail('ada.obi@example.com'), 'a•••@e•••.com');
  assert.deepEqual(['https://whatsapp.com/channel/0029VaAbCdEfGhIjKlMnOp', 'https://www.whatsapp.com/channel/0029VaAbCdEfGhIjKlMnOp', 'http://whatsapp.com/channel/0029VaAbCdEfGhIjKlMnOp', 'https://evil.example/channel/0029VaAbCdEfGhIjKlMnOp', 'javascript:alert(1)', '', undefined].map(channelUrl).map(Boolean), [true, true, false, false, false, false, false]);
  assert.match(EMAIL_CONSENT, /at most one message a day and three a week/);
});

test('e-mail: nothing without the age answer and the consent tick; under-18 is never stored; double opt-in; the address is never shown', async (t) => {
  const h = await harness(t, { env: LIVE });
  const { f, post, hello, player, mails, linkIn, page, stored } = h;
  const ada = await player('Ada', null);
  assert.equal((await post('/api/growth/email', { email: 'ada@example.com', consent: true }, ada)).code, 'age_required');
  await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, ada);
  assert.equal((await post('/api/growth/email', { email: 'ada@example.com' }, ada)).status, 400, 'no tick, no address');
  assert.equal((await post('/api/growth/email', { email: 'ada@example.com', consent: 'yes' }, ada)).status, 400);
  assert.equal((await post('/api/growth/email', { email: 'ada@example.com', consent: true })).status, 401);
  assert.equal((await post('/api/growth/email', { email: 'nope', consent: true }, ada)).code, 'invalid_email');
  const kid = await player('Kid', 'minor');
  assert.equal((await post('/api/growth/email', { email: 'kid@example.com', consent: true }, kid)).code, 'under_18');
  assert.deepEqual([mails().length, Object.keys((await stored()).contacts ?? {}).length], [0, 0], 'nothing was sent or stored so far');

  // Asking stores the address unconfirmed and sends exactly one message: the confirmation.
  const asked = await post<Asked>('/api/growth/email', { email: 'Ada@Example.com', consent: true }, ada);
  assert.deepEqual([asked.ok, asked.code, asked.email, asked.dryRun, asked.confirmPath], [true, 'confirm_sent', 'A•••@e•••.com', false, undefined]);
  assert.equal(mails().length, 1);
  const mail = must(mails()[0], 'mail');
  assert.deepEqual([mail.personalizations, mail.from, mail.subject, mail.auth], [[{ to: [{ email: 'Ada@example.com' }] }], { email: LIVE.EMAIL_FROM_ADDRESS, name: 'Allworld' }, 'Confirm your e-mail for Allworld', LIVE.ZEPTOMAIL_AUTH]);
  assert.deepEqual(mail.content.map((part) => part.type), ['text/plain', 'text/html']);
  assert.match(must(mail.content[0], 'part').value, /If you did not ask for this/);
  assert.match(must(mail.content[0], 'part').value, /1 Example Street/);
  let view = await hello(ada);
  assert.deepEqual([consentOf(view).email, emailOf(view).confirmed, emailOf(view).address], [false, false, 'A•••@e•••.com']);
  assert.equal(JSON.stringify(view).includes('Ada@example.com'), false, 'the full address never returns to a browser');
  // An unconfirmed address is never sent anything else, however long the player is away.
  f.advance(DAY + TO_NOON); assert.equal((await h.run()).jobs, 0);
  assert.equal(mails().length, 1);

  // The link: a GET (a mail scanner) confirms nothing; the button's POST does, once.
  const link = linkIn(mail, '/e/confirm');
  const shown = await page(link);
  assert.ok(shown.status === 200 && /<form method="post"/.test(shown.html) && shown.cache === 'no-store' && !/<script/i.test(shown.html));
  assert.equal(consentOf(await hello(ada)).email, false);
  // (The first character of the signature is changed: the last one carries bits that base64url discards.)
  const dot = link.lastIndexOf('.') + 1, forged = `${link.slice(0, dot)}${link[dot] === 'A' ? 'B' : 'A'}${link.slice(dot + 1)}`;
  assert.equal((await page(forged, 'POST')).status, 400, 'a changed token is refused');
  assert.equal((await page('/e/confirm?t=nope.nope', 'POST')).status, 400);
  assert.equal((await page(link, 'POST')).status, 200);
  view = await hello(ada);
  assert.deepEqual([consentOf(view).email, emailOf(view).confirmed], [true, true]);
  assert.deepEqual(mails().map((item) => item.subject), ['Confirm your e-mail for Allworld', 'You are in, Ada'], 'one welcome');
  await page(link, 'POST');
  assert.equal(mails().length, 2, 'confirming again sends nothing more');
  const welcome = must(mails()[1], 'mail');
  assert.match(must(welcome.headers['List-Unsubscribe'], 'header'), /^<https:\/\/play\.example\/e\/unsub\?t=[A-Za-z0-9_.-]+>$/);
  assert.equal(welcome.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(must(welcome.content[0], 'part').value, /Unsubscribe with one tap: https:\/\/play\.example\/e\/unsub/);
  assert.match(must(welcome.content[1], 'part').value, /Unsubscribe with one tap<\/a>/);

  // Changing the address starts again; three confirmations a day at most; an expired link does nothing.
  const changed = await post('/api/growth/email', { email: 'ada2@example.com', consent: true }, ada);
  assert.equal(changed.ok, true);
  assert.equal(consentOf(await hello(ada)).email, false, 'a new address is unconfirmed');
  assert.equal((await page(link, 'POST')).status, 400, 'the old link no longer confirms anything');
  assert.equal((await post('/api/growth/email', { email: 'ada3@example.com', consent: true }, ada)).ok, true);
  assert.equal((await post('/api/growth/email', { email: 'ada4@example.com', consent: true }, ada)).ok, true);
  assert.equal((await post('/api/growth/email', { email: 'ada5@example.com', consent: true }, ada)).code, 'confirm_limit');
  const late = linkIn(must(mails().at(-1), 'a mail'), '/e/confirm');
  f.advance((OUTREACH.confirmHours + 1) * HOUR);
  assert.equal((await page(late, 'POST')).status, 400, 'a confirmation link expires');
  // Where the address is, and is not.
  const data = await stored();
  assert.deepEqual(Object.keys(must(data.contacts, 'contacts')), [ada.id]);
  const elsewhere = JSON.stringify({ players: data.players, shares: data.shares, metrics: data.metrics, outreach: data.outreach });
  assert.equal(/example\.com/.test(elsewhere), false, 'the address is in the contact record only: not in the profile, the log or the metrics');
  assert.equal(h.f.logs.join('\n').includes('example.com') || h.f.logs.join('\n').includes('TESTKEY'), false);
});

test('e-mail: one-click unsubscribe deletes the address at once, with no login, and removal in the game does the same', async (t) => {
  const h = await harness(t, { env: LIVE });
  const { post, hello, player, mails, page, stored, f } = h;
  const ada = await player('Ada'), bola = await player('Bola');
  await optIn(h, ada); await optIn(h, bola, 'bola@example.com');
  const unsub = must(/<(https:\/\/play\.example)(\/e\/unsub\?t=[^>]+)>/.exec(must(must(mails().find((mail) => mail.subject.startsWith('You are in, Ada')), 'welcome').headers['List-Unsubscribe'], 'header')), 'an unsubscribe link')[2] ?? '';
  const shown = await page(unsub);
  assert.ok(shown.status === 200 && /Unsubscribe<\/button>/.test(shown.html));
  assert.equal(Object.keys(must((await stored()).contacts, 'contacts')).length, 2, 'opening the page removes nothing');
  // What a mail program does (RFC 8058): a POST with a fixed form body, no cookie, no Origin.
  const res = await fetch(f.base + unsub, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(must((await stored()).contacts, 'contacts')), [bola.id]);
  assert.deepEqual([consentOf(await hello(ada)).email, (await hello(ada)).contact.email], [false, null]);
  assert.equal((await page(unsub, 'POST')).status, 200, 'unsubscribing twice is still unsubscribed');
  assert.equal((await page('/e/unsub?t=bad.token', 'POST')).status, 400);
  // One tap in the game.
  assert.equal((await post('/api/growth/email/remove', { cityId: 'lagos' }, bola)).removed, true);
  assert.deepEqual(Object.keys(must((await stored()).contacts, 'contacts')), []);
  const totals = (await h.mod<GrowthMetricsResponse>('/api/mod/growth/metrics')).totals;
  assert.deepEqual([totals['email.unsubscribed'], totals['email.removed'], totals['email.confirmed']], [1, 1, 2]);
});

test('e-mail schedule: exactly once per period, daily and weekly caps, quiet hours, back-off, the kill switch and the global cap', async (t) => {
  const h = await harness(t, { env: { ...LIVE, EMAIL_DAILY_CAP: '2' } });
  const { f, hello, player, mails, run, mod } = h;
  const ada = await player('Ada');
  await optIn(h, ada);
  const digests = () => mails().filter((mail) => mail.subject.startsWith('While you were away'));
  // Not away long enough; then away, but it is night in Lagos.
  f.advance(20 * HOUR); await run();
  assert.equal(digests().length, 0);
  f.advance(5 * HOUR); // 02:01 Lagos the next night
  assert.deepEqual([(await run()).reason, digests().length], ['quiet_hours', 0]);
  f.advance(10 * HOUR); // noon
  assert.equal((await run()).jobs, 1);
  assert.equal(digests().length, 1);
  const mail = must(digests()[0], 'digest');
  assert.ok(must(mail.content[0], 'part').value.includes('Nothing was taken from you') && must(mail.content[0], 'part').value.includes('This week you could:') && mail.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  assert.equal(/miss you|you will lose|last chance|hurry/i.test(must(mail.content[0], 'part').value), false);
  // Run again, and again an hour later: the period is claimed, so nothing more goes out today.
  for (let i = 0; i < 3; i++) { await run(); f.advance(HOUR); }
  assert.equal(digests().length, 1);
  // Day 2: one unanswered message, a day has passed. Days 3 and 4: back-off of three days.
  f.advance(DAY - 3 * HOUR); await run();
  assert.equal(digests().length, 2);
  f.advance(DAY); await run(); f.advance(DAY); await run();
  assert.equal(digests().length, 2, 'two unanswered messages: wait three days');
  f.advance(DAY); await run();
  assert.equal(digests().length, 3);
  // The player comes back: the count of unanswered messages starts again, but three a week still holds.
  await hello(ada);
  f.advance(DAY); assert.equal((await run()).jobs, 0, 'the week’s allowance is used up');
  // The operator's switch stops e-mail; switching it back lets the next due message go.
  f.advance(6 * DAY);
  assert.deepEqual((await mod('/api/mod/growth/outreach/switch', { channel: 'email', off: true })).off, true);
  await run(); assert.equal(digests().length, 3);
  await mod('/api/mod/growth/outreach/switch', { channel: 'email', off: false });
  await run(); assert.equal(digests().length, 4);
  // The global cap: three more confirmed players are due the same day, and the cap of two a day (one already used) stops the rest.
  const others = [];
  for (const name of ['Bola', 'Chidi', 'Dayo']) { const who = await player(name); await optIn(h, who, `${name.toLowerCase()}@example.com`); others.push(who); }
  f.advance(DAY + HOUR); await run();
  const view = await mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.deepEqual([view.email.sentToday, view.email.dailyCap], [2, 2]);
  assert.deepEqual([view.email.configured, view.email.live, view.email.confirmed, view.email.from], [true, true, 4, LIVE.EMAIL_FROM_ADDRESS]);
  assert.ok(view.log.length > 5 && view.log.every((line) => !JSON.stringify(line).includes('@') && !Object.hasOwn(line, 'to')), 'the log carries no address');
  assert.equal(JSON.stringify(view).includes(ada.id), false);
});

test('provider failures: a 4xx is never retried, a 5xx and a timeout are retried a bounded number of times, and a failed digest is not sent again that day', async (t) => {
  const env = (name: string) => LIVE[name] ?? '';
  const attempt = async (responses: (number | Error)[]) => {
    const seen: (object | undefined)[] = [];
    const result = await sendMail({ env, fetch: async (_url: string, init?: object) => { seen.push(init); const next = must(responses[Math.min(seen.length - 1, responses.length - 1)], 'a response'); if (next instanceof Error) throw next; return { status: next, headers: new Map([['retry-after', '0']]) }; } },
      { to: 'ada@example.com', subject: 's', text: 't', html: '<p>t</p>' }, { pause: async () => {} });
    return [result.ok, result.attempts, result.error ?? null];
  };
  assert.deepEqual(await attempt([202]), [true, 1, null]);
  for (const status of [400, 401, 403, 404, 422]) assert.deepEqual(await attempt([status, 202]), [false, 1, `http_${status}`], `${status} is not retried`);
  assert.deepEqual(await attempt([500, 503, 202]), [true, 3, null]);
  assert.deepEqual(await attempt([429, 202]), [true, 2, null]);
  assert.deepEqual(await attempt([500]), [false, RETRIES, 'http_500']);
  assert.deepEqual(await attempt([Object.assign(new Error('x'), { name: 'TimeoutError' })]), [false, RETRIES, 'timeout']);
  assert.deepEqual(await attempt([new Error('socket')]), [false, RETRIES, 'network']);
  // An answer without a numeric status was never a thrown network error: it is neither success nor an HTTP code, and is retried.
  const noStatus = await sendMail({ env, fetch: async () => ({}) }, { to: 'ada@example.com', subject: 's', text: 't', html: '<p>t</p>' }, { pause: async () => {} });
  assert.deepEqual([noStatus.ok, noStatus.status, noStatus.attempts, noStatus.error], [false, undefined, RETRIES, 'http_undefined']);
  assert.deepEqual(await attempt([new Error('socket')]), [false, RETRIES, 'network'], 'a rejected fetch is still a network error');
  assert.deepEqual(await sendMail({ env: () => '', fetch: async () => { throw new Error('must not be called'); } }, { to: 'a@b.cd', subject: 's', text: 't', html: 't' }), { ok: false, status: 0, attempts: 0, error: 'not_configured' });

  // Through the server: the provider refuses the digest. It is logged as failed with the status only, and not tried again that day.
  let fail = false;
  const h = await harness(t, { env: LIVE, respond: () => ({ status: fail ? 401 : 202 }) });
  const ada = await h.player('Ada');
  await optIn(h, ada);
  h.f.advance(DAY + TO_NOON); fail = true;
  const before = h.mails().length;
  await h.run(); await h.run();
  assert.equal(h.mails().length, before + 1, 'one attempt, no retry of a 4xx, no second attempt for the same day');
  const view = await h.mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.deepEqual([must(view.email.lastError).state, must(view.email.lastError).status, must(view.email.lastError).error, view.email.sentToday], ['failed', 401, 'http_401', 0]);
  assert.equal(JSON.stringify(view).includes('TESTKEY'), false, 'the provider key is never shown');
});

test('dry-run: with no provider configured nothing leaves the server; the message is composed and kept as a preview', async (t) => {
  const h = await harness(t, {});
  const { f, post, hello, player, calls, page, mod, run } = h;
  const ada = await player('Ada');
  const asked = await post<Asked>('/api/growth/email', { email: 'ada@example.com', consent: true }, ada);
  assert.deepEqual([asked.ok, asked.code, asked.dryRun], [true, 'dry_run', true]);
  assert.match(asked.confirmPath, /^\/e\/confirm\?t=/);
  assert.equal((await page(asked.confirmPath, 'POST')).status, 200);
  f.advance(DAY + TO_NOON); await run();
  assert.equal(calls.length, 0, 'no outside request at all');
  const mine = (await hello(ada)).contact;
  assert.deepEqual([mine.live.email, must(mine.email).confirmed, must(must(mine.email).preview).kind], [false, true, 'away']);
  assert.match(must(must(mine.email).preview).text, /While you were away/);
  const view = await mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.deepEqual([view.email.configured, view.email.live, view.email.from], [false, false, null]);
  assert.deepEqual(view.log.filter((line) => line.channel === 'email').map((line) => line.state), ['dry-run', 'dry-run', 'dry-run']);
  assert.deepEqual(view.previews.map((preview) => preview.kind), ['away', 'welcome', 'confirm']);
  assert.ok(view.previews.every((preview) => !/[?&]t=[A-Za-z0-9_-]{7,}/.test(preview.text) && !/example\.com/.test(preview.text)), 'a stored preview holds no working link and no address');
  // Half configured is still dry-run: a key without a sender address sends nothing.
  const half = await harness(t, { env: { ZEPTOMAIL_AUTH: must(LIVE.ZEPTOMAIL_AUTH) } });
  const bola = await half.player('Bola');
  assert.equal((await half.post<Asked>('/api/growth/email', { email: 'bola@example.com', consent: true }, bola)).dryRun, true);
  assert.equal(half.calls.length, 0);
});

test('push: adults only and only on request; the same rules and exactly-once; a gone subscription is deleted; 429 pauses; the keys are a 0600 file', async (t) => {
  let answer: Reply = { status: 201 };
  const h = await harness(t, { respond: () => answer });
  const { f, post, hello, player, calls, run, mod, stored } = h;
  const key = await h.f.request('/api/growth/push/key').then((res) => res.json());
  assert.equal(b64u.decode(key.publicKey).length, 65);
  const file = await stat(join(f.dir, 'keys', 'vapid.json'));
  assert.equal(file.mode & 0o777, 0o600, 'the VAPID key file is readable by the server’s user only');
  assert.equal(JSON.stringify((await stored()) ?? {}).includes('privateKey'), false, 'and is not in the data file');
  const ada = await player('Ada', null), kid = await player('Kid', 'minor');
  assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: subscription(), consent: true }, ada)).code, 'age_required');
  await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, ada);
  assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: subscription() }, ada)).status, 400, 'consent is explicit');
  assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: { endpoint: 'https://evil.example/hook', keys: UA }, consent: true }, ada)).status, 400);
  assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: subscription(), consent: true }, kid)).code, 'under_18');
  for (const n of [1, 1, 2, 3, 4]) assert.equal((await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: subscription(n), consent: true }, ada)).ok, true);
  let view = await hello(ada);
  assert.deepEqual([consentOf(view).push, view.contact.push.devices], [true, 3], 'at most three devices; the same one twice is one');
  assert.equal(JSON.stringify(view).includes('fcm.googleapis.com'), false, 'an endpoint is never returned');
  // A day away, at noon: one notification per device, encrypted, with VAPID and sensible headers. Once.
  f.advance(DAY + TO_NOON); await run(); await run();
  assert.equal(calls.length, 3);
  const call = must(calls[0], 'call');
  assert.match(call.url, /^https:\/\/fcm\.googleapis\.com\/fcm\/send\/device-\d$/);
  assert.match(must(call.init.headers.Authorization), /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.deepEqual([call.init.headers['Content-Encoding'], call.init.headers.TTL, call.init.headers.Urgency, call.init.headers.Topic], ['aes128gcm', '43200', 'low', 'away']);
  assert.ok(call.init.body instanceof Uint8Array && call.init.body.length > 100 && !new TextDecoder().decode(call.init.body).includes('While you were away'), 'the body is ciphertext');
  // Next day the push service says two devices are gone and throttles: those are deleted, and push pauses.
  answer = { status: 410 };
  f.advance(DAY); await run();
  assert.deepEqual([(await hello(ada)).contact.push.devices, consentOf(await hello(ada)).push], [0, false], 'all three were gone: the subscriptions are deleted and the switch is off');
  await post('/api/growth/push/subscribe', { cityId: 'lagos', subscription: subscription(9), consent: true }, ada);
  answer = { status: 429, headers: { 'retry-after': '7200' } };
  f.advance(4 * DAY); const sent = calls.length; await run();
  assert.equal(calls.length, sent + 1);
  const ops = await mod<OutreachOperatorResponse>('/api/mod/growth/outreach');
  assert.ok(must(ops.push.pausedUntil) > f.now() && must(ops.push.lastError).status === 429 && ops.push.subscribers === 1);
  answer = { status: 201 }; f.advance(DAY); await run();
  // Switching off in the game deletes the subscription; the kill switch stops sending for everyone.
  assert.equal((await post('/api/growth/push/unsubscribe', { cityId: 'lagos' }, ada)).ok, true);
  assert.deepEqual(Object.keys(must((await stored()).push, 'push subscriptions')), []);
  assert.equal((await mod('/api/mod/growth/outreach/switch', { channel: 'push', off: true })).off, true);
  assert.equal((await mod('/api/mod/growth/outreach/switch', { channel: 'sms', off: true })).status, 400);
  // sendPush itself: the outcomes a caller acts on.
  const keys = await generateKeys(), sub = must(cleanSubscription(subscription()), 'a subscription');
  const outcome = async (status: number | Error, headers: Record<string, string> = {}) => sendPush({ now: () => 1700000000000, fetch: async () => { if (status instanceof Error) throw status; return { status, headers: new Map(Object.entries(headers)) }; } }, sub, { title: 't' }, { keys, subject: 'mailto:a@b.cd' });
  assert.deepEqual([await outcome(201), await outcome(404), await outcome(410), await outcome(429, { 'retry-after': '30' }), await outcome(400), await outcome(503), (await outcome(new Error('down'))).retry],
    [{ ok: true }, { ok: false, gone: true, status: 404 }, { ok: false, gone: true, status: 410 }, { ok: false, status: 429, retryAfter: 30 }, { ok: false, status: 400 }, { ok: false, retry: true, status: 503 }, true]);
});

test('sendPush: an answer without a numeric status fails as it did, without being a retryable network error', async () => {
  const keys = await generateKeys(), sub = must(cleanSubscription(subscription()), 'a subscription');
  const send = (answer: unknown) => sendPush({ now: () => 1700000000000, fetch: async () => answer }, sub, { title: 't' }, { keys, subject: 'mailto:a@b.cd' });
  assert.deepEqual(await send({}), { ok: false, status: undefined });
  assert.deepEqual(await send({ status: 'nope' }), { ok: false, status: undefined });
  assert.equal((await send(null)).retry, true, 'a null answer is still a network failure');
});

test('templates: plain text and HTML say the same, everything is escaped, and the WhatsApp Channel link is shown only when it is one', async (t) => {
  const digest = { subject: 'Your week in Lagos, <Ada>', greeting: 'Here is what is waiting in Lagos.', lines: ['Bola knocked <b>', 'Rent is due'], tasks: [{ text: 'Eat ten meals (4/10)' }] };
  for (const mail of [awayMail({ digest, playUrl: 'https://play.example/', unsubscribeUrl: 'https://play.example/e/unsub?t=x', contact: 'Allworld, Lagos' }), weekMail({ digest, playUrl: 'https://play.example/', unsubscribeUrl: 'https://play.example/e/unsub?t=x', contact: '' })]) {
    assert.ok(!/<b>|<Ada>/.test(mail.html) && mail.html.includes('Bola knocked &lt;b&gt;') && mail.text.includes('- Bola knocked <b>') && mail.text.includes('Unsubscribe with one tap: https://play.example/e/unsub?t=x') && mail.html.includes('href="https://play.example/e/unsub?t=x"'));
    assert.ok(mail.text.includes('- Eat ten meals (4/10)') && mail.html.includes('Eat ten meals (4/10)'));
  }
  assert.equal(/unsubscribe/i.test(confirmMail({ name: 'Ada', confirmUrl: 'https://play.example/e/confirm?t=x', hours: 48, contact: '' }).text), false, 'the confirmation is not a subscription yet');
  const withChannel = await harness(t, { env: { WHATSAPP_CHANNEL_URL: 'https://whatsapp.com/channel/0029VaAbCdEfGhIjKlMnOp' } });
  assert.equal((await withChannel.hello(await withChannel.player('Ada'))).channel, 'https://whatsapp.com/channel/0029VaAbCdEfGhIjKlMnOp');
  const bad = await harness(t, { env: { WHATSAPP_CHANNEL_URL: 'javascript:alert(1)' } });
  assert.equal((await bad.hello(await bad.player('Ada'))).channel, '');
  assert.equal((await bad.mod<OutreachOperatorResponse>('/api/mod/growth/outreach')).whatsapp.channel, null);
});
