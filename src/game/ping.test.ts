// OWNER: social — the pure rules of Ping (src/game/ping.ts): when a ping may be mailed, and the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PING, nightAt, pingMailDecision, pingMailNoted, pingNoteWords, placeWords, waitWords } from './ping.ts';
import { COMEBACK, quiet } from './comeback.ts';
import { COMEBACK_TYPES, PREF_OF } from './comeback-prefs.ts';
import type { PingMailFacts } from './ping.ts';

const HOUR = 3600000, DAY = 86400000;
/** Midday in Lagos on day 10. */
const NOON = Date.UTC(1970, 0, 11, 11);
const facts = (over: Partial<PingMailFacts> = {}): PingMailFacts => ({ now: NOON, from: 'ada', prefs: { on: true, pausedUntil: 0, friends: true }, online: false, ledger: [], lastActive: NOON - 30 * DAY, ...over });

test('a ping mail is a Friends mail with numbers of its own, and its night is the night of every other mail', () => {
  assert.equal(PREF_OF.ping, 'friends');
  assert.ok(COMEBACK_TYPES.includes('ping'));
  assert.deepEqual([PING.quietFrom, PING.quietTo], [COMEBACK.quietFrom, COMEBACK.quietTo]);
  for (let hour = 0; hour < 24; hour++) { const at = Date.UTC(1970, 0, 11, hour); assert.equal(nightAt(at), quiet(at), `hour ${hour}`); }
  assert.ok(PING.pairMinutes < PING.liveMinutes && PING.mail.pairPerDay <= PING.mail.recipientPerDay && PING.mail.recipientPerDay * 7 >= PING.mail.recipientPerWeek);
  assert.ok(PING.mail.unansweredPerSender < PING.mail.unansweredInAll);
});

test('the gates, in order: the switches, never while in the game, never at night', () => {
  assert.equal(pingMailDecision(facts()), 'send');
  assert.equal(pingMailDecision(facts({ prefs: null })), 'off');
  assert.equal(pingMailDecision(facts({ prefs: { on: false, pausedUntil: 0, friends: true } })), 'off');
  assert.equal(pingMailDecision(facts({ prefs: { on: true, pausedUntil: 0, friends: false } })), 'off');
  assert.equal(pingMailDecision(facts({ prefs: { on: true, pausedUntil: NOON + 1, friends: true } })), 'off');
  assert.equal(pingMailDecision(facts({ online: true })), 'online');
  assert.equal(pingMailDecision(facts({ now: Date.UTC(1970, 0, 11, 20, 30) })), 'night');
  assert.equal(pingMailDecision(facts({ now: Date.UTC(1970, 0, 11, 6, 59) })), 'night');
  assert.equal(pingMailDecision(facts({ now: Date.UTC(1970, 0, 11, 7, 0) })), 'send');
  // It does not wait because the friend played a minute ago: a ping is for now.
  assert.equal(pingMailDecision(facts({ lastActive: NOON - 60000 })), 'send');
});

test('the caps: one pair, one recipient, and nobody who never comes back', () => {
  const at = (hours: number, from = 'ada') => ({ at: NOON - hours * HOUR, from });
  assert.equal(pingMailDecision(facts({ ledger: [at(3.9)] })), 'pair');
  assert.equal(pingMailDecision(facts({ ledger: [at(4)] })), 'send');
  assert.equal(pingMailDecision(facts({ ledger: [at(4, 'bayo')] })), 'send', 'another friend’s mail does not hold this one back');
  assert.equal(pingMailDecision(facts({ ledger: [at(23), at(5)] })), 'pair', 'two a day from one friend');
  assert.equal(pingMailDecision(facts({ ledger: [at(25), at(5)], lastActive: NOON - HOUR })), 'send');
  assert.equal(pingMailDecision(facts({ ledger: [at(20, 'b'), at(10, 'c'), at(5, 'd')] })), 'recipient');
  assert.equal(pingMailDecision(facts({ ledger: [at(20, 'b'), at(10, 'c')] })), 'recipient', 'two a day from everybody together');
  assert.equal(pingMailDecision(facts({ ledger: [at(25, 'b'), at(5, 'd')] })), 'send');
  const week = [1, 2, 3, 4, 5].map((day) => at(day * 24 + 1, `f${day}`));
  assert.equal(pingMailDecision(facts({ ledger: week, lastActive: NOON })), 'recipient', 'five in a week');
  assert.equal(pingMailDecision(facts({ ledger: week.slice(0, 4), lastActive: NOON })), 'send');
  // Unanswered: three from this friend, or five from anybody, since the last visit.
  const old = [at(100), at(70), at(40)];
  assert.equal(pingMailDecision(facts({ ledger: old })), 'backoff');
  assert.equal(pingMailDecision(facts({ ledger: old, lastActive: NOON - 50 * HOUR })), 'send', 'a visit since then counts as an answer');
  assert.equal(pingMailDecision(facts({ ledger: old, from: 'bayo' })), 'send', 'the back-off is per friend');
  assert.equal(pingMailDecision(facts({ ledger: [at(220, 'a1'), at(190, 'a2'), at(150, 'a3'), at(90, 'a4'), at(30, 'a5')], from: 'bayo' })), 'backoff', 'five from anybody, however long ago, until a visit');
  // A mail dated in the future (a clock that went back) holds nothing back.
  assert.equal(pingMailDecision(facts({ ledger: [{ at: NOON + HOUR, from: 'ada' }] })), 'send');
});

test('the ledger is bounded and forgets what is older than a week', () => {
  let ledger: { at: number; from: string }[] = [];
  for (let i = 0; i < 60; i++) ledger = pingMailNoted(ledger, `f${i}`, NOON + i * 1000);
  assert.equal(ledger.length, PING.mail.kept);
  assert.equal(ledger.at(-1)?.from, 'f59');
  assert.deepEqual(pingMailNoted([{ at: NOON - 8 * DAY, from: 'old' }], 'new', NOON), [{ at: NOON, from: 'new' }]);
});

test('the words: a home is only ever its city; control characters and long names cannot shape a line', () => {
  assert.equal(placeWords({ home: false, venueLabel: 'Freedom Park', cityName: 'Lagos' }), 'at Freedom Park, Lagos');
  assert.equal(placeWords({ home: true, venueLabel: '14 Secret Close, Estate 9', cityName: 'Lagos' }), 'at home in Lagos');
  assert.equal(placeWords({ home: false, venueLabel: ' A\nB\u0000C ', cityName: 'Iba\tdan' }), 'at A B C, Iba dan');
  assert.equal(placeWords({ home: false, venueLabel: '', cityName: '' }), 'at a place, Allworld');
  assert.equal(pingNoteWords('told', 'Ada'), 'Ada is in the game and has been told.');
  assert.equal(pingNoteWords('later', 'Ada'), 'Pinged. Ada will see it when they are back.');
  assert.equal(pingNoteWords('night', 'Ada'), 'It is night for Ada; they will see it when they are back.');
  assert.deepEqual([waitWords(1), waitWords(60000), waitWords(29.2 * 60000), waitWords(61 * 60000), waitWords(3 * HOUR)], ['in 1 minute', 'in 1 minute', 'in 29 minutes', 'in 2 hours', 'in 3 hours']);
});
