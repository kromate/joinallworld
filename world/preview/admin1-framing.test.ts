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
test('atlas inland frame is local and refuses empty geometry', () => {
  const frame = admin1AtlasFrame({type:'Polygon',coordinates:[[[3,6],[4,6],[4,7],[3,7],[3,6]]]});
  assert.equal(frame.wraps,false); const [x,y,w,h] = frame.viewBox.split(' ').map(Number);
  assert.ok(x! < 366 && x! + w! > 368 && y! < 166 && y! + h! > 168);
  assert.throws(()=>admin1AtlasFrame({type:'Polygon',coordinates:[]}),/no coordinates/);
});
