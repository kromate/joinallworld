import { loadCityContent as preloadCityContent } from './game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The client is a read-only mirror: offline it sends nothing and grants nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient, outgoing, TEXT, STORAGE_KEY, roomJoinNeeded } from './client.ts';
import { dispatch } from './life.ts';
import { START_HOMES, TRAITS, DREAMS } from './game/content/traits.ts';
import { createLife } from './life.ts';
import type { ApiError, NameProblem } from './client.ts';
import type { ActionBody, ActionType } from './types/actions.ts';
import type { LifeState } from './types/life.ts';
import type { OwnSession } from './types/protocol.ts';

/** What the tests read of a request body the client sent. */
interface SentBody { actionId?: string; cityId?: string; type?: string; payload?: unknown }
/** [method, path, parsed request body] of one fake request. */
type Call = [string, string, SentBody | undefined]
/** A fake fetch answer: only what the client reads. */
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
/** Test states that are deliberately not full lives (an action kind this build does not know). */
const loose = (value: unknown) => value as LifeState;

function harness({ online = true } = {}) {
  const calls: Call[] = [], statuses: [string, boolean][] = [], changes: LifeState[] = [];
  let life = createLife({ name: 'Ada' }), up = online, session: OwnSession | null = { id: 'public-1', name: 'Ada' };
  const memory = new Map();
  const fetch = async (path: string, options: RequestInit = {}) => {
    calls.push([options.method || 'GET', path, options.body ? JSON.parse(options.body as string) as SentBody : undefined]);
    if (!up) throw new TypeError('fetch failed');
    if (path === '/api/session') return session ? json(200, { session, serverTime: 5000 }) : json(401, { error: 'device_session_required' });
    if (path.startsWith('/api/life')) return json(200, { state: life, serverTime: 5000 });
    if (path === '/api/action') { life = { ...life, cash: life.cash - 400, message: 'Travelling to The Library.' }; return json(200, { ok: true, code: 'started', state: life, serverTime: 5000 }); }
    return json(404, { error: 'not_found' });
  };
  const client = createClient({ fetch, now: () => 1000, randomUUID: () => '11111111-1111-4111-8111-111111111111', setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    onStatus: (text, error) => statuses.push([text, error]), onChange: state => changes.push(state) });
  return { client, calls, statuses, changes, memory, setUp: (value: boolean) => { up = value; }, dropSession: () => { session = null; } };
}

test('offline client is read-only: no request, no local grant, state unchanged', async () => {
  const h = harness({ online: false });
  assert.equal(await h.client.connect(), false);
  assert.equal(h.client.online, false);
  const before = JSON.stringify(h.client.state); h.calls.length = 0;
  const attempts: [ActionType, Record<string, unknown> | undefined][] = [['travel', { id: 'library', mode: 'cab' }], ['activity', { id: 'chill' }], ['apply-job', { id: 'community-helper' }], ['cancel', undefined]];
  for (const [type, payload] of attempts) {
    assert.deepEqual(await h.client.command(type, payload), { ok: false, code: 'offline', reason: TEXT.paused[h.client.link] });
  }
  assert.equal((await h.client.switchCity('ibadan')).ok, false);
  assert.equal(h.calls.length, 0, 'nothing was sent');
  assert.equal(JSON.stringify(h.client.state), before, 'nothing was applied locally');
  assert.equal(h.client.cityId, 'lagos');
});

test('online commands carry a server-time action ID and a payload, and only server state is accepted', async () => {
  const h = harness();
  assert.equal(await h.client.connect(), true);
  assert.equal(h.client.serverTimeOffset, 4000);
  const result = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.deepEqual(result, { ok: true, code: 'started', reason: undefined });
  const [method, path, body] = h.calls.at(-1) as Call;
  assert.deepEqual([method, path], ['POST', '/api/action']);
  assert.deepEqual(body, { actionId: '5000:11111111-1111-4111-8111-111111111111', cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'cab' } });
  assert.equal(h.client.state.cash, 4600);
  assert.equal(JSON.parse(h.memory.get(STORAGE_KEY)).state.cash, 4600, 'cache mirrors the server state');
});

test('a fresh visitor stays preview-only until its first authoritative life is accepted', async () => {
  const h=harness();assert.equal(h.client.snapshotPhase,'preview');await h.client.connect();assert.equal(h.client.snapshotPhase,'available')
  const saved=JSON.parse(h.memory.get(STORAGE_KEY));assert.equal(saved.ownerId,'public-1');assert.equal(saved.state.cash,5000)
})

test('a different confirmed identity cannot inherit a cached name, balance or scene when its wallet is quarantined', async () => {
  const old=createLife({name:'Ada',cash:4600,location:'library'}),memory=new Map([[STORAGE_KEY,JSON.stringify({version:1,state:old,ownerId:'public-a',identity:{name:'Ada'},cityId:'lagos'})]])
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>path==='/api/session'
    ?json(200,{session:{id:'public-b',name:'Bola',cities:['lagos']},serverTime:1000}):json(409,{error:'economy_unavailable',reason:'Wallet recovery required.'})})
  assert.equal(client.snapshotPhase,'unconfirmed');assert.equal(await client.connect(),false)
  assert.deepEqual([client.session?.id,client.link,client.snapshotPhase,client.online],['public-b','recovery','unavailable',false])
  const saved=JSON.parse(String(memory.get(STORAGE_KEY)));assert.equal('state'in saved,false);assert.equal('ownerId'in saved,false)
})

test('a confirmed same-owner cache remains last-known during wallet recovery', async () => {
  const old=createLife({name:'Ada',cash:4600,location:'library'}),memory=new Map([[STORAGE_KEY,JSON.stringify({version:1,state:old,ownerId:'public-a',identity:{name:'Ada'},cityId:'lagos'})]])
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>path==='/api/session'
    ?json(200,{session:{id:'public-a',name:'Ada',cities:['lagos']},serverTime:1000}):json(409,{error:'economy_unavailable',reason:'Wallet recovery required.'})})
  assert.equal(await client.connect(),false);assert.deepEqual([client.snapshotPhase,client.state.cash,client.state.location,client.link],['available',4600,'library','recovery'])
})

