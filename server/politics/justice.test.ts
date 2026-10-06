// OWNER: politics — the pure justice rules: fights, offences, police and jail (docs/POLITICS.md section 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JUSTICE } from '../../src/game/content/politics.ts';
import type { JusticeRecord } from '../../src/types/politics.ts';
import { arrestBlock, attackerWins, fightBlock, inJurisdiction, jail, jailOf, officersOf, policeIsValid, recordFight, timeLeft } from './justice.ts';

const NOW = 1_800_000_000_000, MIN = 60000;
const empty = (): JusticeRecord => ({ offences: {}, jail: {}, police: {}, judges: {}, lawyers: {}, cases: {}, fights: {}, pairs: {} });
const ada = { id: 'ada', name: 'Ada' }, bola = { id: 'bola', name: 'Bola' }, chi = { id: 'chi', name: 'Chi' };

test('a fight has cooldowns for the attacker and for the pair, and a jailed player cannot fight or be fought', () => {
  const justice = empty();
  assert.equal(fightBlock(justice, NOW, 'ada', 'bola'), null);
  assert.equal(fightBlock(justice, NOW, 'ada', 'ada')?.code, 'self');
  recordFight(justice, NOW, 'o1', ada, bola, 'lagos', 'market', true);
  assert.equal(fightBlock(justice, NOW + MIN, 'ada', 'chi')?.code, 'fight_cooldown', 'any fight');
  assert.equal(fightBlock(justice, NOW + JUSTICE.cooldownMs + 1, 'ada', 'bola')?.code, 'pair_cooldown', 'the same pair');
  assert.equal(fightBlock(justice, NOW + JUSTICE.cooldownMs + 1, 'ada', 'chi'), null);
  assert.equal(fightBlock(justice, NOW + JUSTICE.pairCooldownMs + 1, 'ada', 'bola'), null);
  jail(justice, NOW + MIN, justice.offences.o1!, chi, 'city', 'city:lagos', 10);
  assert.equal(fightBlock(justice, NOW + MIN * 2, 'chi', 'ada')?.code, 'target_jailed');
  assert.equal(fightBlock(justice, NOW + MIN * 2, 'ada', 'bola')?.code, 'jailed');
});

test('the fitter fighter usually wins; the attacker takes a tie', () => {
  assert.equal(attackerWins(80, 20, [0, 1]), true); assert.equal(attackerWins(20, 80, [1, 0]), false);
  assert.equal(attackerWins(50, 50, [0.5, 0.5]), true);
  assert.equal(attackerWins(50, 50, [0, 0.01]), false);
});

test('an offence is recorded, expires, and old records are dropped', () => {
  const justice = empty();
  const offence = recordFight(justice, NOW, 'o1', ada, bola, 'lagos', 'market', false);
  assert.deepEqual([offence.kind, offence.status, offence.won, offence.by.id, offence.against.id], ['assault', 'open', false, 'ada', 'bola']);
  assert.equal(arrestBlock(justice, NOW + MIN, 'chi', offence), null);
  assert.equal(arrestBlock(justice, NOW + JUSTICE.offenceMs + 1, 'chi', offence)?.code, 'offence_old');
  assert.equal(arrestBlock(justice, NOW, 'ada', offence)?.code, 'self');
  assert.equal(arrestBlock(justice, NOW, 'chi', undefined)?.code, 'no_such_offence');
  recordFight(justice, NOW + 2 * 86400000, 'o2', chi, bola, 'lagos', 'market', true);
  assert.deepEqual(Object.keys(justice.offences), ['o2'], 'a day-old offence is dropped when the next is written');
});

