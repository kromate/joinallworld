import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('community microphone safeguards, spatial playback, and multi-tab venue revocation', async (t) => {
  const globalNames = ['document', 'window', 'location', 'fetch', 'navigator', 'WebSocket', 'RTCPeerConnection', 'setInterval', 'clearInterval'];
  const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const liveApis = [];
  t.after(() => {
    try { for (const api of liveApis) api.destroy(); }
    finally {
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
  class Element {
    constructor(){this.events={};this.children=[];this.hidden=false;this.value='';this.textContent='';this.attrs={};this.style={};}
    addEventListener(n,fn){this.events[n]=fn;} removeEventListener(n){delete this.events[n];}
    setAttribute(n,v){this.attrs[n]=v;} append(...els){this.children.push(...els);for(const el of els)el.parent=this;}
    replaceChildren(...els){this.children=[];this.append(...els);} remove(){if(this.parent)this.parent.children=this.parent.children.filter(el=>el!==this);}
    get firstElementChild(){return this.children[0];} querySelector(s){return this.selectors?.[s];}
    async fire(n){return this.events[n]?.({preventDefault(){}});}
    play(){this.playCalls=(this.playCalls||0)+1;return Promise.resolve();}
  }
  const selectors=['connection','room','name','content','members','count','messages','compose','join-voice','mute','leave-voice','voice-status','audio','feedback','retry','device','position','position-map','north','south','west','east','network-note','playback-note','proximity','voice','chat','private-note'];
  const els=Object.fromEntries(selectors.map(n=>[`.community-${n}`,new Element()]));
  els['#community-microphone']=new Element();
  els['.community-name'].selectors={input:new Element(),button:new Element()};
  els['.community-compose'].selectors={input:new Element(),button:new Element()};
  const container=new Element();container.selectors=els;
  globalThis.document={createElement(){return new Element();}};
  globalThis.window=new Element();window.RTCPeerConnection=function(){};
  globalThis.location={protocol:'http:',host:'localhost:5173'};
  let voiceConfigCalls=0;
  globalThis.fetch=async url=>({ok:true,json:async()=>url==='/api/voice-config'?(voiceConfigCalls++,{iceServers:[{urls:'stun:test'}],mode:'stun-only',turnConfigured:false}):({session:{id:'a',name:'Alex'}})});
  let mediaCalls=0, stopped=0, enumerateCalls=0; const constraints=[];
  const track={enabled:true,stop(){stopped++;}};
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{enumerateDevices:async()=>{enumerateCalls++;return [{kind:'audioinput',deviceId:'test-mic',label:'Test microphone'}];},getUserMedia:async options=>{mediaCalls++;constraints.push(options);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}},configurable:true});
  class WS {static OPEN=1;static CONNECTING=0;static instances=[];constructor(){this.readyState=0;this.sent=[];WS.instances.push(this);}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}open(){this.readyState=1;this.onopen();}receive(data){data.members?.forEach(member=>{member.position??={x:0,z:0};});this.onmessage({data:JSON.stringify(data)});}}
  globalThis.WebSocket=WS;
  const source=(await readFile(new URL('./community.js', import.meta.url), 'utf8')).replace("import './community.css';", '') + '\n//# sourceURL=community-under-test.js';
  const {createCommunity}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const statuses=[];
  const api=await createCommunity(container,{onStatus:s=>statuses.push(s)});
  liveApis.push(api);
  assert.equal(mediaCalls,0,'initialization must never request mic');assert.deepEqual(api.getSession(),{id:'a',name:'Alex'});
  const ws=WS.instances[0];ws.open();assert.deepEqual(ws.sent[0],{type:'join',cityId:'lagos',venueId:'park'});
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false,muted:false}]});
  assert.equal(mediaCalls,0,'presence must never request mic');
  await els['.community-join-voice'].fire('click');assert.equal(mediaCalls,1);assert.equal(stopped,0);
  assert.deepEqual(ws.sent.at(-1),{type:'voice-state',enabled:true,muted:true});
  assert.equal(track.enabled,false,'join defaults muted');
  assert.equal(enumerateCalls,1,'picker only lists devices after permission');
  await els['.community-mute'].fire('click');assert.equal(track.enabled,true,'explicit unmute enables mic');
  els['#community-microphone'].value='test-mic';await els['#community-microphone'].fire('change');
  api.join('ibadan','library');assert.equal(stopped,1,'room change stops microphone');assert.deepEqual(ws.sent.at(-1),{type:'join',cityId:'ibadan',venueId:'library'});
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false,muted:false}]});
  els['.community-compose'].selectors.input.value='Hello';await els['.community-compose'].fire('submit');
  const chat=ws.sent.at(-1);assert.equal(chat.type,'chat');assert.equal(chat.body,'Hello');assert.ok(chat.clientId);
  ws.receive({type:'error',error:'rate_limited',clientId:chat.clientId});
  assert.equal(els['.community-messages'].children[0].children[0].children[1].textContent,'Not sent');
  const sentCount=ws.sent.length;
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false,muted:false}]});
  assert.equal(ws.sent.length,sentCount,'rejected messages never auto retry');
  await els['.community-messages'].children[0].children.at(-1).fire('click');
  assert.equal(ws.sent.at(-1).clientId,chat.clientId,'manual retry retains dedupe id');
  ws.receive({type:'chat',id:'message1',clientId:chat.clientId,from:{id:'a',name:'Alex'},body:'Hello',at:1});
  assert.equal(els['.community-messages'].children.length,1);assert.equal(els['.community-messages'].children[0].children[0].children[1].textContent,'Sent');
  ws.receive({type:'chat',id:'message1',clientId:chat.clientId,from:{id:'a',name:'Alex'},body:'Hello',at:1});assert.equal(els['.community-messages'].children.length,1,'duplicate echo suppressed');
  await els['.community-join-voice'].fire('click');assert.equal(mediaCalls,2);assert.deepEqual(constraints[1],{audio:{deviceId:{exact:'test-mic'}},video:false});assert.equal(track.enabled,false);
  class PC {
    static all=[];constructor(config){this.config=config;this.signalingState='stable';this.connectionState='new';PC.all.push(this);}
    addTrack(){} async createOffer(){return {type:'offer',sdp:'offer'};} async createAnswer(){return {type:'answer',sdp:'answer'};}
    async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.signalingState=d.type==='offer'?'have-local-offer':'stable';}
    async setRemoteDescription(d){this.remoteDescription=d;this.signalingState=d.type==='offer'?'have-remote-offer':'stable';}
    async addIceCandidate(c){this.lastCandidate=c;} close(){this.closed=true;}
  }
  globalThis.RTCPeerConnection=PC;
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true},{id:'b',name:'Bea',enabled:true}]});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(PC.all.length,1);assert.equal(ws.sent.at(-1).data.description.type,'offer','lower id offers');
  ws.receive({type:'signal',from:'b',data:{candidate:{candidate:'ice'}}});
  ws.receive({type:'signal',from:'b',data:{description:{type:'answer',sdp:'answer'}}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(PC.all[0].remoteDescription.type,'answer');assert.equal(PC.all[0].lastCandidate.candidate,'ice');
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true}]});assert.equal(PC.all[0].closed,true,'departed peer closes');
  ws.receive({type:'signal',from:'outside',data:{description:{type:'offer',sdp:'bad'}}});assert.equal(PC.all.length,1,'outside-room signal ignored');
  api.destroy();assert.equal(stopped,2,'destroy stops microphone');assert.equal(ws.readyState,3);assert.equal(container.children.length,0);
  assert.ok(statuses.some(s=>s.status==='online'&&s.connected&&s.session.id==='a'));
  let factoryCalls=0, syntheticStops=0, diagnosticsCalls=0, timerCallback=null, timerCleared=false;
  const syntheticTrack={enabled:true,readyState:'live',stop(){syntheticStops++;this.readyState='ended';}};
  const originalSetInterval=globalThis.setInterval,originalClearInterval=globalThis.clearInterval;
  globalThis.setInterval=(callback,delay)=>{assert.equal(delay,1000,'diagnostics sample at most 1Hz');timerCallback=callback;return 99;};
  globalThis.clearInterval=id=>{if(id===99)timerCleared=true;};
  let contextsClosed=0,remoteStops=0,sourceConnections=0,outputConnections=0,contextCreations=0;
  window.AudioContext=class {
    constructor(){contextCreations++;this.destination={kind:'destination'};this.state='running';}
    createMediaStreamSource(){return {connect(target){assert.equal(target.kind,'gain');sourceConnections++;},disconnect(){}};}
    createGain(){return {kind:'gain',gain:{value:1},connect(target){if(target.kind==='analyser')target.inputGain=this;else {assert.equal(target.kind,'destination');outputConnections++;}},disconnect(){}};}
    createAnalyser(){return {kind:'analyser',fftSize:512,getFloatTimeDomainData(samples){samples.fill(.25*this.inputGain.gain.value);},disconnect(){}};}
    async resume(){} async close(){contextsClosed++;}
  };
  const callsBeforeSynthetic=mediaCalls;
  const syntheticApi=await createCommunity(container,{audioStreamFactory:async()=>{factoryCalls++;return {getTracks:()=>[syntheticTrack],getAudioTracks:()=>[syntheticTrack]};},diagnostics:true,onPeerStats(){diagnosticsCalls++;},iceTransportPolicy:'relay'});
  liveApis.push(syntheticApi);
  const syntheticWs=WS.instances.at(-1);syntheticWs.open();syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false}]});
  assert.equal(factoryCalls,0,'synthetic factory gated behind explicit Join');assert.equal(contextCreations,0,'playback context absent before Join gesture');
  await els['.community-join-voice'].fire('click');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(factoryCalls,1);assert.equal(mediaCalls,callsBeforeSynthetic,'synthetic mode never captures microphone');
  assert.equal(syntheticTrack.enabled,false);assert.equal(els['.community-mute'].textContent,'Unmute test audio');
  assert.deepEqual(await syntheticApi.getDiagnostics(),{voice:true,muted:true,trackCount:1,liveTrackCount:1,localTracks:[{enabled:false,muted:undefined,readyState:'live'}],playbackContextState:'running',position:{x:0,z:0},relayMode:'stun-only',peers:[]});
  
  PC.prototype.getStats=async()=>new Map([[1,{kind:'audio',type:'inbound-rtp',packetsReceived:20,totalAudioEnergy:.5}],[2,{kind:'audio',type:'outbound-rtp',packetsSent:30}],[3,{kind:'audio',type:'media-source',audioLevel:.2,totalAudioEnergy:.8}]]);
  syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true},{id:'b',name:'Bea',enabled:true}]});
  await new Promise(resolve=>setTimeout(resolve,0));
  const remoteTrack={readyState:'live',stop(){remoteStops++;this.readyState='ended';}};
  PC.all.at(-1).ontrack({streams:[{getTracks:()=>[remoteTrack]}],track:remoteTrack});
  const measured=await syntheticApi.getDiagnostics();
  assert.equal(measured.liveTrackCount,2);assert.equal(measured.peers[0].rms,.25);
  assert.equal(measured.peers[0].inboundPacketsReceived,20);assert.equal(measured.peers[0].totalAudioEnergy,.5);assert.equal(measured.peers[0].outboundPacketsSent,30);assert.equal(measured.peers[0].sourceAudioLevel,.2);assert.equal(measured.peers[0].sourceTotalAudioEnergy,.8);
  assert.equal(PC.all.at(-1).config.iceTransportPolicy,'relay','optional relay policy is passed to actual peer connection');assert.equal(sourceConnections,1,'source routes once through gain');assert.equal(outputConnections,1,'gain routes once to destination');
  const routedAudio=els['.community-audio'].children.at(-1).children[0];assert.equal(routedAudio.muted,true);assert.ok(routedAudio.srcObject);assert.equal(routedAudio.playCalls,1,'WebAudio uses one muted decode sink');
  syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true,position:{x:0,z:0}},{id:'b',name:'Bea',enabled:true,position:{x:6,z:0}}]});
  assert.equal((await syntheticApi.getDiagnostics()).peers[0].gain,.5,'half-range halves receive gain');assert.equal((await syntheticApi.getDiagnostics()).peers[0].rms,.125,'post-gain analyser amplitude halves');
  await els['.community-east'].fire('click');assert.deepEqual(syntheticWs.sent.at(-1),{type:'move',x:2,z:0});
  assert.equal(syntheticApi.moveTo(0,0),true);assert.deepEqual(syntheticWs.sent.at(-1),{type:'move',x:0.01,z:0},'a reported position is never exactly the origin, which means "not reported yet"');
  assert.equal(syntheticApi.moveTo(40,-40),true);assert.deepEqual(syntheticWs.sent.at(-1),{type:'move',x:20,z:-20},'reports are kept inside the server bounds');
  assert.deepEqual((await syntheticApi.getDiagnostics()).position,{x:0,z:0},'move never optimistically overrides server position');
  const nearPeer=PC.all.at(-1);
  syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true,position:{x:0,z:0}},{id:'b',name:'Bea',enabled:true,position:{x:13,z:0}}]});
  assert.equal(nearPeer.closed,true,'out-of-range peer hard closes');assert.equal((await syntheticApi.getDiagnostics()).peers.length,0);
  const beforeReentry=PC.all.length;
  syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true,position:{x:0,z:0}},{id:'b',name:'Bea',enabled:true,position:{x:3,z:0}}]});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(PC.all.length,beforeReentry+1,'range reentry negotiates fresh peer');
  assert.equal((await syntheticApi.getDiagnostics()).peers[0].gain,.75);
  const rejectedPeer=PC.all.at(-1),countBeforeRejected=PC.all.length;
  syntheticWs.receive({type:'error',error:'peer_out_of_range',to:'b'});
  assert.equal(rejectedPeer.closed,true);assert.equal((await syntheticApi.getDiagnostics()).peers.length,0);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(PC.all.length,countBeforeRejected,'rejection never immediately loops reconnect');
  syntheticWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true,position:{x:0,z:0}},{id:'b',name:'Bea',enabled:true,position:{x:3,z:0}}]});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(PC.all.length,countBeforeRejected+1,'fresh authoritative presence retries rejected peer');
  assert.equal(voiceConfigCalls,3,'each fresh Join fetches server ICE without persistent credentials');
  assert.equal(diagnosticsCalls,1);await timerCallback();assert.equal(diagnosticsCalls,2);
  await els['.community-leave-voice'].fire('click');assert.equal(timerCleared,true);assert.equal(syntheticStops,1);assert.equal(contextsClosed,1);assert.equal(remoteStops,1);
  assert.deepEqual(await syntheticApi.getDiagnostics(),{voice:false,muted:false,trackCount:0,liveTrackCount:0,localTracks:[],playbackContextState:null,position:{x:0,z:0},relayMode:null,peers:[]});
  await timerCallback();assert.equal(diagnosticsCalls,2,'stale diagnostics callback cannot publish after leave');
  syntheticApi.join('lagos','home');assert.ok(els['.community-room'].textContent.includes('Your home (private)'));assert.equal(els['.community-proximity'].hidden,true);assert.equal(els['.community-voice'].hidden,true);assert.equal(els['.community-chat'].hidden,true);
  syntheticApi.destroy();globalThis.setInterval=originalSetInterval;globalThis.clearInterval=originalClearInterval;
  let revokedStops=0,revokedFactoryCalls=0;
  const revokedTrack={enabled:true,readyState:'live',stop(){revokedStops++;this.readyState='ended';}};
  const contextsBeforeRevocation=contextsClosed;
  const revokedApi=await createCommunity(container,{diagnostics:true,audioStreamFactory:async()=>{revokedFactoryCalls++;return {getTracks:()=>[revokedTrack],getAudioTracks:()=>[revokedTrack]};}});
  liveApis.push(revokedApi);
  const revokedWs=WS.instances.at(-1);revokedWs.open();revokedWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false}]});
  await els['.community-join-voice'].fire('click');assert.equal(revokedFactoryCalls,1);
  revokedWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:true},{id:'b',name:'Bea',enabled:true}]});
  await new Promise(resolve=>setTimeout(resolve,0));const revokedPeer=PC.all.at(-1);
  els['.community-compose'].selectors.input.value='Pending before travel';await els['.community-compose'].fire('submit');const revokedChatRow=els['.community-messages'].children.at(-1);
  revokedWs.receive({type:'error',code:'venue_mismatch',error:'venue_mismatch'});
  const revokedSnapshot=await revokedApi.getDiagnostics();
  assert.equal(revokedSnapshot.voice,false);assert.equal(revokedSnapshot.liveTrackCount,0);assert.equal(revokedSnapshot.playbackContextState,null);
  assert.equal(revokedStops,1);assert.equal(revokedPeer.closed,true);assert.equal(contextsClosed,contextsBeforeRevocation+1);
  assert.equal(els['.community-join-voice'].disabled,true);assert.equal(els['.community-compose'].selectors.input.disabled,true);
  assert.equal(revokedChatRow.children[0].children[1].textContent,'Not sent: you moved to another place');
  assert.equal(els['.community-feedback'].textContent,'You moved to another place. Return to the game to reconnect here.');
  const sentAfterRevocation=revokedWs.sent.length;
  await els['.community-join-voice'].fire('click');assert.equal(revokedFactoryCalls,1,'revoked Join never reacquires stream');
  els['.community-compose'].selectors.input.value='Stale chat';await els['.community-compose'].fire('submit');assert.equal(revokedWs.sent.length,sentAfterRevocation,'revoked room rejects stale chat');assert.equal(revokedApi.moveTo(2,2),false);
  revokedWs.receive({type:'presence',members:[]});assert.equal(els['.community-join-voice'].disabled,true,'presence lacking self cannot renew membership');
  revokedWs.close();const socketCount=WS.instances.length;await els['.community-retry'].fire('click');assert.equal(WS.instances.length,socketCount,'Reconnect cannot automatically rejoin revoked room');
  revokedApi.join('lagos','park');assert.equal(WS.instances.length,socketCount+1,'explicit legitimate room join can reconnect same room');
  const renewedWs=WS.instances.at(-1);renewedWs.open();renewedWs.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false}]});
  assert.equal(els['.community-join-voice'].disabled,false);assert.equal(els['.community-connection'].textContent,'Connected','explicit same-room recovery restores connection label');assert.equal(revokedFactoryCalls,1,'membership renewal never automatically recaptures audio');
  assert.equal(renewedWs.sent.filter(message=>message.type==='chat').length,0,'stale pending chat never retries after renewed membership');
  revokedApi.destroy();
});

