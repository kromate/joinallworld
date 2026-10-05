// OWNER: growth — comeback mail: every trigger rule, and the policy that keeps it from being excessive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife } from '../life.ts';
import { lagosDayStart } from './clock.ts';
import { COMEBACK, NEVER, awayPlan, candidates, decide, defaultPrefs, digestAllowed, emptyMemory, eventPlan, milestoneFacts, milestonePlan, needAlert, nextOpen, nudgePlan, projectNeed, releaseAt, remember, waitingPlan } from './comeback.ts';
import { mailWords, whenWords } from './comeback-words.ts';
import type { ComebackType, DecideInput, Facts, Memory, Plan } from './comeback.ts';
import type { LifeState } from '../types/life.ts';

const HOUR = 3600000, DAY = 86400000;
/** Thursday 2026-01-08, 12:00 Lagos (UTC+1): outside quiet hours. */
const NOON = Date.UTC(2026, 0, 8, 11);
const facts = (over: Partial<Facts> = {}): Facts => ({ name: 'Kunle Bello', needs: { hunger: 30, energy: 60, fun: 50, social: 60, hygiene: 60, bladder: 60 }, needsAt: NOON - 30 * HOUR, waiting: [], nudges: [], milestones: [], events: [], ...over });
const input = (over: Partial<DecideInput> = {}): DecideInput => ({ now: NOON, lastActive: NOON - 30 * HOUR, facts: facts(), memory: emptyMemory(), prefs: defaultPrefs(true), ...over });
const must = <T>(value: T | null | undefined): T => { assert.ok(value !== null && value !== undefined); return value; };
const typeOf = (over: Partial<DecideInput> = {}): ComebackType | null => decide(input(over)).plan?.type ?? null;

// ---- triggers --------------------------------------------------------------------------------

test('need alert: away a day, the worst of hunger, energy and social, only if it would be low on return', () => {
  const at = NOON, away = at - 25 * HOUR;
  // Settling applies at most four hours of decay and never goes under 10: 30 hunger would be 6 after four hours -> floor 10.
  assert.equal(projectNeed('hunger', 30, at - 30 * HOUR, at), 10);
  assert.equal(projectNeed('hunger', 8, at - 30 * HOUR, at), 8, 'a need already under the floor is not moved');
  assert.equal(projectNeed('energy', 60, at - HOUR, at), 56, 'only the time since it was stored counts, up to four hours');
  assert.deepEqual(needAlert(facts(), at, away), { need: 'hunger', level: 10 });
  assert.equal(needAlert(facts(), at, at - 23 * HOUR), null, 'not before 24 hours away');
  assert.equal(needAlert(facts({ needs: { hunger: 90, energy: 90, social: 90 } }), at, away), null, 'nothing low');
  // Other needs (bored, grubby, bursting) are not worth a mail; the lowest of the three is the one named.
  assert.equal(needAlert(facts({ needs: { hunger: 90, energy: 90, social: 90, fun: 0, hygiene: 0, bladder: 0 } }), at, away), null);
  assert.equal(needAlert(facts({ needs: { hunger: 50, energy: 12, social: 15 } , needsAt: at }), at, away)?.need, 'energy', 'the worst only');
  assert.equal(needAlert(facts({ needs: null }), at, away), null);
  assert.equal(needAlert(facts({ needs: { hunger: Number.NaN, energy: 90, social: 90 } }), at, away), null, 'a damaged value is ignored');
});

test('someone waiting: friends named, requests only counted, nothing before the last mail', () => {
  const items = [{ kind: 'message' as const, from: 'Ada', at: 5 }, { kind: 'message' as const, from: 'Ada', at: 6 }, { kind: 'gift' as const, from: 'Tunde', at: 7 }, { kind: 'request' as const, from: null, at: 8 }];
  const plan = must(waitingPlan({ waiting: items }, { waitingAt: 0 }));
  assert.deepEqual([plan.names, plan.messages, plan.gifts, plan.requests, plan.newest, plan.go], [['Ada', 'Tunde'], 2, 1, 1, 8, 'messages']);
  assert.equal(waitingPlan({ waiting: items }, { waitingAt: 8 }), null, 'already mailed');
  assert.equal(must(waitingPlan({ waiting: items }, { waitingAt: 6 })).messages, 0, 'only what is newer than the last mail');
  assert.equal(waitingPlan({ waiting: [] }, { waitingAt: 0 }), null);
  const onlyRequest = must(waitingPlan({ waiting: [{ kind: 'request', from: null, at: 1 }] }, { waitingAt: 0 }));
  assert.deepEqual([onlyRequest.names, onlyRequest.go], [[], 'people'], 'a request is never named');
});

