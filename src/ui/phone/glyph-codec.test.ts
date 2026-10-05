import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GLYPHS } from './icons-source.ts';
import { GLYPH_DATA, GLYPH_CODES } from './icons-packed.ts';
import { unpackGlyphText } from './glyph-codec.ts';
import { glyph, hasGlyph } from './icons.ts';
import { glyphJson, packGlyphText } from '../../../scripts/glyph-packing.ts';

test('all 125 initial SVG glyphs are byte-identical to the original editable artwork', () => {
  const decoded: unknown = JSON.parse(unpackGlyphText(GLYPH_DATA, GLYPH_CODES));
  assert.deepEqual(decoded, GLYPHS);
  assert.equal(Object.keys(GLYPHS).length, 125);
  const canonical = JSON.stringify(Object.entries(GLYPHS).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  assert.equal(createHash('sha256').update(canonical).digest('hex'), 'ab2520f95a2ff979f36a7621ac91b78e3d91a76acfad90f3e41d2d3a282a5965');
  for (const [name, artwork] of Object.entries(GLYPHS)) {
    assert.equal(hasGlyph(name), true);
    const svg = glyph(name);
    assert.equal(svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')), artwork, name);
  }
});

test('the checked-in glyph payload regenerates deterministically without writing', () => {
  assert.deepEqual(packGlyphText(glyphJson(GLYPHS)), { data: GLYPH_DATA, count: GLYPH_CODES });
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/build-glyphs.ts', '--check'], { stdio: 'pipe' });
});

test('fixed-width decode handles byte boundaries, odd padding and the next-dictionary-code case', () => {
  const data = Buffer.from([0x04, 0x10, 0x42, 0x10, 0x01, 0x02]).toString('base64');
  assert.equal(unpackGlyphText(data, 4), 'ABABABA');
  assert.equal(unpackGlyphText(Buffer.from([0x04, 0x10, 0x42, 0x10, 0x00]).toString('base64'), 3), 'ABAB');
  for (const text of ['', 'A', 'AAAAAA', 'banana bandana banana']) {
    const packed = packGlyphText(text);
    assert.equal(unpackGlyphText(packed.data, packed.count), text);
  }
});

test('the dictionary saturates safely and resets independently on the next decode', () => {
  let seed = 12345, text = '';
  for (let i = 0; i < 80000; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += String.fromCharCode(32 + ((seed >>> 16) % 95)); }
  const packed = packGlyphText(text);
  assert.ok(packed.count > 4096);
  assert.equal(unpackGlyphText(packed.data, packed.count), text);
  const next = packGlyphText('ABABABA');
  assert.equal(unpackGlyphText(next.data, next.count), 'ABABABA');
  const unicode = { label: '<text>Ẹ káàbọ̀ 🌍</text>' }, encoded = packGlyphText(glyphJson(unicode));
  assert.deepEqual(JSON.parse(unpackGlyphText(encoded.data, encoded.count)), unicode);
});

test('truncated or invalid encoded data fails explicitly', () => {
  assert.throws(() => unpackGlyphText('BA==', 1), /Truncated/);
  assert.throws(() => unpackGlyphText(Buffer.from([0x10, 0x00]).toString('base64'), 1), /first glyph code/);
  assert.throws(() => unpackGlyphText(Buffer.from([0x04, 0x1f, 0xff]).toString('base64'), 2), /dictionary code/);
  for (const count of [-1, 0.5, NaN]) assert.throws(() => unpackGlyphText('', count), /code count/);
});