test('positions: the game moves the avatar, the room reports everyone back, and none of it touches the microphone', async (t) => {
  const globalNames = ['document', 'window', 'location', 'fetch', 'navigator', 'WebSocket', 'RTCPeerConnection'];
  const originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let api = null;
  t.after(() => { try { api?.destroy(); } finally { for (const [name, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } } });
  class Element {
    constructor(){this.events={};this.children=[];this.hidden=false;this.value='';this.textContent='';this.attrs={};this.style={};}
    addEventListener(n,fn){this.events[n]=fn;} removeEventListener(n){delete this.events[n];}
    setAttribute(n,v){this.attrs[n]=v;} append(...els){this.children.push(...els);} replaceChildren(...els){this.children=[...els];} remove(){}
    get firstElementChild(){return this.children[0];} querySelector(s){return this.selectors?.[s];}
    async fire(n){return this.events[n]?.({preventDefault(){}});}
  }
  const names=['connection','room','name','content','members','count','messages','compose','join-voice','mute','leave-voice','voice-status','audio','feedback','retry','device','position','north','south','west','east','network-note','playback-note','proximity','voice','chat','private-note'];
  const els=Object.fromEntries(names.map(n=>[`.community-${n}`,new Element()]));
  els['#community-microphone']=new Element();
  els['.community-name'].selectors={input:new Element(),button:new Element()};els['.community-compose'].selectors={input:new Element(),button:new Element()};
  const container=new Element();container.selectors=els;
  globalThis.document={createElement(){return new Element();}};
  globalThis.window=new Element();window.RTCPeerConnection=function(){};
  globalThis.location={protocol:'http:',host:'localhost:5173'};
  globalThis.fetch=async()=>({ok:true,json:async()=>({session:{id:'a',name:'Alex'}})});
  let mediaCalls=0;
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{mediaCalls++;throw new Error('must not be asked');}}},configurable:true});
  class WS {static OPEN=1;static CONNECTING=0;static instances=[];constructor(){this.readyState=0;this.sent=[];WS.instances.push(this);}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}open(){this.readyState=1;this.onopen();}receive(data){this.onmessage({data:JSON.stringify(data)});}}
  globalThis.WebSocket=WS;
  const source=(await readFile(new URL('./community.js', import.meta.url), 'utf8')).replace("import './community.css';", '') + '\n//# sourceURL=community-positions-under-test.js';
  const {createCommunity}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const seen=[], steps=[]; let walks=true;
  api=await createCommunity(container,{onMembers:(list)=>seen.push(list),onStep:(dx,dz)=>{steps.push([dx,dz]);return walks;}});
  const ws=WS.instances.at(-1);
  assert.equal(api.moveTo(3,4),false,'no room yet: nothing is sent');
  ws.open();
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false,muted:true,position:{x:0,z:0}},{id:'b',name:'Bea',enabled:false,muted:true,position:{x:6,z:-2}}]});
  assert.deepEqual(seen.at(-1),{self:'a',members:[{id:'a',name:'Alex',position:null},{id:'b',name:'Bea',position:{x:6,z:-2}}]},'the game is told who is here and where; the origin means "not reported yet"');
  assert.equal(api.moveTo(3.25,-4.5),true);assert.deepEqual(ws.sent.at(-1),{type:'move',x:3.25,z:-4.5},'the scene position is what the room is told');
  ws.receive({type:'presence',members:[{id:'a',name:'Alex',enabled:false,muted:true,position:{x:3.25,z:-4.5}},{id:'b',name:'Bea',enabled:true,muted:false,position:{x:6,z:-2}}]});
  assert.deepEqual(seen.at(-1).members[0].position,{x:3.25,z:-4.5});
  assert.match(els['.community-position'].textContent,/1 of 1 person in voice is within range/,'the panel says who is in range of where you stand');
  // The Walk buttons ask the game to walk the avatar; only without a scene do they move the voice position directly.
  const before=ws.sent.length;
  await els['.community-north'].fire('click');await els['.community-east'].fire('click');
  assert.deepEqual(steps,[[0,-2],[2,0]]);assert.equal(ws.sent.length,before,'the game walked: the panel itself sent nothing');
  walks=false;await els['.community-west'].fire('click');
  assert.deepEqual(ws.sent.at(-1),{type:'move',x:1.25,z:-4.5},'no scene: the button moves the voice position as before');
  // Revocation empties the list for the game, refuses further moves and never touched the microphone.
  ws.receive({type:'error',code:'venue_mismatch',error:'venue_mismatch'});
  assert.deepEqual(seen.at(-1),{self:'a',members:[]},'a revoked room has nobody in it');
  assert.equal(api.moveTo(1,1),false,'a revoked room accepts no position');
  const sent=ws.sent.length;await els['.community-north'].fire('click');assert.equal(ws.sent.length,sent,'nor does a Walk button reach it');
  assert.equal(mediaCalls,0,'positions never ask for the microphone');
  assert.ok(ws.sent.every((message)=>message.type!=='voice-state'||message.enabled===false),'and never enable voice');
  api.destroy();assert.deepEqual(seen.at(-1),{self:'a',members:[]});api=null;
});
