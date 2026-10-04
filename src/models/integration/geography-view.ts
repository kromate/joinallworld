import * as THREE from 'three';
import { buildGeography } from '../geo/index.ts';
import type { GeoData, GeographyModel } from '../geo/index.ts';

/** A city pin the host asks for. `access` also names the pin's style (`is-here`, `is-soon`, ...). */
export interface PinCity { id: string; name: string; lon: number; lat: number; access: string }
export interface GeographyViewOptions {
  onFeature?: (id: string) => void;
  onCity?: (id: string) => void;
  onFallback?: () => void;
  simple?: boolean;
}
export interface GeographyView {
  setData: (data: GeoData, cities?: PinCity[]) => void;
  setCities: (cities: PinCity[]) => void;
  select: (id: string | null) => void;
  resize: () => void;
  readonly diagnostics: { kind: '3d' | '2d'; renderCount: number; triangles: number };
  destroy: () => void;
}
interface Marker { city: PinCity; element: HTMLButtonElement; x: number; y: number }
interface Drag { x: number; y: number; lastX: number; moved: boolean }

/** Own the world-map canvas, model, markers, and listeners. No animation loop. */
export function createGeographyView(container: HTMLElement,{onFeature=()=>{},onCity=()=>{},onFallback=()=>{},simple=false}: GeographyViewOptions={}): GeographyView{
  const canvas=document.createElement('canvas');canvas.className='wm-model-canvas';canvas.setAttribute('aria-label','Interactive geographic map');container.append(canvas);
  let renderer: THREE.WebGLRenderer|null=null,model: GeographyModel|null=null,disposed=false,yaw=0,zoom=1,drag: Drag|null=null,markers: Marker[]=[],selected: string|null=null,renderCount=0,lastWidth=0,lastHeight=0,cityKey='';
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,1000),ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),scratch=new THREE.Vector3();
  scene.background=new THREE.Color(0x9fcdd4);scene.add(new THREE.HemisphereLight(0xeaf4ff,0xc9b08a,2));const key=new THREE.DirectionalLight(0xffeed2,2.4);key.position.set(-12,30,16);scene.add(key);
  try{if(!simple){renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;}else{canvas.hidden=true;onFallback();}}
  catch{canvas.hidden=true;onFallback();}
  const fallback=document.createElementNS('http://www.w3.org/2000/svg','svg');fallback.classList.add('wm-model-flat');fallback.setAttribute('role','img');fallback.setAttribute('aria-label','Geographic map');fallback.toggleAttribute('hidden',!!renderer);container.append(fallback);
  const pins=document.createElement('div');pins.className='wm-model-pins';container.append(pins);
  function layout(){
    if(!model||disposed)return;
    const width=Math.max(1,container.clientWidth||600),height=Math.max(1,container.clientHeight||420),frame=model.frame();
    lastWidth=width;lastHeight=height;
    const extent=Math.max(1,height/width)*zoom,dx=frame.position.x-frame.target.x,dz=frame.position.z-frame.target.z;
    camera.aspect=width/height;camera.position.set(frame.target.x+(dx*Math.cos(yaw)+dz*Math.sin(yaw))*extent,frame.position.y*extent,frame.target.z+(-dx*Math.sin(yaw)+dz*Math.cos(yaw))*extent);camera.lookAt(frame.target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    if(renderer){renderer.setSize(width,height,false);renderer.render(scene,camera);container.dataset.renderCount=String(++renderCount);container.dataset.modelTriangles=String(model.userData.triangles);container.dataset.drawCalls=String(renderer.info.render.calls);}
    const boxes=[];
    for(const marker of markers){
      if(renderer){model.project(marker.city.lon,marker.city.lat,scratch).project(camera);marker.x=(scratch.x*.5+.5)*width;marker.y=(-scratch.y*.5+.5)*height;}
      else{const b=model.userData.bounds,factor=Math.min(width/(b.east-b.west),height/(b.north-b.south));marker.x=(width-(b.east-b.west)*factor)/2+(marker.city.lon-b.west)*factor;marker.y=(height-(b.north-b.south)*factor)/2+(b.north-marker.city.lat)*factor;}
      const w=Math.max(40,marker.city.name.length*7+18),box={x:marker.x-w/2,y:marker.y-31,w,h:32};
      marker.element.style.left=`${marker.x}px`;marker.element.style.top=`${marker.y}px`;
      const outside=box.x<0||box.x+w>width||box.y<0||marker.y>height;
      marker.element.hidden=outside||boxes.some(b=>box.x<b.x+b.w&&box.x+w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y);
      if(!marker.element.hidden)boxes.push(box);
    }
  }
  function flat(model: GeographyModel){
    const b=model.userData.bounds,w=b.east-b.west,h=b.north-b.south;fallback.setAttribute('viewBox',`0 0 ${w} ${h}`);fallback.replaceChildren();
    for(const feature of model.data.features){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.dataset.wmFeature=feature.id;
      path.setAttribute('d',feature.polygons.map(rings=>rings.map(ring=>ring.map(([lon,lat],i)=>`${i?'L':'M'}${lon-b.west},${b.north-lat}`).join(' ')+'Z').join(' ')).join(' '));path.setAttribute('fill-rule','evenodd');path.setAttribute('fill',feature.id===selected?'#e5a62d':'#b8cd9a');path.setAttribute('stroke','#50756b');path.setAttribute('stroke-width',String(Math.max(w,h)/650));fallback.append(path);}
  }
  function setCities(cities: PinCity[]){const key=JSON.stringify(cities.map(c=>[c.id,c.name,c.lon,c.lat,c.access]));if(key===cityKey)return;cityKey=key;markers=[];pins.replaceChildren();for(const city of cities){const button=document.createElement('button');button.type='button';button.className=`wm-model-pin is-${city.access}`;button.textContent=city.name;button.dataset.wmCity=city.id;button.setAttribute('aria-label',`${city.name}, ${city.access==='here'?'you are here':city.access==='soon'?'coming soon':city.access}`);pins.append(button);markers.push({city,element:button,x:0,y:0});}layout();}
  function setData(data: GeoData,cities: PinCity[]=[]){model?.userData.dispose();model=buildGeography(data,{width:24});scene.add(model.object3D);container.dataset.geography=data.id;container.dataset.renderer=renderer?'webgl':'svg';yaw=0;zoom=1;selected=null;cityKey='';if(!renderer)flat(model);setCities(cities);}
  const select=(id: string|null)=>{if(!model||selected===id)return;if(selected)model.highlight(selected,false);selected=id;if(id)model.highlight(id,true);if(!renderer)flat(model);layout();};
  function down(event: PointerEvent){drag={x:event.clientX,y:event.clientY,lastX:event.clientX,moved:false};canvas.setPointerCapture?.(event.pointerId);}
  function move(event: PointerEvent){if(!drag)return;const delta=event.clientX-drag.lastX;drag.moved ||= Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>5;yaw+=delta*.006;drag.lastX=event.clientX;layout();}
  function up(event: PointerEvent){if(!drag)return;const moved=drag.moved;drag=null;if(moved||!model)return;const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObject(model.userData.parts.land)[0];if(hit){const point=model.object3D.worldToLocal(hit.point),id=model.pick(model.unproject(point.x,point.z));if(id)onFeature(id);}}
  const cancel=()=>{drag=null;};const wheel=(event: WheelEvent)=>{event.preventDefault();zoom=Math.max(.45,Math.min(2.5,zoom*Math.exp(event.deltaY*.001)));layout();};
  const pinClick=(event: Event)=>{const button=(event.target as Element).closest<HTMLElement>('[data-wm-city]'),id=button?.dataset.wmCity;if(id!==undefined)onCity(id);};const flatClick=(event: Event)=>{const path=(event.target as Element).closest<SVGElement>('[data-wm-feature]'),id=path?.dataset.wmFeature;if(id!==undefined)onFeature(id);};
  const contextLost=(event: Event)=>{event.preventDefault();renderer?.dispose();renderer=null;canvas.hidden=true;fallback.removeAttribute('hidden');container.dataset.renderer='svg';if(model){flat(model);layout();}onFallback();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('webglcontextlost',contextLost);pins.addEventListener('click',pinClick);fallback.addEventListener('click',flatClick);
  return {setData,setCities,select,resize(){if(container.clientWidth!==lastWidth||container.clientHeight!==lastHeight)layout();},get diagnostics(): GeographyView['diagnostics']{return {kind:renderer?'3d':'2d',renderCount,triangles:model?.userData.triangles||0};},destroy(){if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('wheel',wheel);pins.removeEventListener('click',pinClick);fallback.removeEventListener('click',flatClick);model?.userData.dispose();renderer?.dispose();renderer?.forceContextLoss();canvas.remove();fallback.remove();pins.remove();markers=[];}};
}
