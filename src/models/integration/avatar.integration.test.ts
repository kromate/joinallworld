import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelFlags, modelLibraryEnabled, MODEL_FLAGS } from './flags.ts';

test('every model-library integration is OFF by default; ?models=vehicles switches the trip vehicles on and nothing else', () => {
  assert.deepEqual(MODEL_FLAGS, ['vehicles', 'moments']);
  assert.deepEqual(modelFlags(''), { vehicles: false, moments: false });
  assert.equal(modelLibraryEnabled(''), false);
  assert.equal(modelLibraryEnabled('?models=legacy'), false);
  assert.equal(modelLibraryEnabled('?models=library'), false, 'an unknown name switches nothing on');
  assert.equal(modelLibraryEnabled('?models=vehicles'), true);
  assert.deepEqual(modelFlags('?venue=park&models=avatars,vehicles'), { vehicles: true, moments: false });
  assert.deepEqual(modelFlags('?models=moments'), { vehicles: false, moments: true });
  assert.equal(modelLibraryEnabled('?models=moments'), false, 'the moments flag does not switch the trip vehicles on');
});

test('the running game keeps its own avatars and atlas: neither loads the model library', async () => {
  // The library's people and geography are available to the workshop (models.html) and are tested in their own folders;
  // they are not wired into the game (docs/MODELS.md says what was adopted and why).
  for (const file of ['../../scene/characters.ts', '../../world-map.ts', '../../map3d/city-build.ts', '../../map3d/actor.ts', '../../map3d/map3d.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from '[^']*models\//, `${file} imports nothing from src/models`);
  }
  // The one integration point: the city view fetches the trip vehicles only when the flag is on.
  const index = await readFile(new URL('../../map3d/index.ts', import.meta.url), 'utf8');
  assert.match(index, /modelFlags\(\)\.vehicles \? \(await import\('\.\.\/models\/integration\/scene-models\.ts'\)/);
});
