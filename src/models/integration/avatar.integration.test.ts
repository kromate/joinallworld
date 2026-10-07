import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('the running game keeps its own avatars and atlas: neither loads the model library', async () => {
  // The library's people and geography are available to the workshop (models.html) and are tested in their own folders;
  // they are not wired into the game (docs/MODELS.md says what was adopted and why).
  for (const file of ['../../scene/characters.ts', '../../world-map.ts', '../../map3d/city-build.ts', '../../map3d/actor.ts', '../../map3d/map3d.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from '[^']*models\//, `${file} imports nothing from src/models`);
  }
  // The one integration point: the city view fetches the trip vehicles after its own pack, never in the startup chunk, and falls back to its own vehicle if the library fails to load.
  const index = await readFile(new URL('../../map3d/index.ts', import.meta.url), 'utf8');
  assert.match(index, /import\('\.\.\/models\/integration\/scene-models\.ts'\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(index, /^import .*models\//m, 'the city view imports the library lazily only');
  assert.doesNotMatch(index, /modelFlags/);
});
