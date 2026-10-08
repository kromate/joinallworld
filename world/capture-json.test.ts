import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTURE_JSON_LIMITS, parseCaptureJson } from './capture-json.ts';
import type { CaptureJsonLimits } from './capture-json.ts';
import { identifySourceFeature } from './feature-identity.ts';

const encoded = (value: string) => new TextEncoder().encode(value);
const parse = (value: string) => parseCaptureJson(encoded(value));

test('strict capture parsing matches native JSON for valid source values without changing the byte snapshot', () => {
  const samples: unknown[] = [null, true, false, -0, 1e-7, 1e21, -1.25, '', 'é😀', '\ud800', [], {},
    { features: [{ type: 'Feature', id: 'exact-id', properties: { sourceLayer: 'buildings', sources: ['a', 'b'] },
      geometry: { type: 'Polygon', coordinates: [[[0, 0, 9], [1, 0, 9], [1, 1, 9], [0, 0, 9]]] } }] },
    { '2': 2, '0': 0, 'nul\u0000key': [true, null, false], escaped: '\\"\b\f\n\r\t' }];
  for (const sample of samples) {
    const text = JSON.stringify(sample), bytes = encoded(text), before = bytes.slice();
    assert.deepEqual(parseCaptureJson(bytes), JSON.parse(text));
    assert.deepEqual(bytes, before);
  }
  assert.ok(Object.is(parse('-0'), -0));
  assert.deepEqual(parse(' \r\n\t { "id" : "a" , "items" : [ 1 , 2 ] } '), { id: 'a', items: [1, 2] });
});

test('duplicate decoded keys fail rather than silently overwriting complete source content', () => {
  for (const text of ['{"id":"a","id":"b"}', '{"id":"a","\\u0069d":"a"}',
    '{"feature":{"height":4,"height":7}}', '{"features":[{"sources":[],"sources":["other"]}]}',
    '{"é":1,"\\u00e9":2}', '{"😀":1,"\\ud83d\\ude00":2}']) {
    assert.throws(() => parse(text), /duplicate decoded/);
  }
  assert.deepEqual(parse('{"a":{"id":1},"b":{"id":2}}'), { a: { id: 1 }, b: { id: 2 } });
});

test('dangerous prototype spelling is preserved as source data and rejected by feature admission', () => {
  const result = parse('{"type":"Feature","id":"a","properties":{"building":true,"sourceLayer":"buildings","__proto__":{"polluted":true}},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}') as Record<string, unknown>;
  const properties = result.properties as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(properties), Object.prototype);
  assert.ok(Object.hasOwn(properties, '__proto__'));
  assert.deepEqual(properties.__proto__, { polluted: true });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const admitted = identifySourceFeature(result, { provider: 'overture', release: '2026-09-23.1', layers: ['buildings'] });
  assert.deepEqual(admitted.status, 'exception');
  if (admitted.status === 'exception') assert.equal(admitted.code, 'unsupported-json-tree');
});

test('invalid syntax, nonfinite numbers and non-JSON whitespace cannot manufacture a capture', () => {
  const samples = ['', '{', '[', '01', '+1', '.5', '1.', '1e', 'NaN', 'Infinity', '1e9999',
    'true false', 'nullx', '{"id":1,}', '[1,]', '[,1]', '{id:1}', '{"id" 1}',
    '"unterminated', '"bad\\x20"', '"raw\nnewline"', '\u00a0null', '\ufeffnull'];
  for (const text of samples) assert.throws(() => parse(text), { name: 'SyntaxError' });
});

test('invalid UTF8 bytes are rejected without replacement characters', () => {
  for (const bytes of [[0x22, 0xc0, 0xaf, 0x22], [0x22, 0xed, 0xa0, 0x80, 0x22], [0x22, 0xc3, 0x22]]) {
    assert.throws(() => parseCaptureJson(new Uint8Array(bytes)), { name: 'TypeError' });
  }
});

test('caller byte/node/depth bounds can only reduce hard limits', () => {
  assert.throws(() => parseCaptureJson(encoded('[1,2]'), { nodes: 2 }), /node or depth/);
  assert.deepEqual(parseCaptureJson(encoded('[1,2]'), { nodes: 3 }), [1, 2]);
  assert.throws(() => parseCaptureJson(encoded('[[[0]]]'), { depth: 2 }), /node or depth/);
  assert.throws(() => parseCaptureJson(encoded('"ninebytes"'), { bytes: 8 }), /byte limit/);
  for (const limits of [{ bytes: CAPTURE_JSON_LIMITS.bytes + 1 }, { nodes: NaN }, { depth: 0 }, { depth: 1.5 }]) {
    assert.throws(() => parseCaptureJson(encoded('null'), limits), { name: 'RangeError' });
  }
  assert.throws(() => parseCaptureJson(new Uint8Array(new SharedArrayBuffer(4))), /unshared/);
  assert.throws(() => parseCaptureJson(encoded('null'), { toString: 7 } as unknown as Partial<CaptureJsonLimits>), /Unknown/);
});
