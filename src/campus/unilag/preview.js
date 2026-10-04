/** Dev-only host. All rendering and input lives here; rules modules stay pure. */
import * as THREE from 'three';
import { createKit } from '../../scene/kit.js';
import { createWalker } from '../../scene/movement.js';
import { createMotionLoop } from '../../scene/motion-loop.js';
import { buildUnilag } from './scene.js';
import { BUILDINGS, ZONES, ROADS, ANCHORS, ENTRANCE } from './layout.js';

const $=id=>document.getElementById(id);
const renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,1800),kit=createKit(),campus=buildUnilag(kit);
world.add(campus.group);
const hemi=new THREE.HemisphereLight('#c6e0e6','#68765a',2),sun=new THREE.DirectionalLight('#fff0d2',2.4);
sun.position.set(80,140,50);world.add(hemi,sun);
const walker=createWalker({speed:8,jogSpeed:18});walker.setGrid(campus.walk.grid);walker.place(ENTRANCE.x,ENTRANCE.z,0);
let yaw=.55,tilt=.62,distance=64,gridVisible=false,frameCount=0,phase=0,trip=null;
const keys=new Set(),labels=new Map(),map=$('map'),ctx=map.getContext('2d');
const screenPoint=new THREE.Vector3(),labelRay=new THREE.Raycaster(),rayStart=new THREE.Vector3(),rayDirection=new THREE.Vector3();
for(const b of BUILDINGS){const opt=document.createElement('option');opt.value=b.id;opt.textContent=b.label;$('destination').append(opt);}
$('destination').value='senate';

