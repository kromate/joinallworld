import * as THREE from 'three';
import { GeometryBatch, countModel } from './geometry.ts';

export const ENVIRONMENT_TYPES = Object.freeze([
  'compound-house', 'bungalow', 'apartment', 'office', 'kiosk', 'market-stall',
  'bus-stop', 'bridge', 'lagoon', 'river', 'beach',
] as const);
export const DETAILS = Object.freeze(['map', 'street', 'showcase'] as const);

export type EnvironmentType = typeof ENVIRONMENT_TYPES[number];
export type EnvironmentDetail = typeof DETAILS[number];
export type EnvironmentTime = 'day' | 'dusk' | 'night';
export interface EnvironmentOptions {
  detail?: EnvironmentDetail | undefined;
  color?: THREE.ColorRepresentation | undefined;
  time?: EnvironmentTime | number | undefined;
  /** Water opacity from 0.55 to 1. */
  opacity?: number | undefined;
}
export interface EnvironmentAnchors {
  door?: THREE.Object3D;
  gate?: THREE.Object3D;
  roof?: THREE.Object3D;
  waterline?: THREE.Object3D;
  entrance?: THREE.Object3D;
  deck?: THREE.Object3D;
  footprint: THREE.Vector3;
}
export interface EnvironmentUserData {
  triangles: number;
  drawCalls: number;
  dispose: () => void;
  anchors: EnvironmentAnchors;
  parts: Record<string, THREE.Object3D>;
  dimensions: { width: number, height: number, depth: number };
  detail: EnvironmentDetail;
  type: string;
}
export interface EnvironmentModel { object3D: THREE.Group; userData: EnvironmentUserData }
type Builder = (batch: GeometryBatch, detail: EnvironmentDetail, baseColor: number) => void;

const PALETTE = Object.freeze({
  sand: 0xd9b77d, cream: 0xf0d9ae, coral: 0xd66d55, yellow: 0xf3b72c,
  rust: 0x9d4934, brown: 0x68483c, dark: 0x27333a, glass: 0x477a89,
  concrete: 0xaaa696, road: 0x454a4d, white: 0xf4ead2, green: 0x38734f,
  water: 0x277f93, deepWater: 0x1e6076, foam: 0xddebdc, earth: 0x9f774b,
});
const LIMITS: Readonly<Record<EnvironmentDetail, number>> = Object.freeze({ map: 250, street: 1500, showcase: 8000 });
const CORRUGATION = 0x7f342d;

function anchor(root: THREE.Group, name: string, x: number, y: number, z: number) {
  const point = new THREE.Object3D(); point.name = name; point.position.set(x, y, z); root.add(point); return point;
}

function doorway(batch: GeometryBatch,x: number,y: number,z: number,w: number=1,h: number=2.1,d: number=.12,color: number=PALETTE.dark){ batch.box(x,y,z,w,h,d,color); }

function windows(batch: GeometryBatch,x: number,y: number,z: number,count: number,spacing: number,color: number=PALETTE.glass){ for(let i=0;i<count;i+=1) batch.box(x+(i-(count-1)/2)*spacing,y,z,.72,.82,.1,color); }

function framedWindows(batch: GeometryBatch,x: number,y: number,z: number,count: number,spacing: number){
  windows(batch,x,y,z,count,spacing);
  for(let i=0;i<count;i+=1){ const wx=x+(i-(count-1)/2)*spacing; batch.box(wx,y+.48,z+.015,.9,.08,.14,PALETTE.cream); batch.box(wx,y-.48,z+.015,.9,.08,.14,PALETTE.cream); batch.box(wx-.41,y,z+.015,.08,.88,.14,PALETTE.cream); batch.box(wx+.41,y,z+.015,.08,.88,.14,PALETTE.cream); }
}

