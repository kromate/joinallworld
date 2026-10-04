import * as THREE from 'three';
import { buildGeography, loadGeography, GEOGRAPHY_LEVELS, buildRoute, transitionCamera, regionData } from './geo/index.js';

const $ = id => document.getElementById(id), query = new URLSearchParams(location.search);
const state = {category:query.get('category')||'vehicles',detail:query.get('detail')||'street',type:query.get('type')||'',view:query.get('view')||'perspective',time:query.get('time')||'day',grid:query.has('grid'),sheet:query.get('sheet')||''};
const modules = {}, records = []; let epoch=0,renderer,renderCount=0,drag=null;
document.body.classList.toggle('capture',query.has('capture'));
for(const id of ['view','time','sheet'])$(id).value=state[id];$('grid').checked=state.grid;
if(query.has('skin'))$('skin').value=query.get('skin');
const sceneColor = () => new THREE.Color(state.time==='night'?0x182d3c:0xdfe6dc);

async function domain(category){
  if(modules[category])return modules[category];
  if(category==='vehicles')modules[category]=await import('./vehicles/index.js');
  if(category==='people')modules[category]=await import('./people/index.js');
  if(category==='environment')modules[category]=await import('./environment/index.js');
  return modules[category];
}

function optionsFor(select,items,value){select.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item;option.textContent=item.replaceAll('-',' ');return option;}));if(items.includes(value))select.value=value;}

function dispose(){for(const r of records){r.route?.userData.dispose();r.traveller?.userData.dispose();r.model.userData.dispose();}records.length=0;$('gallery').replaceChildren();}

async function rebuild(){
  const version=++epoch;document.body.dataset.ready='loading';$('error').hidden=true;$('summary').textContent='Building models…';
  try{
    const mod=await domain(state.category);if(version!==epoch)return;
    dispose();document.body.dataset.category=state.category;document.body.dataset.time=state.time;
    for(const b of document.querySelectorAll('[data-category]'))b.setAttribute('aria-pressed',String(b.dataset.category===state.category));
    const people=state.category==='people',details=people?['low','medium','high']:['map','street','showcase'];
    if(!details.includes(state.detail))state.detail=details[1];
    document.querySelectorAll('[data-detail]').forEach((b,i)=>{b.dataset.detail=details[i];b.textContent=details[i];b.setAttribute('aria-pressed',String(state.detail===details[i]));});
    const types=state.category==='vehicles'?mod.VEHICLE_TYPES:state.category==='environment'?mod.ENVIRONMENT_TYPES:people?['woman','man']:GEOGRAPHY_LEVELS;
    if(!types.includes(state.type))state.type=types[0];optionsFor($('model'),types,state.type);
    if(people){
      const hair=Array.isArray(mod.LOOK_OPTIONS.hair)?mod.LOOK_OPTIONS.hair:mod.LOOK_OPTIONS.hair[state.type];
      const outfits=Array.isArray(mod.LOOK_OPTIONS.outfit)?mod.LOOK_OPTIONS.outfit:mod.LOOK_OPTIONS.outfit[state.type];
      optionsFor($('hair'),hair,query.get('hair')||$('hair').value);optionsFor($('outfit'),outfits,query.get('outfit')||$('outfit').value);
    }
    let items=(state.grid?types:[state.type]).map(type=>({type,title:type.replaceAll('-',' ')}));
    if(people&&state.sheet){
      items=[];for(const body of [state.type])for(const id of mod.LOOK_OPTIONS[state.sheet][body])for(const skin of ['skin-1','skin-7'])for(const view of ['front','side','back'])items.push({type:body,title:`${body} ${id} · ${skin==='skin-7'?'dark':'light'} · ${view}`,look:{[state.sheet]:id,skin},view});
    }
    $('gallery').classList.toggle('grid',items.length>1);
    for(const item of items){
      let model,data;
      const opts={detail:state.detail,time:state.time};
      if(state.category==='vehicles')model=mod.buildVehicle(item.type,{...opts,...($('custom-colour').checked?{color:$('colour').value}:{}),route:$('routeboard').value});
      if(state.category==='environment')model=mod.buildEnvironment(item.type,opts);
      if(people)model=mod.buildPerson({body:item.type,hair:$('hair').value,outfit:$('outfit').value,skin:$('skin').value,fabric:$('fabric').value,outfitColor:$('custom-colour').checked?$('colour').value:'#d27954',bottomsColor:'#243a66',hairColor:'#211911',face:'round',expression:'smile',...item.look},{...opts,rig:true});
      if(state.category==='geo'){data=state.region||await loadGeography(item.type);if(version!==epoch)return;model=buildGeography(data,{time:state.time,comingSoon:item.type==='africa'?['KE','GH']:[]});}
      const tile=document.createElement('article');tile.className='tile';tile.dataset.type=item.type;
      const title=document.createElement('h2');title.textContent=data?.name||item.title;tile.append(title);
      const badge=document.createElement('span');badge.className='badge';badge.textContent=state.category==='geo'?(data.roads?.length?'Schematic travel routes':'Local map data'):state.detail;tile.append(badge);
      const metric=document.createElement('div');metric.className='metrics';tile.append(metric);$('gallery').append(tile);
      const scene=new THREE.Scene();scene.background=sceneColor();scene.add(new THREE.HemisphereLight(state.time==='night'?0xb5c6ea:0xeaf4ff,state.time==='night'?0x555873:0xc9b08a,state.time==='night'?1.6:2.0));
      const key=new THREE.DirectionalLight(0xffeed2,state.time==='night'?1.4:2.8);key.position.set(-5,9,7);scene.add(key);const rim=new THREE.DirectionalLight(0xcde6ff,.9);rim.position.set(6,4,-6);scene.add(rim);scene.add(model.object3D);
      model.object3D.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model.object3D),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      const camera=new THREE.PerspectiveCamera(35,1,.01,4000),r={model,scene,camera,tile,metric,center,radius:Math.max(size.length(),.5),yaw:.68,pitch:.35,zoom:1,view:item.view||state.view,labels:[]};
      if(state.category==='geo'){
        r.from=model.frame();r.to=r.from;r.cameraFrame={position:new THREE.Vector3(),target:new THREE.Vector3(),span:0};
        const routes=data.roads||[],cityPoints=data.cities||[];
        const points=routes[0]?.points||(cityPoints.length>1?[[cityPoints[0].lon,cityPoints[0].lat],[cityPoints[1].lon,cityPoints[1].lat]]:null);
        if(points){r.route=buildRoute(model,points,{mode:$('flight').checked?'flight':'road'});scene.add(r.route.object3D);
          const vm=await domain('vehicles');if(version!==epoch){r.route.userData.dispose();model.userData.dispose();return;}r.traveller=vm.buildVehicle($('flight').checked?'airplane':'danfo',{detail:'map'});r.traveller.object3D.scale.setScalar(.09);r.route.userData.anchors.traveller.add(r.traveller.object3D);}
        for(const city of Object.values(model.userData.anchors.cities).filter(c=>c.capitalOf||['Lagos','Nairobi','Mombasa'].includes(c.name))){const label=document.createElement('span');label.className='map-label';label.textContent=city.name;tile.append(label);r.labels.push({element:label,point:city.position,projected:new THREE.Vector3()});}
      }
      records.push(r);
    }
    if(state.category==='geo'&&records.length===1){const model=records[0].model;const previous=$('feature').value;const ids=['',...Object.keys(model.userData.features)];optionsFor($('feature'),ids,previous);for(const option of $('feature').options)option.textContent=option.value?model.userData.features[option.value].name:'Whole map';}
    $('note').textContent=state.category==='geo'?'Natural Earth public-domain maps. Kenya: geoBoundaries, CC BY 4.0 collection. Travel corridors are schematic.':'Original procedural geometry. No downloaded model or image texture.';
    pose();render();document.body.dataset.ready='true';
  }catch(error){$('error').textContent=error.stack||String(error);$('error').hidden=false;$('summary').textContent='Preview needs attention';document.body.dataset.ready='error';console.error(error);}
}