function drawMap(){
  const scaleX=map.width/700,scaleZ=map.height/480;
  const point=(x,z)=>[(x+300)*scaleX,(z+240)*scaleZ];
  ctx.fillStyle='#e4e6d5';ctx.fillRect(0,0,map.width,map.height);
  ctx.fillStyle='#8eb5b6';ctx.fillRect(640*scaleX,0,60*scaleX,map.height);
  for(const zone of ZONES){const [x,z,x1,z1]=zone.bounds,[px,pz]=point(x,z);ctx.strokeStyle='#b8c6ad';ctx.lineWidth=.5;ctx.strokeRect(px,pz,(x1-x)*scaleX,(z1-z)*scaleZ);}
  ctx.strokeStyle='#fdf7e6';ctx.lineWidth=3;
  for(const r of ROADS){ctx.beginPath();r.points.forEach(([x,z],i)=>{const p=point(x,z);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.stroke();}
  for(const b of BUILDINGS){const [x,z]=point(b.x-b.w/2,b.z-b.d/2);ctx.fillStyle=b.id===$('destination').value?'#b0764b':'#829681';ctx.fillRect(x,z,b.w*scaleX,b.d*scaleZ);}
  if(gridVisible){const g=campus.navigation.grids.get(campus.zone);ctx.fillStyle='#994a3866';for(let r=0;r<g.rows;r+=2)for(let c=0;c<g.cols;c+=2)if(g.cells[r*g.cols+c]){const [x,z]=point(g.bounds[0]+c*g.cell,g.bounds[1]+r*g.cell);ctx.fillRect(x,z,2*scaleX,2*scaleZ);}}
  for(const friend of campus.walk.people()){const p=point(friend.x,friend.z);ctx.fillStyle='#686ab8';ctx.beginPath();ctx.arc(...p,2.5,0,Math.PI*2);ctx.fill();}
  const p=point(walker.x,walker.z);ctx.fillStyle='#db7142';ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fill();ctx.stroke();
}
function draw(){
  camera.position.set(walker.x+Math.sin(yaw)*Math.cos(tilt)*distance,Math.sin(tilt)*distance+2,walker.z+Math.cos(yaw)*Math.cos(tilt)*distance);
  camera.lookAt(walker.x,2,walker.z);
  world.background=new THREE.Color(campus.background);world.fog=new THREE.Fog(campus.background,260,1000);
  const night=campus.time==='night';hemi.intensity=night?.9:2;sun.intensity=night?.65:2.4;sun.color.set(night?'#9ebadb':'#fff0d2');
  document.body.dataset.time=campus.time;
  renderer.render(world,camera);frameCount++;
  for(const node of labels.values())node.hidden=true;
  const visible=campus.tags().map(tag=>({...tag,dist:Math.hypot(tag.position.x-walker.x,tag.position.z-walker.z)})).filter(t=>t.dist<100).sort((a,b)=>a.dist-b.dist).slice(0,innerWidth<600?5:10);
  const placed=[];
  for(const tag of visible){
    rayStart.copy(camera.position);rayDirection.set(tag.position.x,tag.position.y,tag.position.z).sub(rayStart);
    const tagDistance=rayDirection.length();labelRay.set(rayStart,rayDirection.normalize());labelRay.far=tagDistance-.7;
    if(labelRay.intersectObject(campus.group,true).length)continue;
    screenPoint.set(tag.position.x,tag.position.y,tag.position.z).project(camera);
    const x=(screenPoint.x+1)*innerWidth/2,y=(1-screenPoint.y)*innerHeight/2;
    if(screenPoint.z>1||x<20||x>innerWidth-20||y<170||y>innerHeight-210||placed.some(p=>Math.abs(p.x-x)<100&&Math.abs(p.y-y)<28))continue;
    let node=labels.get(tag.id);if(!node){node=document.createElement('span');node.className='name-tag';labels.set(tag.id,node);$('labels').append(node);}
    node.textContent=tag.name;node.hidden=false;node.style.left=x+'px';node.style.top=y+'px';placed.push({x,y});
  }
  const stats=campus.stats();$('stats').textContent=`${renderer.info.render.triangles.toLocaleString()} triangles · ${renderer.info.render.calls} calls · ${stats.resident.length} detailed zones`;
  $('motion').textContent=`${frameCount} frames · ${loop.running?'Moving':'Idle'}`;
  $('zone-name').textContent=ZONES.find(z=>z.id===campus.zone)?.label||'Campus';drawMap();
}
const loop=createMotionLoop(dt=>{
  walker.input(Number(keys.has('d')||keys.has('ArrowRight'))-Number(keys.has('a')||keys.has('ArrowLeft')),Number(keys.has('w')||keys.has('ArrowUp'))-Number(keys.has('s')||keys.has('ArrowDown')),keys.has('Shift'));
  // Calling input(0,0) preserves the walker's existing path.
  const moved=walker.step(dt,yaw);phase+=dt*(walker.jogging?9:5);
  campus.walk.move(walker.x,0,walker.z,walker.ry);campus.walk.gait(phase,phase);
  if(!moved)campus.walk.rest();draw();return moved||walker.hasInput;
},{onHidden(){keys.clear();walker.stop();},onVisible(){draw();}});
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();draw();}
function jump(id){const a=ANCHORS[id];if(!a)return false;loop.stop();walker.stop();if(!campus.setSpot(id))return false;walker.place(a.x,a.z,a.ry);distance=id==='senate'?125:48;draw();return true;}
function go(id){const a=ANCHORS[id];if(a&&walker.goTo(a.x,a.z,{arrive(){ $('status').textContent=`You reached ${a.label}.`; }})){ $('status').textContent=`Walking to ${a.label}…`;loop.wake();return true;}$('status').textContent='That destination is not reachable from here.';return false;}
$('walk').onclick=()=>go($('destination').value);
$('jump').onclick=()=>{jump($('destination').value);$('status').textContent='Preview position changed. Use Walk there to follow a route.';};
$('destination').onchange=drawMap;
$('time').onchange=()=>{campus.setTime($('time').value);draw();};
$('grid').onclick=()=>{gridVisible=!gridVisible;$('grid').setAttribute('aria-pressed',String(gridVisible));drawMap();};
$('help').onclick=()=>{$('controls').hidden=!$('controls').hidden;$('help').setAttribute('aria-expanded',String(!$('controls').hidden));};
addEventListener('resize',resize);
addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON'].includes(e.target.tagName))return;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift'].includes(e.key)){e.preventDefault();keys.add(e.key);loop.wake();}});
addEventListener('keyup',e=>keys.delete(e.key));addEventListener('blur',()=>{keys.clear();walker.stop();});
let drag=null;
$('world').onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};$('world').setPointerCapture(e.pointerId);};
$('world').onpointermove=e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.006;tilt=Math.min(1.35,Math.max(.25,tilt+(e.clientY-drag.y)*.004));drag={x:e.clientX,y:e.clientY};draw();};
$('world').onpointerup=()=>drag=null;$('world').onpointercancel=()=>drag=null;
$('world').addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(14,Math.min(220,distance+e.deltaY*.07));draw();},{passive:false});
for(const button of document.querySelectorAll('[data-move]')){const key={up:'w',left:'a',right:'d',down:'s'}[button.dataset.move];button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(key);loop.wake();};button.onpointerup=button.onpointercancel=()=>keys.delete(key);}
map.onclick=e=>{const r=map.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*700-300,z=(e.clientY-r.top)/r.height*480-240;const at=campus.walk.grid.nearest(x,z);if(at&&walker.goTo(at.x,at.z))loop.wake();else $('status').textContent='Choose a walkable part of campus.';};
// Inspection interface exists only on the dev page, with no game-server writes.
globalThis.campusPreview={campus,walker,renderer,jump,go,draw,setTime(value){campus.setTime(value);$('time').value=value;draw();},get frames(){return frameCount;},get idle(){return !loop.running;},setView(values){if(Number.isFinite(values.yaw))yaw=values.yaw;if(Number.isFinite(values.tilt))tilt=values.tilt;if(Number.isFinite(values.distance))distance=values.distance;draw();},dispose(){loop.dispose();campus.dispose();kit.dispose();renderer.dispose();}};
resize();
