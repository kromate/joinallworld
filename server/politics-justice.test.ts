// OWNER: politics — fights, offences, police and jail on the Node host. The pure rules are in server/politics/justice.test.ts.
// Design: docs/POLITICS.md section 5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { JUSTICE, QUORUM } from '../src/game/content/politics.ts';
import type { JusticeResponse } from '../src/types/politics.ts';
import { DAY, harness } from './testing/politicsHarness.ts';
import type { Device } from './testing/politicsHarness.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

async function scene(t: Parameters<typeof harness>[0]) {
  const h = await harness(t);
  const { f, edit, player, elect, post, get } = h;
  /** A player standing in the park, connected to its room. */
  async function atPark(name: string, energy = 100): Promise<Device> {
    const device = await player(name);
    await edit(device, (state) => { state.location = 'park'; state.needs.energy = energy; });
    await f.joinRoom(device);
    return device;
  }
  const justice = async (device?: Device): Promise<JusticeResponse> => (await get('/api/politics/justice/overview?city=lagos', device)) as unknown as JusticeResponse;
  const fight = (device: Device, target: Device) => post('/api/politics/justice/fight', { cityId: 'lagos', target: target.id, requestId: f.id() }, device);
  const arrest = (device: Device, offence: string) => post('/api/politics/justice/arrest', { cityId: 'lagos', offence, requestId: f.id() }, device);
  const enrol = (device: Device, player: Device, tier = 'state') => post('/api/politics/justice/enrol', { cityId: 'lagos', tier, player: player.id }, device);
  return { ...h, atPark, justice, fight, arrest, enrol, elect, QUORUM };
}

test('a fight is decided by the server, costs both energy, goes on record, and cannot be repeated at once', { timeout: 60000 }, async (t) => {
  const { f, atPark, fight, justice, get, edit } = await scene(t);
  const ada = await atPark('Ada', 100), bola = await atPark('Bola', 30);
  const first = await fight(ada, bola);
  assert.equal(first.code, 'won', 'the fitter player wins');
  const loser = (await get('/api/life?city=lagos', bola)).state, winner = (await get('/api/life?city=lagos', ada)).state;
  assert.ok((loser?.needs.energy ?? 99) <= 30 - JUSTICE.loserEnergy + 5, 'the loser lost energy');
  assert.ok((winner?.needs.energy ?? 0) <= 100 - JUSTICE.winnerEnergy + 5 && (winner?.needs.energy ?? 0) >= 100 - JUSTICE.winnerEnergy - 5, 'the winner lost a little');
  assert.ok(loser?.moodlets.some((item) => item.id === 'justice-beaten'), 'the loser is left beaten up');
  assert.ok(loser?.social.notices.some((notice) => notice.text.includes('Ada attacked you')), 'and is told');
  const record = await justice(ada);
  assert.deepEqual(record.you?.wanted.map((offence) => [offence.by.name, offence.against.name]), [['Ada', 'Bola']], 'the attacker is wanted');
  assert.equal((await fight(ada, bola)).code, 'fight_cooldown');
  const chi = await atPark('Chi');
  assert.equal((await fight(ada, chi)).code, 'fight_cooldown', 'one fight at a time, whoever the other player is');
  assert.equal((await fight(chi, chi)).code, 'self');
  await edit(chi, (state) => { state.civic.since = f.now(); });
  const dayo = await atPark('Dayo');
  assert.equal((await fight(dayo, chi)).code, 'too_new', 'a newcomer is left alone');
});

test('both must be in the same place, awake and able: nobody is fought at home, offline, in another place or when too tired', { timeout: 60000 }, async (t) => {
  const { f, atPark, fight, player, edit } = await scene(t);
  const ada = await atPark('Ada'), bola = await atPark('Bola');
  const offline = await player('Offline'); // never joined a room
  assert.equal((await fight(ada, offline)).code, 'not_here');
  const market = await player('Market');
  await f.joinRoom(market).catch(() => undefined);
  assert.equal((await fight(ada, market)).code, 'not_here', 'in another place');
  await edit(ada, (state) => { state.needs.energy = JUSTICE.minEnergy - 1; });
  assert.equal((await fight(ada, bola)).code, 'too_tired');
  await edit(ada, (state) => { state.needs.energy = 90; state.location = 'home'; });
  assert.equal((await fight(ada, bola)).code, 'not_here', 'not from home');
});

