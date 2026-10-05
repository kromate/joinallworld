// OWNER: civic — tests for server/routes/civic.ts against a real server with a fake clock.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.ts.
// The pure rules are covered in server/civic/logic.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { VENUES } from '../src/game/cities/lagos/venues.ts';

import { isOpen, minutesUntilOpen } from '../src/game/clock.ts';
import { spotsOf } from '../src/game/api.ts';
import type { LifeState } from '../src/types/index.ts';
import type { AdsResponse, GovResponse, HuntResponse, NeighboursResponse, PrefsResponse, PulseResponse, RadioEntry, RadioResponse, RichListResponse } from '../src/types/civic.ts';
import type { ApiEnvelope } from '../src/types/protocol.ts';
import type { Database } from './types.ts';

const DAY = 86400000;
const START = 100000; // the fixture's clock starts on a Thursday, 01:01 Nigerian time
const MONDAY = 4 * DAY - 3600000; // the following Monday, 00:00 Nigerian time
const HOUR = 3600000;

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Frame = Record<string, unknown>;
interface Device { cookie: string; id: string }
/** What every JSON answer may carry; an error answer has `error`, a refusal `ok: false` + `code` + `reason`. */
interface Plain { status: number; error?: string; ok?: boolean; code?: string; reason?: string; duplicate?: boolean }
/**
 * An answer to a civic write: the fields of RunResponse, VoteResponse, RentAdResponse, ShoutoutResponse and PrefsResponse
 * together, typed as the documented bodies (src/types/civic.ts). An error answer carries none of them, and then a test
 * that reads one fails on the missing value.
 */
