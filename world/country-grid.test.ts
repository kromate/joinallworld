import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCountryGrid, geographicGridCell, geographicGridOwner, validateCountryGridRequest } from './country-grid.ts';
import { sha256 } from './pack.ts';
import type { CountryGridBoundary, CountryGridRequest } from './country-grid-types.ts';

const sha=(c:string)=>c.repeat(64);
const countryId='country:natural-earth:NE_ID%3A1159320001';
const source={id:'natural-earth-admin0-fixture',url:'https://example.test/admin0.geojson',release:'fixture-commit',license:'Public-domain',attribution:'Synthetic source fixture',sha256:sha('a'),bytes:13_287_234};
function pin(category:string,c:string,bytes=100){return {path:`${category}/${sha(c)}.json`,sha256:sha(c),bytes};}
function boundary(geometry:unknown,overrides:Record<string,unknown>={}):CountryGridBoundary{return {directoryManifestHash:sha('b'),node:{id:countryId,parentId:'continent:africa',name:'Fixtureland',kind:'country',countryCode:'GH',bounds:[-180,-90,180,90],sourceFeatureIds:[`${source.id}:NE_ID:1159320001`],provider:'world',outline:'available',exceptions:[]},source:{...source},pins:{manifest:pin('manifests','b'),node:pin('nodes','c'),outlineIndex:pin('outline-index','d'),parts:[pin('outlines','e')]},geometry:geometry as CountryGridBoundary['geometry'],...overrides} as CountryGridBoundary;}
const baseRequest:CountryGridRequest={schemaVersion:1,id:'grid-fixture',directoryManifestHash:sha('b'),countryId,level:1,limits:{positions:100_000,bboxCells:300_000,cells:100_000,operations:100_000_000,outputBytes:16_000_000}};
const ring=(w:number,s:number,e:number,n:number):number[][]=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const cell=(plan:ReturnType<typeof compileCountryGrid>['plan'],x:number,y:number)=>plan.cells.find(c=>c.column===x&&c.row===y);
type XY=[number,number];
function bruteOrient(a:XY,b:XY,c:XY):number{const d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);return d<0?-1:d>0?1:0;}
function bruteOn(p:XY,a:XY,b:XY):boolean{return bruteOrient(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);}
function bruteCross(a:XY,b:XY,c:XY,d:XY):boolean{const x=bruteOrient(a,b,c),y=bruteOrient(a,b,d),z=bruteOrient(c,d,a),q=bruteOrient(c,d,b);return(x!==y&&z!==q)||(x===0&&bruteOn(c,a,b))||(y===0&&bruteOn(d,a,b))||(z===0&&bruteOn(a,c,d))||(q===0&&bruteOn(b,c,d));}
function bruteInside(p:XY,r:number[][]):'in'|'out'|'edge'{let inside=false;for(let i=1;i<r.length;i++){const a=r[i-1]! as XY,b=r[i]! as XY;if(bruteOn(p,a,b))return'edge';if((a[1]>p[1])!==(b[1]>p[1])&&((b[1]>a[1]&&bruteOrient(a,b,p)>0)||(b[1]<a[1]&&bruteOrient(a,b,p)<0)))inside=!inside;}return inside?'in':'out';}
function bruteContact(poly:number[][][],box:number[]):boolean{const [x0,y0,x1,y1]=box as [number,number,number,number];for(const r of poly){for(const p of r as XY[])if(p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1)return true;for(let i=1;i<r.length;i++){const a=r[i-1]! as XY,b=r[i]! as XY,corners:[[number,number],[number,number],[number,number],[number,number]]=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];for(let j=0;j<4;j++)if(bruteCross(a,b,corners[j]!,corners[(j+1)%4]!))return true;}}for(const p of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] as XY[]){if(bruteInside(p,poly[0]!)==='in'&&!poly.slice(1).some(h=>bruteInside(p,h)==='in'))return true;}return false;}
function bruteSelected(coords:number[][][][],level:number):Array<{column:number;row:number;polygonIndices:number[]}>{const scale=2**level,step=1/scale,out=new Map<string,{column:number;row:number;polygonIndices:number[]}>();for(let pi=0;pi<coords.length;pi++){const poly=coords[pi]!,outer=poly[0]!;const xs=outer.map(p=>p[0]!),ys=outer.map(p=>p[1]!);const x0=Math.max(0,Math.ceil((Math.min(...xs)+180)*scale)-1),x1=Math.min(360*scale-1,Math.floor((Math.max(...xs)+180)*scale)),y0=Math.max(0,Math.ceil((Math.min(...ys)+90)*scale)-1),y1=Math.min(180*scale-1,Math.floor((Math.max(...ys)+90)*scale));for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const box=[-180+x*step,-90+y*step,-180+(x+1)*step,-90+(y+1)*step];if(bruteContact(poly,box)){const key=`${x}:${y}`,item=out.get(key)??{column:x,row:y,polygonIndices:[]};item.polygonIndices.push(pi);out.set(key,item);}}}return [...out.values()].sort((a,b)=>a.column-b.column||a.row-b.row);}