test('police: only the officeholder enrols, only for their term and seat, and an officer arrests where the offender stands', { timeout: 90000 }, async (t) => {
  const { f, atPark, fight, arrest, enrol, elect, justice, post, get } = await scene(t);
  const ada = await atPark('Ada', 100), bola = await atPark('Bola', 30), chi = await atPark('Chi'), governor = await atPark('Governor');
  await elect(governor, 'state:lagos', QUORUM.state);
  const offence = (await justice(ada)).you?.wanted[0]?.id;
  assert.equal(offence, undefined, 'no offence yet');
  assert.equal((await fight(ada, bola)).code, 'won');
  const open = (await justice(ada)).you?.wanted[0]?.id ?? '';
  assert.match(open, /^o\d+$/);

  assert.equal((await arrest(chi, open)).code, 'not_police', 'a resident cannot arrest');
  assert.equal((await enrol(chi, chi)).code, 'not_in_office');
  assert.equal((await enrol(governor, chi)).code, 'enrolled');
  assert.deepEqual((await justice(governor)).seats[1]?.officers.map((officer) => officer.name), ['Chi']);
  assert.deepEqual([(await justice(governor)).seats[1]?.canEnrol, (await justice(chi)).seats[1]?.canEnrol], [true, false]);
  assert.equal((await justice(chi)).you?.police?.tier, 'state');
  assert.deepEqual((await justice(chi)).offences.map((item) => [item.by.name, item.here]), [['Ada', true]], 'the officer sees the open offence, and that the offender is here');

  // The sentence is the one the Governor decreed.
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'state', lever: 'stateSentence', value: 5 }, governor)).code, 'decreed');
  assert.equal((await arrest(ada, open)).code, 'not_police', 'the offender cannot arrest');
  const arrested = await arrest(chi, open);
  assert.equal(arrested.code, 'arrested');
  const sentence = (await justice(ada)).you?.jail;
  assert.deepEqual([sentence?.minutes, sentence?.by.name], [5, 'Chi']);
  assert.equal((await arrest(chi, open)).code, 'no_such_offence', 'an offence is acted on once');

  // A sentence stops moving about and working, and fighting; it does not stop the Phone.
  const trip = await f.action(ada.cookie, { type: 'travel', payload: { id: 'market', mode: 'trek' } });
  assert.equal(trip.error, 'jailed');
  assert.match(String((trip as { reason?: string }).reason), /in jail for 5 minutes/);
  assert.equal((await f.action(ada.cookie, { type: 'activity', payload: { id: 'walk' } })).error, 'jailed');
  assert.equal((await f.action(ada.cookie, { type: 'homeward.accept', payload: { quote: 'unaccepted' } })).error, 'jailed');
  assert.notEqual((await f.action(ada.cookie, { type: 'civic.refresh', payload: {} })).error, 'jailed');
  assert.equal((await fight(ada, chi)).code, 'jailed');
  assert.equal((await fight(chi, ada)).code, 'target_jailed');
  assert.ok((await get('/api/life?city=lagos', ada)).state?.social.notices.some((notice) => notice.text.includes('You are in jail for 5 minutes')) !== false);

  // It ends by itself.
  f.advance(6 * 60000);
  assert.equal((await justice(ada)).you?.jail, null);
  assert.notEqual((await f.action(ada.cookie, { type: 'travel', payload: { id: 'market', mode: 'trek' } })).error, 'jailed');

  // The enrolment lapses with the Governor's term.
  f.advance(8 * DAY);
  assert.equal((await justice(chi)).you?.police, null);
  assert.equal((await justice(chi)).seats[1]?.officers.length, 0);
});