/** Place paired ribs flush against both planes of a gabled roof. */
function roofCorrugation(batch: GeometryBatch,baseY: number,width: number,height: number,depth: number){
  const half=width/2; const pitch=Math.atan2(height,half); const stripHeight=.06;
  for(let offset=.45;offset<half-.2;offset+=.72) for(const side of [-1,1]){ const x=side*offset; const angle=side<0?pitch:-pitch; const surface=baseY+height*(1-offset/half); const y=surface+stripHeight/(2*Math.cos(angle)); batch.rotatedBoxZ(x,y,0,.08,stripHeight,depth-.1,angle,CORRUGATION); }
}

function compound(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){
  batch.box(0,1.35,0,7,2.7,4.8,baseColor); batch.roof(0,2.7,0,7.6,1.35,5.4,PALETTE.rust);
  doorway(batch,0,1.05,2.46); windows(batch,-2.1,1.45,2.46,2,1.25);
  batch.box(-3.1,.72,3.5,2.6,1.44,.18,PALETTE.cream); batch.box(3.1,.72,3.5,2.6,1.44,.18,PALETTE.cream); batch.box(-4.32,.72,0,.18,1.44,7,PALETTE.cream); batch.box(4.32,.72,0,.18,1.44,7,PALETTE.cream);
  batch.box(-1.18,.9,3.15,.12,1.75,.85,PALETTE.dark); batch.box(1.18,.9,3.15,.12,1.75,.85,PALETTE.dark);
  batch.cylinder(3.0,4.82,-.7,.72,1.25,10,PALETTE.dark); for(const x of [2.55,3.45]) batch.box(x,4.08,-.7,.11,.75,.11,PALETTE.dark);
  if(detail!=='map'){
    batch.box(-2.65,1.9,2.8,.18,2.4,.18,PALETTE.brown); batch.box(2.65,1.9,2.8,.18,2.4,.18,PALETTE.brown); batch.box(0,3.05,2.8,5.5,.18,.18,PALETTE.brown);
  }
  batch.box(0,.2,2.9,2.5,.4,1.4,PALETTE.sand);
  if(detail==='showcase') { framedWindows(batch,1.85,1.45,2.46,2,1.05); roofCorrugation(batch,2.7,7.6,1.35,5.4); batch.cylinder(-3.25,1.55,2.2,.09,3.1,6,PALETTE.dark); }
}

function bungalow(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){
  batch.box(0,1.25,0,6.6,2.5,4.2,baseColor); batch.roof(0,2.5,0,7.4,1.25,5,PALETTE.rust); doorway(batch,0,1.05,2.16);
  windows(batch,-2,1.35,2.16,2,1.15); batch.box(0,2.25,2.6,3.2,.18,1.1,PALETTE.cream); batch.box(-1.45,1.2,2.6,.16,2.1,.16,PALETTE.brown); batch.box(1.45,1.2,2.6,.16,2.1,.16,PALETTE.brown); batch.box(0,.16,2.75,3.8,.32,1.4,PALETTE.sand);
  if(detail==='showcase'){ framedWindows(batch,1.9,1.35,2.16,2,1.05); roofCorrugation(batch,2.5,7.4,1.25,5); batch.cylinder(3.05,1.4,2.05,.08,2.8,6,PALETTE.dark); }
}

function apartment(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){
  const floors=4; const height=floors*2.35;
  batch.box(0,height/2,0,6.2,height,4.5,baseColor); batch.box(0,height+.16,0,6.6,.32,4.9,PALETTE.concrete); doorway(batch,0,1.05,2.3);
  for(let floor=0;floor<floors;floor+=1){ windows(batch,0,1.25+floor*2.35,2.3,detail==='map'?2:4,1.25); if(floor>0) batch.box(0,.72+floor*2.35,2.75,5.4,.18,1.05,PALETTE.concrete); }
  batch.box(2.1,height+.75,-.8,1.1,1.2,1.1,PALETTE.dark); batch.box(2.1,height+1.4,-.8,.14,1.4,.14,PALETTE.dark);
  if(detail==='showcase'){ for(let floor=1;floor<floors;floor+=1){ const y=.98+floor*2.35; batch.box(0,y,3.18,5.25,.1,.1,PALETTE.dark); for(let x=-2.5;x<=2.5;x+=.5) batch.box(x,y-.22,3.18,.06,.52,.06,PALETTE.dark); } for(let floor=0;floor<floors;floor+=1){ framedWindows(batch,0,1.25+floor*2.35,2.36,4,1.25); batch.box(3.16,1.25+floor*2.35,-.8,.1,.82,.72,PALETTE.glass); } batch.box(3.08,6.7,1.2,.3,.75,.9,PALETTE.cream); }
}

