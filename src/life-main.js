import { createVenueWorld } from './venue-world.js';
import { createWorldMap } from './world-map.js';
import { createLifeUI } from './life-ui.js';
import { createCommunity } from './community.js';
import { createLife, VENUES, TRAVEL_OPTIONS } from './life.js';
import './life-ui.css';
import './world-map.css';
import './community.css';

const $=id=>document.getElementById(id);
let storage;try{storage=window.localStorage}catch{}
let saved;try{saved=JSON.parse(storage?.getItem('joinallworld-life-v1'))}catch{}
let state=createLife(saved?.state);
let cityId=['lagos','ibadan'].includes(saved?.cityId)?saved.cityId:'lagos';
let identity={name:saved?.identity?.name||'New Lagosian',homeOwned:saved?.identity?.homeOwned===true};
let serverTimeOffset=0,hasSavedIdentity=Boolean(saved?.identity),serverSession=null,serverReady=false,community=null,busy=false,pollTimer=null,clockTimer=null;

const cities={lagos:{name:'Lagos',region:'Lagos State'},ibadan:{name:'Ibadan',region:'Oyo State'}};
const view={mode:'venue',expanded:false,selectedDestination:null,catalog:VENUES,travelModes:TRAVEL_OPTIONS,selectedTravel:'danfo',name:identity.name};
const venue=createVenueWorld($('venue-scene'),{location:state.location});
const world=createWorldMap($('map-scene'),{onSelectCity:city=>openCity(city.id)});
world.setCity(cityId);
const dialog=$('life-dialog'),content=$('life-dialog-content');
const escapeText=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cityCatalog(){if(cityId==='lagos')return VENUES;return {...VENUES,park:{...VENUES.park,label:'Agodi Gardens',district:'Ibadan'},library:{...VENUES.library,label:'City Reading Room',district:'Ibadan'}}}
function destinations(){return Object.values(cityCatalog()).map(v=>({id:v.id,name:v.label,district:v.district,description:v.id==='park'?'A place to relax, enjoy art and meet your city.':'Books, music and a quiet place to unwind.'}))}
function status(text,error=false){$('connection-status').textContent=text;$('connection-status').classList.toggle('error',error)}
function save(){try{if(!storage)throw Error('storage');storage.setItem('joinallworld-life-v1',JSON.stringify({version:1,state,identity,cityId}));if(!serverSession)status('Local preview · saved on this device');return true}catch{status(serverSession?'Server saved · browser cache unavailable':'Not saved · browser storage unavailable',true);return false}}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});let payload;try{payload=await response.json()}catch{throw Error('Server returned an unreadable response')}if(Number.isFinite(payload.serverTime))serverTimeOffset=payload.serverTime-Date.now();if(!response.ok){const error=Error(payload.error==='action_expired'?'Your action time was out of sync. Reconnect and try again.':payload.error||payload.message||'Connection failed');error.status=response.status;error.code=payload.code||payload.error;throw error}return payload}
function modal(html){content.innerHTML=html;dialog.showModal()}
function notice(title,text){modal(`<h2>${title}</h2><p>${text}</p>`)}
function render(){document.body.classList.toggle('map-open',view.mode==='map');view.connected=serverReady;view.catalog=cityCatalog();view.name=identity.name;$('venue-scene').hidden=view.mode!=='venue';$('map-scene').hidden=view.mode!=='map';ui.render(state,view);$('city-switch').textContent='🌍 '+cities[cityId].name;$('retry-server').hidden=serverReady;}
function refreshScene(){if(view.mode==='map')world.resize();else venue.resize()}
function setMode(mode){view.mode=mode;view.selectedDestination=null;render();refreshScene()}
function accept(next){const oldLocation=state.location;state=createLife(next);if(oldLocation!==state.location){venue.setLocation(state.location);view.mode='venue';community?.join(cityId,state.location)}save();render();if(oldLocation!==state.location)refreshScene();scheduleProgress()}
async function command(type,id,mode){
 if(busy)return;
 if(!serverReady||!serverSession){status('Reconnect to save your action. Changes are paused while offline.',true);return}
 busy=true;
 try{
  const response=await api('/api/action',{method:'POST',body:JSON.stringify({actionId:Math.round(Date.now()+serverTimeOffset)+':'+crypto.randomUUID(),cityId,type,id,mode})});
  accept(response.state);
  if(!response.ok)status(state.message,true);
 }catch(error){if(error.status===401)expiredSession();else{serverReady=false;status(error.message,true);render()}}
 finally{busy=false}
}

