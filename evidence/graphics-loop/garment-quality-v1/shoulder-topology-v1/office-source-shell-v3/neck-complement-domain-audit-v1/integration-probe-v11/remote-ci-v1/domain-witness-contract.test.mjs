import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDomainWitness } from './domain-witness-contract.mjs';

const summary = { domainMatchesActualCandidate: true, excludedResidualFaces: 136 };
const details = { domainMatchesActualCandidate: true, excludedFullNeckResidualFaceIds: Array.from({ length: 136 }, (_, index) => index + 100) };

test('display-state captures accept the compact summary after pose probes certified full detail', () => {
  assert.equal(assertDomainWitness(summary, undefined, false), true);
});

test('pose-witness snapshots require and validate full independent face detail', () => {
  assert.equal(assertDomainWitness(summary, details, true), true);
  assert.throws(() => assertDomainWitness(summary, undefined, true), /Full independent neck-domain witness is required/);
});

test('full details cannot silently disagree with the compact summary', () => {
  assert.throws(() => assertDomainWitness(summary, { ...details, excludedFullNeckResidualFaceIds: [1] }, false), /disagrees with its summary/);
  assert.throws(() => assertDomainWitness({ ...summary, domainMatchesActualCandidate: false }, details, true), /summary is missing or inconsistent/);
});
