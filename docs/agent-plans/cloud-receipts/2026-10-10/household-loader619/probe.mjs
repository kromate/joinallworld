import assert from 'node:assert/strict'
import { loadConsentView } from '/workspace/remote-verification/repositories/worker-household-identity/server/households/consentView.ts'
import { reduceConsent } from '/workspace/remote-verification/repositories/worker-household-identity/server/households/consent.ts'

const O='00000000-0000-4000-8000-000000000001', LO='00000000-0000-4000-8000-000000000002'
const R='00000000-0000-4000-8000-000000000003', LR='00000000-0000-4000-8000-000000000004'
const H='00000000-0000-4000-8000-000000000005', HH='00000000-0000-4000-8000-000000000006'
const I='00000000-0000-4000-8000-000000000007', M='00000000-0000-4000-8000-000000000008', J='00000000-0000-4000-8000-000000000009'
const owner={character:O,life:LO}, member={character:R,life:LR}, permissions=['sleep','cook']
const absent={state:'absent'}
const point=value=>({state:'present',value})
const fact=(who,state='available')=>({id:who.life,revision:0,who,state})
const pair=(a,b,friends=true)=>({a,b,revision:3,friends,blocked:false})
const home={id:H,revision:0,owner,epoch:1,state:'available'}
const homeIndex={id:H,revision:0,householdId:HH}
const house=(active=[],pending=[],revision=1)=>({id:HH,homeId:H,epoch:1,owner,createdAt:0,lastEventAt:20,revision,state:'open',active,pending})
const invite=(state='pending')=>({id:I,revision:state==='pending'?0:1,householdId:HH,homeId:H,epoch:1,owner,recipient:member,permissions,createdAt:10,expiresAt:604800010,state,...(state==='pending'?{}:{answeredAt:20,membershipId:M})})
const membership=()=>({id:M,revision:0,householdId:HH,homeId:H,epoch:1,inviteId:I,owner,member,permissions,acceptedAt:20,state:'active'})
const ci=(id,fields={})=>({id,revision:0,hosted:[],joined:[],incoming:[],...fields})
const li=(id,joined=[])=>({id,revision:0,joined})
function fixture(op, options={}) {
  const isMemberOp=['leave','revoke','terminate','close'].includes(op)
  const isPendingOp=['accept','decline','cancel','expire','terminate-invitation'].includes(op)
  const inviteState=isMemberOp?'accepted':'pending'
  const h=op==='register'?null:house(isMemberOp?[M]:[],isPendingOp?[I]:[])
  const now=op==='expire'?604800010:100
  const chars=new Map([[O,point(ci(O,{hosted:op==='register'?[]:[HH]}))]])
  const lives=new Map()
  const invites=new Map(op==='invite'?[]:[[I,point(invite(inviteState))]])
  const members=new Map()
  if(isMemberOp) {
    chars.set(R,point(ci(R,{joined:[M]})))
    lives.set(LR,point(li(LR,[M])))
    members.set(M,point(membership()))
  } else if(isPendingOp) chars.set(R,point(ci(R,{incoming:[I]})))
  else if(op==='invite') chars.set(R,point(ci(R)))
  const actor=op==='register'||op==='invite'||op==='cancel'||op==='revoke'||op==='close'?fact(owner):fact(member)
  let system=absent
  if(op==='expire') system=point({kind:'system',subject:owner,cause:'home_retired',evidence:{kind:'home'}})
  if(op==='terminate-invitation') system=point({kind:'system',subject:member,cause:'unfriended',evidence:{kind:'pair',value:pair(member,owner,false)}})
  if(op==='terminate') system=point({kind:'system',subject:member,cause:'member_life_changed',evidence:{kind:'life',value:fact(member,'retired')}})
  const protectedReads=[]
  const tx={
    now:()=>now,
    sessionLife:async()=>point(actor),
    systemAuthority:async()=>system,
    home:async id=>id===H?point(home):absent,
    homeIndex:async id=>id===H?(op==='register'?absent:point(homeIndex)):absent,
    household:async id=>id===HH?(h?point(h):absent):absent,
    characterIndex:async id=>options.ownerIndexAbsent&&id===O?absent:(chars.get(id)??absent),
    lifeIndex:async id=>lives.get(id)??absent,
    lifeFact:async id=>id===LO?point(fact(owner)):id===LR?point(fact(member)):absent,
    pairFact:async(a,b)=>op==='invite'?point(pair(a,b)):op==='accept'?point(pair(a,b)):absent,
    invite:async id=>options.wrongInviteKey&&id===I?point({...invite('accepted'),id:J}):(invites.get(id)??absent),
    member:async id=>members.get(id)??absent,
    protectInviteRead:async(id,revision)=>{protectedReads.push({id,revision})},
  }
  const command={
    register:{op,householdId:HH,homeId:H,epoch:1},
    invite:{op,householdId:HH,revision:1,epoch:1,inviteId:I,recipient:member},
    accept:{op,householdId:HH,revision:1,epoch:1,inviteId:I,membershipId:M},
    decline:{op,householdId:HH,revision:1,epoch:1,inviteId:I},
    cancel:{op,householdId:HH,revision:1,epoch:1,inviteId:I},
    expire:{op,householdId:HH,revision:1,epoch:1,inviteId:I},
    'terminate-invitation':{op,householdId:HH,revision:1,epoch:1,inviteId:I},
    leave:{op,householdId:HH,revision:1,epoch:1,membershipId:M,memberRevision:0},
    revoke:{op,householdId:HH,revision:1,epoch:1,membershipId:M,memberRevision:0},
    terminate:{op,householdId:HH,revision:1,epoch:1,membershipId:M,memberRevision:0},
    close:{op,householdId:HH,revision:1,epoch:1,reason:'owner_closed'},
  }[op]
  return {tx,command,protectedReads}
}

