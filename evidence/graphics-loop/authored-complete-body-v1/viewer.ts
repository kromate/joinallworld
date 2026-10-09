import * as THREE from 'three';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { loadBody } from '../expressive-character-v1/skinned-baseline.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadCompleteCharacter } from './rig.ts';
import { applyCharacterPresentation } from './presentation.ts';
import { completeCharacterKit } from './assets.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05; renderer.setClearColor('#ebe2d4'); renderer.setScissorTest(true);
const kits=[createKit(),createKit()];
const authoredKit=completeCharacterKit(kits[1]!);
const scenes=kits.map(()=>{
  const scene=new THREE.Scene(); scene.add(new THREE.HemisphereLight('#fff0db','#7a7972',2));
  for(const[color,intensity,x,y,z]of[['#fff1d6',2.6,-3,4,5],['#d8e8ff',1,3,2,4],['#ffe5c1',2,1,4,-4]]as const){
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z);scene.add(light);
  }
  return scene;
});
const camera=new THREE.PerspectiveCamera(28,1,.05,40);
let baseline:SkinnedBody|null=null;
let candidate:Awaited<ReturnType<typeof loadCompleteCharacter>>|null=null;
let presentation:ReturnType<typeof applyCharacterPresentation>|null=null;
let state={body:'woman',expression:'grin',pose:'idle',focus:'body'};
let yaw=-.2,seconds=0,running=false,generation=0;
let frames:number[]=[];
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
  if(candidate){candidate.object.rotation.y=yaw;candidate.sample(seconds,state.pose as 'idle'|'walk'|'dance');candidate.setExpression(state.expression as 'neutral'|'smile'|'grin'|'talk'|'blink',seconds);}
  scenes.forEach((scene,index)=>{
    renderer.setViewport(index*Math.floor(width/2),0,Math.floor(width/2),height);renderer.setScissor(index*Math.floor(width/2),0,Math.floor(width/2),height);
    const start=performance.now();renderer.render(scene,camera);frames.push(performance.now()-start);if(frames.length>600)frames.shift();
  });
  document.querySelector('#metrics')!.textContent='Complete authored human experiment. Original head/neck/body stay connected. In-game identity, interactions and physical-phone performance remain unfinished.';
}
async function set(next:Partial<typeof state>){
  const previous=state;state={...state,...next};
  for(const key of['body','expression','pose','focus']as const)(document.querySelector(`#${key}`)as HTMLSelectElement).value=state[key];
  const seed='complete-authored-human';
  const look=normalizeLook({body:state.body,hair:state.body==='woman'?'bun':'curls',outfit:'casual',fabric:'plain',skin:'#9a6341',hairColor:'#241b18',outfitColor:'#cb674d',bottomsColor:'#36594a',expression:state.expression,accessories:[]},seed);
  if(!candidate||previous.body!==state.body){
    const ticket=++generation;presentation?.dispose();baseline?.dispose();candidate?.dispose();presentation=null;baseline=null;candidate=null;
    const loaded=await Promise.all([loadBody(kits[0]!,look,seed,1),loadCompleteCharacter(authoredKit,look,seed)]);
    if(ticket!==generation){loaded.forEach(body=>body.dispose());return;}
    baseline=loaded[0];candidate=loaded[1];
    presentation=applyCharacterPresentation(candidate.object,look);
    candidate.object.scale.setScalar(2.45/1.6675);
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
Object.assign(window,{characterReview:{set,sample(time:number,angle=yaw){seconds=time;yaw=angle;draw();},snapshot(){return{state,yaw,seconds,frames,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,fit:candidate?.metrics,hair:presentation?.metrics};}}});
await set({});Object.assign(window,{characterReady:true});
