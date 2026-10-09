import test from 'node:test';
import assert from 'node:assert/strict';
import { separateTags } from './tag-layout.ts';

const npc = { jawWidth: 56, jawHeight: 20 }, table = { jawWidth: 180, jawHeight: 19 };
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, aw: number, ah: number, bw: number, bh: number) =>
  Math.abs(a.x - b.x) < (aw + bw) / 2 && a.y > b.y - bh && a.y - ah < b.y;

test('an NPC and table sharing a projected hit area remain separately clickable', () => {
  // Actual park marker was centered at (555,126), under the nearby Penalties label.
  const tags = [{ x: 555, y: 126, visible: true }, { x: 585, y: 122, visible: true }];
  separateTags(tags, [npc, table], 1440, 80, 700);
  assert.deepEqual(tags[0], { x: 555, y: 126, visible: true });
  assert.equal(overlap(tags[0]!, tags[1]!, 56, 20, 180, 19), false);
  assert.ok(tags[1]!.y < 122);
});

test('labels near the HUD move below each other rather than under the HUD', () => {
  const tags = [{ x: 180, y: 114, visible: true }, { x: 180, y: 112, visible: true }];
  separateTags(tags, [npc, table], 360, 90, 650);
  assert.equal(overlap(tags[0]!, tags[1]!, 56, 20, 180, 19), false);
  assert.ok(tags.every((tag, i) => tag.y - [npc, table][i]!.jawHeight >= 90 && tag.y <= 650));
  assert.ok(tags[1]!.y > tags[0]!.y);
});

test('a dense phone crowd stays within the scene, ignores hidden tags, and repeats deterministically', () => {
  const make = () => Array.from({ length: 15 }, (_, i) => ({ x: i % 2 ? 176 : 183, y: 480, visible: i !== 1 }));
  const tags = make(), sizes = tags.map(() => npc);
  separateTags(tags, sizes, 360, 100, 660);
  for (let i = 0; i < tags.length; i++) {
    if (!tags[i]!.visible) continue;
    assert.ok(tags[i]!.y >= 120 && tags[i]!.y <= 660);
    for (let j = 0; j < i; j++) if (tags[j]!.visible) assert.equal(overlap(tags[i]!, tags[j]!, 56, 20, 56, 20), false, `${i}/${j}`);
  }
  assert.deepEqual(tags[1], make()[1]);
  const repeated = make(); separateTags(repeated, sizes, 360, 100, 660); assert.deepEqual(repeated, tags);
});

test('isolated labels keep their projection and edge labels remain entirely on screen', () => {
  const tags = [{ x: 150, y: 300, visible: true }, { x: 359, y: 500, visible: true }, { x: 1, y: 500, visible: true }];
  separateTags(tags, [npc, table, table], 360, 80, 700);
  assert.deepEqual(tags[0], { x: 150, y: 300, visible: true });
  assert.equal(tags[1]!.x, 270); assert.equal(tags[2]!.x, 90);
});
