import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeContext} from '../../game/util.ts';
import { VENUES } from '../../game/cities/lagos/venues.ts';

import { NPCS } from '../../game/cities/lagos/regulars.ts';

import {ANCHORS,UNMAPPED_LANDMARKS} from './layout.ts';
import {spotsOf} from '../../game/api.ts';
import type {ActionBody} from '../../types/actions.ts';
import type {ActionOutcome,LifeContext,LifeState} from '../../types/life.ts';
import {rebuildCatalogue} from '../../game/systems/activities.ts';
import {UNILAG_VENUE,CAMPUS_NPCS} from './content.ts';
import student from './student.ts';
import community from './games.ts';
import shuttle,{SHUTTLE_STOPS} from './shuttle.ts';
import {PROGRAMMES} from './curriculum.ts';

// This is the integration a host must perform in the real registry.
VENUES.unilag=UNILAG_VENUE;Object.assign(NPCS,CAMPUS_NPCS);
const {createLife,dispatch:dispatchTyped,advanceLife,viewLife}=await import('../../life.ts');
/** Loose on purpose, like a request body. */
const dispatch=(state:LifeState,body:{type:string;payload?:Record<string,unknown>},ctx:LifeContext):ActionOutcome=>dispatchTyped(state,body as ActionBody,ctx);
rebuildCatalogue('lagos');

test('actual campus content and all three systems survive a shuttle, enrolment, job and reload',()=>{
 const semester=PROGRAMMES.computer.semesters[0];assert.ok(semester);
 let now=Date.UTC(2026,9,5,8),serial=0;
 const context=()=>makeContext({now,cityId:'lagos',seed:`campus-${serial++}`});
 let state=createLife({location:'unilag',spot:'main-gate',cash:5000,skills:{coding:100}},context());
 const act=(type: string,payload: Record<string,unknown>={})=>dispatch(state,{type,payload},context());
 assert.equal(act('campus-shuttle',{destination:'senate'}).code,'started');
 const saved=structuredClone(state);state=createLife(saved,context());
 assert.ok(state.activeAction);const duration=state.activeAction.remaining;now+=duration*1000;
 advanceLife(state,duration,context());assert.equal(state.spot,'senate');
 assert.equal(state.unilagShuttle.rides,1);const paid=state.cash;
 advanceLife(state,0,context());assert.equal(state.cash,paid);assert.equal(state.unilagShuttle.rides,1);
 assert.equal(act('unilag.apply',{programme:'computer'}).code,'admitted');
 assert.equal(act('unilag.matriculate').code,'matriculated');
 assert.equal(act('unilag.register-semester',{courses:semester.courses.map(c=>c.id)}).code,'registered');
 assert.equal(act('unilag.hostel.allocate',{hall:'mariere'}).code,'hostel_allocated');
 assert.equal(act('spot',{id:'library'}).code,'selected');
 assert.equal(act('unilag.job',{id:'library-assistant'}).code,'started');
 state=createLife(structuredClone(state),context());now+=60000;advanceLife(state,60,context());
 assert.equal(state.cash,3500); // 5000 - 50 - 200 - 1100 - 300 + 150.
 assert.equal(act('unilag.job',{id:'tutor'}).code,'campus_job_done');
 assert.equal(act('unilag.election.vote',{candidate:'another-life'}).code,'server_only');
 const view=viewLife(state,context());assert.equal(view.unilagStudent.programme?.id,'computer');
 assert.ok(view.social.here.some(n=>n.id==='lecturer-ada'));
 const shuttleStops=new Set<string>(SHUTTLE_STOPS.map(stop=>stop.id));
 assert.deepEqual(view.unilagShuttle.stops.map(stop=>stop.id),SHUTTLE_STOPS.map(stop=>stop.id),'the public shuttle view exposes exactly the stops with mapped safe anchors');
 for(const stop of SHUTTLE_STOPS){assert.ok(ANCHORS[stop.id],`Missing map anchor for shuttle stop ${stop.id}`);assert.ok(UNILAG_VENUE.spots[stop.id],`Missing venue content for shuttle stop ${stop.id}`);}
 for(const id of UNMAPPED_LANDMARKS)assert.ok(!shuttleStops.has(id),`${id} has no invented shuttle coordinate`);
 const actualSpots=spotsOf('unilag','lagos');
 assert.deepEqual(actualSpots.map(spot=>spot.id).sort(),Object.keys(UNILAG_VENUE.spots).sort(),'all authored campus content spots remain available to the systems');
 for(const id of UNMAPPED_LANDMARKS)assert.ok(actualSpots.some(spot=>spot.id===id),`${id} remains system content despite lacking a mapped coordinate`);
 assert.ok(actualSpots.some(spot=>spot.id==='people'),'the generic people spot remains nonspatial system content');
 const copy=createLife(structuredClone(state),context());
 assert.deepEqual(copy.unilagStudent,state.unilagStudent);assert.deepEqual(copy.unilagCommunity,state.unilagCommunity);assert.deepEqual(copy.unilagShuttle,state.unilagShuttle);
 assert.equal(copy.cash,state.cash);
});