function pose(){const progress=Number($('phase').value);$('phasevalue').textContent=progress.toFixed(2);
  for(const r of records){if(state.category==='vehicles')modules.vehicles.poseVehicle(r.model,{distance:progress*20,steering:Number($('steering').value),bounce:.04,door:Number($('door').value),brake:$('brake').checked,indicator:'left',time:progress*2});
    if(state.category==='people')modules.people.poseAvatar(r.model.object3D,{pose:$('pose').value,stride:progress,time:progress*4});
    if(state.category==='environment')modules.environment.poseEnvironment(r.model,{progress,time:progress*2});
    if(state.category==='geo'){r.route?.pose(progress);if($('zoom').checked){const id=$('feature').value;r.to=r.model.frame(id||undefined);transitionCamera(r.from,r.to,progress,r.cameraFrame);}}
  }
}

function render(){if(!records.length)return;
  if(!renderer){renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;renderer.info.autoReset=false;$('stage').prepend(renderer.domElement);}
  const gallery=$('gallery'),width=gallery.clientWidth,height=gallery.clientHeight;
  renderer.setSize(width,height,false);renderer.domElement.style.width=`${width}px`;renderer.domElement.style.height=`${height}px`;renderer.setScissorTest(true);
  let calls=0,triangles=0;
  for(const r of records){const w=r.tile.clientWidth,h=r.tile.clientHeight,x=r.tile.offsetLeft,y=height-r.tile.offsetTop-h;
    renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);r.camera.aspect=w/h;
    const distance=r.radius/(2*Math.tan(THREE.MathUtils.degToRad(35/2)))*Math.max(1,h/w)*1.18*r.zoom;
    let yaw=r.yaw,pitch=r.pitch;if(r.view==='front'){yaw=0;pitch=.05;}if(r.view==='side'){yaw=Math.PI/2;pitch=.05;}if(r.view==='back'){yaw=Math.PI;pitch=.05;}if(r.view==='top'){yaw=0;pitch=1.5;}
    r.camera.position.set(r.center.x+Math.sin(yaw)*Math.cos(pitch)*distance,r.center.y+Math.sin(pitch)*distance,r.center.z+Math.cos(yaw)*Math.cos(pitch)*distance);
    r.camera.lookAt(r.center);if(state.category==='geo'){const f=$('zoom').checked?r.cameraFrame:r.from;const dx=f.position.x-f.target.x,dy=f.position.y-f.target.y,dz=f.position.z-f.target.z,angle=r.yaw-.68,m=Math.max(1,h/w)*r.zoom;r.camera.position.set(f.target.x+(dx*Math.cos(angle)+dz*Math.sin(angle))*m,f.target.y+dy*m,f.target.z+(-dx*Math.sin(angle)+dz*Math.cos(angle))*m);r.camera.lookAt(f.target);}
    r.camera.updateProjectionMatrix();renderer.info.reset();renderer.render(r.scene,r.camera);
    const rc=renderer.info.render.calls,rt=renderer.info.render.triangles;calls+=rc;triangles+=rt;
    r.metric.textContent=`${r.model.userData.triangles.toLocaleString()} tris · ${r.model.userData.drawCalls} model calls | rendered ${rt.toLocaleString()} tris / ${rc} calls`;
    const labelBoxes=[];
    for(const l of r.labels){l.projected.copy(l.point).project(r.camera);const x=(l.projected.x*.5+.5)*w,y=(-l.projected.y*.5+.5)*h,half=l.element.textContent.length*3.1+6;
      l.element.style.left=`${x}px`;l.element.style.top=`${y}px`;const box={x:x-half,y:y-18,w:half*2,h:20};
      l.element.hidden=l.projected.z>1||x<half||x>w-half||y<55||y>h-35||labelBoxes.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y);if(!l.element.hidden)labelBoxes.push(box);}
  }
  $('summary').textContent=`${records.length} ${records.length===1?'model':'models'} · ${triangles.toLocaleString()} rendered triangles`;$('render-status').textContent=`${++renderCount} renders · ${calls} draw calls · idle until input`;
  document.body.dataset.renderCount=String(renderCount);document.body.dataset.modelCount=String(records.length);
  document.body.dataset.gpuGeometries=String(renderer.info.memory.geometries);document.body.dataset.gpuTextures=String(renderer.info.memory.textures);
}