test('a mismatched cache becomes available only with the new identity authoritative life', async () => {
  const old=createLife({name:'Ada',cash:4600,location:'library'}),next=createLife({name:'Bola',cash:7200,location:'park'}),memory=new Map([[STORAGE_KEY,JSON.stringify({version:1,state:old,ownerId:'public-a',identity:{name:'Ada'},cityId:'lagos'})]])
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>path==='/api/session'
    ?json(200,{session:{id:'public-b',name:'Bola',cities:['lagos']},serverTime:1000}):json(200,{state:next,rev:7,serverTime:1000})})
  assert.equal(await client.connect(),true);assert.deepEqual([client.snapshotPhase,client.session?.id,client.state.name,client.state.cash,client.state.location],['available','public-b','Bola',7200,'park'])
})

test('a late saved-campus hydration cannot restore a cache after identity mismatch', async () => {
  const old=createLife({name:'Ada',cash:4600,location:'library'}),memory=new Map([[STORAGE_KEY,JSON.stringify({version:1,state:old,ownerId:'public-a',identity:{name:'Ada'},cityId:'lagos'})]])
  let release:()=>void=()=>{},calls=0;const waiting=new Promise<void>(done=>{release=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},loadCampus:()=>calls++===0?waiting:null,fetch:async path=>path==='/api/session'
    ?json(200,{session:{id:'public-b',name:'Bola',cities:['lagos']},serverTime:1000}):json(409,{error:'economy_unavailable'})})
  await client.connect();const before=client.state.cash;release();await Promise.resolve();assert.equal(client.snapshotPhase,'unavailable');assert.equal(client.state.cash,before);assert.notEqual(client.state.cash,4600)
})

test('same-owner deferred campus cache stays masked until hydration after life recovery fails', async () => {
  const old=createLife({name:'Ada',cash:4600}),memory=new Map([[STORAGE_KEY,JSON.stringify({version:1,state:old,ownerId:'public-a',identity:{name:'Ada'},cityId:'lagos'})]])
  let release:()=>void=()=>{},calls=0;const waiting=new Promise<void>(done=>{release=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},loadCampus:()=>calls++===0?waiting:null,fetch:async path=>path==='/api/session'
    ?json(200,{session:{id:'public-a',name:'Ada',cities:['lagos']},serverTime:1000}):json(409,{error:'economy_unavailable'})})
  assert.equal(await client.connect(),false);assert.equal(client.snapshotPhase,'unconfirmed');assert.notEqual(client.state.cash,4600)
  release();await Promise.resolve();assert.deepEqual([client.snapshotPhase,client.state.cash],['available',4600])
})

test('an older overlapping connect cannot replace the newer accepted session or snapshot', async () => {
  const a=createLife({name:'Ada',cash:4600}),b=createLife({name:'Bola',cash:8000});let sessions=0,release:(value:ReturnType<typeof json>)=>void=()=>{}
  const delayed=new Promise<ReturnType<typeof json>>(done=>{release=done}),client=createClient({storage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return sessions++===0?delayed:json(200,{session:{id:'public-b',name:'Bola',cities:['lagos']},serverTime:1000})
    return json(200,{state:b,rev:2,serverTime:1000})
  }})
  const older=client.connect(),newer=client.connect();assert.equal(await newer,true);release(json(200,{session:{id:'public-a',name:'Ada',cities:['lagos']},serverTime:1000}));assert.equal(await older,false)
  assert.deepEqual([client.session?.id,client.state.name,client.state.cash,client.snapshotPhase],['public-b','Bola',8000,'available']);assert.notEqual(client.state.cash,a.cash)
})

test('a late refresh from the previous identity cannot claim the replacement recovery session', async () => {
  const a=createLife({name:'Ada',cash:4600}),b=createLife({name:'Bola',cash:9000});let sessionCalls=0,lifeCalls=0,release:(value:ReturnType<typeof json>)=>void=()=>{},started:()=>void=()=>{}
  const delayed=new Promise<ReturnType<typeof json>>(done=>{release=done}),refreshStarted=new Promise<void>(done=>{started=done}),client=createClient({storage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return json(200,{session:sessionCalls++===0?{id:'public-a',name:'Ada',cities:['lagos']}:{id:'public-b',name:'Bola',cities:['lagos']},serverTime:1000})
    lifeCalls+=1;if(lifeCalls===1)return json(200,{state:a,rev:1,serverTime:1000});if(lifeCalls===2){started();return delayed}return json(409,{error:'economy_unavailable'})
  }})
  assert.equal(await client.connect(),true);const oldRefresh=client.refresh();await refreshStarted;assert.equal(await client.connect(),false);assert.deepEqual([client.session?.id,client.snapshotPhase,client.link],['public-b','unavailable','recovery'])
  release(json(200,{state:{...a,cash:5000},rev:2,serverTime:1000}));assert.equal(await oldRefresh,false);assert.deepEqual([client.session?.id,client.snapshotPhase,client.link,client.state.cash],['public-b','unavailable','recovery',4600]);assert.notEqual(client.state.cash,b.cash)
})

