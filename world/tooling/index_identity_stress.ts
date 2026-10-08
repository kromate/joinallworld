// Synthetic near-byte-cap input. No cache, index, campaign, game or network access.
import assert from 'node:assert/strict';
import { parseCaptureJson } from '../capture-json.ts';
import { identifySourceFeature } from '../feature-identity.ts';
import { sha256 } from '../pack.ts';

const began = performance.now();
const binding = { provider: 'overture', release: '2026-09-23.1', layers: ['buildings'] } as const;
// Literal ASCII prefix/suffix allows a separate complete canonical body hash vector.
const prefix = '{"geometry":{"coordinates":[[[0,0],[1,0],[1,1],[0,0]]],"type":"Polygon"},"id":"stress-v1","properties":{"building":true,"payload":"';
const suffix = '","sourceLayer":"buildings"},"type":"Feature"}';
const length = 19_000_000;
const bodyBytes = Buffer.concat([Buffer.from(prefix), Buffer.alloc(length, 0x78), Buffer.from(suffix)]);
assert.ok(bodyBytes.byteLength < 20_000_000);
const expectedBodyHash = sha256(bodyBytes);
const parsed = parseCaptureJson(bodyBytes);
const result = identifySourceFeature(parsed, binding);
assert.ok(result.status === 'admitted');
assert.equal(result.bodyHash, expectedBodyHash);
assert.equal(result.bodyBytes, bodyBytes.byteLength);
assert.equal(result.positions, 4);
assert.equal(result.ownerCellId, 'geo-grid-v1:l1:x360:y180');
// Actual over-cap input must fail before decoding/traversing it.
assert.throws(() => parseCaptureJson(Buffer.alloc(20_000_001, 0x20)), /bound|limit|bytes/i);
console.log(JSON.stringify({ scope: 'synthetic near-byte-cap feature, not worst-case capture/index proof',
  inputBytes: bodyBytes.byteLength, bodyHash: result.bodyHash, bodyBytes: result.bodyBytes,
  status: result.status, positions: result.positions, overCapRejected: true,
  elapsedMs: performance.now() - began, maximumRssKiB: process.resourceUsage().maxRSS,
  nodeVersion: process.version, networkBytes: 0 }));
