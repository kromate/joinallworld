import * as THREE from 'three';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { loadBody } from '../expressive-character-v1/skinned-baseline.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadCompleteCharacter } from './rig.ts';
import { applyNativeFamilyRigCorrection } from './native-family-rig-correction.ts';
import { applyAuthoredPresentation } from './authored-presentation.ts';
import { completeCharacterKit } from './assets.ts';
import { applyAuthoredEyeMaterial } from './eye-material.ts';
import { applySkinMaterial } from './skin-material.ts';
import { applyAuthoredFootwear } from './authored-footwear/presentation.ts';
import { refineRigidFootwear } from './native-rigid-footwear.ts';
import shoeHideMap from './authored-footwear/out/shoes01-body-hide-map.json';
import { createNativeHandPoseController } from './native-hand-pose.ts';
import { NativeCurlHairFactory, type NativeCurlHairLease, NATIVE_CURL_HAIR_SOURCE_SHA256 } from './native-curl-hair.ts';
import { createNativeSourceLandmarkSampler } from './native-source-sampler.ts';
import { createNativeWristOrientationController } from './native-wrist-orientation/native-wrist-controller.ts';
import { createNativeClipSolver, type NativeClipApplyResult } from './native-clip-solver.ts';
import { createNativeDirectionRetargeter, type DirectionRetargetResult } from './native-direction-retarget.ts';
import { createNativeSeatSurfaceProbe, type NativeSeatSurfaceProbe } from './native-seat-surface.ts';
import { solveNativeSeatPose, type NativeSeatPoseAdapterResult } from './native-seat-pose-adapter.ts';
import { createNativeActionController, type NativeActionPose, type NativeActionSnapshot } from './native-actions.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05; renderer.setClearColor('#ebe2d4'); renderer.setScissorTest(true);
const kits=[createKit(),createKit()];
const authoredKit=completeCharacterKit(kits[1]!);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=64;shadowCanvas.height=64;
const shadowContext=shadowCanvas.getContext('2d')!;
const shadowGradient=shadowContext.createRadialGradient(32,32,4,32,32,32);
shadowGradient.addColorStop(0,'rgba(58,43,31,0.32)');shadowGradient.addColorStop(1,'rgba(58,43,31,0)');
shadowContext.fillStyle=shadowGradient;shadowContext.fillRect(0,0,64,64);
const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
const scenes=kits.map(()=>{
  const scene=new THREE.Scene(); scene.add(new THREE.HemisphereLight('#fff0db','#7a7972',2));
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:'#ebe2d4',toneMapped:false}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.1),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));
  contact.rotation.x=-Math.PI/2;contact.position.y=-.01;scene.add(contact);
  for(const[color,intensity,x,y,z]of[['#fff1d6',2.6,-3,4,5],['#d8e8ff',1,3,2,4],['#ffe5c1',2,1,4,-4]]as const){
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z);scene.add(light);
  }
  return scene;
});
const camera=new THREE.PerspectiveCamera(28,1,.05,40);
let baseline:SkinnedBody|null=null;
let candidate:Awaited<ReturnType<typeof loadCompleteCharacter>>|null=null;
let familyRig:ReturnType<typeof applyNativeFamilyRigCorrection>|null=null;
let presentation:Awaited<ReturnType<typeof applyAuthoredPresentation>>|null=null;
let eyes:ReturnType<typeof applyAuthoredEyeMaterial>|null=null;
let skin:Awaited<ReturnType<typeof applySkinMaterial>>|null=null;
let nativePose:ReturnType<typeof createNativeActionController>|null=null;
let actionSnapshot:NativeActionSnapshot|null=null;
const seatFixture=new THREE.Group();
const seatMaterial=new THREE.MeshStandardMaterial({color:'#795a42',roughness:.8});
const seatSurface=new THREE.Mesh(new THREE.BoxGeometry(.55,.06,.52),seatMaterial);
seatFixture.add(seatSurface);
const seatBack=new THREE.Mesh(new THREE.BoxGeometry(.55,.50,.05),seatMaterial);
seatFixture.add(seatBack);
const seatLegs=Array.from({length:4},()=>new THREE.Mesh(new THREE.BoxGeometry(.04,1,.04),seatMaterial));
seatLegs.forEach(leg=>seatFixture.add(leg));scenes[1]!.add(seatFixture);
let rigidFootwear:ReturnType<typeof refineRigidFootwear>|null=null;
let footwear:Awaited<ReturnType<typeof applyAuthoredFootwear>>|null=null;
let hands:ReturnType<typeof createNativeHandPoseController>|null=null;
const curlFactory=new NativeCurlHairFactory();
let curls:NativeCurlHairLease|null=null;
let sampler:ReturnType<typeof createNativeSourceLandmarkSampler>|null=null;
let clipSolver:ReturnType<typeof createNativeClipSolver>|null=null;
let directionRetargeter:ReturnType<typeof createNativeDirectionRetargeter>|null=null;
let directionSnapshot:DirectionRetargetResult|null=null;
let seatSurfaceProbe:NativeSeatSurfaceProbe|null=null;
let seatPoseSnapshot:NativeSeatPoseAdapterResult|null=null;
let clipSnapshot:NativeClipApplyResult|null=null;
let wrists:ReturnType<typeof createNativeWristOrientationController>|null=null;
let state={wristMode:'rest',footMode:'source',seatMode:'uncorrected',outfit:'casual',motionMode:'actions',sourceClip:'jog',body:'woman',expression:'grin',pose:'idle',focus:'body',hairMode:'source'};
let yaw=-.2,seconds=0,running=false,generation=0;
let frames:number[]=[];
function fitAuthoredHeight(object:THREE.Group){
  object.updateMatrixWorld(true);
  const body=object.getObjectByName('Body') as THREE.SkinnedMesh;
  body.skeleton.update();
  const point=new THREE.Vector3(),bounds=new THREE.Box3();
  for(const mesh of [body,...(footwear?[footwear.object]:[])])for(let vertex=0;vertex<mesh.geometry.getAttribute('position').count;vertex++){
    mesh.getVertexPosition(vertex,point);mesh.localToWorld(point);bounds.expandByPoint(point);
  }
  const height=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(height)||height<1||height>2.5)throw new Error(`Invalid authored standing height ${height}`);
  const scale=2.45/height;object.scale.setScalar(scale);object.position.y=-bounds.min.y*scale;
}
function draw(){
  const width=canvas.clientWidth,height=canvas.clientHeight;
  renderer.setSize(width,height,false);camera.aspect=width/2/height;
  const face=state.focus==='head',target=face?2.24:1.3,span=face?.65:2.95;
  const distance=Math.max(span/(2*Math.tan(14*Math.PI/180)),(face?.52:1.3)/(2*Math.tan(14*Math.PI/180)*camera.aspect));
  camera.position.set(0,target+(face?.02:.12),distance);camera.lookAt(0,target,0);camera.updateProjectionMatrix();
  baseline?.place(0,0,0,yaw);
  if(state.pose==='walk')baseline?.stride(seconds/1.35*Math.PI*2,false);
  else if(['sit','interact','cook','eat','drink'].includes(state.pose))baseline?.show(state.pose as 'sit'|'interact'|'cook'|'eat'|'drink');
  else baseline?.show('idle');
  if(candidate){
    candidate.object.rotation.y=yaw;
    directionRetargeter?.restore();
    if(state.motionMode==='sourceclip'&&sampler&&clipSolver){
      const frame=sampler.sampleClip(state.sourceClip,seconds,['lie-down','get-up','sit-enter','sit-exit','door','home-door'].includes(state.sourceClip)?'clamp':'loop');
      if(state.sourceClip==='sit'&&state.seatMode==='surface-corrected'&&seatSurfaceProbe){
        const seatTopWorld:[number,number,number]=[0,candidate.object.position.y+.55*candidate.object.scale.y,0];
        seatPoseSnapshot=solveNativeSeatPose({frame,seatTopWorld,floorY:0,solver:clipSolver,surface:seatSurfaceProbe});
        clipSnapshot=seatPoseSnapshot.applyResults.at(-1)??null;
      }else{
        seatPoseSnapshot=null;
        clipSnapshot=clipSolver.applyFrame(frame,state.sourceClip==='lie-down'?{kind:'body-surface',surfaceY:0}:state.sourceClip==='sit'?{kind:'seat-anchor',hipWorld:[0,.55*candidate.object.scale.y+candidate.object.position.y,0],floorY:0}:{kind:'flat-feet',floorY:0});
      }
      if(state.wristMode==='source')wrists?.apply(frame);
    }else if(state.motionMode==='direction'&&sampler&&directionRetargeter){
      seatPoseSnapshot=null;
      const frame=sampler.sampleClip(state.sourceClip,seconds,['lie-down','get-up','sit-enter','sit-exit','door','home-door'].includes(state.sourceClip)?'clamp':'loop');
      directionSnapshot=directionRetargeter.apply(frame);
      if(state.wristMode==='source')wrists?.apply(frame);else wrists?.restore();
      hands?.restore();
    }else if(state.pose==='rest'){
      seatPoseSnapshot=null;
      const body=candidate.object.getObjectByName('Body') as THREE.SkinnedMesh;
      body.skeleton.pose();candidate.object.updateMatrixWorld(true);
    }else{seatPoseSnapshot=null;actionSnapshot=nativePose?.apply(seconds,state.pose as NativeActionPose,state.pose==='sit'?{kind:'seat',top:.55,floorY:-candidate.object.position.y/candidate.object.scale.y}:{kind:'floor'})??null;}
    seatFixture.visible=(state.motionMode==='actions'&&state.pose==='sit')||(state.motionMode==='sourceclip'&&state.sourceClip==='sit');
    if(seatFixture.visible){
      const scale=candidate.object.scale.y,top=candidate.object.position.y+.55*scale;
      seatFixture.scale.setScalar(scale);seatFixture.rotation.y=yaw;
      seatSurface.position.set(0,(top-.03*scale)/scale,-.08);
      seatBack.position.set(0,top/scale+.25,-.34);
      seatLegs.forEach((leg,i)=>{leg.scale.y=(top-.06*scale)/scale;leg.position.set(i%2?.23:-.23,(top-.06*scale)/2/scale,i<2?.14:-.30);});
    }
    const hairMesh=candidate.object.getObjectByName(`Authored hair ${state.body==='woman'?'afro01':'short02'}`) as THREE.SkinnedMesh|undefined;
    if(curls)curls.object.visible=state.hairMode==='solidcurl';
    if(hairMesh)hairMesh.visible=state.hairMode!=='solidcurl'||!curls;
    if(hairMesh&&!Array.isArray(hairMesh.material)){
      const material=hairMesh.material as THREE.MeshStandardMaterial,cutout=state.hairMode==='cutout';
      const alphaTest=cutout?.5:0;
      if(material.transparent===cutout||material.alphaTest!==alphaTest)material.needsUpdate=true;
      material.transparent=!cutout;material.depthWrite=cutout;material.alphaTest=alphaTest;
      material.forceSinglePass=state.hairMode!=='source';
    }
    const handPose=state.motionMode==='sourceclip'?state.sourceClip:state.pose;
    if(state.motionMode!=='direction')hands?.apply(handPose==='walk'||handPose==='jog'?'walk':['cook','eat','drink'].includes(handPose)?'grip':'relaxed',seconds);
    candidate.setExpression(state.expression as 'neutral'|'smile'|'grin'|'talk'|'blink',seconds);
  }
  scenes.forEach((scene,index)=>{
    if(face&&index===1&&candidate){
      candidate.object.updateMatrixWorld(true);
      const eye=candidate.object.getObjectByName('Eyes') as THREE.SkinnedMesh;
      eye.skeleton.update();const first=new THREE.Vector3(),second=new THREE.Vector3();
      eye.getVertexPosition(0,first);eye.localToWorld(first);eye.getVertexPosition(80,second);eye.localToWorld(second);
      const faceCenter=(first.y+second.y)/2-.055*candidate.object.scale.y;
      camera.position.set(0,faceCenter+.02,distance);camera.lookAt(0,faceCenter,0);camera.updateMatrixWorld();
    }else{camera.position.set(0,target+(face?.02:.12),distance);camera.lookAt(0,target,0);camera.updateMatrixWorld();}
    renderer.setViewport(index*Math.floor(width/2),0,Math.floor(width/2),height);renderer.setScissor(index*Math.floor(width/2),0,Math.floor(width/2),height);
    const start=performance.now();renderer.render(scene,camera);frames.push(performance.now()-start);if(frames.length>600)frames.shift();
  });
  const directionInfo=state.motionMode==='direction'&&directionSnapshot
    ? `\nDirection retarget diagnostic: ${directionSnapshot.clipName}; max angular error ${(directionSnapshot.maxDirectionErrorRadians*180/Math.PI).toFixed(1)}°; sole Y L/R ${directionSnapshot.footSoleMinY.left.toFixed(3)}/${directionSnapshot.footSoleMinY.right.toFixed(3)}m (sole measurements are diagnostic only, not shoe-contact acceptance).`
    : '';
  const seatInfo=seatPoseSnapshot
    ? `\nSurface-corrected source sit diagnostic: posterior seat residual ${seatPoseSnapshot.residualY.toFixed(4)}m in ${seatPoseSnapshot.passes.length} passes; support remains ${seatPoseSnapshot.supportStatus}, not chair/contact acceptance.`
    : '';
  document.querySelector('#metrics')!.textContent=`Complete authored human experiment. Original head/neck/body stay connected. In-game identity, interactions and physical-phone performance remain unfinished.${directionInfo}${seatInfo}`;
}
async function set(next:Partial<typeof state>){
  const previous=state;state={...state,...next};
  for(const key of['body','expression','pose','focus','hairMode','outfit','motionMode','sourceClip','footMode','wristMode','seatMode']as const)(document.querySelector(`#${key}`)as HTMLSelectElement).value=state[key];
  const seed='complete-authored-human';
  const look=normalizeLook({body:state.body,hair:state.body==='woman'?'afro':'lowcut',outfit:state.outfit,fabric:'plain',skin:'#9a6341',hairColor:'#241b18',outfitColor:'#cb674d',bottomsColor:'#36594a',expression:state.expression,accessories:[]},seed);
  if(!candidate||previous.body!==state.body||previous.outfit!==state.outfit||previous.footMode!==state.footMode){
    const ticket=++generation;directionRetargeter?.dispose();directionRetargeter=null;directionSnapshot=null;seatSurfaceProbe=null;seatPoseSnapshot=null;wrists?.dispose();wrists=null;curls?.dispose();curls=null;clipSolver?.dispose();clipSolver=null;sampler?.dispose();sampler=null;hands?.dispose();rigidFootwear?.dispose();rigidFootwear=null;footwear?.dispose();hands=null;footwear=null;nativePose?.dispose();skin?.dispose();eyes?.dispose();presentation?.dispose();baseline?.dispose();familyRig?.dispose();familyRig=null;candidate?.dispose();nativePose=null;skin=null;eyes=null;presentation=null;baseline=null;candidate=null;
    const loaded=await Promise.all([loadBody(kits[0]!,look,seed,1),loadCompleteCharacter(authoredKit,look,seed)]);
    if(ticket!==generation){loaded.forEach(body=>body.dispose());return;}
    const loadedFamilyRig=applyNativeFamilyRigCorrection(loaded[1].object);
    const loadedSkin=await applySkinMaterial(loaded[1].object,look.body,look.skin,kits[1]!);
    if(ticket!==generation){loadedSkin.dispose();loadedFamilyRig.dispose();loaded.forEach(body=>body.dispose());return;}
    const loadedPresentation=await applyAuthoredPresentation(loaded[1].object,look,{kitOwner:kits[1]!,additionalBodyHideSets:[{
      asset:shoeHideMap.asset,bodySourceTriangleCount:shoeHideMap.bodySourceTriangleCount,
      triangleIds:shoeHideMap.sourceBodyTriangleIds,
    }]});
    if(ticket!==generation){loadedPresentation.dispose();loadedSkin.dispose();loadedFamilyRig.dispose();loaded.forEach(body=>body.dispose());return;}
    const loadedShoes=await applyAuthoredFootwear(loaded[1].object,{kitOwner:kits[1]!});
    if(ticket!==generation){loadedShoes.dispose();loadedPresentation.dispose();loadedSkin.dispose();loadedFamilyRig.dispose();loaded.forEach(body=>body.dispose());return;}
    if(state.footMode==='rigid')rigidFootwear=refineRigidFootwear(loaded[1].object,loadedShoes.object);
    baseline=loaded[0];candidate=loaded[1];familyRig=loadedFamilyRig;skin=loadedSkin;footwear=loadedShoes;
    presentation=loadedPresentation;
    eyes=applyAuthoredEyeMaterial(candidate.object);
    const nativeBody=candidate.object.getObjectByName('Body') as THREE.SkinnedMesh;
    nativeBody.skeleton.pose();candidate.object.updateMatrixWorld(true);
    const motionSource=await authoredKit.authoredCharacterAssets.loadMotionRig();
    if(ticket!==generation)return;
    sampler=createNativeSourceLandmarkSampler(motionSource.root.clone(true),motionSource.clips);
    wrists=createNativeWristOrientationController(candidate.object,sampler.restWristRotations);
    directionRetargeter=createNativeDirectionRetargeter(candidate.object,{sourceRest:sampler.restLandmarks,floorY:0});
    const surfaceMeshes:THREE.SkinnedMesh[]=[];candidate.object.traverse(node=>{const mesh=node as THREE.SkinnedMesh;if(mesh.isSkinnedMesh&&(mesh.name==='Body'||mesh.name==='Authored casual suit'||mesh.name.startsWith('Authored office')||mesh===loadedShoes.object))surfaceMeshes.push(mesh);});
    clipSolver=createNativeClipSolver(candidate.object,{sourceRest:sampler.restLandmarks,footSurface:loadedShoes.object,bodySurfaceMeshes:surfaceMeshes});
    seatSurfaceProbe=createNativeSeatSurfaceProbe(candidate.object,surfaceMeshes.filter(mesh=>mesh.name==='Body'||/^Authored (casual|office)/i.test(mesh.name)));
    const guide=candidate.object.getObjectByName('Authored hair afro01') as THREE.SkinnedMesh|undefined;
    if(guide)curls=curlFactory.create({guide,actorRoot:candidate.object,headBone:candidate.object.getObjectByName('mixamorigHead') as THREE.Bone,body:nativeBody,guideSha256:NATIVE_CURL_HAIR_SOURCE_SHA256,hairColor:look.hairColor});
    nativePose=createNativeActionController(candidate.object);nativePose.apply(0,'idle',{kind:'floor'});
    hands=createNativeHandPoseController(candidate.object);
    fitAuthoredHeight(candidate.object);
    scenes[0]!.add(baseline.object);scenes[1]!.add(candidate.object);
  }else baseline!.wear(look,seed);
  seconds=0;draw();
}
for(const key of['body','expression','pose','focus','hairMode','outfit','motionMode','sourceClip','footMode','wristMode','seatMode']as const)document.querySelector(`#${key}`)!.addEventListener('change',event=>void set({[key]:(event.target as HTMLSelectElement).value}));
document.querySelector('#turn')!.addEventListener('click',()=>{yaw+=Math.PI/2;draw();});
document.querySelector('#play')!.addEventListener('click',()=>{
  if(running)return;running=true;frames=[];const start=performance.now();
  function frame(){seconds=(performance.now()-start)/1000;draw();if(seconds<6)requestAnimationFrame(frame);else running=false;}requestAnimationFrame(frame);
});
let drag:number|null=null;
canvas.addEventListener('pointerdown',event=>{drag=event.clientX;canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(drag===null)return;yaw+=(event.clientX-drag)*.012;drag=event.clientX;draw();});
for(const type of['pointerup','pointercancel'])canvas.addEventListener(type,()=>{drag=null;});window.addEventListener('resize',draw);
Object.assign(window,{characterReview:{set,sample(time:number,angle=yaw){seconds=time;yaw=angle;draw();},snapshot(){return{state,yaw,seconds,frames,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,fit:candidate?.metrics,familyRig:familyRig?.metrics,hair:presentation?.metrics,eyes:eyes?.metrics,skin:skin?.metrics,footwear:footwear?.metrics,rigidFootwear:rigidFootwear?.metrics,curls:curls?.metrics,clip:clipSnapshot,direction:directionSnapshot,directionRest:directionRetargeter?.metrics,seat:seatPoseSnapshot,seatSurface:seatSurfaceProbe?.metrics,animation:'native-rig deterministic action prototype; source-position and direction-retarget modes are diagnostics',action:actionSnapshot};}}});
await set({});Object.assign(window,{characterReady:true});
