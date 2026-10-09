import * as THREE from 'three';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { loadBody } from '../expressive-character-v1/skinned-baseline.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadCompleteCharacter } from './rig.ts';
import { applyAuthoredPresentation } from './authored-presentation.ts';
import { completeCharacterKit } from './assets.ts';
import { applyAuthoredEyeMaterial } from './eye-material.ts';
import { applySkinMaterial } from './skin-material.ts';

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
let presentation:Awaited<ReturnType<typeof applyAuthoredPresentation>>|null=null;
let eyes:ReturnType<typeof applyAuthoredEyeMaterial>|null=null;
let skin:Awaited<ReturnType<typeof applySkinMaterial>>|null=null;
let state={body:'woman',expression:'grin',pose:'idle',focus:'body'};
let yaw=-.2,seconds=0,running=false,generation=0;
let frames:number[]=[];
function fitAuthoredHeight(object:THREE.Group){
  object.updateMatrixWorld(true);
  const body=object.getObjectByName('Body') as THREE.SkinnedMesh;
  body.skeleton.update();
  const point=new THREE.Vector3(),bounds=new THREE.Box3();
  for(let vertex=0;vertex<body.geometry.getAttribute('position').count;vertex++){
    body.getVertexPosition(vertex,point);body.localToWorld(point);bounds.expandByPoint(point);
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
  else if(state.pose==='dance')baseline?.sampleUse('dance',seconds);
  else baseline?.show('idle');
  if(candidate){
    candidate.object.rotation.y=yaw;
    if(state.pose==='rest'){
      const body=candidate.object.getObjectByName('Body') as THREE.SkinnedMesh;
      body.skeleton.pose();candidate.object.updateMatrixWorld(true);
    }else candidate.sample(seconds,state.pose as 'idle'|'walk'|'dance');
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
  document.querySelector('#metrics')!.textContent='Complete authored human experiment. Original head/neck/body stay connected. In-game identity, interactions and physical-phone performance remain unfinished.';
}
async function set(next:Partial<typeof state>){
  const previous=state;state={...state,...next};
  for(const key of['body','expression','pose','focus']as const)(document.querySelector(`#${key}`)as HTMLSelectElement).value=state[key];
  const seed='complete-authored-human';
  const look=normalizeLook({body:state.body,hair:state.body==='woman'?'afro':'lowcut',outfit:'casual',fabric:'plain',skin:'#9a6341',hairColor:'#241b18',outfitColor:'#cb674d',bottomsColor:'#36594a',expression:state.expression,accessories:[]},seed);
  if(!candidate||previous.body!==state.body){
    const ticket=++generation;skin?.dispose();eyes?.dispose();presentation?.dispose();baseline?.dispose();candidate?.dispose();skin=null;eyes=null;presentation=null;baseline=null;candidate=null;
    const loaded=await Promise.all([loadBody(kits[0]!,look,seed,1),loadCompleteCharacter(authoredKit,look,seed)]);
    if(ticket!==generation){loaded.forEach(body=>body.dispose());return;}
    const loadedSkin=await applySkinMaterial(loaded[1].object,look.body,look.skin);
    if(ticket!==generation){loadedSkin.dispose();loaded.forEach(body=>body.dispose());return;}
    const loadedPresentation=await applyAuthoredPresentation(loaded[1].object,look);
    if(ticket!==generation){loadedPresentation.dispose();loadedSkin.dispose();loaded.forEach(body=>body.dispose());return;}
    baseline=loaded[0];candidate=loaded[1];skin=loadedSkin;
    presentation=loadedPresentation;
    eyes=applyAuthoredEyeMaterial(candidate.object);
    fitAuthoredHeight(candidate.object);
    scenes[0]!.add(baseline.object);scenes[1]!.add(candidate.object);
  }else baseline!.wear(look,seed);
  seconds=0;draw();
}
for(const key of['body','expression','pose','focus']as const)document.querySelector(`#${key}`)!.addEventListener('change',event=>void set({[key]:(event.target as HTMLSelectElement).value}));
document.querySelector('#turn')!.addEventListener('click',()=>{yaw+=Math.PI/2;draw();});
document.querySelector('#play')!.addEventListener('click',()=>{
  if(running)return;running=true;frames=[];const start=performance.now();
  function frame(){seconds=(performance.now()-start)/1000;draw();if(seconds<6)requestAnimationFrame(frame);else running=false;}requestAnimationFrame(frame);
});
let drag:number|null=null;
canvas.addEventListener('pointerdown',event=>{drag=event.clientX;canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(drag===null)return;yaw+=(event.clientX-drag)*.012;drag=event.clientX;draw();});
for(const type of['pointerup','pointercancel'])canvas.addEventListener(type,()=>{drag=null;});window.addEventListener('resize',draw);
Object.assign(window,{characterReview:{set,sample(time:number,angle=yaw){seconds=time;yaw=angle;draw();},snapshot(){return{state,yaw,seconds,frames,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,fit:candidate?.metrics,hair:presentation?.metrics,eyes:eyes?.metrics,skin:skin?.metrics};}}});
await set({});Object.assign(window,{characterReady:true});
