import assert from 'node:assert/strict';

export const LEGACY_FIRST_FIVE = Object.freeze(['yaounde', 'lome', 'accra', 'nairobi', 'algiers']);
const BATCH_NAMES = Object.freeze(['first-five', 'second-four', 'addis-ababa', 'third-three', 'third-two']);
const KNOWN_BATCHES = Object.freeze([
  LEGACY_FIRST_FIVE,
  Object.freeze(['cotonou', 'abidjan', 'dakar', 'cape-town']),
  Object.freeze(['addis-ababa']),
  Object.freeze(['cairo', 'rabat', 'kigali']),
  Object.freeze(['kampala', 'lusaka']),
]);
export const LEGACY_SOURCE_SHA = '3af17a01b8bd406bfb830ca0d2ee66d2d0093d28';

export function selectAfricaBatches(exportedBatches, sourceSha, legacyFirstFive) {
  if (exportedBatches === undefined || exportedBatches === null) {
    assert.equal(sourceSha, LEGACY_SOURCE_SHA, `source ${sourceSha} does not export AFRICA_DESTINATION_BATCHES`);
    assert.deepEqual(legacyFirstFive, LEGACY_FIRST_FIVE, 'legacy source does not export the exact inspected first-five fixture');
    return Object.freeze([Object.freeze({ name: 'first-five', cities: LEGACY_FIRST_FIVE })]);
  }
  assert.ok(Array.isArray(exportedBatches), 'AFRICA_DESTINATION_BATCHES must be an array');
  assert.ok(exportedBatches.length === 3 || exportedBatches.length === 5,
    'Africa batch export must contain exactly the inspected three or five batches');
  const batches = exportedBatches.map((cities, index) => {
    assert.ok(Array.isArray(cities), `Africa batch ${index + 1} must be an array`);
    assert.ok(cities.length > 0, `Africa batch ${index + 1} cannot be empty`);
    for (const city of cities) assert.ok(typeof city === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city), `invalid city ID in Africa batch ${index + 1}`);
    return Object.freeze({ name: BATCH_NAMES[index], cities: Object.freeze([...cities]) });
  });
  const cities = batches.flatMap(batch => batch.cities);
  assert.equal(new Set(cities).size, cities.length, 'Africa batches contain duplicate city IDs');
  assert.deepEqual(batches.map(batch => [...batch.cities]), KNOWN_BATCHES.slice(0, batches.length),
    'Africa batches do not match the admitted destination cities and order');
  return Object.freeze(batches);
}

export function assertRegisteredAfricaCoverage(batches, registeredForeignCities) {
  assert.ok(Array.isArray(batches), 'selected Africa batches must be an array');
  assert.ok(Array.isArray(registeredForeignCities), 'registered foreign cities must be an array');
  const selected = batches.flatMap(batch => batch.cities);
  for (const cities of [selected, registeredForeignCities]) {
    assert.ok(cities.length > 0, 'foreign city coverage cannot be empty');
    assert.ok(cities.every(city => typeof city === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)),
      'foreign city coverage contains an invalid city ID');
    assert.equal(new Set(cities).size, cities.length, 'foreign city coverage contains duplicate IDs');
  }
  assert.deepEqual([...selected].sort(), [...registeredForeignCities].sort(),
    'sealed journey batches must cover exactly every registered foreign city');
}

export function citySceneAssets(files, cities) {
  assert.ok(files instanceof Map, 'package files must be a Map');
  assert.ok(Array.isArray(cities), 'selected cities must be an array');
  const selected = [];
  const byCity = {};
  for (const city of cities) {
    const cityEntries = {};
    for (const kind of ['map', 'geometry']) {
      const pattern = new RegExp(`^assets/assets/city-${city}-${kind}-[a-f0-9]{8}\\.js$`);
      const matches = [...files.values()].filter(entry => pattern.test(entry.path));
      assert.equal(matches.length, 1, `package must contain exactly one content-addressed ${kind} chunk for ${city}`);
      cityEntries[kind] = matches[0];
      selected.push(matches[0]);
    }
    byCity[city] = cityEntries;
  }
  return { entries: selected, byCity };
}

export function selectedAssets(files, cities) {
  const scene = citySceneAssets(files, cities);
  const html = files.get('assets/index.html');
  assert.ok(html, 'package manifest must include assets/index.html');
  return { entries: [html, ...scene.entries], byCity: scene.byCity };
}
