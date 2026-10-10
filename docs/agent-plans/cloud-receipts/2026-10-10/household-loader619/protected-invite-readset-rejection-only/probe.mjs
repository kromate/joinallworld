import assert from 'node:assert/strict'
import { loadConsentView } from '/workspace/remote-verification/repositories/worker-household-identity/server/households/consentView.ts'

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

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const loaderPath='/workspace/remote-verification/repositories/worker-household-identity/server/households/consentView.ts'
assert.equal(hash(loaderPath),'78e4eb7e451b7082a8c69b2f95f86536df90bbe3d695fbe37661ab593b3340d8')
console.log(JSON.stringify({loader_sha256:hash(loaderPath),helper_sha256:hash(new URL(import.meta.url)),scope:'protected supporting invite readset rejection only'}))
const readsetFault=fixture('close')
let calls=0
readsetFault.tx.protectInviteRead=async(id,revision)=>{calls++;assert.equal(id,I);assert.equal(revision,1);throw new Error('invite readset protection failed')}
await assert.rejects(loadConsentView(readsetFault.command,readsetFault.tx),/invite readset protection failed/)
assert.equal(calls,1)
console.log('PASS protected supporting-read failure aborts loader; exact invite revision checked; one call')