test('a sentence is the lever’s minutes, never above the constitution’s longest, and ends by itself', () => {
  const justice = empty();
  const offence = recordFight(justice, NOW, 'o1', ada, bola, 'lagos', 'market', true);
  const sentence = jail(justice, NOW, offence, chi, 'state', 'state:lagos', 9999);
  assert.equal(sentence.minutes, JUSTICE.sentenceMaxMin);
  assert.equal(offence.status, 'arrested');
  assert.equal(arrestBlock(justice, NOW, 'chi', offence)?.code, 'no_such_offence', 'an offence is acted on once');
  assert.equal(jailOf(justice, 'ada', NOW + MIN)?.by.id, 'chi');
  assert.equal(jailOf(justice, 'ada', NOW + JUSTICE.sentenceMaxMin * MIN + 1), null);
  const second = recordFight(justice, NOW + MIN, 'o2', ada, bola, 'lagos', 'market', true);
  assert.equal(arrestBlock(justice, NOW + MIN, 'chi', second)?.code, 'already_jailed');
  assert.equal(jail(empty(), NOW, offence, chi, 'city', 'city:lagos', 0).minutes, 1, 'at least a minute');
  assert.equal(timeLeft(NOW + 12 * MIN, NOW), '12 minutes'); assert.equal(timeLeft(NOW + 90 * MIN, NOW), '1 h 30 min'); assert.equal(timeLeft(NOW + 1000, NOW), '1 minute');
});

test('an officer lasts only as long as the officeholder who enrolled them sits in the term they enrolled in', () => {
  const justice = empty();
  justice.police.chi = { scope: 'city:lagos', tier: 'city', week: 5, by: ada, name: 'Chi', at: NOW };
  justice.police.dayo = { scope: 'state:lagos', tier: 'state', week: 5, by: ada, name: 'Dayo', at: NOW };
  assert.equal(policeIsValid(justice.police.chi, { id: 'ada', week: 5 }), true);
  assert.equal(policeIsValid(justice.police.chi, { id: 'ada', week: 6 }), false, 'a new term');
  assert.equal(policeIsValid(justice.police.chi, { id: 'bola', week: 5 }), false, 'another officeholder');
  assert.equal(policeIsValid(justice.police.chi, null), false, 'an empty seat');
  assert.equal(policeIsValid(undefined, { id: 'ada', week: 5 }), false);
  assert.deepEqual(officersOf(justice, 'city:lagos', { id: 'ada', week: 5 }).map(([id]) => id), ['chi']);
  assert.deepEqual(officersOf(justice, 'city:lagos', { id: 'ada', week: 6 }), []);
});

test('police act where their seat does', () => {
  assert.equal(inJurisdiction('city', 'city:lagos', 'lagos', ['city:lagos', 'state:lagos']), true);
  assert.equal(inJurisdiction('city', 'city:lagos', 'ibadan', ['city:ibadan', 'state:oyo']), false);
  assert.equal(inJurisdiction('state', 'state:lagos', 'ikorodu', ['city:ikorodu', 'state:lagos']), true);
  assert.equal(inJurisdiction('state', 'state:lagos', 'ibadan', ['city:ibadan', 'state:oyo']), false);
  assert.equal(inJurisdiction('nation', 'nation:ng', 'anywhere', []), true);
});

import { appealBlock, applyRuling, bailOf, escalate, escalateBlock, fileAppeal, judgesOf, nextTier, ruleBlock } from './justice.ts';

/** An arrested player with an open case before a city court. */
function arrested() {
  const justice = empty();
  const offence = recordFight(justice, NOW, 'o1', ada, bola, 'lagos', 'park', true);
  const sentence = jail(justice, NOW, offence, chi, 'city', 'city:lagos', 20);
  return { justice, offence, sentence };
}
const judge = { scope: 'city:lagos', tier: 'city' as const, week: 5, by: { id: 'mayor', name: 'Mayor' }, name: 'Judy', at: NOW };

test('an appeal needs a sentence being served and is made once', () => {
  const justice = empty();
  assert.equal(appealBlock(justice, NOW, 'ada')?.code, 'not_jailed');
  const { justice: held, sentence } = arrested();
  assert.equal(appealBlock(held, NOW + MIN, 'ada'), null);
  const found = fileAppeal(held, NOW + MIN, ada, sentence, 'lagos', 'I was defending myself', null);
  assert.deepEqual([found.id, found.tier, found.scope, found.status, found.officer.id, found.city], ['o1', 'city', 'city:lagos', 'open', 'chi', 'lagos']);
  assert.equal(appealBlock(held, NOW + MIN, 'ada')?.code, 'already_appealed');
  assert.equal(appealBlock(held, NOW + 21 * MIN, 'ada')?.code, 'not_jailed', 'a served sentence has nothing left to appeal');
  const old = { ...sentence }; delete old.scope;
  held.jail.ada = old;
  assert.equal(appealBlock({ ...held, cases: {} }, NOW + MIN, 'ada')?.code, 'no_court', 'a sentence from before courts cannot be appealed');
});

