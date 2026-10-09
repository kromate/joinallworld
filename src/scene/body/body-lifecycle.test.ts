import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedBodyLifecycle, PLAYER_BODY_POSES } from './body-lifecycle.ts';

test('creator venue and home request the same complete player lifecycle', () => {
  for (const scene of ['creator', 'venue', 'home'] as const) {
    assert.equal(requestedBodyLifecycle({scene, poses: ['idle', 'walk']}), PLAYER_BODY_POSES);
    assert.equal(requestedBodyLifecycle({scene, role: 'player', poses: ['idle']}), PLAYER_BODY_POSES);
  }
  assert.equal(new Set(PLAYER_BODY_POSES).size, 15);
});

test('an NPC keeps its host requested poses without being mistaken for the player', () => {
  const npcPoses = ['idle', 'walk', 'interact'] as const;
  assert.equal(requestedBodyLifecycle({scene: 'venue', role: 'npc', poses: npcPoses}), npcPoses);
});