test('an uncertain action survives reload and an exact retry cannot overwrite a newer accepted revision', async () => {
  const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value)},timers={setTimeout:()=>0,clearTimeout:()=>{}}
  let life=createLife({name:'Ada'}),firstBody:SentBody|null=null
  const first=createClient({storage,...timers,now:()=>1000,randomUUID:()=> '11111111-1111-4111-8111-111111111111',fetch:async(path,options)=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:life,rev:1,serverTime:1000})
    firstBody=JSON.parse(String(options.body)) as SentBody;throw new TypeError('response lost')
  }})
  await first.connect();assert.equal((await first.command('spot',{id:'trees'})).code,'network');assert.ok(first.pendingAction)
  let resolveAction:(value:ReturnType<typeof json>)=>void=()=>{}, actionCalls=0, lifeRev=5
  const delayed=new Promise<ReturnType<typeof json>>(done=>{resolveAction=done})
  const second=createClient({storage,...timers,now:()=>1000,fetch:async(path,options)=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:{...life,cash:lifeRev===5?5000:6000},rev:lifeRev,serverTime:1000})
    actionCalls+=1;assert.deepEqual(JSON.parse(String(options.body)),firstBody);return delayed
  }})
  await second.connect();assert.ok(second.pendingAction)
  assert.equal((await second.command('cancel')).code,'action_recovery_required');assert.equal(actionCalls,0)
  const retry=second.retryPendingAction();lifeRev=6;await second.refresh();resolveAction(json(200,{ok:true,code:'selected',state:{...life,cash:5100},rev:5,serverTime:1000}))
  assert.equal((await retry).ok,true);assert.equal(second.state.cash,6000,'the crossed older action answer was definitive but did not replace revision 6');assert.equal(second.pendingAction,null)
})

test('pending action is identity-bound, ambiguous server errors keep it, and browser storage failure sends nothing', async () => {
  const base={version:1,state:createLife({name:'Ada'}),identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(base)]]),timers={setTimeout:()=>0,clearTimeout:()=>{}};let mode:'ambiguous'|'ok'='ambiguous'
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},...timers,fetch:async path=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:base.state,rev:1,serverTime:1000})
    return mode==='ambiguous'?json(503,{error:'storage_unavailable',reason:'Uncertain.'}):json(200,{ok:false,code:'idle',state:base.state,rev:1,serverTime:1000})
  }})
  await client.connect();assert.equal((await client.retryPendingAction()).code,'storage_unavailable');assert.ok(client.pendingAction)
  mode='ok';assert.equal((await client.retryPendingAction()).code,'idle');assert.equal(client.pendingAction,null)
  memory.set(STORAGE_KEY,JSON.stringify(base));const changed=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},...timers,fetch:async path=>path==='/api/session'?json(200,{session:{id:'public-2',name:'Bola'},serverTime:1000}):json(200,{state:base.state,rev:1,serverTime:1000})})
  await changed.connect();assert.equal(changed.pendingAction,null)
  let actions=0;const noStore=createClient({storage:{getItem:()=>null,setItem(){throw Error('full')}},...timers,fetch:async path=>{if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000});if(path.startsWith('/api/life'))return json(200,{state:base.state,rev:1,serverTime:1000});actions+=1;return json(500,{error:'unexpected'})}})
  await noStore.connect();assert.equal((await noStore.command('cancel')).code,'browser_storage_unavailable');assert.equal(actions,0)
})

test('a delayed city-switch refusal cannot roll back a newer authoritative city or actor', async () => {
  const observed = [];
  for (const replaceActor of [false, true]) {
    const lagos = createLife({ name: 'Ada' });
    const ibadan = createLife({ ...lagos, estate: { ...lagos.estate, city: 'ibadan' }, location: 'agodi-gardens' }, { cityId: 'ibadan' });
    const replacement = createLife({ name: 'Bola', cash: 7777 });
    const memory = new Map<string, string>(), paths: string[] = [];
    let actor = 'public-1', moved = false, held = false;
    let release: () => void = () => {}, started: () => void = () => {};
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { started = resolve; });
    const client = createClient({
      now: () => 1000, setTimeout: () => 0, clearTimeout: () => {},
      storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
      fetch: async (path, options) => {
        paths.push(path);
        if (path === '/api/session') return json(200, { session: { id: actor, name: actor === 'public-1' ? 'Ada' : 'Bola', cities: ['lagos'] }, serverTime: 1000 });
        assert.equal(new Headers(options.headers).get('X-Allworld-Actor'), actor);
        if (actor === 'public-2') return json(200, { state: replacement, rev: 1003, serverTime: 1000 });
        if (path === '/api/life?city=ibadan' && !held) {
          held = true;
          // This refusal was produced while the character was still in Lagos; its JSON arrives later.
          return { ok: false, status: 409, json: async () => { started(); await delayed; return { error: 'city_moved', city: 'lagos', reason: 'Your character is in Lagos. Open that city to carry on.', serverTime: 1000 }; } };
        }
        if (moved && path === '/api/life?city=lagos') return json(409, { error: 'city_moved', city: 'ibadan', reason: 'Your character is in Ibadan. Open that city to carry on.', serverTime: 1000 });
        return json(200, { state: moved ? ibadan : lagos, rev: moved ? 1002 : 1000, serverTime: 1000 });
      },
    });
    assert.equal(await client.connect(), true);
    const switching = client.switchCity('ibadan');
    await waiting;
    // Another device completes travel before this device's next current-life read.
    moved = true;
    assert.equal(await client.refresh(), true);
    assert.deepEqual([client.cityId, client.state.estate.city, client.revision], ['ibadan', 'ibadan', 1002]);
    if (replaceActor) { actor = 'public-2'; assert.equal(await client.connect(), true); }
    release();
    const result = await switching;
    assert.equal(result.ok, false);
    if (replaceActor) assert.equal(result.code, 'stale_identity_response');
    const saved = JSON.parse(memory.get(STORAGE_KEY) ?? '{}');
    const current = [client.session?.id, client.cityId, client.state.estate.city, client.revision, client.state.cash, saved.ownerId, saved.cityId, saved.state?.cash];
    const nextRead = paths.length;
    await client.refresh();
    observed.push({ replaceActor, current, nextRead: paths[nextRead] });
    client.stop();
  }
  assert.deepEqual(observed, [
    { replaceActor: false, current: ['public-1', 'ibadan', 'ibadan', 1002, 5000, 'public-1', 'ibadan', 5000], nextRead: '/api/life?city=ibadan' },
    { replaceActor: true, current: ['public-2', 'lagos', 'lagos', 1003, 7777, 'public-2', 'lagos', 7777], nextRead: '/api/life?city=lagos' },
  ]);
});