test('a judge rules on a case of their own court, and never on one they are part of', () => {
  const { justice, sentence } = arrested();
  const found = fileAppeal(justice, NOW, ada, sentence, 'lagos', 'Not me', { id: 'lex', name: 'Lex' });
  const sitting = { id: 'mayor', week: 5 };
  assert.equal(ruleBlock(found, 'judy', sitting, judge), null);
  assert.equal(ruleBlock(found, 'judy', sitting, { ...judge, scope: 'state:lagos' })?.code, 'not_judge', 'another court');
  assert.equal(ruleBlock(found, 'judy', { id: 'mayor', week: 6 }, judge)?.code, 'not_judge', 'a lapsed enrolment');
  assert.equal(ruleBlock(found, 'judy', sitting, undefined)?.code, 'not_judge');
  for (const party of ['ada', 'chi', 'lex']) assert.equal(ruleBlock(found, party, sitting, judge)?.code, 'conflict', party);
  assert.equal(ruleBlock(undefined, 'judy', sitting, judge)?.code, 'no_such_case');
  justice.judges.judy = judge;
  assert.deepEqual(judgesOf(justice, 'city:lagos', sitting).map(([id]) => id), ['judy']);
  assert.deepEqual(judgesOf(justice, 'city:lagos', { id: 'mayor', week: 6 }), []);
});

test('a ruling frees, halves or leaves the sentence, and closes the case', () => {
  for (const [verdict, expected] of [['quashed', null], ['reduced', 10], ['upheld', 20]] as const) {
    const { justice, sentence } = arrested();
    const found = fileAppeal(justice, NOW, ada, sentence, 'lagos', 'Not me', null);
    applyRuling(justice, NOW, found, { id: 'judy', name: 'Judy' }, verdict, 'Reasons given');
    assert.deepEqual([found.status, found.ruling?.verdict, found.ruling?.by.name], ['decided', verdict, 'Judy']);
    assert.equal(jailOf(justice, 'ada', NOW + 1)?.minutes ?? null, expected === null ? null : 20, verdict);
    assert.equal(expected === null ? jailOf(justice, 'ada', NOW + 1) : Math.round(((jailOf(justice, 'ada', NOW + 1)?.until ?? 0) - NOW) / MIN), expected, verdict);
    assert.equal(ruleBlock(found, 'judy', { id: 'mayor', week: 5 }, judge)?.code, 'no_such_case', 'one ruling per hearing');
  }
});

test('one appeal to the next court up, then the ruling is final', () => {
  assert.deepEqual([nextTier('city'), nextTier('state'), nextTier('nation')], ['state', 'nation', null]);
  const { justice, sentence } = arrested();
  assert.equal(escalateBlock(justice, NOW, 'ada')?.code, 'no_case');
  const found = fileAppeal(justice, NOW, ada, sentence, 'lagos', 'Not me', null);
  assert.equal(escalateBlock(justice, NOW, 'ada')?.code, 'not_decided');
  applyRuling(justice, NOW, found, { id: 'judy', name: 'Judy' }, 'upheld', 'It stands');
  assert.equal(escalateBlock(justice, NOW, 'ada'), null);
  escalate(found, 'state:lagos', 'state');
  assert.deepEqual([found.status, found.tier, found.scope, found.appeals, found.lower?.verdict, found.ruling], ['open', 'state', 'state:lagos', 1, 'upheld', undefined]);
  applyRuling(justice, NOW, found, { id: 'sam', name: 'Sam' }, 'upheld', 'Still stands');
  assert.equal(escalateBlock(justice, NOW, 'ada')?.code, 'appeal_used');
  const lonely = arrested();
  const top = fileAppeal(lonely.justice, NOW, ada, { ...lonely.sentence, tier: 'nation' }, 'lagos', 'x', null);
  applyRuling(lonely.justice, NOW, top, { id: 'sam', name: 'Sam' }, 'upheld', 'Final');
  assert.equal(escalateBlock(lonely.justice, NOW, 'ada')?.code, 'top_court');
});

test('bail is the lever’s whole naira, and zero means none', () => {
  assert.equal(bailOf(5000), 5000); for (const value of [0, -1, 2.5, NaN]) assert.equal(bailOf(value), 0, String(value));
});