const ui=createLifeUI($('life-overlay'),{
 onAction:id=>{view.expanded=false;command('activity',id)},
 onCancel:()=>command('cancel'),
 onSpot:id=>{if(VENUES[state.location].spots[id]){view.expanded=true;command('spot',id)}},
 onNavigate:destination=>{if(destination==='map')setMode('map');else if(destination==='home')setMode('venue');else if(destination==='phone')openPhone()},
 onTravel:(destination,mode)=>{view.selectedDestination=null;command('travel',destination,mode)},
 onPanel:panel=>{if(panel==='first-activity'){if(state.location!=='park'){setMode('map');view.selectedDestination=destinations()[0];render()}else{view.expanded=true;command('spot','trees')}}else if(panel==='activities'){view.expanded=!view.expanded;render()}else if(panel==='sim')openSim();else if(panel==='jobs')openPhone();else if(panel==='people')toggleCommunity();else notice('Your first few minutes','Choose Under the trees, then Chill. The activity takes 11 seconds and restores Energy and Fun. Open Map to choose Lagos or Ibadan, or visit another place. Use Community to meet people in the same place. Voice starts only when you choose Join voice.')},
});
function openSim(){modal(`<h2>Your Sim</h2><p>${escapeText(identity.name)} · ${cities[cityId].name}</p>`+Object.entries(state.needs).map(([key,value])=>`<div class="sim-need"><span>${key[0].toUpperCase()+key.slice(1)}</span><meter min="0" max="100" value="${value}"></meter><b>${Math.round(value)}</b></div>`).join('')+'<p class="preview-note">Mood thresholds and starting values are provisional beta settings.</p>')}
function openPhone(){modal('<h2>Phone</h2><div class="phone-menu"><button id="phone-jobs">💼 Jobs</button><button id="phone-community">Community</button><button id="phone-help">Saved progress</button></div>');$('phone-community').onclick=()=>{dialog.close();toggleCommunity(true)};$('phone-jobs').onclick=()=>notice('Jobs are being connected','Reference job listings and requirements are still being verified. Until they are ready, try Chill under the trees and explore the two city previews.');$('phone-help').onclick=()=>notice('Your progress',serverSession?'Your device session is saved on this server. Actions and cash settle together, and duplicate requests cannot charge twice. This is a device identity, not a password-protected account. Do not clear cookies if you want to keep this identity.':'You are in a local preview. Browser storage keeps this preview on this device. Connect to the server to create a separate saved device session.')}
function openCity(id){const city=cities[id];modal(`<h2>${city.name}</h2><p>${city.region}, Nigeria</p><p>${id===cityId?'You are here. Choose somewhere to go.':'Start or continue your own life in this city. City switching is free during the beta.'}</p><button id="enter-city" class="city-primary">${id===cityId?'Explore '+city.name:'Enter '+city.name}</button><div id="city-places"></div><p class="preview-note">Ibadan uses an original starter city pack; its content is still expanding.</p>`);$('enter-city').onclick=async()=>{if(id!==cityId)await switchCity(id);else showPlaces()};if(id===cityId)showPlaces()}
function showPlaces(){$('city-places').innerHTML=destinations().map(v=>`<button data-place="${v.id}">${v.id==='park'?'🌳':'📚'} ${v.name}</button>`).join('');content.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{view.selectedDestination=destinations().find(v=>v.id===b.dataset.place);dialog.close();view.mode='map';render();refreshScene()})}
async function switchCity(id){if(state.activeAction){notice('Finish your activity first','Complete or cancel your current action before switching cities.');return}try{if(serverSession){if(!serverReady)throw Error('Reconnect before switching cities.');const data=await api('/api/life?city='+id);cityId=id;accept(data.state)}else{throw Error('Connect before entering a city.')}world.setCity(id);community?.join(id,state.location);venue.setLocation(state.location);view.mode='venue';render();refreshScene();openCity(id)}catch(e){if(e.status===401)expiredSession();else status(e.message,true)}}
function toggleCommunity(force){$('community-panel').hidden=typeof force==='boolean'?!force:!$('community-panel').hidden}
function expiredSession(){
 serverReady=false;serverSession=null;community?.destroy();community=null;clearTimeout(pollTimer);render();status('Device session expired · saved preview preserved',true);
 modal('<h2>Your device session has expired</h2><p>Your saved preview is still on this browser. The server has retained the old life, but recovery is not available yet. Starting a new life creates a separate identity.</p><button id="keep-preview">Keep my saved preview</button><button id="new-device-life">Start a separate new life</button>');
 $('keep-preview').onclick=()=>dialog.close();$('new-device-life').onclick=()=>{dialog.close();connect(true)};
}
async function connect(createNew=false){status('Connecting…');try{
 let response;
 if(createNew){response=await api('/api/session',{method:'POST',body:JSON.stringify({name:identity.name})});community?.destroy();community=null;}
 else try{response=await api('/api/session')}catch(error){
  if(error.status!==401)throw error;
  if(hasSavedIdentity){expiredSession();return}
  modal('<h2>Start your city life</h2><p>Choose a nickname for this device. This is not a verified account.</p><form id="start-life"><label>Your nickname <input id="new-nickname" minlength="3" maxlength="24" required autocomplete="nickname"></label><button>Start life</button></form>');
  $('new-nickname').value=identity.name;$('start-life').onsubmit=e=>{e.preventDefault();identity.name=$('new-nickname').value.trim();dialog.close();connect(true)};status('Choose a nickname to connect');return;
 }
 serverSession=response.session;hasSavedIdentity=true;identity.name=serverSession.name;serverReady=true;
 const data=await api('/api/life?city='+cityId);accept(data.state);status('Connected · server-saved device session');
 if(!community)community=await createCommunity($('community-content'),{cityId,venueId:state.location,onStatus:s=>{if(s.status==='offline')status('Community disconnected · reconnect in panel',true);else if(s.connected)status('Connected · server-saved device session')}});
 $('retry-server').hidden=true;
 }catch(e){serverReady=false;status(e.status===401?'Session expired · reconnect to review your options':'Connection unavailable · changes paused',true);render()}}