document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{state.category=button.dataset.category;state.type='';state.region=null;state.sheet='';$('sheet').value='';rebuild();}));
document.querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>{state.detail=button.dataset.detail;rebuild();}));
$('model').addEventListener('change',()=>{state.type=$('model').value;state.region=null;rebuild();});
for(const id of ['time','view'])$(id).addEventListener('change',()=>{state[id]=$(id).value;rebuild();});
for(const id of ['hair','outfit','fabric','skin','colour','custom-colour','routeboard','flight'])$(id).addEventListener('change',rebuild);
$('sheet').addEventListener('change',()=>{state.sheet=$('sheet').value;rebuild();});$('grid').addEventListener('change',()=>{state.grid=$('grid').checked;rebuild();});
for(const id of ['phase','door','steering','brake','pose','zoom'])$(id).addEventListener('input',()=>{pose();render();});
$('feature').addEventListener('change',()=>{const r=records[0];if(!r?.model.highlight)return;for(const id of Object.keys(r.model.userData.features))r.model.highlight(id,id===$('feature').value);pose();render();});
$('open-region').addEventListener('click',()=>{const r=records[0],id=$('feature').value;if(!r||!id)return;if(id==='NG'){state.type='nigeria';state.region=null;}else if(id==='KE'){state.type='kenya';state.region=null;}else{state.region=regionData(r.model.data,id);}rebuild();});
$('whole-map').addEventListener('click',()=>{state.region=null;$('zoom').checked=false;$('phase').value='0';rebuild();});
$('reset').addEventListener('click',()=>{for(const r of records){r.yaw=.68;r.pitch=.35;r.zoom=1;r.view=state.view;}render();});
$('gallery').addEventListener('pointerdown',event=>{const r=records.find(r=>r.tile.contains(event.target));if(!r)return;drag={r,x:event.clientX,y:event.clientY};r.tile.setPointerCapture(event.pointerId);});
$('gallery').addEventListener('pointermove',event=>{if(!drag)return;drag.r.view='perspective';drag.r.yaw+=(event.clientX-drag.x)*.008;drag.r.pitch=Math.max(-.1,Math.min(1.5,drag.r.pitch+(event.clientY-drag.y)*.008));drag.x=event.clientX;drag.y=event.clientY;render();});
$('gallery').addEventListener('pointerup',()=>{drag=null;});$('gallery').addEventListener('pointercancel',()=>{drag=null;});
$('gallery').addEventListener('wheel',event=>{const r=records.find(r=>r.tile.contains(event.target));if(!r)return;event.preventDefault();r.zoom=Math.max(.35,Math.min(3,r.zoom*Math.exp(event.deltaY*.001)));render();},{passive:false});
window.addEventListener('resize',render);window.addEventListener('pagehide',()=>{dispose();renderer?.dispose();});
await rebuild();