test('a stored moved-city action outcome follows the authoritative life and clears the uncertain intent', async () => {
  const lagos=createLife({name:'Ada'}),ibadan=createLife({...lagos,location:'park',message:'You are in Ibadan.',estate:{...lagos.estate,city:'ibadan'}},{cityId:'ibadan'})
  const base={version:1,state:lagos,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(base)]])
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async(path,options)=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:lagos,rev:1,serverTime:1000})
    assert.deepEqual(JSON.parse(String(options?.body)),{actionId:base.pendingAction.actionId,cityId:'lagos',type:'cancel'})
    return json(200,{ok:false,code:'city_moved',state:ibadan,rev:2,serverTime:1000})
  }})
  await client.connect()
  const result=await client.retryPendingAction()
  assert.equal(result.code,'city_moved')
  assert.equal(client.cityId,'ibadan')
  assert.equal(client.state.message,'You are in Ibadan.')
  assert.equal(client.pendingAction,null,'the server has durably fenced this exact action id')
})

test('an old identity action cannot overwrite or clear the replacement identity during lazy city loading', async () => {
  const a=createLife({name:'Ada'}),b=createLife({name:'Bola',cash:7777}),oldAnswer={...a,cash:5100}
  const saved={version:1,state:a,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(saved)]])
  let identity:'public-1'|'public-2'='public-1',releaseLoad:()=>void=()=>{},started:()=>void=()=>{},oldLoads=0
  const loading=new Promise<void>(done=>{releaseLoad=done}),loadStarted=new Promise<void>(done=>{started=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},
    loadLifeCities:async raw=>{if((raw as LifeState)?.cash===5100&&++oldLoads===2){started();await loading}return[]},fetch:async path=>{
      if(path==='/api/session')return json(200,{session:{id:identity,name:identity==='public-1'?'Ada':'Bola'},serverTime:1000})
      if(path.startsWith('/api/life'))return json(200,{state:identity==='public-1'?a:b,rev:identity==='public-1'?1:9,serverTime:1000})
      return json(200,{ok:true,code:'idle',state:oldAnswer,rev:2,serverTime:1000})
    }})
  await client.connect();const retry=client.retryPendingAction();await loadStarted
  identity='public-2';await client.connect();releaseLoad()
  assert.equal((await retry).code,'stale_identity_response')
  assert.deepEqual([client.session?.id,client.state.cash,client.revision,client.pendingAction,client.link],['public-2',7777,9,null,'online'])
})

test('legacy moved-city recovery cannot change the city or state after identity replacement', async () => {
  const a=createLife({name:'Ada'}),ibadan=createLife({...a,cash:6000,estate:{...a.estate,city:'ibadan'}},{cityId:'ibadan'}),b=createLife({name:'Bola',cash:9999})
  const saved={version:1,state:a,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(saved)]])
  let identity:'public-1'|'public-2'='public-1',release:(answer:ReturnType<typeof json>)=>void=()=>{},started:()=>void=()=>{}
  const recovery=new Promise<ReturnType<typeof json>>(done=>{release=done}),recoveryStarted=new Promise<void>(done=>{started=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return json(200,{session:{id:identity,name:identity==='public-1'?'Ada':'Bola'},serverTime:1000})
    if(path==='/api/life?city=ibadan'){started();return recovery}
    if(path.startsWith('/api/life'))return json(200,{state:identity==='public-1'?a:b,rev:identity==='public-1'?1:11,serverTime:1000})
    return json(409,{error:'city_moved',city:'ibadan',reason:'Your character moved.'})
  }})
  await client.connect();const retry=client.retryPendingAction();await recoveryStarted
  identity='public-2';await client.connect();release(json(200,{state:ibadan,rev:2,serverTime:1000}))
  assert.equal((await retry).code,'stale_identity_response')
  assert.deepEqual([client.session?.id,client.cityId,client.state.cash,client.revision,client.pendingAction,client.link],['public-2','lagos',9999,11,null,'online'])
})

test('a late error from an old identity cannot expire or disconnect the replacement identity', async () => {
  const a=createLife({name:'Ada'}),b=createLife({name:'Bola',cash:8888}),saved={version:1,state:a,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(saved)]])
  let identity:'public-1'|'public-2'='public-1',finishOld:(answer:ReturnType<typeof json>)=>void=()=>{},finishNew:(answer:ReturnType<typeof json>)=>void=()=>{},actionCalls=0
  const oldAction=new Promise<ReturnType<typeof json>>(done=>{finishOld=done}),newAction=new Promise<ReturnType<typeof json>>(done=>{finishNew=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return json(200,{session:{id:identity,name:identity==='public-1'?'Ada':'Bola'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:identity==='public-1'?a:b,rev:identity==='public-1'?1:10,serverTime:1000})
    return actionCalls++===0?oldAction:newAction
  }})
  await client.connect();const retry=client.retryPendingAction();identity='public-2';await client.connect()
  const bAction=client.command('cancel');assert.equal(client.pendingAction?.sessionId,'public-2')
  finishOld(json(401,{error:'device_session_required'}))
  assert.equal((await retry).code,'stale_identity_response')
  assert.deepEqual([client.session?.id,client.state.cash,client.revision,client.pendingAction?.sessionId,client.link],['public-2',8888,10,'public-2','online'])
  finishNew(json(200,{ok:false,code:'idle',state:b,rev:10,serverTime:1000}));await bAction
})