test('a friend misses you: counted for a week, once per mail', () => {
  const nudges = [{ from: 'Ada', at: NOON - DAY }, { from: 'Bola', at: NOON - 8 * DAY }];
  const plan = must(nudgePlan({ nudges }, { nudgeAt: 0 }, NOON));
  assert.deepEqual([plan.names, plan.go], [['Ada'], 'people'], 'a nudge older than 7 days is gone');
  assert.equal(nudgePlan({ nudges }, { nudgeAt: NOON - DAY }, NOON), null);
});

test('milestones come from state that exists: house, deposit, table win, election, shift', () => {
  const now = Date.UTC(2026, 0, 5, 8); // Monday 09:00 Lagos
  const state: LifeState = createLife(null, { now, cityId: 'lagos', isNew: true });
  const none = { now, cityId: 'lagos', wins: [], civic: { elected: null, voting: null } };
  assert.deepEqual(milestoneFacts(state, none), []);
  state.estate.upgrade = { to: 'bq', cost: 60000, startedAt: now - 2 * HOUR, doneAt: now - HOUR };
  state.economy.deposits = [{ id: 'fd-1', amount: 5000, term: 'd1', openedAt: now - 2 * DAY }, { id: 'fd-2', amount: 5000, term: 'd7', openedAt: now - 2 * DAY }];
  state.job = 'tech';
  const found = milestoneFacts(state, { ...none, wins: [{ id: 'w1', won: true }, { id: 'w2', won: false }], civic: { elected: 7, voting: 7 } });
  assert.deepEqual(found.map((item) => item.what).sort(), ['deposit', 'elected', 'house', 'shift', 'table', 'vote']);
  assert.equal(found.filter((item) => item.what === 'deposit').length, 1, 'only the deposit whose term ended');
  assert.equal(found.find((item) => item.what === 'house')?.label, 'Two-room house');
  // One at a time, the most meaningful first; what was mailed is not mailed again.
  assert.equal(must(milestonePlan({ milestones: found }, { keys: [] })).what, 'elected');
  assert.equal(must(milestonePlan({ milestones: found }, { keys: ['elected:7'] })).what, 'house');
  assert.equal(milestonePlan({ milestones: found }, { keys: found.map((item) => item.key) }), null);
  // An upgrade still in progress, and a starter job (open every day), are not milestones.
  state.estate.upgrade = { to: 'bq', cost: 60000, startedAt: now, doneAt: now + HOUR };
  state.economy.deposits = []; state.job = 'community-helper';
  assert.deepEqual(milestoneFacts(state, none), []);
});

test('events: only one that starts within the next 24 hours, once, for a player who has been away a day', () => {
  const events = [{ key: 'event:a', title: 'A', venue: 'Park', start: NOON + 30 * HOUR }, { key: 'event:b', title: 'B', venue: 'Park', start: NOON + 10 * HOUR }, { key: 'event:c', title: 'C', venue: 'Park', start: NOON - HOUR }];
  assert.equal(must(eventPlan({ events }, { keys: [] }, NOON)).title, 'B');
  assert.equal(eventPlan({ events }, { keys: ['event:b'] }, NOON), null, 'A is too far off, C has begun');
  const f = facts({ events });
  assert.equal(candidates(input({ facts: f, lastActive: NOON - 13 * HOUR })).some((plan) => plan.type === 'event'), false, 'away only 13 hours: the weakest reason waits');
  assert.equal(candidates(input({ facts: f, lastActive: NOON - 25 * HOUR })).some((plan) => plan.type === 'event'), true);
});

test('away steps: 3, 7 and 28 days, each once per absence, the highest reached', () => {
  const last = NOON - 8 * DAY;
  assert.equal(awayPlan({ away: {} }, NOON, NOON - 2 * DAY), null);
  assert.equal(must(awayPlan({ away: {} }, NOON, NOON - 3 * DAY)).step, 3);
  assert.equal(must(awayPlan({ away: {} }, NOON, last)).step, 7, 'the highest step reached');
  assert.equal(awayPlan({ away: { '7': NOON - HOUR } }, NOON, last), null, 'sent for this absence');
  assert.equal(must(awayPlan({ away: { '7': last - DAY } }, NOON, last)).step, 7, 'a mail from an earlier absence does not count');
  assert.equal(must(awayPlan({ away: {} }, NOON, NOON - 29 * DAY)).step, 28);
});

