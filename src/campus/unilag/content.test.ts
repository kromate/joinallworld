import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS } from './layout.ts';
import { CAMPUS_NPCS, DISCOVERY_TRAIL, shareLabel, UI_LINKS, UNILAG_VENUE } from './content.ts';

const NEEDS = new Set(['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']);
const SKILLS = new Set(['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography']);

test('UNILAG content covers every finalized layout anchor', () => {
  assert.equal(UNILAG_VENUE.id, 'unilag');
  assert.deepEqual(Object.keys(UNILAG_VENUE.spots).sort(), Object.keys(ANCHORS).sort());
  for (const [id, item] of Object.entries(UNILAG_VENUE.spots)) {
    assert.equal(item.id, id);
    assert.ok(item.label && item.caption);
    assert.ok(Array.isArray(item.activities));
  }
});

test('campus activities use supported skills and needs with finite beta numbers', () => {
  for (const spot of Object.values(UNILAG_VENUE.spots)) for (const def of spot.activities) {
    for (const value of [def.duration, def.cost, def.cooldown].filter((value): value is number => value !== undefined)) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= 0);
    }
    for (const [need, value] of Object.entries(def.effects ?? {})) {
      assert.ok(NEEDS.has(need), `${def.id}: unsupported need ${need}`);
      assert.ok(Number.isFinite(value));
    }
    for (const [skill, value] of Object.entries(def.xp ?? {})) {
      assert.ok(SKILLS.has(skill), `${def.id}: unsupported skill ${skill}`);
      assert.ok(Number.isFinite(value) && value >= 0);
    }
    assert.equal(def.reward, undefined, `${def.id}: campus content must not add rewards`);
  }
});

test('NPCs and discovery trail point at real campus spots', () => {
  assert.ok(Object.keys(CAMPUS_NPCS).length >= 8);
  for (const npc of Object.values(CAMPUS_NPCS)) {
    assert.equal(npc.venue, 'unilag');
    assert.ok(UNILAG_VENUE.spots[npc.at], `${npc.id}: orphan spot ${npc.at}`);
    assert.ok(npc.name && npc.role && npc.quotes.length);
  }
  assert.equal(DISCOVERY_TRAIL.length, 8);
  for (const trail of DISCOVERY_TRAIL) assert.ok(UNILAG_VENUE.spots[trail.spot], `${trail.id}: orphan trail spot`);
  assert.equal(UI_LINKS.bank.target, 'phone://bank');
  assert.equal(shareLabel(DISCOVERY_TRAIL[0]), 'Share Enter through Main Gate');
});