for (const op of ['register','invite','accept','decline','cancel','expire','terminate-invitation','leave','revoke','terminate','close']) {
  const f=fixture(op)
  const loaded=await loadConsentView(f.command,f.tx)
  assert.equal(loaded.ok,true,`${op} loader: ${JSON.stringify(loaded)}`)
  assert.equal(loaded.view.op,op)
  const reduced=reduceConsent(loaded.command,loaded.view)
  assert.equal(reduced.ok,true,`${op} reducer: ${JSON.stringify(reduced)}`)
  if (['decline','cancel','expire','terminate-invitation','leave','revoke','terminate'].includes(op)) assert(loaded.view.characters.some(row=>row.id===O),`${op} owner index loaded`)
  if (op==='register'||op==='close'||op==='leave') assert.equal(loaded.view.authority.kind==='actor'?loaded.view.authority.pair.state:'system',op==='register'||op==='close'||op==='leave'?'not-loaded':'system')
  if (['leave','close'].includes(op)) assert.deepEqual(f.protectedReads,[{id:I,revision:1}])
  console.log(`PASS ${op}: load -> reducer`)
}

const wrong=fixture('close',{wrongInviteKey:true})
assert.equal((await loadConsentView(wrong.command,wrong.tx)).ok,false)
assert.equal(wrong.protectedReads.length,0)
console.log('PASS close refuses accepted-invite wrong-key crosslink before readset protection')

const missingOwner=fixture('leave',{ownerIndexAbsent:true})
const ownerLoaded=await loadConsentView(missingOwner.command,missingOwner.tx)
assert.equal(ownerLoaded.ok,true)
assert(ownerLoaded.view.characters.some(row=>row.id===O&&row.point.state==='absent'))
assert.equal(reduceConsent(ownerLoaded.command,ownerLoaded.view).ok,false)
console.log('PASS explicit owner-index absence reaches reducer refusal')

let commandGetter=0
const getterCommand={op:'register',homeId:H,epoch:1}
Object.defineProperty(getterCommand,'householdId',{enumerable:true,get(){commandGetter+=1;return HH}})
const reg=fixture('register')
assert.equal((await loadConsentView(getterCommand,reg.tx)).ok,false)
assert.equal(commandGetter,0)
console.log('PASS command accessor rejected without invocation')

let rowGetter=0
const rowTx=fixture('register')
rowTx.tx.home=async()=>({state:'present',value:Object.defineProperty({revision:0,owner,epoch:1,state:'available'},'id',{enumerable:true,get(){rowGetter+=1;return H}})})
assert.equal((await loadConsentView(reg.command,rowTx.tx)).ok,false)
assert.equal(rowGetter,0)
console.log('PASS storage row accessor rejected without invocation')

const fault=fixture('register')
fault.tx.home=async()=>{throw new Error('transaction read failed')}
await assert.rejects(loadConsentView(fault.command,fault.tx),/transaction read failed/)
console.log('PASS transaction read failure propagates; it is never absence')

const unqueried=fixture('close')
const unqueriedView=await loadConsentView(unqueried.command,unqueried.tx)
assert.equal(unqueriedView.view.authority.kind,'actor')
assert.equal(unqueriedView.view.authority.pair.state,'not-loaded')
console.log('PASS unqueried pair fact stays not-loaded')

const pairGetterFixture=fixture('invite')
let pairGetter=0
const unsafePair=Object.defineProperty({revision:3,friends:true,blocked:false,b:owner},'a',{enumerable:true,get(){pairGetter+=1;return member}})
pairGetterFixture.tx.pairFact=async()=>point(unsafePair)
assert.equal((await loadConsentView(pairGetterFixture.command,pairGetterFixture.tx)).ok,false)
assert.equal(pairGetter,0)
console.log('PASS queried pair accessor rejected without invocation')

const pairFault=fixture('invite')
pairFault.tx.pairFact=async()=>{throw new Error('transaction pair read failed')}
await assert.rejects(loadConsentView(pairFault.command,pairFault.tx),/transaction pair read failed/)
console.log('PASS queried pair read failure aborts instead of becoming absence')

const readsetFault=fixture('close')
readsetFault.tx.protectInviteRead=async()=>{throw new Error('invite readset protection failed')}
await assert.rejects(loadConsentView(readsetFault.command,readsetFault.tx),/invite readset protection failed/)
console.log('PASS protected supporting-read failure aborts loader')