test('an officer’s reach: not the offender’s city for a city officer elsewhere, a full force is refused, and the officer or the officeholder can end the post', { timeout: 90000 }, async (t) => {
  const { atPark, fight, arrest, enrol, elect, justice, post } = await scene(t);
  const mayor = await atPark('Mayor'), ada = await atPark('Ada', 100), bola = await atPark('Bola', 30), chi = await atPark('Chi');
  await elect(mayor, 'city:lagos', QUORUM.city);
  assert.equal((await enrol(mayor, chi, 'city')).code, 'enrolled');
  const unknown = await post('/api/politics/justice/enrol', { cityId: 'lagos', tier: 'city', player: '00000000-0000-4000-8000-000000000000' }, mayor);
  assert.equal(unknown.code, 'unknown_player');
  assert.equal((await post('/api/politics/justice/enrol', { cityId: 'lagos', tier: 'city', player: 'nope' }, mayor)).error, 'invalid_player');
  // A full force (three officers for a city seat) refuses a fourth.
  const rest: Device[] = [];
  for (const name of ['One', 'Two', 'Three']) rest.push(await atPark(name));
  assert.equal((await enrol(mayor, rest[0]!, 'city')).code, 'enrolled');
  assert.equal((await enrol(mayor, rest[1]!, 'city')).code, 'enrolled');
  assert.equal((await enrol(mayor, rest[2]!, 'city')).code, 'police_full');
  assert.equal((await enrol(mayor, chi, 'city')).code, 'enrolled', 'an officer already in the force can be enrolled again');
  assert.equal((await post('/api/politics/justice/dismiss', { cityId: 'lagos', tier: 'city', player: rest[0]!.id }, ada)).code, 'not_in_office');
  assert.equal((await post('/api/politics/justice/dismiss', { cityId: 'lagos', tier: 'city', player: rest[0]!.id }, mayor)).code, 'dismissed');
  assert.equal((await post('/api/politics/justice/dismiss', { cityId: 'lagos', tier: 'city', player: chi.id }, chi)).code, 'dismissed', 'an officer may resign');
  assert.equal((await post('/api/politics/justice/dismiss', { cityId: 'lagos', tier: 'city', player: chi.id }, mayor)).code, 'not_police');
  assert.equal((await fight(ada, bola)).code, 'won');
  const open = (await justice(ada)).you?.wanted[0]?.id ?? '';
  assert.equal((await arrest(chi, open)).code, 'not_police', 'a resigned officer cannot arrest');
  assert.equal((await arrest(rest[1]!, open)).code, 'arrested', 'a city officer arrests in their own city');
});