function office(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){
  const floors=3; const h=floors*2.6; batch.box(0,h/2,0,7,h,4.6,baseColor); batch.box(0,h+.2,0,7.5,.4,5.1,PALETTE.dark); doorway(batch,0,1.2,2.36,1.6,2.4);
  for(let floor=0;floor<floors;floor+=1) windows(batch,0,1.35+floor*2.6,2.36,detail==='map'?3:5,1.18);
  batch.box(0,.16,3,3.6,.32,1.2,PALETTE.concrete); batch.box(0,h-1.2,2.5,5.8,.18,.62,PALETTE.dark); batch.box(0,h+.65,0,2.8,.5,.5,PALETTE.yellow);
  if(detail==='showcase'){ for(let floor=0;floor<floors;floor+=1){ framedWindows(batch,0,1.35+floor*2.6,2.42,5,1.18); batch.box(3.56,1.35+floor*2.6,-.65,.1,.82,.72,PALETTE.glass); } for(const y of [2.1,4.7]){ batch.box(3.54,y,1.25,.35,.7,1,PALETTE.cream); for(let z=.9;z<=1.55;z+=.22) batch.box(3.72,y,z,.04,.5,.08,PALETTE.dark); } batch.cylinder(-3.25,3.7,2.25,.08,7.4,6,PALETTE.dark); }
}

function kiosk(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){ batch.box(0,1.25,0,3.2,2.5,2.3,baseColor); batch.box(0,2.65,0,3.8,.3,2.9,PALETTE.rust); batch.box(0,1.35,1.2,2.2,1.1,.12,PALETTE.dark); batch.box(0,.82,1.42,2.7,.18,.5,PALETTE.cream); batch.box(0,2.25,1.32,3,.5,.12,PALETTE.yellow); batch.box(0,.9,1.68,2.5,.1,.42,PALETTE.brown); if(detail==='showcase'){ for(let row=0;row<2;row+=1) for(let i=0;i<7;i+=1){ const colors=[PALETTE.yellow,PALETTE.green,PALETTE.coral]; batch.box(-1.05+i*.35,1.02+row*.34,1.72,.22,.25,.22,colors[(i+row)%3]!); } batch.box(-1.25,.48,1.55,.3,.95,.3,PALETTE.green); batch.box(1.25,.48,1.55,.3,.95,.3,PALETTE.coral); } }

function market(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){ batch.box(0,2.6,0,5.2,.28,3.2,baseColor); for(const x of [-2.3,2.3]) for(const z of [-1.3,1.3]) batch.box(x,1.3,z,.18,2.6,.18,PALETTE.brown); batch.box(0,.85,0,4.4,.18,1.6,PALETTE.cream); if(detail!=='map'){ batch.box(-1.4,1.05,0,.7,.45,1.2,PALETTE.green); batch.box(0,1.05,0,.7,.45,1.2,PALETTE.yellow); batch.box(1.4,1.05,0,.7,.45,1.2,PALETTE.coral); } if(detail==='showcase'){ for(const x of [-1.75,-.9,0,.9,1.75]) batch.box(x,.58,.2,.3,.3,.3,x<0?PALETTE.green:PALETTE.yellow); batch.pyramid(-1.35,1.28,-.15,.65,.42,.7,PALETTE.green); batch.pyramid(0,1.28,-.15,.65,.48,.7,PALETTE.yellow); batch.pyramid(1.35,1.28,-.15,.65,.4,.7,PALETTE.coral); } }