for(const code of ['action_expired','action_id_conflict'] as const)test(`a delayed ${code} refresh cannot affect a replacement identity`,async()=>{
  const a=createLife({name:'Ada'}),b=createLife({name:'Bola',cash:12345}),saved={version:1,state:a,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(saved)]])
  let identity:'public-1'|'public-2'='public-1',lifeCalls=0,release:(answer:ReturnType<typeof json>)=>void=()=>{},started:()=>void=()=>{}
  const delayed=new Promise<ReturnType<typeof json>>(done=>{release=done}),refreshStarted=new Promise<void>(done=>{started=done})
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return json(200,{session:{id:identity,name:identity==='public-1'?'Ada':'Bola'},serverTime:1000})
    if(path.startsWith('/api/life')){lifeCalls+=1;if(lifeCalls===2){started();return delayed}return json(200,{state:identity==='public-1'?a:b,rev:identity==='public-1'?1:12,serverTime:1000})}
    return json(409,{error:code})
  }})
  await client.connect();const retry=client.retryPendingAction();await refreshStarted
  identity='public-2';await client.connect();release(json(200,{state:{...a,cash:6000},rev:2,serverTime:1000}))
  assert.equal((await retry).code,'stale_identity_response')
  assert.deepEqual([client.session?.id,client.state.cash,client.revision,client.pendingAction,client.link],['public-2',12345,12,null,'online'])
})

test('a successful same-identity conflict refresh clears the intent without marking the client offline',async()=>{
  const life=createLife({name:'Ada'}),saved={version:1,state:life,identity:{name:'Ada'},cityId:'lagos',pendingAction:{sessionId:'public-1',actionId:'1000:11111111-1111-4111-8111-111111111111',cityId:'lagos',type:'cancel'}}
  const memory=new Map([[STORAGE_KEY,JSON.stringify(saved)]]);let lifeCalls=0
  const client=createClient({storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},setTimeout:()=>0,clearTimeout:()=>{},fetch:async path=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000})
    if(path.startsWith('/api/life'))return json(200,{state:{...life,cash:lifeCalls++?6000:5000},rev:lifeCalls,serverTime:1000})
    return json(409,{error:'action_id_conflict',reason:'That action ID belongs to another request.'})
  }})
  await client.connect();const result=await client.retryPendingAction()
  assert.equal(result.code,'action_id_conflict')
  assert.deepEqual([client.state.cash,client.pendingAction,client.link,client.online],[6000,null,'online',true])
})

test('route cooldowns do not let an unrelated support 429 freeze actions', async () => {
  let actions=0;const life=createLife({name:'Ada'}),client=createClient({storage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout:()=>{},fetch:async(path)=>{
    if(path==='/api/session')return json(200,{session:{id:'public-1',name:'Ada'},serverTime:1000});if(path.startsWith('/api/life'))return json(200,{state:life,rev:1,serverTime:1000})
    if(path==='/api/support/reports')return json(429,{error:'rate_limited',retryAfter:60});actions+=1;return json(200,{ok:true,code:'idle',state:life,rev:1,serverTime:1000})
  }})
  await client.connect();await assert.rejects(client.api('/api/support/reports'),(error:ApiError)=>error.status===429)
  assert.equal((await client.command('cancel')).ok,true);assert.equal(actions,1)
})

test('connection loss mid-session pauses changes with the recovery text and keeps the cached state', async () => {
  const h = harness();
  await h.client.connect();
  h.setUp(false);
  const result = await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(result.ok, false); assert.equal(result.reason, TEXT.connectionLost);
  assert.deepEqual(h.statuses.at(-1), ['Connection lost. Reconnect to check your saved progress.', true]);
  assert.equal(h.client.online, false); assert.equal(h.client.state.cash, 5000);
  const sent = h.calls.length;
  assert.equal((await h.client.command('cancel')).code, 'offline'); assert.equal(h.calls.length, sent);
  h.setUp(true);
  assert.equal(await h.client.connect(), true); assert.equal(h.client.online, true);
});

test('an expired session stops the client and a tampered cache is sanitized', async () => {
  const h = harness();
  await h.client.connect(); h.dropSession();
  let expired = 0;
  const memory = new Map([[STORAGE_KEY, JSON.stringify({ identity: { name: 'Ada' }, cityId: 'atlantis', state: { cash: 1e30, location: 'vault' } })]]);
  const client = createClient({ fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'device_session_required' }) }), setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key), setItem() {} }, onSessionExpired: () => { expired += 1; } });
  assert.equal(client.cityId, 'lagos'); assert.equal(client.state.cash, 5000); assert.equal(client.state.location, 'park');
  assert.equal(await client.connect(), false); assert.equal(expired, 1); assert.equal(client.online, false);
  assert.equal(TEXT.cityNote('Ibadan'), 'More places and activities are coming to Ibadan.');
});

