import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCountryDetailService } from './country-detail-data.ts';
import { countryOutlineSvg } from './country-detail.ts';
import {
  COUNTRY_DETAIL_CATALOGUE_PATH, COUNTRY_DETAIL_CATALOGUE_SHA256,
  COUNTRY_DETAIL_ATLAS_SHA256, COUNTRY_DETAIL_DIRECTORY_MANIFEST_SHA256,
  COUNTRY_DETAIL_SOURCE_SHA256, COUNTRY_DETAIL_SOURCE_BYTES,
} from './country-detail-pins.generated.ts';

test('every shipped country bundle passes the actual game adapter and bounded outline display', async () => {
  const requests: string[] = [];
  const service = createCountryDetailService({
    pins: {
      cataloguePath: COUNTRY_DETAIL_CATALOGUE_PATH,
      catalogueSha256: COUNTRY_DETAIL_CATALOGUE_SHA256,
      atlasSha256: COUNTRY_DETAIL_ATLAS_SHA256,
      directoryManifestSha256: COUNTRY_DETAIL_DIRECTORY_MANIFEST_SHA256,
      sourceSha256: COUNTRY_DETAIL_SOURCE_SHA256,
      sourceBytes: COUNTRY_DETAIL_SOURCE_BYTES,
    },
    fetcher: async (input, init) => {
      assert.equal(typeof input, 'string');
      assert.match(String(input), /^\/world-country-detail\/(?:catalogue-v1-)?[a-f0-9]{64}\.txt$/);
      assert.equal(init?.mode, 'same-origin');
      assert.equal(init?.redirect, 'manual');
      assert.equal(init?.credentials, 'omit');
      const path = String(input);
      requests.push(path);
      const filename = fileURLToPath(new URL(`../../../public${path}`, import.meta.url));
      const bytes = new Uint8Array(await readFile(filename));
      return new Response(bytes.buffer, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(bytes.byteLength) } });
    },
  });
  assert.equal(requests.length, 0, 'startup cannot fetch country data');
  const signal = new AbortController().signal;
  const catalogue = await service.catalogue(signal);
  assert.equal(catalogue.countries.length, 258);
  assert.equal(requests.length, 1);
  const nigeria = catalogue.countries.find(country => country.countryId === 'legacy-ng');
  assert.equal(nigeria?.status, 'protected');
  await assert.rejects(service.load('legacy-ng', signal), /Nigeria/);
  assert.equal(requests.length, 1, 'Nigeria must not download an outline');
  let positions = 0, countries = 0;
  for (const country of catalogue.countries) {
    if (country.status === 'protected') continue;
    assert.equal(country.status, 'mapped');
    const outline = await service.load(country.countryId, signal);
    assert.equal(outline.country.countryId, country.countryId);
    assert.ok(outline.attribution.length > 0 && outline.attribution.length <= 2048);
    assert.ok(outline.limitations.length <= 16);
    assert.ok(outline.limitations.every(note => note.length <= 2048));
    const display = countryOutlineSvg(outline);
    assert.ok(display.displayPositions > 2 && display.displayPositions <= 30_000);
    assert.ok(!/NaN|Infinity/.test(display.path));
    positions += display.sourcePositions;
    countries++;
  }
  assert.equal(countries, 257);
  assert.equal(positions, 546_699);
  assert.equal(requests.length, 258, 'only catalogue and explicitly requested country bundles were read');
});