test('courts: bail, an appeal with a lawyer, a judge’s ruling, and one appeal to the state court', { timeout: 120000 }, async (t) => {
  const { f, atPark, fight, arrest, enrol, elect, justice, post, get } = await scene(t);
  const mayor = await atPark('Mayor'), governor = await atPark('Governor'), ada = await atPark('Ada', 100), bola = await atPark('Bola', 30), chi = await atPark('Chi'), judy = await atPark('Judy'), sam = await atPark('Sam'), lex = await atPark('Lex'), dayo = await atPark('Dayo', 30);
  await elect(mayor, 'city:lagos', QUORUM.city); await elect(governor, 'state:lagos', QUORUM.state);
  assert.equal((await enrol(mayor, chi, 'city')).code, 'enrolled');
  const judge = (device: Device, tier: string, by: Device) => post('/api/politics/justice/enrol', { cityId: 'lagos', tier, player: device.id, role: 'judge' }, by);
  assert.equal((await judge(judy, 'city', mayor)).code, 'enrolled');
  assert.equal((await judge(sam, 'state', governor)).code, 'enrolled');
  assert.equal((await judge(judy, 'city', chi)).code, 'not_in_office', 'only the officeholder makes judges');
  assert.deepEqual((await justice(mayor)).seats[0]?.judges.map((item) => item.name), ['Judy']);
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'citySentence', value: 20 }, mayor)).code, 'decreed');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'cityBail', value: 3000 }, mayor)).code, 'decreed');
  assert.equal((await post('/api/politics/justice/lawyer', { cityId: 'lagos', on: true }, lex)).code, 'practising');
  assert.deepEqual((await justice(ada)).court.lawyers.map((item) => item.name), ['Lex']);

  // Bail frees at once, for the price the Mayor set, paid into the city treasury.
  assert.equal((await fight(ada, bola)).code, 'won');
  const first = (await justice(ada)).you?.wanted[0]?.id ?? '';
  assert.equal((await arrest(chi, first)).code, 'arrested');
  assert.equal((await justice(ada)).court.bail, 3000);
  const cash = (await get('/api/life?city=lagos', ada)).state?.cash ?? 0;
  const bailed = await post('/api/politics/justice/bail', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.equal(bailed.code, 'bailed');
  assert.equal(cash - (bailed.state?.cash ?? 0), 3000);
  assert.equal((await justice(ada)).you?.jail, null);
  assert.equal((await post('/api/politics/justice/bail', { cityId: 'lagos', requestId: f.id() }, ada)).code, 'not_jailed');
  assert.equal(((await get('/api/politics/overview?city=lagos', ada)) as unknown as { seats: { treasury: { balance: number } }[] }).seats[0]?.treasury.balance, 3000);

  // A second offence: appealed with a lawyer, cut by a city judge, then taken to the state court and quashed.
  f.advance(6 * 60000);
  assert.equal((await fight(ada, dayo)).code, 'won');
  const second = (await justice(ada)).you?.wanted.find((offence) => offence.against.name === 'Dayo')?.id ?? '';
  assert.equal((await arrest(chi, second)).code, 'arrested');
  assert.equal((await post('/api/politics/justice/appeal', { cityId: 'lagos', statement: 'ab', requestId: f.id() }, ada)).code, 'text_too_short');
  assert.equal((await post('/api/politics/justice/appeal', { cityId: 'lagos', statement: 'He swung first', counsel: bola.id, requestId: f.id() }, ada)).code, 'not_a_lawyer');
  assert.equal((await post('/api/politics/justice/appeal', { cityId: 'lagos', statement: 'He swung first', requestId: f.id() }, bola)).code, 'not_jailed');
  const cash2 = (await get('/api/life?city=lagos', ada)).state?.cash ?? 0;
  const appealed = await post('/api/politics/justice/appeal', { cityId: 'lagos', statement: 'He swung first', counsel: lex.id, requestId: f.id() }, ada);
  assert.equal(appealed.code, 'appealed'); assert.equal(cash2 - (appealed.state?.cash ?? 0), 500);
  assert.equal((await post('/api/politics/justice/appeal', { cityId: 'lagos', statement: 'Again', requestId: f.id() }, ada)).code, 'already_appealed');
  assert.deepEqual([(await justice(lex)).court.counselFor.length, (await justice(judy)).court.docket.length, (await justice(chi)).court.docket.length, (await justice(sam)).court.docket.length], [1, 1, 0, 0], 'the lawyer sees the case, the city judge has it on the docket, nobody else does');
  assert.equal((await post('/api/politics/justice/argue', { cityId: 'lagos', offence: second, argument: 'My client was provoked' }, bola)).code, 'not_your_case');
  assert.equal((await post('/api/politics/justice/argue', { cityId: 'lagos', offence: second, argument: 'My client was provoked' }, lex)).code, 'argued');
  assert.equal((await post('/api/politics/justice/argue', { cityId: 'lagos', offence: second, argument: 'Once more' }, lex)).code, 'already_argued');
  assert.equal((await justice(judy)).court.docket[0]?.counsel?.argument, 'My client was provoked');

  const rule = (device: Device, verdict: string, note = 'Having heard both sides') => post('/api/politics/justice/rule', { cityId: 'lagos', offence: second, verdict, note }, device);
  assert.equal((await rule(chi, 'quashed')).code, 'not_judge', 'the arresting officer cannot rule');
  assert.equal((await rule(ada, 'quashed')).code, 'not_judge', 'nor the defendant');
  assert.equal((await rule(sam, 'quashed')).code, 'not_judge', 'nor a judge of another court');
  assert.equal((await rule(judy, 'banished')).code, 'invalid_verdict');
  assert.equal((await rule(judy, 'reduced', 'ab')).code, 'text_too_short');
  assert.equal((await rule(judy, 'reduced')).code, 'reduced');
  const rulings = (await (await fetch(`${f.base}/api/world/records?kind=ruling`)).json()) as { entries: { title: string; scope: string; facts: Record<string, unknown> }[] };
  assert.deepEqual(rulings.entries.map((entry) => [entry.scope, entry.facts.verdict, entry.facts.judge, entry.facts.defendant]), [['city:lagos', 'reduced', 'Judy', 'Ada']], 'a ruling is on the public record as it is made');
  const remaining = (await justice(ada)).you?.jail?.until ?? 0;
  assert.ok(remaining - f.now() <= 10 * 60000 + 1000 && remaining - f.now() > 0, 'half of what was left');
  assert.equal((await rule(judy, 'quashed')).code, 'no_such_case', 'one ruling for a hearing');
  assert.equal((await justice(ada)).court.case?.ruling?.verdict, 'reduced');
  assert.ok((await get('/api/life?city=lagos', ada)).state?.social.notices.some((notice) => notice.text.includes('Judy: Your sentence was cut in half')));

  assert.equal((await post('/api/politics/justice/escalate', { cityId: 'lagos', requestId: f.id() }, bola)).code, 'no_case');
  const up = await post('/api/politics/justice/escalate', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.equal(up.code, 'escalated');
  assert.deepEqual([(await justice(judy)).court.docket.length, (await justice(sam)).court.docket.length], [0, 1], 'the state court has it now');
  assert.equal((await rule(sam, 'quashed', 'The arrest was unsound')).code, 'quashed');
  assert.equal((await justice(ada)).you?.jail, null, 'free');
  const decided = (await justice(ada)).court.rulings[0];
  assert.deepEqual([decided?.ruling?.verdict, decided?.lower?.verdict, decided?.appeals], ['quashed', 'reduced', 1]);
  assert.equal((await post('/api/politics/justice/escalate', { cityId: 'lagos', requestId: f.id() }, ada)).code, 'no_case');

  // Courts, like police, last a term.
  f.advance(8 * 86400000);
  assert.equal((await justice(judy)).court.judge, null);
  assert.equal((await justice(mayor)).seats[0]?.judges.length, 0);
});
