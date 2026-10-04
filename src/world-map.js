/** Geographic exploration above the playable city map. Entry remains server/registry gated. */
import './world-map.css';
import { citiesOf,cityAccess,cityEntry } from './map3d/regions.js';
import { modelLibraryEnabled } from './models/integration/flags.js';
import { createWorldMap as createLegacyWorldMap } from './world-map-legacy.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ACCESS={here:{tag:'You are here',action:city=>`Open the ${city.name} map`},enter:{tag:'Open',action:city=>`Go to ${city.name}`},preview:{tag:'Preview',action:city=>`Open your ${city.name} life`},soon:{tag:'Coming soon'}};

export function createWorldMap(container,{onOpenCity=()=>{},onEnterCity=()=>{},held=()=>[],onTravel=()=>{},routes=()=>[]}={}){
  if(!modelLibraryEnabled())return createLegacyWorldMap(container,{onOpenCity,onEnterCity,held,onTravel,routes});
  let current='lagos',selectedCity='lagos',selectedFeature='',scope={kind:'country',id:'nigeria'},data=null,view=null,shown=false,disposed=false,revision=0,loading=false,failure=null;
  const root=document.createElement('section');root.className='wm wm-library';root.setAttribute('aria-label','World map');
  root.innerHTML='<header class="wm-head"></header><div class="wm-stage"><div class="wm-model-stage"></div><p class="wm-model-status" role="status"></p></div><aside class="wm-side" aria-label="Places"></aside>';
  container.append(root);const header=root.querySelector('.wm-head'),side=root.querySelector('.wm-side'),stage=root.querySelector('.wm-model-stage'),status=root.querySelector('.wm-model-status');
  const access=id=>cityEntry(id)?cityAccess(id,{current,held:held()||[]}):'soon';
  const country=()=>scope.kind==='region'?scope.country:scope.kind==='country'?scope.id:null;
  function visibleCities(){
    if(!data||!['country','region'].includes(scope.kind))return [];
    const known=citiesOf(country()||'');
    const selected=scope.kind==='region'?known.filter(c=>data.features.some(f=>geo.containsPoint(f,c.lon,c.lat))):known;
    const extras=known.length&&scope.kind!=='region'?[]:(data.cities||[]).filter(c=>!selected.some(k=>k.name===c.name)).map(c=>({...c,id:`geo:${country()}:${c.id}`,region:data.name,teaser:`${c.name} is not open to play yet.`}));
    return [...selected,...extras].map(c=>({...c,access:access(c.id)})).sort((a,b)=>{const rank=c=>c.access==='here'?0:c.name==='Nairobi'?1:c.name==='Mombasa'?2:3;return rank(a)-rank(b);});
  }
  let geo=null,createView=null;
  const code=Promise.all([import('./models/geo/index.js'),import('./models/integration/geography-view.js')]).then(([g,v])=>{geo=g;createView=v.createGeographyView;});
  function travel(city){
    const offered=routes()?.filter?.(r=>r.to===city.id)||[];
    if(!offered.length||!cityEntry(city.id)||access(city.id)==='soon')return '';
    return `<div class="wm-routes"><h4>Travel options</h4>${offered.map(r=>`<button type="button" class="wm-go" data-wm-travel="${esc(r.to)}:${esc(r.mode)}" ${r.blocked?'disabled':''}>${esc(r.label||r.mode)}${Number.isFinite(r.fare)?` · ₦${r.fare.toLocaleString()}`:''}</button>${r.blocked?`<p>${esc(r.blocked)}</p>`:''}`).join('')}</div>`;
  }
  function chrome(){
    const cities=visibleCities(),city=cities.find(c=>c.id===selectedCity)||cities[0];if(city)selectedCity=city.id;
    const title=data?.name||(scope.kind==='world'?'World':scope.id),feature=data?.features.find(f=>f.id===selectedFeature);
    header.innerHTML=`<nav class="wm-breadcrumb" aria-label="Map levels"><button type="button" data-wm-level="world">World</button><button type="button" data-wm-level="africa">Africa</button><button type="button" data-wm-level="nigeria">Nigeria</button><button type="button" data-wm-level="kenya">Kenya</button></nav><h2>${esc(title)}</h2><p>Explore places near and far. Lagos is open to play.</p>`;
    const choices=(data?.features||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
    side.innerHTML=`${choices.length>1?`<label class="wm-region-label">${scope.kind==='world'||scope.kind==='continent'?'Country':'Region'}<select data-wm-region aria-label="Choose a region"><option value="">Choose a place</option>${choices.map(f=>`<option value="${esc(f.id)}" ${f.id===selectedFeature?'selected':''}>${esc(f.name)}${f.disputed?' · disputed boundary':''}</option>`).join('')}</select></label>`:''}
      ${feature&&choices.length>1?`<button type="button" class="wm-go" data-wm-explore="${esc(feature.id)}">Explore ${esc(feature.name)}</button>`:''}
      ${scope.kind==='region'?`<button type="button" class="wm-back" data-wm-level="${esc(scope.country)}">Back to ${esc(scope.country==='nigeria'?'Nigeria':'Kenya')}</button>`:''}
      ${scope.kind==='world'?`<div class="wm-continents">${['Africa','Europe','Asia','North America','South America','Oceania'].map(c=>`<button type="button" data-wm-continent="${esc(c)}">${esc(c)}</button>`).join('')}</div>`:''}
      ${cities.length?`<ul class="wm-cities">${cities.map(c=>`<li><button type="button" class="wm-city is-${c.access}${c.id===selectedCity?' is-selected':''}" data-wm-city="${esc(c.id)}" aria-pressed="${c.id===selectedCity}"><span class="wm-city-dot" aria-hidden="true"></span><span class="wm-city-text"><b>${esc(c.name)}</b><small>${esc(c.region||data.name)}</small></span><em>${ACCESS[c.access].tag}</em></button></li>`).join('')}</ul>`:''}
      ${city?`<div class="wm-detail is-${city.access}" aria-live="polite"><h3>${esc(city.name)} <span>${ACCESS[city.access].tag}</span></h3><p>${esc(city.teaser||'More places are on the way.')}</p>${ACCESS[city.access].action?`<button type="button" class="wm-go" data-wm-go="${esc(city.id)}">${esc(ACCESS[city.access].action(city))}</button>`:`<p class="wm-wait">${esc(city.name)} is coming soon. You can explore its map now.</p>`}${travel(city)}</div>`:`<p class="wm-wait">Choose a country or region to explore. Map previews do not open new cities for play.</p>`}
      <p class="wm-map-credit">Map data: <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener">Natural Earth</a>${country()==='kenya'?` · Kenya: <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries / RCMRD</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>; simplified`:''}. ${data?.roads?.length?'Travel corridors are schematic.':''} ${data?.features.some(f=>f.disputed)?'Disputed boundaries follow the source and imply no endorsement.':''}</p>`;
    status.textContent=failure|| (loading?'Loading map…':view?.diagnostics.kind==='2d'?'Simple map. Choose places from the list.':'');root.dataset.scope=scope.kind;root.dataset.country=country()||'';root.dataset.ready=String(!loading&&!failure&&!!data);
    if(view){view.setCities(cities);view.select(selectedFeature||null);}
  }
  function simpleMap(){try{return new URLSearchParams(globalThis.location?.search||'').get('map')==='2d'||globalThis.localStorage?.getItem('joinallworld-map')==='2d';}catch{return false;}}
  function show(){if(!shown||disposed||!data||!createView)return;if(!view){view=createView(stage,{simple:simpleMap(),onFeature:id=>{selectedFeature=id;chrome();},onCity:id=>{selectedCity=id;chrome();},onFallback:()=>{status.textContent='Simple map. Choose places from the list.';}});view.setData(data,visibleCities());}view.select(selectedFeature||null);view.resize();}
  async function load(){const ticket=++revision;loading=true;failure=null;chrome();try{await code;let next;
    if(scope.kind==='world')next=await geo.loadGeography('world');
    else if(scope.kind==='continent'){if(scope.id==='Africa')next=await geo.loadGeography('africa');else{const world=await geo.loadGeography('world');next={...world,id:`continent:${scope.id}`,name:scope.id,features:world.features.filter(f=>f.group===scope.id)};}}
    else if(scope.kind==='country'){if(['nigeria','kenya'].includes(scope.id))next=await geo.loadGeography(scope.id);else{const world=await geo.loadGeography('world');next=geo.regionData(world,scope.id);}}
    else{const base=await geo.loadGeography(scope.country);next=geo.regionData(base,scope.id);}
    if(disposed||ticket!==revision)return;data=next;loading=false;selectedFeature='';view?.destroy();view=null;chrome();show();
  }catch(error){if(disposed||ticket!==revision)return;loading=false;failure='This map could not load. Choose another level or try again.';console.error('Geography map:',error);chrome();}}
  function change(next){scope=next;selectedFeature='';void load();}
  function click(event){
    const level=event.target.closest('[data-wm-level]');if(level){const id=level.dataset.wmLevel;change(id==='world'?{kind:'world',id}:id==='africa'?{kind:'continent',id:'Africa'}:{kind:'country',id});return;}
    const continent=event.target.closest('[data-wm-continent]');if(continent){change({kind:'continent',id:continent.dataset.wmContinent});return;}
    const explore=event.target.closest('[data-wm-explore]');if(explore){const id=explore.dataset.wmExplore;if(['world','continent'].includes(scope.kind))change({kind:'country',id:id==='NG'?'nigeria':id==='KE'?'kenya':id});else if(['nigeria','kenya'].includes(scope.id))change({kind:'region',id,country:scope.id});return;}
    const go=event.target.closest('[data-wm-go]');if(go){const id=go.dataset.wmGo,state=access(id);if(state==='here')onOpenCity(id);else if(state==='enter'||state==='preview')onEnterCity(id);return;}
    const trip=event.target.closest('[data-wm-travel]');if(trip&&!trip.disabled){const [to,mode]=trip.dataset.wmTravel.split(':');const offered=routes()?.find?.(r=>r.to===to&&r.mode===mode&&!r.blocked);if(offered&&access(to)!=='soon')onTravel(to,mode);return;}
    const city=event.target.closest('[data-wm-city]');if(city){selectedCity=city.dataset.wmCity;chrome();side.querySelector(`[data-wm-city="${CSS.escape(selectedCity)}"]`)?.focus();}
  }
  const select=event=>{if(event.target.matches('[data-wm-region]')){selectedFeature=event.target.value;chrome();side.querySelector('[data-wm-region]')?.focus();}};
  root.addEventListener('click',click);root.addEventListener('change',select);void load();
  return {setCity(id){const entry=cityEntry(id);if(!entry)return;current=id;selectedCity=id;if(country()!==entry.country)change({kind:'country',id:entry.country});else chrome();},refresh:chrome,setShown(next){next=Boolean(next);if(next===shown)return;shown=next;if(shown)show();else{view?.destroy();view=null;}},resize(){if(shown){show();view?.resize();}},diagnostics(){return {scope,data:data?.id,ready:!!data&&!loading,...view?.diagnostics};},destroy(){disposed=true;revision++;view?.destroy();root.removeEventListener('click',click);root.removeEventListener('change',select);root.remove();}};
}