function busStop(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){ batch.box(0,.12,0,6,.24,2.2,PALETTE.concrete); batch.box(0,2.55,0,5.8,.25,2.1,baseColor); for(const x of [-2.6,2.6]) batch.box(x,1.35,0,.18,2.5,.18,PALETTE.dark); batch.box(0,.78,0,4.3,.18,.65,PALETTE.brown); batch.box(-2.82,2.5,0,.14,2.7,.14,PALETTE.dark); batch.box(-2.82,3.75,0,.9,.55,.12,PALETTE.yellow); if(detail!=='map'){ batch.box(0,1.65,-.96,4.9,1.45,.12,PALETTE.glass); batch.box(0,2.78,0,2.2,.5,.18,PALETTE.yellow); } if(detail==='showcase'){ for(const x of [-1.8,-.9,0,.9,1.8]) batch.box(x,1.08,-.78,.06,.52,.06,PALETTE.dark); } }

function bridge(batch: GeometryBatch,detail: EnvironmentDetail,baseColor: number){ batch.box(0,2.2,0,14,.65,4.6,baseColor); for(const x of [-5.5,0,5.5]){ batch.box(x,1,0,.65,2.1,3.2,PALETTE.concrete); } for(const z of [-2.18,2.18]) batch.box(0,2.57,z,14,.26,.24,PALETTE.concrete); for(const z of [-2.05,2.05]) batch.box(0,2.75,z,14,.18,.18,PALETTE.concrete); for(const x of [-5.5,0,5.5]) for(const z of [-2.05,2.05]) batch.box(x,3.15,z,.14,.8,.14,PALETTE.dark); if(detail!=='map'){ batch.box(0,2.56,0,14,.035,.12,PALETTE.white); for(const x of [-5,-2.5,0,2.5,5]) batch.box(x,2.57,-1.08,1.35,.04,.12,PALETTE.yellow); } if(detail==='showcase'){ for(const x of [-4.2,-2.8,-1.4,1.4,2.8,4.2]) for(const z of [-2.05,2.05]) batch.box(x,2.98,z,.08,.42,.08,PALETTE.dark); } }

function shoreline(batch: GeometryBatch,type: string,detail: EnvironmentDetail){
  if(type==='river'){ batch.box(-3.8,-.05,0,2.2,.22,12,PALETTE.earth); batch.box(3.8,-.05,0,2.2,.22,12,PALETTE.green); }
  if(type==='beach'){ batch.box(0,-.08,-3.2,12,.25,3.5,PALETTE.sand); batch.box(0,-.1,-5,12,.22,.5,PALETTE.green); }
  if(type==='lagoon'){ batch.box(0,-.14,-4.6,14,.18,.45,PALETTE.earth); }
  const count=detail==='showcase'?5:detail==='street'?3:1; for(let i=0;i<count;i+=1){ const x=(i-(count-1)/2)*2.1; const z=type==='river' ? -4+i*2 : -1.4; batch.box(x,.035,z,1.15,.025,.12,PALETTE.foam); }
  if(type==='beach'){ const palms=5; for(let i=0;i<palms;i+=1){ const x=-4.5+i*(9/(palms-1)); const lean=(i%2===0?.16:-.12); batch.leaningPost(x,.72,-4.35,.2,1.45,lean,0,PALETTE.brown); batch.leaningPost(x+lean,1.78,-4.35,.17,.82,lean*.7,.04,PALETTE.brown); } }
}

function palmCrownGeometry(detail: EnvironmentDetail){
  const fronds=5; const positions=[]; const normals=[]; const indices=[];
  for(let i=0;i<fronds;i+=1){ const a=i/fronds*Math.PI*2; const base=positions.length/3; const side=.23; const mid=1.0; const length=1.35; const px=-Math.sin(a)*side; const pz=Math.cos(a)*side;
    positions.push(0,0,0,Math.cos(a)*mid+px,.06,Math.sin(a)*mid+pz,Math.cos(a)*length,-.34,Math.sin(a)*length,Math.cos(a)*mid-px,.06,Math.sin(a)*mid-pz);
    normals.push(0,1,0,0,1,0,0,1,0,0,1,0); indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3)); geometry.setIndex(indices); geometry.computeBoundingSphere(); return geometry;
}