test('dyadic IDs, bounds, half-open seam ownership and singular pole ownership are exact',()=>{
  assert.deepEqual(geographicGridCell(2,721,361),{id:'geo-grid-v1:l2:x721:y361',level:2,column:721,row:361,bounds:[.25,.25,.5,.5]});
  assert.equal(geographicGridOwner([-180,0],1).id,'geo-grid-v1:l1:x0:y180');
  assert.equal(geographicGridOwner([180,0],1).column,0);
  assert.deepEqual([geographicGridOwner([72,90],1).column,geographicGridOwner([72,90],1).row],[0,359]);
  assert.deepEqual([geographicGridOwner([-72,-90],1).column,geographicGridOwner([-72,-90],1).row],[0,0]);
  assert.equal(geographicGridOwner([0,0],1).column,360,'grid boundaries belong east/north half-open cell');
  assert.equal(geographicGridOwner([-.5000000000000001,0],1).column,358,'exact binary-double position just west of an edge stays west');
  assert.equal(geographicGridOwner([-.49999999999999994,0],1).column,359,'exact binary-double position just east of an edge stays east');
});

test('inclusive polygon contact keeps all rectangle-edge cells and deterministic numeric order',()=>{
  const geom={type:'Polygon',coordinates:[ring(-.5,-.5,.5,.5)]};const input=structuredClone(baseRequest);const before=JSON.stringify(geom);const result=compileCountryGrid(input,boundary(geom));
  assert.equal(result.plan.counts.bboxCandidates,16);assert.equal(result.plan.counts.selectedCells,16);
  assert.deepEqual(result.plan.cells.map(c=>[c.column,c.row]),Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>[358+i,178+j])).flat());
  assert.deepEqual(result.plan.cells.find(c=>c.column===359&&c.row===179)?.polygonIndices,[0]);
  assert.equal(result.bytes.at(-1),10);assert.equal(JSON.stringify(geom),before);assert.equal(result.sha256,sha256(result.bytes));
});

test('exact orientation fallback retains a very thin polygon crossing a dyadic cell edge',()=>{
  const thin={type:'Polygon',coordinates:[[[.49999999999999994,.25],[.5000000000000001,.25000000000000006],[.5000000000000001,.2500000000000001],[.49999999999999994,.25]]]};const plan=compileCountryGrid(baseRequest,boundary(thin)).plan;
  assert.ok(plan.cells.some(c=>c.column===360&&c.row===180));assert.ok(plan.cells.some(c=>c.column===361&&c.row===180));
});

test('concave polygon bbox cells outside polygon stay unselected; holes exclude strictly interior cells but retain hole edges',()=>{
  const concave={type:'Polygon',coordinates:[[[ -1,-1],[1,-1],[1,-.5],[-.5,-.5],[-.5,1],[-1,1],[-1,-1]]]};const concavePlan=compileCountryGrid(baseRequest,boundary(concave)).plan;
  assert.ok(concavePlan.counts.bboxCandidates>concavePlan.counts.selectedCells);assert.equal(cell(concavePlan,360,360),undefined,'cell wholly in the concave notch is excluded');
  const holed={type:'Polygon',coordinates:[ring(-1,-1,1,1),ring(-.5,-.5,.5,.5)]};const plan=compileCountryGrid({...baseRequest,level:2},boundary(holed)).plan;
  assert.equal(cell(plan,720,360),undefined,'cell wholly inside the hole is excluded');assert.ok(plan.cells.some(c=>c.column===718&&c.row===360),'cell touching the hole boundary remains selected');
});

test('overlapping multipolygon cell contacts are unique and retain every source polygon index',()=>{
  const geometry={type:'MultiPolygon',coordinates:[[ring(-.5,-.5,.25,.25)],[ring(-.25,-.25,.5,.5)]]};const plan=compileCountryGrid(baseRequest,boundary(geometry)).plan;
  assert.equal(new Set(plan.cells.map(c=>c.id)).size,plan.cells.length);assert.deepEqual(cell(plan,359,179)?.polygonIndices,[0,1]);assert.equal(plan.counts.polygons,2);assert.equal(plan.counts.positions,10);assert.equal(plan.counts.bboxCandidates,14);assert.equal(plan.counts.selectedCells,14);
});

test('source-cut Fiji seam contacts mirror only boundary rows to opposite seam columns',()=>{
  const eastCut={type:'Polygon',coordinates:[ring(179.5,-16.5,180,-16)]};const westCut={type:'Polygon',coordinates:[ring(-180,-16.5,-179.5,-16)]};const geometry={type:'MultiPolygon',coordinates:[eastCut.coordinates,westCut.coordinates]};const plan=compileCountryGrid(baseRequest,boundary(geometry)).plan;
  assert.ok(plan.cells.some(c=>c.column===0&&c.polygonIndices.includes(0)),'+180 contact mirrors to -180 column');assert.ok(plan.cells.some(c=>c.column===719&&c.polygonIndices.includes(1)),'-180 contact mirrors to +180 column');assert.ok(plan.cells.every(c=>c.row>=146&&c.row<=149));
});

