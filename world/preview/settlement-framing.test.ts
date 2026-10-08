import test from 'node:test';
import assert from 'node:assert/strict';
import { planSettlementMarkers, projectSettlementPoint } from './settlement-framing.ts';
import type { SettlementPointRecord } from '../settlement-product-types.ts';

function point(sourceOrdinal: number, longitude: number, latitude = 0, scaleRank = 5): SettlementPointRecord {
  return {
    sourceOrdinal,
    sourceKey: `NE_ID:${String(sourceOrdinal + 1).padStart(6, '0')}`,
    id: `settlement:${sourceOrdinal + 1}`,
    name: `Place ${sourceOrdinal + 1}`,
    nameAscii: `Place ${sourceOrdinal + 1}`,
    sourceClass: 'city',
    scaleRank,
    coordinates: [longitude, latitude],
  };
}

test('uses the longitude/latitude SVG convention and explicit wrap projection at poles', () => {
  assert.deepEqual(projectSettlementPoint(point(0, -180, 90), false), { x: 0, y: 0 });
  assert.deepEqual(projectSettlementPoint(point(1, 180, -90), false), { x: 720, y: 360 });
  assert.deepEqual(projectSettlementPoint(point(2, -179, 12), true), { x: 722, y: 156 });
  assert.deepEqual(projectSettlementPoint(point(3, -179, 12), false), { x: 2, y: 156 });
});

test('marker planning includes frame boundaries and preserves the selected point before rank order', () => {
  const rows = [point(0, 0, 0, 0), point(1, 1, 0, 9), point(2, 2, 0, 1), point(3, 40, 0, 0)];
  const before = JSON.stringify(rows);
  const plan = planSettlementMarkers(rows, { viewBox: '360 180 4 4', wraps: false }, 'settlement:2');
  assert.deepEqual(plan.markers.map(marker => marker.point.id), ['settlement:2', 'settlement:1', 'settlement:3']);
  assert.deepEqual(plan.markers.map(marker => [marker.x, marker.y]), [[362, 180], [360, 180], [364, 180]]);
  assert.deepEqual({ eligible: plan.eligible, outside: plan.outsideView, deferred: plan.deferred }, { eligible: 3, outside: 1, deferred: 0 });
  assert.equal(JSON.stringify(rows), before);
});

test('bounds visible marker count at 256 and reports every deferred and off-frame point', () => {
  const rows = Array.from({ length: 300 }, (_, index) => point(index, 0, 0, index % 11));
  rows.push(point(300, 120, 0));
  const plan = planSettlementMarkers(rows, { viewBox: '359 179 2 2', wraps: false }, 'settlement:300');
  assert.equal(plan.markers.length, 256);
  assert.equal(plan.markers[0]?.point.id, 'settlement:300');
  assert.equal(plan.eligible, 300);
  assert.equal(plan.outsideView, 1);
  assert.equal(plan.deferred, 44);
  assert.equal(plan.eligible, plan.markers.length + plan.deferred);
});

test('rank and source key ordering is deterministic independent of input order', () => {
  const rows = [point(8, 0, 0, 3), point(6, 0, 0, 1), point(2, 0, 0, 1)];
  const first = planSettlementMarkers(rows, { viewBox: '360 180 1 1', wraps: false });
  const second = planSettlementMarkers([...rows].reverse(), { viewBox: '360 180 1 1', wraps: false });
  assert.deepEqual(first.markers.map(marker => marker.point.sourceKey), ['NE_ID:000003', 'NE_ID:000007', 'NE_ID:000009']);
  assert.deepEqual(second.markers.map(marker => marker.point.sourceKey), first.markers.map(marker => marker.point.sourceKey));
});

test('rejects malformed coordinates, duplicate identities, ranks, and invalid viewboxes', () => {
  assert.throws(() => projectSettlementPoint(point(0, Number.NaN), false), /WGS84/);
  assert.throws(() => projectSettlementPoint(point(0, 181), false), /WGS84/);
  assert.throws(() => projectSettlementPoint(point(0, 0, -91), false), /WGS84/);
  assert.throws(() => planSettlementMarkers([point(0, 0)], { viewBox: '0 0 0 1', wraps: false }), /positive size/);
  assert.throws(() => planSettlementMarkers([point(0, 0)], { viewBox: '0 0 Infinity 1', wraps: false }), /finite/);
  assert.throws(() => planSettlementMarkers([point(0, 0)], { viewBox: '0 0 1', wraps: false }), /four numbers/);
  const duplicated = [point(0, 0), point(1, 0)];
  duplicated[1]!.id = duplicated[0]!.id;
  assert.throws(() => planSettlementMarkers(duplicated, { viewBox: '0 0 720 360', wraps: false }), /unique/);
  assert.throws(() => planSettlementMarkers([point(0, 0, 0, 11)], { viewBox: '0 0 720 360', wraps: false }), /scale rank/);
});