function waterMesh(width: number,depth: number,detail: EnvironmentDetail,color: THREE.ColorRepresentation,opacity: number){
  const xSegments=detail==='map'?6:detail==='street'?12:24; const zSegments=detail==='map'?3:detail==='street'?6:10;
  const geometry=new THREE.PlaneGeometry(width,depth,xSegments,zSegments); geometry.rotateX(-Math.PI/2);
  const colors=[]; const tint=new THREE.Color(color); for(let i=0;i<geometry.attributes.position!.count;i+=1) colors.push(tint.r,tint.g,tint.b);
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingSphere(); geometry.boundingSphere!.radius+=.06;
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.72,metalness:.04,transparent:opacity<1,opacity,side:THREE.DoubleSide}); material.forceSinglePass=true;
  const mesh=new THREE.Mesh(geometry,material); mesh.name='water'; return mesh;
}

const isEnvironmentType=(type: string): type is EnvironmentType => (ENVIRONMENT_TYPES as readonly string[]).includes(type);
const isDetail=(detail: unknown): detail is EnvironmentDetail => (DETAILS as readonly unknown[]).includes(detail);

/** Build a Lagos environment model. Geometry is self-contained and performs no fetches. */
export function buildEnvironment(type: string,options: EnvironmentOptions={}): EnvironmentModel{
  if(!isEnvironmentType(type)) throw new RangeError(`Unknown environment type: ${type}`);
  const detail: EnvironmentDetail=isDetail(options.detail) ? options.detail : 'street';
  const root=new THREE.Group(); root.name=`environment:${type}`;
  const batch=new GeometryBatch(); const defaultColor=type==='office'?0xd3c7ac:type==='bridge'?PALETTE.road:PALETTE.coral; const baseColor=new THREE.Color(options.color ?? defaultColor).getHex();
  const builders: Partial<Record<EnvironmentType, Builder>>={ 'compound-house':compound, bungalow, apartment, office, kiosk, 'market-stall':market, 'bus-stop':busStop, bridge };
  const resources: { dispose: () => void }[]=[]; const parts: Record<string, THREE.Object3D>={};
  const build=builders[type]; if(build) build(batch,detail,baseColor); else shoreline(batch,type,detail);
  const night=options.time==='night'; const materialTint=night?0x8293aa:options.time==='dusk'?0xe7b08d:0xffffff;
  if(batch.indices.length){ const geometry=batch.build(); const material=new THREE.MeshStandardMaterial({color:materialTint,vertexColors:true,roughness:.88,metalness:.02}); const mesh=new THREE.Mesh(geometry,material); mesh.name='structure'; root.add(mesh); resources.push(geometry,material); parts.structure=mesh; }
  const waterTypes=['lagoon','river','beach'];
  if(waterTypes.includes(type)) { const waterSize: [number, number]=type==='river'?[5.6,12]:[12,8]; const water=waterMesh(waterSize[0],waterSize[1],detail,options.color??(type==='lagoon'?PALETTE.deepWater:PALETTE.water),Math.min(1,Math.max(.55,options.opacity??1))); root.add(water); resources.push(water.geometry,water.material); parts.water=water; water.userData.basePositions=new Float32Array(water.geometry.attributes.position!.array); }
  if(type==='beach'){
    const palmCount=5; const geometry=palmCrownGeometry(detail); const material=new THREE.MeshStandardMaterial({color:night?0x24463a:PALETTE.green,roughness:.95,side:THREE.DoubleSide}); const palms=new THREE.InstancedMesh(geometry,material,palmCount); const matrix=new THREE.Matrix4();
    for(let i=0;i<palmCount;i+=1){ const x=-4.5+i*(9/(palmCount-1)); const lean=(i%2===0?.16:-.12); matrix.makeRotationY(i*.63); matrix.setPosition(x+lean*1.7,2.28,-4.31); palms.setMatrixAt(i,matrix); }
    palms.name='palm-crowns'; root.add(palms); resources.push(palms,geometry,material); parts.palms=palms;
  }
  root.updateMatrixWorld(true); const bounds=new THREE.Box3().setFromObject(root); const size=new THREE.Vector3(); bounds.getSize(size); const dimensions={width:size.x,height:size.y,depth:size.z}; const anchors: EnvironmentAnchors={ footprint:new THREE.Vector3(size.x,0,size.z) };
  if(['compound-house','bungalow','apartment','office'].includes(type)){ anchors.door=anchor(root,'door',0,0,bounds.max.z); anchors.roof=anchor(root,'roof',0,bounds.max.y,0); }
  if(type==='compound-house') anchors.gate=anchor(root,'gate',0,0,3.5);
  if(['kiosk','market-stall','bus-stop'].includes(type)) anchors.entrance=anchor(root,'entrance',0,0,bounds.max.z);
  if(type==='bridge') anchors.deck=anchor(root,'deck',0,2.56,0);
  if(waterTypes.includes(type)) anchors.waterline=anchor(root,'waterline',0,0,type==='beach'?-1.6:0);
  let disposed=false; const dispose=()=>{ if(disposed) return; disposed=true; for(const resource of resources) resource.dispose(); };
  const counts=countModel(root); if(counts.triangles>LIMITS[detail]) { dispose(); throw new Error(`${type}/${detail} exceeds ${LIMITS[detail]} triangles`); }
  const userData: EnvironmentUserData={...counts,dispose,anchors,parts,dimensions,detail,type}; root.userData=userData;
  poseEnvironment({object3D:root,userData},{progress:0,time:typeof options.time==='number'?options.time:0});
  return {object3D:root,userData};
}