// ---- the policy ------------------------------------------------------------------------------

test('priority: someone waiting > a friend nudge > a need > a milestone > an event > away', () => {
  const waiting = [{ kind: 'message' as const, from: 'Ada', at: NOON - 2 * HOUR }];
  const nudges = [{ from: 'Bola', at: NOON - HOUR }];
  const milestones = [{ key: 'house:1', what: 'house' as const, label: 'Duplex' }];
  const events = [{ key: 'event:x', title: 'Jazz', venue: 'Park', start: NOON + 5 * HOUR }];
  const lastActive = NOON - 4 * DAY;
  const order: ComebackType[] = [];
  let f = facts({ waiting, nudges, milestones, events });
  for (let i = 0; i < 6; i++) {
    const d = decide(input({ facts: f, lastActive }));
    const plan = must(d.plan); order.push(plan.type);
    f = plan.type === 'waiting' ? { ...f, waiting: [] } : plan.type === 'nudge' ? { ...f, nudges: [] } : plan.type === 'need' ? { ...f, needs: null } : plan.type === 'milestone' ? { ...f, milestones: [] } : plan.type === 'event' ? { ...f, events: [] } : f;
    // Each candidate is taken in turn: the memory is cleared so only the priority is under test.
    if (plan.type === 'away') break;
  }
  assert.deepEqual(order, ['waiting', 'nudge', 'need', 'milestone', 'event', 'away']);
});

test('gates: off, paused, active in the last 12 hours, quiet hours, preference per type', () => {
  assert.equal(decide(input({ prefs: defaultPrefs(false) })).why, 'off');
  assert.equal(decide(input({ prefs: { ...defaultPrefs(true), pausedUntil: NOON + DAY } })).next, NOON + DAY);
  const active = decide(input({ lastActive: NOON - 11 * HOUR }));
  assert.deepEqual([active.why, active.next], ['active', NOON + HOUR], 'looked at again when 12 hours have passed');
  // 21:00 Lagos is 20:00 UTC; 07:59 Lagos is 06:59 UTC.
  for (const [hour, minute] of [[20, 0], [23, 30], [3, 0], [6, 59]] as const) {
    const now = Date.UTC(2026, 0, 8, hour, minute), d = decide(input({ now, lastActive: now - 30 * HOUR, facts: facts({ needsAt: now - 30 * HOUR }) }));
    assert.equal(d.plan, null, `${hour}:${minute} UTC`);
    assert.equal(d.why, 'quiet_hours');
    assert.equal(d.next, nextOpen(now));
  }
  assert.equal(nextOpen(Date.UTC(2026, 0, 8, 22)), lagosDayStart(20462) + 8 * HOUR, 'a late evening opens at 08:00 the next day');
  assert.equal(new Date(nextOpen(Date.UTC(2026, 0, 8, 22))).toISOString(), '2026-01-09T07:00:00.000Z');
  assert.equal(new Date(nextOpen(Date.UTC(2026, 0, 8, 2))).toISOString(), '2026-01-08T07:00:00.000Z');
  assert.equal(nextOpen(Date.UTC(2026, 0, 8, 7)), Date.UTC(2026, 0, 8, 7), '08:00 is open');
  assert.equal(typeOf(), 'need');
  const types = { ...defaultPrefs(true).types, needs: false };
  assert.equal(typeOf({ prefs: { ...defaultPrefs(true), types } }), null, 'a type that is switched off is never sent, and nothing else qualifies');
});