test('room membership is restored on arrival and after a cancelled trip, and never enables voice', async () => {
  const idle = createLife({ location: 'park' });
  const travelling = createLife({ location: 'park', activeAction: { kind: 'travel', id: 'library', duration: 5, remaining: 3 } });
  const arrived = createLife({ location: 'library' });
  const chilling = createLife({ location: 'park', spot: 'trees', activeAction: { kind: 'activity', id: 'chill', duration: 11, remaining: 4 } });
  assert.equal(roomJoinNeeded(travelling, idle), true, 'trip cancelled: same place, no action');
  assert.equal(roomJoinNeeded(loose({ ...travelling, activeAction: { kind: 'commute' } }), idle), true, 'cancelled work commute rejoins without enabling voice');
  assert.equal(roomJoinNeeded(travelling, arrived), true, 'arrived somewhere new');
  assert.equal(roomJoinNeeded(idle, idle), false);
  assert.equal(roomJoinNeeded(idle, travelling), false, 'setting off does not rejoin');
  assert.equal(roomJoinNeeded(travelling, travelling), false);
  assert.equal(roomJoinNeeded(chilling, idle), false, 'finishing or cancelling an activity is not a room change');
  // The automatic commute is a departure too: the server ends the membership when it starts, so a
  // cancelled commute needs the same rejoin as a cancelled trip — and arriving at work joins there.
  const commuting = createLife({ location: 'park', job: 'tech', activeAction: { kind: 'commute', id: 'cchub', duration: 5, remaining: 3 } });
  assert.equal(commuting.activeAction?.kind, 'commute');
  assert.equal(roomJoinNeeded(commuting, idle), true, 'commute cancelled: same place, no action');
  assert.equal(roomJoinNeeded(commuting, createLife({ location: 'cchub' })), true, 'arrived at work');
  assert.equal(roomJoinNeeded(idle, commuting), false, 'the commute starting does not rejoin');
  assert.equal(roomJoinNeeded(commuting, commuting), false);
  // A timed action of a kind this build does not know is treated as a departure, never as "still here".
  assert.equal(roomJoinNeeded(loose({ location: 'park', activeAction: { kind: 'future-move' } }), idle), true);
  // The community store wires that decision to join only — never to a voice or microphone control.
  const store = await readFile('src/app/features/community/communityStore.ts', 'utf8'), app = await readFile('src/app/state/app.ts', 'utf8');
  assert.match(store, /if \(roomJoinNeeded\(previous, next\)\) instance\?\.join\(game\.cityId\.value, next\.location\)/);
  assert.doesNotMatch(store, /getUserMedia|voice-state|joinVoice|\.(mute|enableVoice)/i);
  assert.doesNotMatch(app, /getUserMedia|voice-state|joinVoice|community\.(mute|voice|enable)/i);
});

test('city sheet footnote uses the current city-specific text', async () => {
  const city = await readFile('src/app/features/travel/CityPanel.vue', 'utf8');
  assert.match(city, /More places and activities are coming to/);
  assert.doesNotMatch(city, /original starter city pack/);
  assert.equal(TEXT.cityNote('Lagos'), 'More places and activities are coming to Lagos.');
});

test('uuid() works without crypto.randomUUID, as on a plain-HTTP LAN origin', async () => {
  const { uuid } = await import('./client.ts');
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const insecure = { getRandomValues: ((bytes: Uint8Array) => globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>)) as Crypto['getRandomValues'] };
  const ids = new Set(Array.from({ length: 50 }, () => uuid(insecure)));
  assert.equal(ids.size, 50); for (const id of ids) assert.match(id, pattern);
  assert.match(uuid(), pattern);
});

test('a nickname the server refuses comes back to the form with the server’s reason; other requests keep it on the error', async () => {
  const asked: (NameProblem | undefined)[] = [], statuses: [string, boolean][] = [];
  const reason = 'That name cannot contain a link or web address in this beta.';
  let reply = json(400, { error: 'name_not_allowed', reason });
  const fetch = async (path: string, options: RequestInit = {}) => (path === '/api/session' && options.method === 'POST' ? reply : path === '/api/session' ? json(401, { error: 'device_session_required' }) : json(404, { error: 'not_found' }));
  const client = createClient({ fetch, now: () => 1000, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text, error) => statuses.push([text, error]), onNeedName: (problem) => asked.push(problem) });
  client.identity.name = 'www.abc.com';
  assert.equal(await client.connect(true), false);
  assert.deepEqual(asked, [{ code: 'name_not_allowed', reason, name: 'www.abc.com' }]);
  assert.deepEqual(statuses.at(-1), ['Choose a different nickname to connect', true]);
  assert.equal(client.online, false);
  // A muted player renaming, and a refusal that carries no sentence: still a reason the form can show.
  reply = json(403, { error: 'muted', reason: 'A moderator has muted you until 10:00 UTC.' });
  await client.connect(true);
  assert.deepEqual([asked.at(-1)?.code, asked.at(-1)?.reason], ['muted', 'A moderator has muted you until 10:00 UTC.']);
  reply = json(400, { error: 'invalid_name' });
  await client.connect(true);
  assert.deepEqual([asked.at(-1)?.code, asked.at(-1)?.reason], ['invalid_name', 'A nickname needs 3 to 24 ordinary characters.']);
  // Anything else is a connection problem, not a question about the name.
  reply = json(503, { error: 'device_capacity' });
  await client.connect(true);
  assert.equal(asked.length, 3);
  // fetchJson rejects with the server's sentence attached, for panels that show it themselves (Profile rename).
  reply = json(400, { error: 'name_not_allowed', reason });
  await assert.rejects(client.fetchJson('/api/session', { method: 'POST', body: { name: 'x' } }), (error: ApiError) => error.status === 400 && error.code === 'name_not_allowed' && error.reason === reason);
});

test('retry keys have the timed form the server requires, stamped with server time', async () => {
  const h = harness();
  await h.client.connect();
  assert.equal(h.client.newId(), '5000:11111111-1111-4111-8111-111111111111', 'server time (5000), not the device clock (1000)');
  await h.client.command('travel', { id: 'library', mode: 'cab' });
  assert.equal(h.calls.at(-1)?.[2]?.actionId, h.client.newId(), 'the same helper stamps action IDs');
});