test('slanted edge touching a cut seam mirrors the endpoint row, not the full polygon bbox',()=>{
  const triangle={type:'Polygon',coordinates:[[[180,-16.5],[179.5,-16],[179,-16.5],[179.5,-17],[180,-16.5]]]};const plan=compileCountryGrid(baseRequest,boundary(triangle)).plan;
  const mirrored=plan.cells.filter(c=>c.column===0);assert.ok(mirrored.length>0);assert.ok(mirrored.every(c=>c.row===146||c.row===147));assert.ok(plan.counts.bboxCandidates>=plan.counts.selectedCells);
});

test('stepped polar source-cut edge selects polar sectors without longitude jumps; pole owner is canonical',()=>{
  const lower:number[][]=[[180,-90]];for(let x=179.5;x>=-180;x-=.5)lower.push([x,-90]);const upper:number[][]=[];for(let x=-180;x<=180;x+=.5)upper.push([x,-89.5]);const coordinates=[...lower,[-180,-89],...upper.slice(1),[180,-90]];
  const plan=compileCountryGrid(baseRequest,boundary({type:'Polygon',coordinates:[coordinates]})).plan;
  assert.ok(plan.cells.some(c=>c.row===0&&c.column===0));assert.ok(plan.cells.some(c=>c.row===0&&c.column===719));assert.equal(geographicGridOwner([125,-90],1).column,0);
});

test('rejects arbitrary wrapped rings, malformed geometry and unbound/Nigeria identities',()=>{
  const badWrap={type:'Polygon',coordinates:[[[179,-1],[-179,-1],[-179,1],[179,1],[179,-1]]]};assert.throws(()=>compileCountryGrid(baseRequest,boundary(badWrap)),/longitude jump/);
  assert.throws(()=>compileCountryGrid(baseRequest,boundary({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0,5]]]})),/2D/);
  const changed=boundary({type:'Polygon',coordinates:[ring(0,0,1,1)]});changed.node.id='country:wrong';assert.throws(()=>compileCountryGrid(baseRequest,changed),/identity mismatch/);
  const ng=boundary({type:'Polygon',coordinates:[ring(0,0,1,1)]});ng.node.countryCode='NG';assert.throws(()=>compileCountryGrid(baseRequest,ng),/excluded/);
  const unbound=boundary({type:'Polygon',coordinates:[ring(0,0,1,1)]});unbound.node.sourceFeatureIds=['other:NE_ID:1'];assert.throws(()=>compileCountryGrid(baseRequest,unbound),/unbound/);
});

test('preserves a verified world map unit with a null country code without inventing one',()=>{
  const input=boundary({type:'Polygon',coordinates:[ring(12,-1,13,1)]});input.node.countryCode=null;
  const result=compileCountryGrid(baseRequest,input);
  assert.equal(result.plan.country.id,countryId);assert.equal(result.plan.country.countryCode,null);assert.ok(result.plan.cells.length>0);
});

test('limits reject malformed requests, excessive positions/candidates/operations/output before returning a plan',()=>{
  assert.throws(()=>validateCountryGridRequest({...baseRequest,id:'bad/id'}),/safe lowercase/);
  assert.throws(()=>validateCountryGridRequest({...baseRequest,level:17}),/integer/);
  const geometry={type:'Polygon',coordinates:[ring(-.5,-.5,.5,.5)]};
  assert.throws(()=>compileCountryGrid({...baseRequest,limits:{...baseRequest.limits,positions:3}},boundary(geometry)),/position limit/);
  assert.throws(()=>compileCountryGrid({...baseRequest,limits:{...baseRequest.limits,bboxCells:2}},boundary(geometry)),/candidate/);
  assert.throws(()=>compileCountryGrid({...baseRequest,limits:{...baseRequest.limits,operations:1}},boundary(geometry)),/operation limit/);
  assert.throws(()=>compileCountryGrid({...baseRequest,limits:{...baseRequest.limits,outputBytes:10}},boundary(geometry)),/output-byte/);
  const badPin=boundary(geometry);badPin.pins.parts[0]!.path='outlines/not-hash.json';assert.throws(()=>compileCountryGrid(baseRequest,badPin),/hash-addressed/);
});

test('row-indexed contact agrees with an independent full-ring brute reference',()=>{
  const fixtures:number[][][][][]=[
    [[ring(-1,-1,1,1),ring(-.5,-.5,.5,.5)]],
    [[[[-1,-1],[1,-1],[1,-.5],[-.5,-.5],[-.5,1],[-1,1],[-1,-1]]]],
    [[ring(-1,-1,.25,.25)],[ring(-.25,-.25,1,1)]],
  ];
  for(const coordinates of fixtures){const geometry={type:coordinates.length===1?'Polygon':'MultiPolygon',coordinates:coordinates.length===1?coordinates[0]:coordinates};const actual=compileCountryGrid(baseRequest,boundary(geometry)).plan.cells.map(({column,row,polygonIndices})=>({column,row,polygonIndices}));assert.deepEqual(actual,bruteSelected(coordinates,baseRequest.level));}
});