test('caps: one in 24 hours, three in 7 days, across every type (the digest is one of them)', () => {
  const sent = (...ago: number[]): Memory => ({ ...emptyMemory(), sent: ago.map((h) => ({ at: NOON - h * HOUR, type: 'need' as const })) });
  const lastActive = NOON - 30 * HOUR;
  assert.equal(releaseAt(sent().sent, NOON, lastActive), 0);
  assert.equal(releaseAt(sent(5).sent, NOON, lastActive), NOON - 5 * HOUR + DAY, 'a day after the last');
  assert.equal(decide(input({ memory: sent(5) })).why, 'capped');
  assert.deepEqual(decide(input({ memory: sent(5) })).suppressed, ['need'], 'what was held back is reported for the counters');
  assert.equal(decide(input({ memory: sent(25) })).why, 'chosen');
  const three = sent(30, 60, 100);
  assert.equal(three.sent.length, 3);
  assert.equal(releaseAt(three.sent, NOON, NOON - 20 * HOUR), NOON - 100 * HOUR + 7 * DAY, 'the oldest of the three leaves the week');
  assert.equal(decide(input({ memory: three, lastActive: NOON - 4 * DAY })).why, 'capped');
  assert.equal(digestAllowed(sent(5), NOON, lastActive), false);
  assert.equal(digestAllowed(sent(25), NOON, lastActive), true);
  // A capped player is looked at again at the first open time after the cap clears, never in quiet hours.
  const d = decide(input({ memory: sent(5) }));
  assert.ok(d.next >= NOON - 5 * HOUR + DAY);
  assert.equal(d.next, nextOpen(d.next), 'and never in quiet hours');
});

test('cooldowns: a need at most every 3 days; waiting and milestones every 2; each key once', () => {
  const need = (days: number): Memory => ({ ...emptyMemory(), last: { need: NOON - days * DAY } });
  assert.equal(candidates(input({ memory: need(2) })).some((plan) => plan.type === 'need'), false);
  assert.equal(candidates(input({ memory: need(3) })).some((plan) => plan.type === 'need'), true);
  const w = facts({ waiting: [{ kind: 'message', from: 'Ada', at: NOON - HOUR }] });
  assert.equal(candidates(input({ facts: w, memory: { ...emptyMemory(), last: { waiting: NOON - DAY } } })).some((plan) => plan.type === 'waiting'), false);
  assert.equal(candidates(input({ facts: w, memory: { ...emptyMemory(), last: { waiting: NOON - 3 * DAY } } })).some((plan) => plan.type === 'waiting'), true);
});

test('back-off: three mails with no visit in between drop to one per 14 days; the final away mail ends the run until a visit', () => {
  const lastActive = NOON - 20 * DAY;
  const ago = (days: number[], type: ComebackType = 'away'): Memory => ({ ...emptyMemory(), sent: days.map((d) => ({ at: NOON - d * DAY, type })) });
  assert.equal(releaseAt(ago([10, 8, 6]).sent, NOON, lastActive), NOON - 6 * DAY + 14 * DAY);
  assert.equal(releaseAt(ago([10, 8]).sent, NOON, lastActive), 0, 'two are not yet a back-off');
  // After a visit the unanswered count starts again.
  assert.equal(releaseAt(ago([10, 8, 6]).sent, NOON, NOON - 5 * DAY), 0);
  assert.equal(decide(input({ lastActive, memory: ago([10, 8, 6]) })).why, 'capped');
  assert.equal(decide(input({ lastActive, memory: ago([20, 15, 14]) })).why, 'chosen', '14 days after the last is allowed');
  // The final mail: silence, however long they stay away, until they come back.
  const thirty: Memory = { ...emptyMemory(), away: { '28': NOON - 2 * DAY } };
  const stopped = decide(input({ lastActive: NOON - 40 * DAY, memory: thirty }));
  assert.deepEqual([stopped.plan, stopped.why, stopped.next], [null, 'stopped', NEVER]);
  assert.equal(decide(input({ lastActive: NOON - 40 * DAY, memory: thirty, now: NOON + 60 * DAY })).why, 'stopped');
  // They came back after it: a new absence begins.
  assert.notEqual(decide(input({ lastActive: NOON - 4 * DAY, memory: { ...thirty, away: { '28': NOON - 20 * DAY } } })).why, 'stopped');
});

test('the final away mail is never starved, and five mails with no visit end the run whatever they were', () => {
  const events = [{ key: 'event:x', title: 'Jazz', venue: 'Park', start: NOON + 5 * HOUR }];
  const lastActive = NOON - 29 * DAY;
  const chosen = must(decide(input({ lastActive, facts: facts({ events }) })).plan);
  assert.deepEqual([chosen.type, chosen.type === 'away' ? chosen.step : 0], ['away', 28], 'the final mail outranks an event');
  const many: Memory = { ...emptyMemory(), sent: [1, 2, 3, 4, 5].map((d) => ({ at: NOON - (40 - d * 10) * DAY, type: 'event' as const })) };
  const d = decide(input({ lastActive: NOON - 45 * DAY, memory: many }));
  assert.deepEqual([d.plan, d.why, d.next], [null, 'stopped', NEVER]);
});