interface Written extends Plain { state: LifeState; gov: GovResponse; ads: AdsResponse; radio: RadioResponse; entry: RadioEntry; prefs: PrefsResponse['prefs'] }
/** An answer to a read: `T` names the documented body (src/types/civic.ts); an error answer carries `error` instead. */
type Read<T> = Plain & T & ApiEnvelope
const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null;
const isLifeState = (value: unknown): value is LifeState => isRecord(value) && typeof value.cash === 'number' && isRecord(value.onboarding);
const isDatabase = (value: unknown): value is Database => isRecord(value) && isRecord(value.sessions);
/** The value, or an error naming what was missing (a test that finds nothing fails at once, as a property read on null did). */
/** `.code` / `.reason` of a result that may be a success (no code) or a refusal. */
const codeOf = (result: object | null | undefined): unknown => (result && 'code' in result ? result.code : undefined);
const reasonOf = (result: { reason?: string }): string => result.reason ?? '';
/** The hunt of a life that has one (a life settled to a Lagos day has). */
const huntOf = (state: LifeState) => must(state.civic.hunt, 'hunt');
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected a ${what}`);
  return value;
}

async function harness(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  const get = async <T extends object = object>(path: string, device?: Device): Promise<Read<T>> => {
    const res = await f.request(path, null, device?.cookie);
    const body: unknown = await res.json();
    return { ...(isRecord(body) ? body : {}), status: res.status } as Read<T>; // `T` names the shape the route documents
  };
  // Like the browser, every paid civic request carries a fresh request id unless the test names one.
  const RECEIPTED = ['/api/civic/gov/run', '/api/civic/ads/rent', '/api/civic/radio/shoutout'];
  const post = async (path: string, body: Frame, device?: Device): Promise<Written> => {
    const sent = RECEIPTED.includes(path) && device && body.requestId === undefined ? { ...body, requestId: f.id() } : body;
    const res = await f.request(path, sent, device?.cookie);
    const answer: unknown = await res.json();
    return { ...(isRecord(answer) ? answer : {}), status: res.status } as Written; // see Written
  };
  const life = async (device: Device): Promise<LifeState> => {
    const body = await get<{ state: LifeState }>('/api/life?city=lagos', device);
    return must(isLifeState(body.state) ? body.state : null, 'life state');
  };
  let clock = START;
  const goTo = (at: number) => { f.advance(at - clock); clock = at; };
  const wait = (ms: number) => goTo(clock + ms);
  const database = async (): Promise<Database> => {
    const stored: unknown = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
    if (!isDatabase(stored)) throw new Error('not a data file');
    return stored;
  };
  return { f, get, post, life, goTo, wait, database, now: () => clock };
}

test('civic routes: registered under /api/civic, guarded by the host, and strict about input', async t => {
  const { f, get, post } = await harness(t);
  const ada = await f.device('Ada');
  assert.equal((await get('/api/civic/anything', ada)).status, 404);
  assert.equal((await get('/api/civic/governor', ada)).status, 404);
  assert.equal((await get('/api/life?city=lagos', ada)).status, 200);
  for (const path of ['/api/civic/pulse', '/api/civic/gov', '/api/civic/ads', '/api/civic/hunt', '/api/civic/richlist', '/api/civic/neighbours', '/api/civic/radio']) {
    assert.deepEqual(await get(`${path}?city=atlantis`, ada), { status: 400, error: 'invalid_city' }, path);
    assert.equal((await get(path, ada)).status, 400, path);
    assert.equal((await fetch(`${f.base}${path}?city=lagos`, { headers: { Origin: 'https://evil.example', Cookie: ada.cookie } })).status, 403, path);
  }
  assert.equal((await get<RadioResponse>('/api/civic/radio?city=lagos&venue=../x', ada)).error, 'invalid_venue');
  // Signed out: public reads work, anything personal or paid needs the device session.
  for (const path of ['/api/civic/pulse', '/api/civic/gov', '/api/civic/ads', '/api/civic/hunt', '/api/civic/richlist']) assert.equal((await get(`${path}?city=lagos`)).status, 200, path);
  assert.equal((await get<NeighboursResponse>('/api/civic/neighbours?city=lagos')).error, 'device_session_required');
  for (const [path, body] of [['/api/civic/gov/run', { cityId: 'lagos', slogan: 'Hello Lagos' }], ['/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }], ['/api/civic/gov/announce', { cityId: 'lagos', text: 'Hello' }],
    ['/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: 'sea-5-5', text: 'Hi', colour: 'green', icon: 'star' }], ['/api/civic/ads/remove', { cityId: 'lagos', kind: 'sea', slot: 'sea-5-5' }],
    ['/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Water', artist: 'Tyla' }], ['/api/civic/prefs', { richList: false }]] satisfies [string, Frame][]) {
    assert.deepEqual(await post(path, body), { status: 401, error: 'device_session_required' }, path);
    if (path !== '/api/civic/prefs') assert.equal((await post(path, { ...body, cityId: 'atlantis' }, ada)).error, 'invalid_city', path);
  }
  assert.equal((await post('/api/civic/prefs', { richList: 'no' }, ada)).error, 'invalid_prefs');
  assert.equal((await post('/api/civic/ads/remove', { cityId: 'lagos', kind: 'image', slot: 'x' }, ada)).error, 'invalid_slot');
  // The paid civic actions exist as real action types but only complete through these routes.
  for (const type of ['civic.run', 'civic.vote', 'civic.rent-ad', 'civic.shoutout'] as const) {
    // `internal` is not an ActionRequest field: it is sent anyway, to show that a client cannot set it.
    const smuggled = { type, internal: true, payload: { kind: 'sea', slot: 'sea-5-5', grant: 'civic.server-grant', internal: true } };
    const bare = await f.action(ada.cookie, smuggled);
    assert.equal(bare.ok, false); assert.equal(bare.code, 'server_only', type); assert.equal(bare.state.cash, 5000);
  }
  assert.equal((await f.action(ada.cookie, { type: 'civic.refresh' })).code, 'refreshed');
  assert.deepEqual((await get<AdsResponse>('/api/civic/ads?city=lagos')).sea.plots, []);
  const empty = await get<GovResponse>('/api/civic/gov?city=lagos');
  assert.equal(empty.governor, null); assert.equal(empty.you, null); assert.deepEqual(empty.election.candidates, []); assert.equal(empty.serverTime, START);
});

test('governor: a full weekly election with stated eligibility, one vote each, live tally, tie-break and announcements', async t => {
  const { f, get, post, life, goTo, wait, database } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), chidi = await f.device('Chidi');
  for (const device of [ada, bola, chidi]) await life(device);

  // Thursday of week 0: polls are open but nobody stood, so there is nobody to vote for and nominations are shut.
  let gov = await get<GovResponse>('/api/civic/gov?city=lagos', ada);
  assert.equal(gov.phase, 'voting'); assert.equal(gov.you?.run.ok, false); assert.equal(codeOf(gov.you?.run), 'nominations_closed');
  assert.equal(gov.you?.vote.ok, false); assert.match(gov.you?.vote.ok === false ? gov.you.vote.reason : '', /Nobody is on the ballot/);
  assert.deepEqual((gov.you?.run.checks ?? []).map((item) => [item.id, item.met]), [['days', false], ['fee', true], ['work', false]], 'eligibility is stated up front');
  assert.equal(gov.rules.filingFee, 2000); assert.equal(gov.rules.pollingVenue, 'polling-unit', 'the merged city has a Polling Unit, so votes are cast there');
  const tooEarly = await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Light for all' }, ada);
  assert.equal(tooEarly.ok, false); assert.equal(tooEarly.code, 'nominations_closed'); assert.match(reasonOf(tooEarly), /Monday/); assert.equal(tooEarly.state.cash, 5000);
  // Ada and Bola are paid for work on two different Lagos days (Thursday and Friday); Chidi never works.
  const workShift = async (device: Device) => {
    await f.action(device.cookie, { type: 'apply-job', payload: { id: 'community-helper' } });
    await f.action(device.cookie, { type: 'spot', payload: { id: 'work' } });
    const started = await f.action(device.cookie, { type: 'activity', payload: { id: 'helper-shift' } });
    assert.equal(started.ok, true, started.reason);
    wait(21000);
    return life(device);
  };
  for (const device of [ada, bola]) assert.equal((await workShift(device)).civic.work.days, 1);
  goTo(START + DAY);
  for (const device of [ada, bola]) assert.deepEqual([(await workShift(device)).civic.work.days, (await life(device)).cash], [2, 5600]);

  // Monday: nominations.
  goTo(MONDAY + 60000);
  const dayo = await f.device('Dayo');
  gov = await get<GovResponse>('/api/civic/gov?city=lagos', ada);
  assert.equal(gov.phase, 'nominations'); assert.equal(gov.phaseEndsAt, MONDAY + 3 * DAY); assert.equal(gov.you?.run.ok, true); assert.equal(gov.you?.days, 4);
  for (const [slogan, code] of [['', 'text_too_short'], ['ab', 'text_too_short'], ['x'.repeat(61), 'text_too_long'], ['vote at www.ada.ng', 'links_not_allowed'], [undefined, 'text_required'], [{ a: 1 }, 'text_required']] satisfies [unknown, string][]) {
    const refused = await post('/api/civic/gov/run', { cityId: 'lagos', slogan }, ada);
    assert.equal(refused.ok, false); assert.equal(refused.code, code, String(slogan)); assert.ok(refused.reason); assert.equal(refused.state.cash, 5600);
  }
  const newcomer = await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'New broom' }, dayo);
  assert.equal(newcomer.code, 'too_new'); assert.match(reasonOf(newcomer), /at least 2 days/); assert.equal(newcomer.state.cash, 5000);
  const declared = await post('/api/civic/gov/run', { cityId: 'lagos', slogan: '  Light <b>for</b> all  ' }, ada);
  assert.equal(declared.ok, true); assert.equal(declared.code, 'declared'); assert.equal(declared.state.cash, 3600);
  assert.deepEqual(declared.state.ledger.at(-1), { at: MONDAY + 60000, amount: -2000, reason: 'Governorship filing fee', balance: 3600 });
  assert.deepEqual(declared.gov.election.candidates, [{ id: ada.id, name: 'Ada', slogan: 'Light <b>for</b> all', votes: 0, you: true }]);
  const twice = await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Light for all' }, ada);
  assert.equal(twice.code, 'already_candidate'); assert.equal(twice.state.cash, 3600, 'a repeat is never charged again');
  wait(1000);
  assert.equal((await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Roads first' }, bola)).ok, true);
  const idle = await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Never worked a day' }, chidi);
  assert.equal(idle.code, 'work_days'); assert.match(reasonOf(idle), /paid for work on at least 2 different days/); assert.equal(idle.state.cash, 5000, 'age alone does not qualify, and nothing is charged');
  const notYet = await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, chidi);
  assert.equal(notYet.code, 'polls_closed'); assert.match(reasonOf(notYet), /Thursday to Saturday/);

  // Thursday: voting. One vote per player, enforced on the server, cast in person at the Polling Unit (open 8AM–6PM).
  goTo(MONDAY + 3 * DAY + 60000);
  const eve = await f.device('Eve');
  const closed = await f.action(ada.cookie, { type: 'travel', payload: { id: 'polling-unit', mode: 'trek' } });
  assert.equal(closed.code, 'closed'); assert.match(reasonOf(closed), /opens 8AM/);
  const fromAfar = await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: bola.id }, ada);
  assert.equal(fromAfar.code, 'wrong_place'); assert.match(reasonOf(fromAfar), /Travel to Polling Unit/); assert.equal(fromAfar.gov.election.yourVote, null);
  goTo(MONDAY + 3 * DAY + 9 * HOUR);
  for (const device of [ada, bola]) assert.equal((await f.action(device.cookie, { type: 'travel', payload: { id: 'polling-unit', mode: 'trek' } })).ok, true);
  assert.equal((await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: bola.id }, ada)).code, 'wrong_place', 'still on the road');
  wait(20000);
  assert.equal((await get<GovResponse>('/api/civic/gov?city=lagos', ada)).you?.vote.ok, true);
  assert.equal((await post('/api/civic/gov/run', { cityId: 'lagos', slogan: 'Late entry' }, chidi)).code, 'nominations_closed');
  assert.equal((await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, eve)).code, 'too_new');
  for (const candidate of [chidi.id, 'nobody', '__proto__', 5, null, undefined]) assert.equal((await post('/api/civic/gov/vote', { cityId: 'lagos', candidate }, chidi)).code, 'unknown_candidate', String(candidate));
  const voted = await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: bola.id }, ada);
  assert.equal(voted.ok, true); assert.equal(voted.gov.election.yourVote, bola.id); assert.equal(codeOf(voted.gov.you?.vote), 'already_voted');
  assert.equal(voted.state.cash, 3600, 'voting is free');
  assert.equal((await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, bola)).ok, true);
  const [again, parallel] = await Promise.all([post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, ada), post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, ada)]);
  assert.equal(again.code, 'already_voted'); assert.equal(parallel.code, 'already_voted');
  gov = await get<GovResponse>('/api/civic/gov?city=lagos');
  assert.deepEqual(gov.election.candidates.map((item) => [item.name, item.votes]), [['Ada', 1], ['Bola', 1]], 'live tally; a tie lists the earlier declaration first');
  assert.equal(gov.election.totalVotes, 2); assert.equal(gov.governor, null); assert.equal(gov.election.yourVote, null, 'a signed-out reader sees no ballot of their own');
  assert.equal((await post('/api/civic/gov/announce', { cityId: 'lagos', text: 'I am in charge' }, ada)).code, 'not_governor');

  // Sunday: polls closed, the tie goes to the earlier declaration.
  goTo(MONDAY + 6 * DAY + 60000);
  gov = await get<GovResponse>('/api/civic/gov?city=lagos', bola);
  assert.equal(gov.phase, 'results'); assert.equal(gov.governor?.id, ada.id); assert.equal(gov.governor?.name, 'Ada'); assert.equal(gov.governor?.termEndsAt, MONDAY + 13 * DAY);
  assert.equal(gov.lastResult?.winner?.votes, 1); assert.equal(gov.you?.isGovernor, false); assert.equal(codeOf(gov.you?.announce), 'not_governor');
  assert.equal((await post('/api/civic/gov/vote', { cityId: 'lagos', candidate: ada.id }, chidi)).code, 'polls_closed');
  assert.equal((await post('/api/civic/gov/announce', { cityId: 'lagos', text: 'Coup!' }, bola)).code, 'not_governor');
  for (const [text, code] of [['', 'text_too_short'], ['x'.repeat(141), 'text_too_long'], ['see http://x.example', 'links_not_allowed']]) assert.equal((await post('/api/civic/gov/announce', { cityId: 'lagos', text }, ada)).code, code);
  const posted = await post('/api/civic/gov/announce', { cityId: 'lagos', text: ' Sanitation\u0007 day is <i>Saturday</i> ' }, ada);
  assert.equal(posted.ok, true); assert.equal(posted.gov.announcements[0]?.text, 'Sanitation day is <i>Saturday</i>'); assert.deepEqual(posted.gov.announcements[0]?.by, { id: ada.id, name: 'Ada' });
  const cooling = await post('/api/civic/gov/announce', { cityId: 'lagos', text: 'One more thing' }, ada);
  assert.equal(cooling.code, 'announcement_cooldown'); assert.match(reasonOf(cooling), /more minutes/);
  const pulse = await get<PulseResponse>('/api/civic/pulse?city=lagos', chidi);
  assert.equal(pulse.gov.governor?.id, ada.id); assert.equal(pulse.notices[0]?.kind, 'announcement'); assert.equal(pulse.notices[0]?.text, 'Sanitation day is <i>Saturday</i>');
  assert.ok(pulse.notices.some((item) => item.kind === 'result' && item.title === 'Ada is the new Governor of Lagos'));

  // Still Governor through Saturday; out of office when the next election closes without a winner.
  goTo(MONDAY + 12 * DAY);
  assert.equal((await get<GovResponse>('/api/civic/gov?city=lagos')).governor?.id, ada.id);
  goTo(MONDAY + 13 * DAY + 1000);
  gov = await get<GovResponse>('/api/civic/gov?city=lagos', ada);
  assert.equal(gov.governor, null); assert.equal(gov.lastResult?.winner, null); assert.equal(codeOf(gov.you?.announce), 'not_governor');
  assert.equal((await get<GovResponse>('/api/civic/gov?city=ibadan')).election.candidates.length, 0, 'each city has its own election');

  const db = await database();
  const lagos = must(must(db.civic).cities.lagos);
  assert.deepEqual(Object.keys(lagos.gov.elections), ['1']);
  assert.deepEqual(lagos.gov.elections[1]?.votes, { [ada.id]: bola.id, [bola.id]: ada.id });
  for (const device of [ada, bola, chidi, dayo, eve]) assert.ok(!JSON.stringify(db.civic).includes(device.cookie.slice(4)), 'the civic collection never holds a session secret');
});

test('billboards and sea plots: rented with in-game naira, text + colour + icon only, listed in one response, expiring', async t => {
  const { f, get, post, wait } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const creative = { text: 'Mama Put <3', colour: 'gold', icon: 'food' };
  const open = await get<AdsResponse>('/api/civic/ads?city=lagos');
  assert.equal(open.billboards.slots.length, 12); assert.ok(open.billboards.slots.every((slot) => slot.ad === null)); assert.deepEqual(open.sea.plots, []);
  assert.equal(open.sea.price, 100); assert.equal(open.sea.days, 30); assert.equal(open.palette.colours.length, 8); assert.equal(open.palette.icons.length, 16);
  for (const [change, code] of [[{ slot: 'bb-99' }, 'invalid_slot'], [{ kind: 'image' }, 'invalid_slot'], [{ text: 'x' }, 'text_too_short'], [{ text: 'x'.repeat(41) }, 'text_too_long'], [{ text: 'call shop.com' }, 'links_not_allowed'],
    [{ colour: 'url(x)' }, 'invalid_colour'], [{ icon: 'https://x/y.png' }, 'invalid_icon'], [{ image: 'data:image/png;base64,AAAA', text: undefined }, 'text_required']] satisfies [Frame, string][]) {
    const refused = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-08', ...creative, ...change }, ada);
    assert.equal(refused.ok, false); assert.equal(refused.code, code, JSON.stringify(change)); assert.ok(refused.reason); assert.equal(refused.state.cash, 5000);
  }
  const rented = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-08', ...creative, link: 'https://evil.example', image: 'x' }, ada);
  assert.equal(rented.ok, true); assert.equal(rented.state.cash, 3500); assert.equal(rented.state.ledger.at(-1)?.reason, 'Billboard · Marina · 7 days');
  const board = rented.ads.billboards.slots.find((slot) => slot.slot === 'bb-08');
  assert.deepEqual(board, { slot: 'bb-08', near: 'park', road: 'Marina', price: 1500, ad: { text: 'Mama Put <3', colour: 'gold', icon: 'food', by: { id: ada.id, name: 'Ada' }, at: 100000, expiresAt: 100000 + 7 * DAY, mine: true, price: 1500 } });
  assert.deepEqual(Object.keys(board.ad).sort(), ['at', 'by', 'colour', 'expiresAt', 'icon', 'mine', 'price', 'text'], 'no link or image field exists');
  assert.equal((await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-08', ...creative }, ada)).code, 'already_yours');
  const taken = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-08', ...creative }, bola);
  assert.equal(taken.code, 'slot_taken'); assert.match(reasonOf(taken), /rented by Ada/); assert.equal(taken.state.cash, 5000);
  assert.equal((await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-09', ...creative }, ada)).state.cash, 2000);
  const capped = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-10', ...creative }, ada);
  assert.equal(capped.code, 'ad_limit'); assert.equal(capped.state.cash, 2000);
  // Sea plots: ₦100 a plot for 30 days, dearer on the shore rows.
  const plot = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: 'sea-5-3', text: 'Ada Fabrics', colour: 'blue', icon: 'shop' }, ada);
  assert.equal(plot.state.cash, 1900); assert.equal(plot.ads.sea.plots[0]?.expiresAt, 100000 + 30 * DAY); assert.equal(plot.ads.sea.plots[0]?.row, 5); assert.equal(plot.ads.sea.plots[0]?.col, 3);
  assert.equal((await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: 'sea-0-0', text: 'Shore', colour: 'teal', icon: 'palm' }, ada)).state.cash, 1650);
  const broke = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-01', ...creative }, bola);
  assert.equal(broke.ok, true);
  await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-02', ...creative }, bola);
  for (let col = 0; col < 8; col++) await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: `sea-1-${col}`, text: 'Bola', colour: 'red', icon: 'fire' }, bola);
  const empty = await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'sea', slot: 'sea-9-9', text: 'Bola', colour: 'red', icon: 'fire' }, bola);
  assert.equal(empty.code, 'insufficient_funds'); assert.match(reasonOf(empty), /costs ₦100 for 30 days; you have ₦0/); assert.equal(empty.state.cash, 0);
  // The public listing is one request and carries no secret.
  const listing = await get<AdsResponse>('/api/civic/ads?city=lagos');
  assert.equal(listing.sea.plots.length, 10); assert.ok(listing.sea.plots.every((item) => item.mine === false));
  assert.ok(!JSON.stringify(listing).includes(ada.cookie.slice(4)));
  assert.deepEqual((await get<AdsResponse>('/api/civic/ads?city=ibadan')).sea.plots, [], 'ads belong to one city');
  // Taking down: only your own, no refund.
  assert.equal((await post('/api/civic/ads/remove', { cityId: 'lagos', kind: 'billboard', slot: 'bb-08' }, bola)).code, 'not_yours');
  assert.equal((await post('/api/civic/ads/remove', { cityId: 'lagos', kind: 'billboard', slot: 'bb-12' }, bola)).code, 'no_ad');
  const removed = await post('/api/civic/ads/remove', { cityId: 'lagos', kind: 'billboard', slot: 'bb-09' }, ada);
  assert.equal(removed.ok, true); assert.equal(removed.ads.billboards.slots.find((slot) => slot.slot === 'bb-09')?.ad, null);
  // Expiry on server time.
  wait(7 * DAY);
  let later = await get<AdsResponse>('/api/civic/ads?city=lagos', ada);
  assert.ok(later.billboards.slots.every((slot) => slot.ad === null), 'billboards expire after 7 days'); assert.equal(later.sea.plots.length, 10);
  wait(23 * DAY);
  later = await get<AdsResponse>('/api/civic/ads?city=lagos', ada);
  assert.deepEqual(later.sea.plots, [], 'sea plots expire after 30 days');
});

test('daily gem hunt: found through play, real city counter, prize paid through the ledger exactly once a day', async t => {
  const { f, get, post, life, wait, now } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  let hunt = await get<HuntResponse>('/api/civic/hunt?city=lagos');
  assert.deepEqual([hunt.found, hunt.today, hunt.prize, hunt.gemsPerDay, hunt.you], [0, 0, 3000, 3, null]);
  const early = await f.action(ada.cookie, { type: 'civic.hunt-claim' });
  assert.equal(early.ok, false); assert.equal(early.code, 'gems_missing'); assert.match(reasonOf(early), /Find all 3 gems first/); assert.equal(early.state.cash, 5000);
  wait(1000);
  let state = await life(ada);
  assert.equal(huntOf(state).gems.length, 3);
  // Opening hours and 4–18 second trips: take gems whose venue is open first, wait for the rest to open.
  const day = huntOf(state).day;
  for (let round = 0; round < 3; round++) {
    state = await life(ada);
    const left = huntOf(state).gems.filter((item) => !item.found);
    if (!left.length) break;
    const clock = now();
    let gem = left.find((item) => isOpen(must(VENUES[item.venue], 'registered venue').hours, clock));
    if (!gem) {
      gem = left.reduce((best, item) => (minutesUntilOpen(must(VENUES[item.venue], 'registered venue').hours, clock) < minutesUntilOpen(must(VENUES[best.venue], 'registered venue').hours, clock) ? item : best));
      assert.equal((await f.action(ada.cookie, { type: 'travel', payload: { id: gem.venue, mode: 'trek' } })).code, 'closed');
      wait(minutesUntilOpen(must(VENUES[gem.venue], 'registered venue').hours, clock) * 60000);
    }
    const index = huntOf(state).gems.findIndex((item) => item.venue === gem.venue && item.spot === gem.spot && item.kind === gem.kind);
    if (state.location !== gem.venue) {
      assert.equal((await f.action(ada.cookie, { type: 'travel', payload: { id: gem.venue, mode: 'trek' } })).ok, true);
      assert.equal((await f.action(ada.cookie, { type: 'civic.hunt-search' })).code, 'travelling');
      wait(20000);
      state = await life(ada);
      assert.equal(state.location, gem.venue);
      if (huntOf(state).gems[index]?.found) continue;
    }
    if (gem.kind === 'activity') {
      const stuck = await f.action(ada.cookie, { type: 'civic.hunt-search' });
      assert.equal(stuck.code, 'activity_needed'); assert.match(reasonOf(stuck), /Finish any activity/);
      // Every venue has regulars to greet: a free activity that shakes the gem loose.
      const hello = must(spotsOf(gem.venue, 'lagos').find((spot) => spot.id === 'people')?.activities.find((def) => def.id.endsWith('-hello')), 'greeting activity');
      await f.action(ada.cookie, { type: 'spot', payload: { id: 'people' } });
      assert.equal((await f.action(ada.cookie, { type: 'activity', payload: { id: hello.id } })).ok, true);
      wait(12000);
    } else {
      if (gem.spot && state.spot !== gem.spot) await f.action(ada.cookie, { type: 'spot', payload: { id: gem.spot } });
      const search = await f.action(ada.cookie, { type: 'civic.hunt-search' });
      assert.equal(search.ok, true, JSON.stringify(search.reason)); assert.equal(search.code, 'found');
    }
    state = await life(ada);
    assert.equal(huntOf(state).gems[index]?.found, true, JSON.stringify(gem));
    assert.equal(huntOf(state).day, day, 'all three were reachable within one day');
  }
  const done = await f.action(ada.cookie, { type: 'civic.hunt-search' });
  assert.equal(done.code, 'hunt_complete'); assert.match(reasonOf(done), /Claim your ₦3,000 prize/);
  assert.equal((await get<HuntResponse>('/api/civic/hunt?city=lagos')).found, 0, 'finds reach the city counter at the player’s next check-in');
  assert.equal((await get<PulseResponse>('/api/civic/pulse?city=lagos', ada)).hunt.found, 3);
  hunt = await get<HuntResponse>('/api/civic/hunt?city=lagos', ada);
  assert.deepEqual(hunt.you, { found: 3, total: 3, claimed: false, canClaim: true }); assert.equal(hunt.found, 3); assert.equal(hunt.today, 3);
  const before = (await life(ada)).cash;
  const [first, second] = await Promise.all([f.action(ada.cookie, { type: 'civic.hunt-claim' }), f.action(ada.cookie, { type: 'civic.hunt-claim' })]);
  assert.deepEqual([first.code, second.code].sort(), ['already_claimed', 'claimed'], 'two simultaneous claims pay once');
  const paid = await life(ada);
  assert.equal(paid.cash, before + 3000); assert.equal(paid.ledger.filter((entry) => entry.reason === 'Daily gem hunt prize').length, 1);
  assert.equal((await f.action(ada.cookie, { type: 'civic.hunt-claim' })).code, 'already_claimed');
  await get<PulseResponse>('/api/civic/pulse?city=lagos', ada);
  // The counter is the server's own count: Bola sees Ada's three, and Bola's hunt is separate.
  const other = await get<PulseResponse>('/api/civic/pulse?city=lagos', bola);
  assert.equal(other.hunt.found, 3); assert.equal(other.hunt.claims, 1); assert.equal(other.checkedIn, true);
  assert.equal((await f.action(bola.cookie, { type: 'civic.hunt-claim' })).code, 'gems_missing');
  assert.equal((await get<HuntResponse>('/api/civic/hunt?city=ibadan')).found, 0);
  // Next Lagos day: a fresh set, yesterday's prize cannot be claimed again.
  wait(DAY);
  const tomorrow = await f.action(ada.cookie, { type: 'civic.hunt-claim' });
  assert.equal(huntOf(tomorrow.state).claimed, tomorrow.ok); assert.equal(tomorrow.state.cash, before + 3000 + (tomorrow.ok ? 3000 : 0));
  assert.equal((await get<PulseResponse>('/api/civic/pulse?city=lagos', ada)).hunt.claims, tomorrow.ok ? 2 : 1);
});

test('club radio: bought in a club with in-game naira, queued on server time, retried safely, capped per day', async t => {
  const { f, get, post, wait } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  const outside = await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Water', artist: 'Tyla' }, ada);
  assert.equal(outside.ok, false); assert.equal(outside.code, 'not_in_club'); assert.equal(outside.state.cash, 5000);
  assert.equal((await get<RadioResponse>('/api/civic/radio?city=lagos&venue=park')).club, false);
  for (const device of [ada, bola]) await f.action(device.cookie, { type: 'travel', payload: { id: 'library', mode: 'trek' } });
  assert.equal((await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Water', artist: 'Tyla' }, ada)).code, 'not_in_club', 'still on the road');
  wait(20000); // a trek takes up to 18 seconds in the merged city
  for (const [song, code] of [[{ title: '', artist: 'Tyla' }, 'text_too_short'], [{ title: 'Water' }, 'text_required'], [{ title: 'x'.repeat(41), artist: 'Tyla' }, 'text_too_long'], [{ title: 'Water', artist: 'listen at tyla.com' }, 'links_not_allowed']] satisfies [Frame, string][]) {
    const refused = await post('/api/civic/radio/shoutout', { cityId: 'lagos', ...song }, ada);
    assert.equal(refused.code, code); assert.ok(refused.reason); assert.equal(refused.state.cash, 5000);
  }
  wait(60000);
  const requestId = f.id();
  const queued = await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: ' Water ', artist: '<b>Tyla</b>', requestId, url: 'https://evil.example', audio: 'x' }, ada);
  assert.equal(queued.ok, true); assert.equal(queued.state.cash, 4500); assert.equal(queued.state.ledger.at(-1)?.reason, 'Club radio shout-out · The Library');
  assert.deepEqual(Object.keys(queued.entry).sort(), ['artist', 'by', 'endsAt', 'id', 'mine', 'startsAt', 'title'], 'text only: no audio or link field');
  assert.equal(queued.entry.title, 'Water'); assert.equal(queued.entry.artist, '<b>Tyla</b>'); assert.equal(queued.entry.endsAt - queued.entry.startsAt, 60000);
  const retry = await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Water', artist: '<b>Tyla</b>', requestId }, ada);
  assert.equal(retry.duplicate, true); assert.equal(retry.entry.id, queued.entry.id); assert.equal(retry.state.cash, 4500, 'a retried request is not charged twice');
  assert.equal((await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Unavailable', artist: 'Davido', requestId }, bola)).duplicate, undefined, 'request ids are per player');
  let radio = await get<RadioResponse>('/api/civic/radio?city=lagos&venue=library', bola);
  assert.equal(radio.playing?.title, 'Water'); assert.equal(radio.playing?.by.name, 'Ada'); assert.equal(radio.playing?.mine, false);
  assert.deepEqual(radio.queue.map((entry) => [entry.title, entry.mine, entry.startsAt]), [['Unavailable', true, queued.entry.endsAt]]);
  assert.equal(radio.usedToday, 1); assert.equal(radio.price, 500);
  const pulse = await get<PulseResponse>('/api/civic/pulse?city=lagos', bola);
  assert.equal(pulse.radio?.playing?.title, 'Water', 'the pulse carries the banner for the club you are standing in');
  wait(61000);
  radio = await get<RadioResponse>('/api/civic/radio?city=lagos&venue=library');
  assert.equal(radio.playing?.title, 'Unavailable'); assert.deepEqual(radio.queue, []);
  wait(61000);
  assert.equal((await get<RadioResponse>('/api/civic/radio?city=lagos&venue=library')).playing, null);
  assert.equal((await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Two', artist: 'A' }, ada)).ok, true);
  assert.equal((await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Three', artist: 'A' }, ada)).state.cash, 3500);
  const capped = await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Four', artist: 'A' }, ada);
  assert.equal(capped.code, 'shoutout_limit'); assert.match(reasonOf(capped), /all 3 shout-outs for today/); assert.equal(capped.state.cash, 3500);
  // Per-player rate limit on top of the daily cap.
  let limited = 0;
  for (let i = 0; i < 8; i++) if ((await post('/api/civic/radio/shoutout', { cityId: 'lagos', title: 'Spam', artist: 'A' }, ada)).status === 429) limited += 1;
  assert.ok(limited >= 2, 'the route is rate-limited per player');
});

test('neighbours, rich list and counters: real counts, truthful presence, opt-outs, no secrets', async t => {
  const { f, get, post, life, wait, database } = await harness(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), chidi = await f.device('Chidi');
  let pulse = await get<PulseResponse>('/api/civic/pulse?city=lagos');
  assert.deepEqual(pulse.counters, { players: 0, online: 0, visits: 0 }, 'nothing is invented before anyone checks in'); assert.equal(pulse.checkedIn, false);
  for (const device of [ada, bola, chidi]) assert.equal((await get<PulseResponse>('/api/civic/pulse?city=lagos', device)).checkedIn, true);
  const peer = await f.joinRoom(bola);
  wait(6000);
  pulse = await get<PulseResponse>('/api/civic/pulse?city=lagos', ada);
  assert.deepEqual(pulse.counters, { players: 3, online: 1, visits: 3 });
  let hood = await get<NeighboursResponse>('/api/civic/neighbours?city=lagos', ada);
  assert.equal(hood.demonym, 'Lagosians'); assert.equal(hood.total, 3); assert.equal(hood.online, 1); assert.equal(hood.hidden, false);
  // Every life in the merged game lives somewhere (the default house is in Yaba), so nobody is "not set".
  const yaba = must(hood.districts.find((group) => group.id === 'yaba'), 'Yaba district');
  assert.equal(yaba.label, 'Yaba'); assert.equal(yaba.count, 3);
  assert.deepEqual(yaba.homes.map((home) => [home.name, home.online, home.you]), [['Ada', false, true], ['Bola', true, false], ['Chidi', false, false]]);
  assert.deepEqual(hood.districts.map((group) => group.id), ['mushin', 'yaba', 'lekki', 'ikoyi', 'banana']);
  peer.ws.close(); await new Promise((resolve) => peer.ws.once('close', resolve)); await new Promise((resolve) => setTimeout(resolve, 30));
  wait(6000);
  assert.equal((await get<NeighboursResponse>('/api/civic/neighbours?city=lagos', ada)).online, 0, 'presence drops when the connection closes');
  // Opt out of the directory: still counted, no longer listed for others.
  assert.deepEqual((await post('/api/civic/prefs', { directory: false }, chidi)).prefs, { richList: true, directory: false });
  hood = await get<NeighboursResponse>('/api/civic/neighbours?city=lagos', ada);
  assert.equal(hood.total, 3); assert.equal(hood.listed, 2); assert.ok(!JSON.stringify(hood).includes(chidi.id));
  assert.equal((await get<NeighboursResponse>('/api/civic/neighbours?city=lagos', chidi)).hidden, true);
  // Rich list from server-held balances: Bola earns a shift, Ada spends on a billboard.
  await f.action(bola.cookie, { type: 'apply-job', payload: { id: 'community-helper' } });
  await f.action(bola.cookie, { type: 'spot', payload: { id: 'work' } });
  assert.equal((await f.action(bola.cookie, { type: 'activity', payload: { id: 'helper-shift' } })).ok, true);
  wait(21000);
  assert.equal((await life(bola)).cash, 5300);
  await post('/api/civic/ads/rent', { cityId: 'lagos', kind: 'billboard', slot: 'bb-01', text: 'Ada', colour: 'green', icon: 'star' }, ada);
  wait(60000);
  let list = await get<RichListResponse>('/api/civic/richlist?city=lagos', bola);
  assert.deepEqual(list.balances.map((entry) => [entry.rank, entry.name, entry.amount, entry.you]), [[1, 'Bola', 5300, true], [2, 'Chidi', 5000, false], [3, 'Ada', 3500, false]]);
  assert.deepEqual(list.earners.map((entry) => [entry.name, entry.amount]), [['Bola', 300]]);
  assert.deepEqual(list.you, { listed: true, cash: 5300, earned: 300, balanceRank: 1, earnerRank: 1 }); assert.equal(list.counters.players, 3);
  assert.deepEqual((await post('/api/civic/prefs', { richList: false }, bola)).prefs, { richList: false, directory: true });
  list = await get<RichListResponse>('/api/civic/richlist?city=lagos', ada);
  assert.deepEqual(list.balances.map((entry) => entry.name), ['Chidi', 'Ada']); assert.deepEqual(list.earners, []); assert.ok(!JSON.stringify(list).includes(bola.id));
  assert.equal((await get<RichListResponse>('/api/civic/richlist?city=lagos', bola)).you?.listed, false);
  assert.deepEqual((await post('/api/civic/prefs', { richList: true, directory: true }, bola)).prefs, { richList: true, directory: true });
  assert.equal((await get<RichListResponse>('/api/civic/richlist?city=lagos')).balances.length, 3);
  // Check-ins are write-limited: beyond the budget a pulse still answers, read-only.
  const burst = [];
  for (let i = 0; i < 9; i++) burst.push((await get<PulseResponse>('/api/civic/pulse?city=lagos', chidi)).checkedIn);
  assert.ok(burst.includes(true) && burst.includes(false));
  const db = await database();
  const civic = must(db.civic);
  assert.deepEqual(Object.keys(civic).sort(), ['cities', 'prefs', 'v']);
  assert.deepEqual(civic.prefs, { [chidi.id]: { directory: true } });
  const residents = must(civic.cities.lagos).residents;
  assert.deepEqual(Object.keys(residents).sort(), [ada.id, bola.id, chidi.id].sort());
  assert.deepEqual(Object.keys(residents[ada.id] ?? {}).sort(), ['cash', 'claims', 'day', 'earned', 'gems', 'house', 'lastSeen', 'name', 'since', 'week']);
  for (const device of [ada, bola, chidi]) assert.ok(!JSON.stringify(db.civic).includes(device.cookie.slice(4)));
});