test('what the server says about its storage is shown as it is: failing, the 503 reason, and saving again', async () => {
  const statuses: [string, boolean][] = [], changes: LifeState[] = [];
  const life = createLife({ name: 'Ada' });
  let mode = 'ok';
  const refused = { error: 'storage_unavailable', reason: 'The server could not save this, so nothing was changed. Try again in a moment.' };
  const fetch = async (path: string) => {
    if (path === '/api/session') return json(200, { session: { id: 'public-1', name: 'Ada' }, serverTime: 5000 });
    if (path === '/api/action') return mode === 'ok' ? json(200, { ok: true, code: 'started', state: life, serverTime: 5000 }) : json(503, refused);
    return json(200, { state: life, serverTime: 5000, ...(mode === 'failing' ? { storage: 'failing' } : {}) });
  };
  const client = createClient({ fetch, now: () => 1000, setTimeout: () => 0, clearTimeout: () => {}, storage: { getItem: () => null, setItem: () => {} },
    onStatus: (text, error) => statuses.push([text, error]), onChange: (state) => changes.push(state) });
  await client.connect();
  assert.equal(client.storage, null);
  mode = 'failing';
  const result = await client.command('spot', { id: 'trees' });
  assert.deepEqual(result, { ok: false, code: 'storage_unavailable', reason: refused.reason }, 'the action is reported as not done, in the server’s words');
  assert.equal(client.online, true, 'the player is not offline: the server answered');
  assert.deepEqual(client.storage, { reason: refused.reason });
  assert.deepEqual(statuses.at(-1), [refused.reason, true]);
  await client.refresh();
  assert.deepEqual(client.storage, { reason: TEXT.notSaving }, 'a success that carries storage "failing" keeps the indicator on');
  mode = 'ok';
  await client.refresh();
  assert.equal(client.storage, null, 'and the next ordinary success clears it');
  assert.deepEqual(statuses.at(-1), ['Connected · progress saved', false]);
});

test('client.link says why the game is not playable: expired, new, offline and unreachable are different states', async () => {
  const session = { ok: true, status: 200, json: async () => ({ session: { id: 'p1', name: 'Ada' }, serverTime: 1000 }) };
  const life = { ok: true, status: 200, json: async () => ({ state: {}, serverTime: 1000 }) };
  const unknown = { ok: false, status: 401, json: async () => ({ error: 'device_session_required' }) };
  const saved = { getItem: () => JSON.stringify({ identity: { name: 'Ada' }, cityId: 'lagos', state: {} }), setItem() {} };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };

  // The owner's case: the server answers, but does not know this browser's session, and a life is cached here.
  const expired = createClient({ fetch: async () => unknown, storage: saved, ...timers });
  assert.equal(expired.link, 'connecting');
  assert.equal(await expired.connect(), false);
  assert.equal(expired.link, 'expired', 'a reachable server that has lost the session is "expired", never "offline"');

  // The same answer on a browser with no cached life is simply a new player.
  const fresh = createClient({ fetch: async () => unknown, storage: { getItem: () => null, setItem() {} }, ...timers });
  assert.equal(await fresh.connect(), false);
  assert.equal(fresh.link, 'new');

  // No answer at all: the device's own network decides between "offline" and "unreachable".
  let deviceOnline = true, serverUp = true;
  const client = createClient({ fetch: async (path) => { if (!serverUp) throw new Error('fetch failed'); return String(path).startsWith('/api/session') ? session : life; }, storage: saved, isOnline: () => deviceOnline, ...timers });
  assert.equal(await client.connect(), true); assert.equal(client.link, 'online');
  serverUp = false;
  assert.equal((await client.command('cancel')).ok, false);
  assert.equal(client.link, 'unreachable', 'the device is online, the server did not answer');
  deviceOnline = false;
  assert.equal(await client.connect(), false);
  assert.equal(client.link, 'offline', 'the device itself has no network');
  deviceOnline = true; serverUp = true;
  assert.equal(await client.connect(), true); assert.equal(client.link, 'online');

  // A session that disappears mid-game (401 on an action) is expired too.
  const dropped = createClient({ fetch: async (path, options) => (options?.method === 'POST' ? unknown : String(path).startsWith('/api/session') ? session : life), storage: saved, ...timers });
  assert.equal(await dropped.connect(), true);
  await dropped.command('cancel');
  assert.equal(dropped.link, 'expired');
});

test('settling in: the game’s own client cannot send the legacy rented-home payload — the rules still accept it from old scripts', async () => {
  // The client: whatever a panel puts in the payload, only { lga, via, stay } leave the device.
  const h = harness();
  await h.client.connect(); h.calls.length = 0;
  await h.client.command('onboarding.home', { house: 'mushin', lga: 'ikeja', via: 'manual', stay: true, extra: 1 });
  assert.deepEqual(h.calls[0]?.[2]?.payload, { lga: 'ikeja', via: 'manual', stay: true });
  h.calls.length = 0;
  await h.client.command('onboarding.home', { house: 'mushin' });
  assert.deepEqual(h.calls[0]?.[2]?.payload, {}, 'a rented home alone is sent as nothing: the server answers lga_required');
  assert.deepEqual(outgoing('onboarding.home', { house: 'yaba', via: 'device' }), { via: 'device' });
  // Every other action is sent as written.
  const travel = { id: 'library', mode: 'cab', house: 'x' };
  assert.equal(outgoing('travel', travel), travel);
  // The rules: an old script (or the Worker) that still sends { house } is served as before, and {} is refused.
  const house = Object.keys(START_HOMES)[0];
  const ready = () => {
    const life = createLife(null, { now: 1000, cityId: 'lagos', isNew: true, quickStart: true });
    const send = (type: ActionType, payload: Record<string, unknown>, id: string) => dispatch(life, { type, payload, actionId: id } as ActionBody, { now: 1000, cityId: 'lagos', actionId: id });
    send('onboarding.quick-start', { look: life.onboarding.look }, 'play');
    send('onboarding.traits', { traits: Object.keys(TRAITS).slice(0, 2) }, 'traits'); send('onboarding.dream', { dream: Object.keys(DREAMS)[0] }, 'dream');
    return { life, send };
  };
  const probe = ready();
  probe.send('onboarding.lottery', {}, 'lottery');
  assert.equal(probe.send('onboarding.home', outgoing('onboarding.home', { house }), 'home-client').code, 'lga_required', 'what the client would send for { house }');
  const legacy = probe.send('onboarding.home', { house }, 'home-legacy');
  assert.ok(legacy.code === 'life_started' || legacy.code === 'house_locked', `the legacy payload is still understood (${legacy.code})`);
});