test('remember: the ledger is bounded and what was sent is not sent again', () => {
  let memory = emptyMemory();
  const plans: Plan[] = [
    { type: 'milestone', key: 'house:1', what: 'house', label: 'Duplex', go: 'houses' },
    { type: 'event', key: 'event:x', title: 'Jazz', venue: 'Park', start: 1, go: 'events' },
    { type: 'away', key: 'away:3:1', step: 3, go: 'needs', facts: [] },
    { type: 'waiting', key: 'waiting:9', names: ['Ada'], messages: 1, gifts: 0, requests: 0, newest: 9, go: 'messages' },
    { type: 'nudge', key: 'nudge:4', names: ['Ada'], newest: 4, go: 'people' },
  ];
  plans.forEach((plan, i) => { memory = remember(memory, plan, NOON + i); });
  assert.deepEqual(memory.keys, ['house:1', 'event:x']);
  assert.deepEqual([memory.away['3'], memory.waitingAt, memory.nudgeAt, memory.last.need], [NOON + 2, 9, 4, undefined]);
  for (let i = 0; i < 30; i++) memory = remember(memory, plans[0] as Plan, NOON + 100 + i);
  assert.equal(memory.sent.length, COMEBACK.ledger);
  assert.ok(memory.keys.length <= COMEBACK.keys);
});

// ---- the words ----------------------------------------------------------------------------------

test('words: in the character’s voice, one button, no message text, no balance', () => {
  const now = NOON;
  const w = (plan: Plan, name = 'Kunle Bello') => mailWords(plan, { name, now });
  assert.equal(w({ type: 'need', key: 'k', need: 'hunger', go: 'needs' }).subject, 'Kunle is hungry');
  assert.equal(w({ type: 'need', key: 'k', need: 'energy', go: 'needs' }).subject, 'Kunle is tired');
  assert.equal(w({ type: 'need', key: 'k', need: 'social', go: 'people' }).subject, 'Kunle is lonely');
  const waiting = (names: string[], extra: Partial<Extract<Plan, { type: 'waiting' }>> = {}): Plan => ({ type: 'waiting', key: 'k', names, messages: 2, gifts: 1, requests: 0, newest: 1, go: 'messages', ...extra });
  assert.equal(w(waiting(['Ada'])).subject, 'Ada is waiting for you');
  assert.equal(w(waiting(['Ada', 'Tunde'])).subject, 'Ada and Tunde are waiting for you');
  assert.equal(w(waiting(['Ada', 'Tunde', 'Bola'])).subject, 'Ada, Tunde and Bola are waiting for you');
  assert.deepEqual(w(waiting(['Ada'])).lines, ['2 messages from your friends', 'A gift from a friend']);
  assert.equal(w(waiting([], { messages: 0, gifts: 0, requests: 1, go: 'people' })).subject, 'Someone wants to be your friend in Allworld');
  assert.equal(w({ type: 'nudge', key: 'k', names: ['Ada'], newest: 1, go: 'people' }).subject, 'Ada is waiting for you in Allworld');
  assert.equal(w({ type: 'milestone', key: 'k', what: 'house', label: 'Duplex', go: 'houses' }).subject, 'Your house upgrade is finished');
  assert.equal(w({ type: 'milestone', key: 'k', what: 'shift', label: 'Tech hub', go: 'career' }).subject, 'Your Tech hub shift is open');
  assert.match(w({ type: 'away', key: 'k', step: 28, go: 'needs', facts: ['x'] }).intro, /last e-mail/);
  assert.deepEqual(w({ type: 'away', key: 'k', step: 3, go: 'needs', facts: ['a', 'b', 'c', 'd'] }).lines, ['a', 'b', 'c']);
  assert.deepEqual(w({ type: 'away', key: 'k', step: 28, go: 'needs', facts: ['a'] }).lines, [], 'the last mail is just a goodbye');
  assert.equal(whenWords(Date.UTC(2026, 0, 8, 18), NOON), 'tonight at 7PM');
  assert.equal(whenWords(Date.UTC(2026, 0, 8, 13), NOON), 'today at 2PM');
  assert.equal(whenWords(Date.UTC(2026, 0, 9, 9), NOON), 'tomorrow at 10AM');
});
