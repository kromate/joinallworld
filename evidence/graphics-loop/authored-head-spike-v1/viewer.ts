import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadBody as loadBaseline } from '../expressive-character-v1/skinned-baseline.ts';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#e9e0d4');
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.setScissorTest(true);
const scenes=[new THREE.Scene(),new THREE.Scene()];
for(const scene of scenes){scene.add(new THREE.HemisphereLight('#f7e9dd','#736e74',2));for(const [c,p,x,y,z]of[['#fff1d6',2.6,-3,4,5],['#d8e8ff',1,3,2,4],['#ffe5c1',2,1,4,-4]]as const){const light=new THREE.DirectionalLight(c,p);light.position.set(x,y,z);scene.add(light)}}
const baseline=await loadBaseline(createKit(),normalizeLook({body:'woman',hair:'bun',outfit:'casual',skin:'#9a6341',hairColor:'#241b18',outfitColor:'#cb674d',expression:'neutral'},'authored-face'), 'authored-face',1);scenes[0]!.add(baseline.object);
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('./generated/expressive-head-compressed.glb',import.meta.url).href);
const head=new THREE.Group();head.add(gltf.scene);head.scale.setScalar(1.32);head.position.y=2.27-1.63*1.32;scenes[1]!.add(head);
const morphs:THREE.Mesh[]=[];
gltf.scene.traverse(node=>{if(!(node instanceof THREE.Mesh))return;const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials){if(material instanceof THREE.MeshStandardMaterial){material.vertexColors=false;if(material.name==='VitSkin')material.color.set('#c99c7c')}}if(node.morphTargetDictionary)morphs.push(node)});
const camera=new THREE.PerspectiveCamera(26,1,.05,40);
let yaw=-.12,expression='neutral',running=false,time=0;
const frames:number[]=[];
function draw(){const width=canvas.clientWidth,height=canvas.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/2/height;camera.position.set(0,2.36,Math.max(1.55,.36/(2*Math.tan(13*Math.PI/180)*camera.aspect)));camera.lookAt(0,2.27,0);camera.updateProjectionMatrix();baseline.place(0,0,0,yaw);baseline.show('idle');head.rotation.y=yaw;
 for(const mesh of morphs){const keys=mesh.morphTargetDictionary!,values=mesh.morphTargetInfluences!;values.fill(0);const apply=(name:string,value:number)=>{const index=keys[name];if(index!==undefined)values[index]=value};apply('Smile_Lips_Closed',expression==='smile'?.8:0);apply('Happy',expression==='grin'?.65:0);apply('Jaw_Lower',expression==='talk'?(Math.sin(time*7)+1)*.11:expression==='grin'?.09:0);apply('Eyes_Closed_Max',expression==='blink'?1:time%4.7>4.45?Math.sin((time%4.7-4.45)/.25*Math.PI):0)}
 for(let i=0;i<2;i++){const x=i*Math.floor(width/2);renderer.setViewport(x,0,Math.floor(width/2),height);renderer.setScissor(x,0,Math.floor(width/2),height);const start=performance.now();renderer.render(scenes[i]!,camera);frames.push(performance.now()-start)}
 document.querySelector('#metrics')!.textContent='Authored face experiment. Actual Happy/smile/jaw/blink shape keys. Body, hair, rig fitting and phone performance are still pending.';
}
async function set(next:{expression?:string}){expression=next.expression??expression;(document.querySelector('#expression')as HTMLSelectElement).value=expression;baseline.wear(normalizeLook({body:'woman',hair:'bun',outfit:'casual',skin:'#9a6341',hairColor:'#241b18',outfitColor:'#cb674d',expression:expression==='grin'?'grin':expression==='smile'?'smile':'neutral'},'authored-face'),'authored-face');draw()}
document.querySelector('#expression')!.addEventListener('change',event=>void set({expression:(event.target as HTMLSelectElement).value}));
document.querySelector('#turn')!.addEventListener('click',()=>{yaw+=Math.PI/2;draw()});
document.querySelector('#play')!.addEventListener('click',()=>{if(running)return;running=true;const start=performance.now();function frame(){time=(performance.now()-start)/1000;draw();if(time<6)requestAnimationFrame(frame);else running=false}requestAnimationFrame(frame)});
let drag:number|null=null;canvas.addEventListener('pointerdown',event=>{drag=event.clientX;canvas.setPointerCapture(event.pointerId)});canvas.addEventListener('pointermove',event=>{if(drag===null)return;yaw+=(event.clientX-drag)*.012;drag=event.clientX;draw()});for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>{drag=null});window.addEventListener('resize',draw);
Object.assign(window,{characterReview:{set,sample(seconds:number,angle=yaw){time=seconds;yaw=angle;draw()},snapshot(){return{expression,yaw,frames,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,morphs:morphs.map(m=>m.morphTargetDictionary)}}}});draw();Object.assign(window,{characterReady:true});
