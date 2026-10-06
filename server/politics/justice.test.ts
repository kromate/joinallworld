// OWNER: politics — the pure justice rules: fights, offences, police and jail (docs/POLITICS.md section 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JUSTICE } from '../../src/game/content/politics.ts';
import type { JusticeRecord } from '../../src/types/politics.ts';
import { arrestBlock, attackerWins, fightBlock, inJurisdiction, jail, jailOf, officersOf, policeIsValid, recordFight, timeLeft } from './justice.ts';

const NOW = 1_800_000_000_000, MIN = 60000;
const empty = (): JusticeRecord => ({ offences: {}, jail: {}, police: {}, fights: {}, pairs: {} });
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
  jail(justice, NOW + MIN, justice.offences.o1!, chi, 'city', 10);
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
  const sentence = jail(justice, NOW, offence, chi, 'state', 9999);
  assert.equal(sentence.minutes, JUSTICE.sentenceMaxMin);
  assert.equal(offence.status, 'arrested');
  assert.equal(arrestBlock(justice, NOW, 'chi', offence)?.code, 'no_such_offence', 'an offence is acted on once');
  assert.equal(jailOf(justice, 'ada', NOW + MIN)?.by.id, 'chi');
  assert.equal(jailOf(justice, 'ada', NOW + JUSTICE.sentenceMaxMin * MIN + 1), null);
  const second = recordFight(justice, NOW + MIN, 'o2', ada, bola, 'lagos', 'market', true);
  assert.equal(arrestBlock(justice, NOW + MIN, 'chi', second)?.code, 'already_jailed');
  assert.equal(jail(empty(), NOW, offence, chi, 'city', 0).minutes, 1, 'at least a minute');
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