function scheduleProgress(){
 clearTimeout(pollTimer);
 if(document.hidden||!state.activeAction||!serverReady)return;
 pollTimer=setTimeout(async()=>{try{const data=await api('/api/life?city='+cityId);accept(data.state)}catch(e){if(e.status===401)expiredSession();else{serverReady=false;status('Disconnected · action will settle on server',true);render()}}},1000);
}

$('close-life-dialog').onclick=()=>dialog.close();$('city-switch').onclick=()=>{setMode('map');openCity(cityId)};$('community-toggle').onclick=()=>toggleCommunity();$('community-close').onclick=()=>toggleCommunity(false);$('retry-server').onclick=()=>connect();
$('use-location').onclick=()=>{if(!navigator.geolocation){status('Location unavailable. Choose Lagos or Ibadan on the map.',true);return}navigator.geolocation.getCurrentPosition(p=>{const {latitude:lat,longitude:lon}=p.coords;const lagos=Math.hypot(lat-6.5244,lon-3.3792),ibadan=Math.hypot(lat-7.3775,lon-3.947);openCity(lagos<=ibadan?'lagos':'ibadan')},()=>status('Location not shared. Choose a city manually.',true),{enableHighAccuracy:false,timeout:8000,maximumAge:300000})};
window.addEventListener('resize',refreshScene);window.addEventListener('keydown',e=>{if(e.key==='Escape'){view.selectedDestination=null;view.expanded=false;render()}});
window.addEventListener('pagehide',()=>{community?.destroy()});document.addEventListener('visibilitychange',()=>{clearTimeout(clockTimer);scheduleProgress();if(!document.hidden&&serverSession&&serverReady)api('/api/life?city='+cityId).then(d=>accept(d.state)).catch(e=>{if(e.status===401)expiredSession();else status('Reconnect to refresh progress',true)})});
render();refreshScene();connect();