/** Apply an absolute, host-driven pose. Repeating a value always restores the same state. */
export function poseEnvironment(model: EnvironmentModel,state?: {progress?: number, time?: number}): EnvironmentModel{
  const progress=Number.isFinite(state?.progress)?state!.progress!:0; const time=Number.isFinite(state?.time)?state!.time!:0;
  const water=model.userData.parts.water as THREE.Mesh | undefined;
  if(water){
    const geometry=water.geometry; const position=geometry.attributes.position!; const normal=geometry.attributes.normal!; const base=water.userData.basePositions as Float32Array;
    const pa=position.array as Float32Array; const na=normal.array as Float32Array;
    for(let i=0;i<position.count;i+=1){ const offset=i*3; const x=base[offset]!; const z=base[offset+2]!; pa[offset+1]=base[offset+1]!+Math.sin(x*.85+z*.52+time*1.7+progress*Math.PI*2)*.055; na[offset]=0; na[offset+1]=0; na[offset+2]=0; }
    const index=geometry.index!.array;
    for(let i=0;i<index.length;i+=3){
      const ai=index[i]!*3; const bi=index[i+1]!*3; const ci=index[i+2]!*3;
      const abx=pa[bi]!-pa[ai]!; const aby=pa[bi+1]!-pa[ai+1]!; const abz=pa[bi+2]!-pa[ai+2]!; const acx=pa[ci]!-pa[ai]!; const acy=pa[ci+1]!-pa[ai+1]!; const acz=pa[ci+2]!-pa[ai+2]!;
      const nx=aby*acz-abz*acy; const ny=abz*acx-abx*acz; const nz=abx*acy-aby*acx;
      na[ai]!+=nx; na[ai+1]!+=ny; na[ai+2]!+=nz; na[bi]!+=nx; na[bi+1]!+=ny; na[bi+2]!+=nz; na[ci]!+=nx; na[ci+1]!+=ny; na[ci+2]!+=nz;
    }
    for(let i=0;i<normal.count;i+=1){ const offset=i*3; const x=na[offset]!; const y=na[offset+1]!; const z=na[offset+2]!; const length=Math.hypot(x,y,z)||1; na[offset]=x/length; na[offset+1]=y/length; na[offset+2]=z/length; }
    position.needsUpdate=true; normal.needsUpdate=true;
  }
  return model;
}