test('a cached cityId that is not a string is ignored, and switchCity refuses a non-string id', async () => {
  const memory = new Map([[STORAGE_KEY, JSON.stringify({ identity: { name: 'Ada' }, cityId: ['lagos'] })]]);
  const client = createClient({ fetch: async () => json(404, { error: 'not_found' }), setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key), setItem() {} } });
  assert.equal(client.cityId, 'lagos');
  const result = await client.switchCity(['lagos'] as unknown as string);
  assert.deepEqual(result, { ok: false, code: 'invalid_city' });
});

for (const phase of ['fetch', 'json'] as const) test(`a superseded ${phase} failure stays stale instead of being reported as a current connection failure`, async () => {
  let current = true;
  let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  let fail: (error: Error) => void = () => {};
  const blocked = new Promise<never>((_, reject) => { fail = reject; });
  const client = createClient({
    fetch: async () => {
      if (phase === 'fetch') { entered(); return blocked; }
      return { ok: true, status: 200, json: async () => { entered(); return blocked; } };
    },
    storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {},
  });
  const before = JSON.stringify(client.state), offset = client.serverTimeOffset;
  const pending = client.api('/api/anything', {}, () => current);
  await started;
  current = false;
  fail(new Error('Delayed transport failure'));
  await assert.rejects(pending, (error: ApiError) => error.code === 'stale_identity_response');
  assert.equal(JSON.stringify(client.state), before);
  assert.equal(client.serverTimeOffset, offset);
});

test('a JSON null response body is the unreadable-response error, not a TypeError', async () => {
  const client = createClient({ fetch: async () => json(200, null), setTimeout: () => 0, clearTimeout: () => {} });
  await assert.rejects(() => client.api('/api/anything'), (error: Error) => error.message === 'Server returned an unreadable response' && !(error instanceof TypeError));
});

test('a full world is not an unreachable server: a new start refused with 503 device_capacity is remembered as "full" until the next attempt', async () => {
  const full = { ok: false, status: 503, json: async () => ({ error: 'device_capacity', reason: 'The world is full right now. Your place is not lost: try again in a moment.' }) };
  const session = { ok: true, status: 200, json: async () => ({ session: { id: 'p1', name: 'Ada' }, serverTime: 1000 }) };
  const life = { ok: true, status: 200, json: async () => ({ state: {}, serverTime: 1000 }) };
  let places = 0;
  const statuses: string[] = [];
  const client = createClient({ fetch: async (path) => (String(path).startsWith('/api/session') ? (places > 0 ? session : full) : life), storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text) => { statuses.push(text); } });
  assert.equal(client.refusal, null);
  assert.equal(await client.connect(true), false);
  assert.equal(client.refusal, 'full');
  assert.equal(statuses.at(-1), TEXT.worldFull);
  assert.equal(client.online, false);
  // A place opened: the same start succeeds and nothing of the refusal is left.
  places = 1;
  assert.equal(await client.connect(true), true);
  assert.equal(client.refusal, null); assert.equal(client.link, 'online');
  // A server that does not answer at all is something else.
  const down = createClient({ fetch: async () => { throw new Error('fetch failed'); }, storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  assert.equal(await down.connect(true), false);
  assert.equal(down.refusal, null); assert.equal(down.link, 'unreachable');
});

test('a full world met by a start in a chosen city: the refusal is "full", the chosen city is kept, and the same start is let in there when a place opens', async () => {
  const full = { ok: false, status: 503, json: async () => ({ error: 'device_capacity', reason: 'The world is full right now. Your place is not lost: try again in a moment.', retryAfter: 30 }) };
  const asked: string[] = [];
  let places = 0;
  const client = createClient({ fetch: async (path) => { asked.push(String(path)); if (String(path).startsWith('/api/session')) return places > 0 ? { ok: true, status: 200, json: async () => ({ session: { id: 'p1', name: 'Ada' }, serverTime: 1000 }) } : full; return { ok: true, status: 200, json: async () => ({ state: { estate: { city: 'abuja' } }, serverTime: 1000 }) }; }, storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  assert.equal(await client.connect(true, 'abuja'), false);
  assert.deepEqual([client.refusal, client.retryAfter, client.cityId, client.online], ['full', 30, 'abuja', false]);
  assert.deepEqual(asked, ['/api/session'], 'no life is asked for while there is no place');
  places = 1;
  assert.equal(await client.connect(true, 'abuja'), true);
  assert.deepEqual([client.refusal, client.retryAfter, client.cityId, client.link], [null, null, 'abuja', 'online']);
  assert.ok(asked.some((path) => path.startsWith('/api/life?city=abuja')), 'the life is started in the city that was chosen');
});

test('a new start refused for too many new players from one network address is remembered as "limit", with the wait the server gave', async () => {
  const limited = { ok: false, status: 429, json: async () => ({ error: 'rate_limited', retryAfter: 1380, reason: 'Too many new players have started from your network in the last hour.' }) };
  const statuses: string[] = [];
  const client = createClient({ fetch: async () => limited, storage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, clearTimeout: () => {}, onStatus: (text) => { statuses.push(text); } });
  assert.equal(await client.connect(true), false);
  assert.deepEqual([client.refusal, client.retryAfter], ['limit', 1380]);
  assert.equal(statuses.at(-1), TEXT.networkLimit);
  // A 429 on anything but a new start is the ordinary rate limit, not this.
  const returning = createClient({ fetch: async () => limited, storage: { getItem: () => JSON.stringify({ identity: { name: 'Ada' }, cityId: 'lagos', state: {} }), setItem() {} }, setTimeout: () => 0, clearTimeout: () => {} });
  assert.equal(await returning.connect(), false);
  assert.deepEqual([returning.refusal, returning.retryAfter], [null, null]);
});
