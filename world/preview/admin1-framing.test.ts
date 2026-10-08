import test from 'node:test';
import assert from 'node:assert/strict';
import { admin1AtlasFrame } from './admin1-framing.ts';
import { inventoryGeometryPath } from './inventory-view.ts';

test('atlas camera frames a small dateline feature locally without changing its holes', () => {
  const geometry = { type: 'Polygon' as const, coordinates: [[[179,10],[-179,10],[-179,12],[179,12],[179,10]],[[179.4,10.4],[-179.4,10.4],[-179.4,11.6],[179.4,11.6],[179.4,10.4]]] };
  const original = JSON.stringify(geometry), frame = admin1AtlasFrame(geometry);
  assert.equal(frame.wraps,true); const [x,y,w,h] = frame.viewBox.split(' ').map(Number);
  assert.ok(x! < 720 && x! + w! > 720); assert.ok(w! < 20 && h! < 10); assert.ok(y! < 158 && y! + h! > 160);
  assert.equal((inventoryGeometryPath(geometry,720,360,false,true).match(/ Z/g) ?? []).length,6);
  assert.equal(JSON.stringify(geometry),original);
});
test('atlas polar cap loop includes the pole and a full longitude span', () => {
  const frame = admin1AtlasFrame({type:'Polygon',coordinates:[[[-180,80],[-60,80],[60,80],[180,80],[-180,80]]]});
  assert.deepEqual(frame,{viewBox:'0 0 720 20',wraps:false});
});
test('atlas recognizes an explicit south-pole meridian ring even when longitude winding is zero', () => {
  const ring: number[][] = [
    [-120,-80],[-60,-80],[0,-80],[60,-80],[120,-80],[180,-80],
    [180,-90],[120,-90],[60,-90],[0,-90],[-60,-90],[-120,-90],[-180,-90],[-180,-80],[-120,-80],
  ];
  const geometry = { type: 'Polygon' as const, coordinates: [ring] };
  const original = JSON.stringify(geometry);
  const frame = admin1AtlasFrame(geometry);
  assert.deepEqual(frame, { viewBox: '0 340 720 20', wraps: false });
  const [, top, , height] = frame.viewBox.split(' ').map(Number);
  for (const coordinates of ring) {
    const longitude = coordinates[0]!, latitude = coordinates[1]!;
    const x = (longitude + 180) * 2, y = (90 - latitude) * 2;
    assert.ok(x >= 0 && x <= 720 && y >= top! && y <= top! + height!);
  }
  assert.equal(JSON.stringify(geometry), original);
});
test('atlas inland frame is local and refuses empty geometry', () => {
  const frame = admin1AtlasFrame({type:'Polygon',coordinates:[[[3,6],[4,6],[4,7],[3,7],[3,6]]]});
  assert.equal(frame.wraps,false); const [x,y,w,h] = frame.viewBox.split(' ').map(Number);
  assert.ok(x! < 366 && x! + w! > 368 && y! < 166 && y! + h! > 168);
  assert.throws(()=>admin1AtlasFrame({type:'Polygon',coordinates:[]}),/no coordinates/);
});
