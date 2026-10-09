import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { auditPolygonAreaM2, clipAuditPolygon, neckDomainEligibleRegions } from './domain-audit.ts';

test('independent halfspace clip partitions a source triangle without losing area', () => {
  const triangle = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
  const plane = { name: 'neck' as const, normal: [1, 0, 0] as const, offset: -0.5, keep: 'positive' as const };
  const kept = clipAuditPolygon(triangle, plane, true);
  const excluded = clipAuditPolygon(triangle, plane, false);
  assert.equal(auditPolygonAreaM2(triangle), 0.5);
  assert.ok(Math.abs(auditPolygonAreaM2(kept) - 0.125) < 1e-12);
  assert.ok(Math.abs(auditPolygonAreaM2(excluded) - 0.375) < 1e-12);
  assert.ok(Math.abs(auditPolygonAreaM2(kept) + auditPolygonAreaM2(excluded) - 0.5) < 1e-12);
});

test('declared garment domain excludes mixed arm/torso corner cells', () => {
  assert.equal(neckDomainEligibleRegions(['torso', 'torso', 'neck']), true);
  assert.equal(neckDomainEligibleRegions(['torso', 'upperarms', 'torso']), false);
  assert.equal(neckDomainEligibleRegions(['neck', null, 'torso']), false);
});
