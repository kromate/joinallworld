import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import * as esbuild from 'esbuild';

const repo='/workspace/remote-verification/repositories/coordinator-graphics-wiring';
const resultDir=path.dirname(fileURLToPath(import.meta.url));
const entry=path.join(repo,'src/scene/body/native/native-rest-contact-v15/native-full-runtime-v15/native-prepared-factory.ts');
const bundle=path.join(resultDir,'native-prepared-factory-d982-public-budget.bundle.mjs');
await esbuild.build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',write:true,logLevel:'silent',plugins:[{name:'file-url-assets',setup(build){build.onResolve({filter:/\?url$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'file-url'}));build.onLoad({filter:/.*/,namespace:'file-url'},args=>({contents:`export default ${JSON.stringify(pathToFileURL(args.path).href)};`,loader:'js'}));}}]});
const sourceSha256=createHash('sha256').update(await readFile(entry)).digest('hex');
const bundleSha256=createHash('sha256').update(await readFile(bundle)).digest('hex');
const {prepareNativeSkinnedBody}=await import(pathToFileURL(bundle).href);
const {createKit}=await import(pathToFileURL(path.join(repo,'src/scene/kit.ts')).href);
const original={fetch:globalThis.fetch,bitmap:globalThis.createImageBitmap,progress:globalThis.ProgressEvent,self:globalThis.self,textureLoad:THREE.TextureLoader.prototype.load};
const sourceStats={fetches:0,bytes:0,imageDecodes:0};
if(!globalThis.self)globalThis.self=globalThis;
if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class extends Event{constructor(type,init={}){super(type);Object.assign(this,init);}};
globalThis.fetch=async(input,init)=>{const raw=typeof input==='string'||input instanceof URL?String(input):input.url;if(!raw.startsWith('file:'))return original.fetch(input,init);const bytes=await readFile(fileURLToPath(raw));sourceStats.fetches++;sourceStats.bytes+=bytes.byteLength;return new Response(bytes,{status:200,headers:{'content-type':raw.endsWith('.json')?'application/json':'model/gltf-binary'}});};
globalThis.createImageBitmap=async()=>{sourceStats.imageDecodes++;return{width:1,height:1,close(){}};};
THREE.TextureLoader.prototype.load=function(_url,onLoad,_progress,onError){const texture=new THREE.Texture({width:1,height:1,data:new Uint8Array(4)});texture.needsUpdate=true;queueMicrotask(()=>{try{onLoad?.(texture);}catch(error){onError?.(error);}});return texture;};
function box(parent,name,size,center){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());mesh.name=name;mesh.position.set(...center);parent.add(mesh);mesh.updateMatrixWorld(true);return mesh;}
const parent=new THREE.Group();
const kit=createKit();let actor;let floor;
try{
 actor=await prepareNativeSkinnedBody({kit,seed:'d982-public-budget-man',look:{body:'man',hair:'lowcut',outfit:'casual',fabric:'plain',skin:'skin4',hairColor:'darkbrown',outfitColor:'navy',bottomsColor:'cream',accessories:[],face:'oval',expression:'neutral',appearance:{height:'average',build:'average',ageAppearance:'adult'}},sceneScale:1});
 parent.add(actor.object);actor.place(0,0,0,0);actor.fit(.6);parent.updateWorldMatrix(true,true);actor.object.updateWorldMatrix(true,true);
 const initial=actor.sampleFootContacts().flatMap(c=>(c.points??[c]).map(p=>({side:c.side,...p})));
 const lowest=Math.min(...initial.map(p=>p.y));const supportY=lowest-.02;
 floor=box(parent,'actual-host-floor',[10,.05,10],[0,supportY-.025,0]);
 const ray=new THREE.Raycaster();const heightAt=contact=>{parent.updateWorldMatrix(true,true);ray.set(new THREE.Vector3(contact.x,contact.y+3,contact.z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(floor,false)[0];return hit?hit.point.y:null;};
 const snapshot=()=>{const contacts=actor.sampleFootContacts();actor.object.updateWorldMatrix(true,true);const points=contacts.flatMap(c=>(c.points??[c]).map(p=>({side:c.side,x:p.x,y:p.y,z:p.z,gap:p.y-heightAt(p)})));const hips=actor.object.getObjectByName('mixamorigHips');return{points,hipsLocal:hips.position.toArray(),hipsWorld:hips.getWorldPosition(new THREE.Vector3()).toArray()};};
 const before=snapshot();const firstResult=actor.solveFeet(heightAt);const afterFirst=snapshot();const secondResult=actor.solveFeet(heightAt);const afterSecond=snapshot();
 const drift=(a,b)=>Math.max(...a.points.map((p,i)=>Math.hypot(p.x-b.points[i].x,p.y-b.points[i].y,p.z-b.points[i].z)));
 const brief=result=>({corrected:result.corrected,maxError:result.maxError,limited:result.limited,diagnostics:result.diagnostics});
 const output={head:'d98203c6360011132109893076d7b1f07ea8f328',sourceSha256,bundleSha256,bundle,fixture:{family:'man',pose:actor.pose,plane:'actual BoxGeometry top hit by THREE.Raycaster',supportY,initialLowestSoleY:lowest,initialGap:lowest-supportY},sourceStats,initialSoleSamples:initial.length,first:{result:brief(firstResult),pointCount:afterFirst.points.length,hipLocalBefore:before.hipsLocal,hipLocalAfter:afterFirst.hipsLocal,hipWorldBefore:before.hipsWorld,hipWorldAfter:afterFirst.hipsWorld,maxPointDriftFromBaseline:drift(before,afterFirst),minGap:Math.min(...afterFirst.points.map(p=>p.gap)),maxGap:Math.max(...afterFirst.points.map(p=>p.gap))},repeat:{result:brief(secondResult),hipLocal:afterSecond.hipsLocal,hipWorld:afterSecond.hipsWorld,maxPointDriftFromFirst:drift(afterFirst,afterSecond),minGap:Math.min(...afterSecond.points.map(p=>p.gap)),maxGap:Math.max(...afterSecond.points.map(p=>p.gap))}};
 output.checks={firstSpentNonzeroBelow80mm:output.first.result.diagnostics.cumulativePelvisLoweringWorld>0&&output.first.result.diagnostics.cumulativePelvisLoweringWorld<.08,firstHostContactValid:output.first.maxPointDriftFromBaseline>=0&&output.first.maxPointDriftFromBaseline<1,repeatDoesNotExceedBudget:output.repeat.result.diagnostics.cumulativePelvisLoweringWorld<=.080001,repeatAddedNoBudget:Math.abs(output.repeat.result.diagnostics.cumulativePelvisLoweringWorld-output.first.result.diagnostics.cumulativePelvisLoweringWorld)<=1e-9,repeatSameGeometry:output.repeat.maxPointDriftFromFirst<=1e-7};
 await writeFile(path.join(resultDir,'trial-d982-public-pelvis-budget-host.json'),JSON.stringify(output,null,2));
 console.log(JSON.stringify({head:output.head,sourceSha256,bundleSha256,fixture:output.fixture,first:output.first,repeat:output.repeat,checks:output.checks,sourceStats},null,2));
}finally{if(floor){parent.remove(floor);floor.geometry.dispose();floor.material.dispose();}actor?.dispose();kit.dispose();if(original.fetch)globalThis.fetch=original.fetch;if(original.bitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=original.bitmap;if(original.progress===undefined)delete globalThis.ProgressEvent;else globalThis.ProgressEvent=original.progress;if(original.self===undefined)delete globalThis.self;else globalThis.self=original.self;THREE.TextureLoader.prototype.load=original.textureLoad;}
