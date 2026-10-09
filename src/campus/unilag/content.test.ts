import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORS, UNMAPPED_LANDMARKS } from './layout.ts';
import { CAMPUS_NPCS, DISCOVERY_TRAIL, shareLabel, UI_LINKS, UNILAG_VENUE } from './content.ts';

const NEEDS = new Set(['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']);
const SKILLS = new Set(['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography']);

test('UNILAG content distinguishes mapped anchors, explicitly unmapped landmarks and the nonspatial people spot', () => {
  assert.equal(UNILAG_VENUE.id, 'unilag');
  const spotIds = new Set(Object.keys(UNILAG_VENUE.spots));
  const anchorIds = new Set(Object.keys(ANCHORS));
  const unmappedIds = new Set<string>(UNMAPPED_LANDMARKS);
  assert.equal(unmappedIds.size, UNMAPPED_LANDMARKS.length, 'unmapped landmark ids are unique');
  assert.ok(spotIds.has('people') && !anchorIds.has('people'), 'people is a general social spot, not a coordinate');
  for (const id of anchorIds) assert.ok(spotIds.has(id), `${id}: mapped anchor has matching venue content`);
  for (const id of unmappedIds) {
    assert.ok(spotIds.has(id), `${id}: unmapped landmark remains available as venue content`);
    assert.ok(!anchorIds.has(id), `${id}: no coordinate is invented while its map feature is unavailable`);
  }
  assert.deepEqual([...spotIds].filter((id) => !anchorIds.has(id) && id !== 'people').sort(), [...unmappedIds].sort(), 'every physical spot is either mapped or explicitly unmapped');
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
