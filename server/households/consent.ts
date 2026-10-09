import {
  LIMITS, PERMISSIONS, isView, parseCommand, same, pairKey, integer,
  type Authority, type CharacterId, type CharacterIndex, type Collection, type Event,
  type Expectation, type Home, type Household, type Identity, type Invite, type LifeFact,
  type LifeId, type LifeIndex, type LiabilityHandoff, type Member, type MemberEnd,
  type PairFact, type Point, type Result, type View, type Write,
} from './records.ts'

const refuse = (code: string): Result => ({ok:false,code})
const available = (fact: LifeFact, who: Identity): boolean => fact.state === 'available' && same(fact.who,who)
const pairMatches = (p: PairFact, a: Identity, b: Identity): boolean => same(p.a,a) && same(p.b,b) || same(p.a,b) && same(p.b,a)
const actorIs = (a: Authority, who: Identity): boolean => a.kind === 'actor' && available(a.actor,who)
const friends = (a: Authority, who: Identity, other: Identity): boolean => actorIs(a,who) && a.kind === 'actor' && a.pair.state === 'present' && pairMatches(a.pair.value,who,other) && a.pair.value.friends && !a.pair.value.blocked
function systemPairOrLife(a: Authority, member: Identity, owner: Identity): boolean {
  if (a.kind !== 'system' || !same(a.subject,member)) return false
  if (a.cause === 'blocked' || a.cause === 'unfriended') return a.evidence.kind === 'pair' && pairMatches(a.evidence.value,member,owner) && (a.cause === 'blocked' ? a.evidence.value.blocked : !a.evidence.value.friends)
  if (a.cause !== 'member_life_changed' && a.cause !== 'character_erased') return false
  return a.evidence.kind === 'life' && same(a.evidence.value.who,member) && a.evidence.value.state === (a.cause === 'character_erased' ? 'erased' : 'retired')
}
function systemClose(a: Authority, h: Household, home: Home): boolean {
  if (a.kind !== 'system' || !same(a.subject,h.owner)) return false
  if (a.cause === 'home_retired') return a.evidence.kind === 'home' && home.state === 'retired' && home.epoch === h.epoch && same(home.owner,h.owner)
  if (a.cause !== 'owner_life_changed' && a.cause !== 'character_erased') return false
  return a.evidence.kind === 'life' && same(a.evidence.value.who,h.owner) && a.evidence.value.state === (a.cause === 'character_erased' ? 'erased' : 'retired')
}
const inviteBound = (i: Invite, h: Household): boolean => i.householdId === h.id && i.homeId === h.homeId && i.epoch === h.epoch && same(i.owner,h.owner) && i.createdAt >= h.createdAt && i.createdAt <= h.lastEventAt && (i.state === 'pending' || i.answeredAt <= h.lastEventAt)
const memberBound = (m: Member, h: Household): boolean => m.householdId === h.id && m.homeId === h.homeId && m.epoch === h.epoch && same(m.owner,h.owner) && m.acceptedAt >= h.createdAt && m.acceptedAt <= h.lastEventAt && (m.state === 'active' || m.endedAt <= h.lastEventAt)
const completeRoster = (rows: readonly Member[], h: Household): boolean => rows.length === h.active.length && new Set(rows.map(m=>m.id)).size === rows.length && new Set(rows.map(m=>m.member.character)).size === rows.length && rows.every(m=>m.state === 'active' && h.active.includes(m.id) && memberBound(m,h))
const completePending = (rows: readonly Invite[], h: Household, roster: readonly Member[]): boolean => rows.length === h.pending.length && new Set(rows.map(i=>i.id)).size === rows.length && new Set(rows.map(i=>i.recipient.character)).size === rows.length && rows.every(i=>i.state === 'pending' && h.pending.includes(i.id) && inviteBound(i,h) && !roster.some(m=>m.member.character === i.recipient.character))

/** All reads below are explicit, versioned and bounded. No adapter may manufacture missing rows. */
class Patch {
  readonly expected: Expectation[] = []
  readonly writes: Write[] = []
  readonly events: Event[] = []
  readonly liabilities: LiabilityHandoff[] = []
  private readonly characters: CharacterIndex[] = []
  private readonly lives: LifeIndex[] = []
  private readonly usedCharacters = new Set<CharacterId>()
  private readonly usedLives = new Set<LifeId>()
  private readonly dirtyCharacters = new Set<CharacterId>()
  private readonly dirtyLives = new Set<LifeId>()
  valid = true
  readonly view: View
  constructor(view: View) {
    this.view = view
    for (const row of view.characters) {
      if (row.point.state === 'not-loaded') { this.valid=false; continue }
      const value: CharacterIndex = row.point.state === 'present' ? row.point.value : {id:row.id,revision:0,hosted:[],joined:[],incoming:[]}
      this.characters.push(value)
      this.expect('characterIndexes',row.id,row.point.state === 'present' ? value.revision : null)
    }
    for (const row of view.lives) {
      if (row.point.state === 'not-loaded') { this.valid=false; continue }
      const value: LifeIndex = row.point.state === 'present' ? row.point.value : {id:row.id,revision:0,joined:[]}
      this.lives.push(value)
      this.expect('lifeIndexes',row.id,row.point.state === 'present' ? value.revision : null)
    }
    const a=view.authority
    if (a.kind === 'actor') {
      this.fact(a.actor)
      if (a.pair.state === 'present') this.expect('pairFacts',pairKey(a.pair.value),a.pair.value.revision)
    } else if (a.evidence.kind === 'life') this.fact(a.evidence.value)
    else if (a.evidence.kind === 'pair') this.expect('pairFacts',pairKey(a.evidence.value),a.evidence.value.revision)
  }
  expect(collection: Collection,id: string,revision: number | null): void {
    const old=this.expected.find(e=>e.collection===collection && e.id===id)
    if (old) { if (old.revision!==revision) this.valid=false; return }
    this.expected.push({collection,id,revision})
  }
  fact(f: LifeFact): void { this.expect('lifeFacts',f.id,f.revision) }
  character(id: CharacterId): CharacterIndex | undefined { this.usedCharacters.add(id); return this.characters.find(r=>r.id===id) }
  life(id: LifeId): LifeIndex | undefined { this.usedLives.add(id); return this.lives.find(r=>r.id===id) }
  changeCharacter(id: CharacterId, field: 'hosted' | 'joined' | 'incoming', value: string, add: boolean): boolean {
    const row=this.character(id)
    if (!row) return false
    const old=row[field]
    if (old.some(entry=>entry===value) === add) return false
    // Field-specific validated IDs come from canonical command/record identities. No generic string is written.
    let next: CharacterIndex
    if (field === 'hosted') {
      const source=this.writes.find(w=>w.collection==='households' && w.value.id===value)
      if (!source || source.collection!=='households') return false
      next={...row,hosted:add?[...row.hosted,source.value.id]:row.hosted.filter(v=>v!==source.value.id)}
    } else if (field === 'joined') {
      const source=this.writes.find(w=>w.collection==='members' && w.value.id===value)
      if (!source || source.collection!=='members') return false
      next={...row,joined:add?[...row.joined,source.value.id]:row.joined.filter(v=>v!==source.value.id)}
    } else {
      const source=this.writes.find(w=>w.collection==='invites' && w.value.id===value)
      if (!source || source.collection!=='invites') return false
      next={...row,incoming:add?[...row.incoming,source.value.id]:row.incoming.filter(v=>v!==source.value.id)}
    }
    if (next.hosted.length+next.joined.length>20 || next.incoming.length>16) return false
    const at=this.characters.indexOf(row); this.characters[at]=next; this.dirtyCharacters.add(id); return true
  }
  changeLife(m: Member,add: boolean): boolean {
    const row=this.life(m.member.life)
    if (!row || row.joined.includes(m.id)===add) return false
    const joined=add?[...row.joined,m.id]:row.joined.filter(id=>id!==m.id)
    if (joined.length>20) return false
    this.lives[this.lives.indexOf(row)]={...row,joined}; this.dirtyLives.add(row.id); return true
  }
  finish(): Result {
    if (!this.valid) return refuse('incomplete_or_conflicting_view')
    if (this.characters.some(r=>!this.usedCharacters.has(r.id)) || this.lives.some(r=>!this.usedLives.has(r.id))) return refuse('unrelated_index_view')
    for (const row of this.characters) if (this.dirtyCharacters.has(row.id)) {
      const read=this.view.characters.find(r=>r.id===row.id)
      if (!read || row.revision===Number.MAX_SAFE_INTEGER) return refuse('revision_exhausted')
      this.writes.push({collection:'characterIndexes',value:{...row,revision:read.point.state==='absent'?0:row.revision+1}})
    }
    for (const row of this.lives) if (this.dirtyLives.has(row.id)) {
      const read=this.view.lives.find(r=>r.id===row.id)
      if (!read || row.revision===Number.MAX_SAFE_INTEGER) return refuse('revision_exhausted')
      this.writes.push({collection:'lifeIndexes',value:{...row,revision:read.point.state==='absent'?0:row.revision+1}})
    }
    return {ok:true,expected:this.expected,writes:this.writes,events:this.events,liabilities:this.liabilities}
  }
}
function expectPoint<T extends {readonly revision:number}>(p:Patch,collection:Collection,id:string,point:Point<T>): boolean {
  if (point.state==='not-loaded') return false
  p.expect(collection,id,point.state==='present'?point.value.revision:null); return true
}
function endMember(p:Patch,h:Household,m:Member,reason:MemberEnd,now:number): boolean {
  if (m.state!=='active' || m.revision===Number.MAX_SAFE_INTEGER) return false
  const c=p.character(m.member.character),l=p.life(m.member.life)
  if (!c?.joined.includes(m.id) || !l?.joined.includes(m.id)) return false
  p.expect('members',m.id,m.revision)
  p.writes.push({collection:'members',value:{...m,state:'ended',revision:m.revision+1,endedAt:now,reason}})
  if (!p.changeCharacter(m.member.character,'joined',m.id,false) || !p.changeLife(m,false)) return false
  p.events.push({type:'membership-ended',membershipId:m.id,member:m.member,reason,at:now})
  p.liabilities.push({membershipId:m.id,householdId:h.id,homeId:h.homeId,epoch:h.epoch,payer:m.member,owner:h.owner,endReason:reason,effectiveAt:now,requirement:'bar-delivery-and-settle-undelivered-atomically'})
  return true
}
function endInvite(p:Patch,i:Invite,state:'declined'|'cancelled'|'expired',now:number): boolean {
  if (i.state!=='pending' || i.revision===Number.MAX_SAFE_INTEGER || !p.character(i.recipient.character)?.incoming.includes(i.id)) return false
  p.expect('invites',i.id,i.revision)
  p.writes.push({collection:'invites',value:{...i,state,revision:i.revision+1,answeredAt:now}})
  if (!p.changeCharacter(i.recipient.character,'incoming',i.id,false)) return false
  p.events.push({type:'invitation-ended',inviteId:i.id,state,at:now}); return true
}

/** Trusted adapter supplies authenticated canonical facts inside one transaction; client views are never authority. */
export function reduceConsent(rawCommand:unknown,rawView:unknown): Result {
  const c=parseCommand(rawCommand)
  if (!c) return refuse('invalid_command')
  if (!isView(rawView) || rawView.op!==c.op) return refuse('invalid_view')
  const v=rawView, a=v.authority, now=v.now, p=new Patch(v)
  if (!p.valid || v.home.state!=='present') return refuse('incomplete_view')
  const home=v.home.value
  p.expect('homes',home.id,home.revision)
  if (!expectPoint(p,'homeIndexes',home.id,v.homeIndex) || v.homeIndex.state==='present' && v.homeIndex.value.id!==home.id) return refuse('invalid_home_index')
  if (!expectPoint(p,'households',c.householdId,v.household)) return refuse('incomplete_view')
  if (c.op==='register' && v.op==='register') {
    if (v.household.state!=='absent' || home.id!==c.homeId || home.epoch!==c.epoch || home.state!=='available' || !actorIs(a,home.owner)) return refuse('not_authorized_or_changed')
    if (v.homeIndex.state==='present' && v.homeIndex.value.householdId!==null) return refuse('household_exists')
    const owner=p.character(home.owner.character)
    if (!owner || owner.hosted.includes(c.householdId) || owner.hosted.length+owner.joined.length>=20) return refuse('index_missing_or_full')
    const household:Household={id:c.householdId,homeId:home.id,epoch:home.epoch,owner:home.owner,createdAt:now,lastEventAt:now,revision:0,state:'open',active:[],pending:[]}
    p.writes.push({collection:'households',value:household})
    if (!p.changeCharacter(home.owner.character,'hosted',household.id,true)) return refuse('index_mismatch')
    const old=v.homeIndex.state==='present'?v.homeIndex.value.revision:null
    if (old===Number.MAX_SAFE_INTEGER) return refuse('revision_exhausted')
    p.writes.push({collection:'homeIndexes',value:{id:home.id,householdId:household.id,revision:old===null?0:old+1}})
    p.events.push({type:'household-opened',householdId:household.id,at:now}); return p.finish()
  }
  if (c.op==='register' || v.household.state!=='present') return refuse('household_missing')
  const h=v.household.value
  if (h.id!==c.householdId || h.state!=='open' || h.revision!==c.revision || h.epoch!==c.epoch || h.homeId!==home.id) return refuse('stale_household')
  if (h.revision===Number.MAX_SAFE_INTEGER) return refuse('revision_exhausted')
  if (now<h.lastEventAt) return refuse('time_regressed')
  if (v.homeIndex.state!=='present' || v.homeIndex.value.householdId!==h.id || !p.character(h.owner.character)?.hosted.includes(h.id)) return refuse('index_mismatch')
  const terminalClose=c.op==='close' && systemClose(a,h,home)
  if (!terminalClose && (home.state!=='available' || home.epoch!==h.epoch || !same(home.owner,h.owner))) return refuse('home_changed')
  const nextBase={...h,revision:h.revision+1,lastEventAt:now}
  if (v.op==='invite' || v.op==='accept' || v.op==='close') {
    if (!completeRoster(v.roster,h)) return refuse('incomplete_roster')
    for (const m of v.roster) p.expect('members',m.id,m.revision)
  }
  if (v.op==='invite' || v.op==='close') {
    if (!completePending(v.pending,h,v.roster)) return refuse('incomplete_pending')
    for (const i of v.pending) p.expect('invites',i.id,i.revision)
  }
  if (c.op==='invite' && v.op==='invite') {
    if (v.freshInvite.state!=='absent') return refuse(v.freshInvite.state==='not-loaded'?'incomplete_view':'id_in_use')
    if (c.recipient.character===h.owner.character || !available(v.recipient,c.recipient) || !friends(a,h.owner,c.recipient)) return refuse('not_authorized')
    p.fact(v.recipient); p.expect('invites',c.inviteId,null)
    if (v.roster.some(m=>m.member.character===c.recipient.character) || v.pending.some(i=>i.recipient.character===c.recipient.character)) return refuse('relationship_exists')
    if (h.pending.length>=LIMITS.pendingPerHome) return refuse('home_pending_full')
    const recipient=p.character(c.recipient.character)
    if (!recipient || recipient.incoming.length>=16 || recipient.incoming.includes(c.inviteId)) return refuse('incoming_missing_or_full')
    const expiresAt=now+LIMITS.inviteMs
    if (!integer(expiresAt)) return refuse('invalid_time')
    const invite:Invite={id:c.inviteId,householdId:h.id,homeId:h.homeId,epoch:h.epoch,owner:h.owner,recipient:c.recipient,permissions:PERMISSIONS,revision:0,state:'pending',createdAt:now,expiresAt}
    p.writes.push({collection:'invites',value:invite},{collection:'households',value:{...nextBase,pending:[...h.pending,invite.id]}})
    if (!p.changeCharacter(c.recipient.character,'incoming',invite.id,true)) return refuse('index_mismatch')
    p.events.push({type:'invitation-created',inviteId:invite.id,state:'pending',at:now}); return p.finish()
  }
  if ((c.op==='accept' || c.op==='decline' || c.op==='cancel' || c.op==='expire' || c.op==='terminate-invitation') && (v.op==='accept' || v.op==='decline' || v.op==='cancel' || v.op==='expire' || v.op==='terminate-invitation')) {
    if (v.invite.state!=='present') return refuse(v.invite.state==='not-loaded'?'incomplete_view':'invitation_missing')
    const i=v.invite.value
    if (i.id!==c.inviteId || i.state!=='pending' || !inviteBound(i,h) || !h.pending.includes(i.id) || !p.character(i.recipient.character)?.incoming.includes(i.id)) return refuse('invitation_changed')
    p.expect('invites',i.id,i.revision)
    if (i.revision===Number.MAX_SAFE_INTEGER) return refuse('revision_exhausted')
    if (c.op==='accept' && v.op==='accept') {
      if (now>=i.expiresAt) return refuse('invitation_expired')
      if (!available(v.owner,h.owner) || !friends(a,i.recipient,h.owner)) return refuse('not_authorized')
      p.fact(v.owner)
      if (v.freshMember.state!=='absent') return refuse(v.freshMember.state==='not-loaded'?'incomplete_view':'id_in_use')
      p.expect('members',c.membershipId,null)
      if (v.roster.some(m=>m.member.character===i.recipient.character)) return refuse('membership_exists')
      const ci=p.character(i.recipient.character),li=p.life(i.recipient.life)
      if (!ci || !li || ci.hosted.length+ci.joined.length>=20 || li.joined.length>=20 || ci.joined.includes(c.membershipId) || li.joined.includes(c.membershipId) || h.active.length>=11) return refuse('membership_index_missing_or_full')
      const member:Member={id:c.membershipId,householdId:h.id,homeId:h.homeId,epoch:h.epoch,inviteId:i.id,owner:h.owner,member:i.recipient,permissions:PERMISSIONS,revision:0,acceptedAt:now,state:'active'}
      p.writes.push({collection:'members',value:member},{collection:'invites',value:{...i,state:'accepted',revision:i.revision+1,answeredAt:now,membershipId:member.id}},{collection:'households',value:{...nextBase,pending:h.pending.filter(id=>id!==i.id),active:[...h.active,member.id]}})
      if (!p.changeCharacter(i.recipient.character,'incoming',i.id,false) || !p.changeCharacter(i.recipient.character,'joined',member.id,true) || !p.changeLife(member,true)) return refuse('index_mismatch')
      p.events.push({type:'membership-accepted',membershipId:member.id,at:now}); return p.finish()
    }
    let ended:'declined'|'cancelled'|'expired'
    if (c.op==='decline') { if (!actorIs(a,i.recipient)) return refuse('not_authorized'); if (now>=i.expiresAt) return refuse('invitation_expired'); ended='declined' }
    else if (c.op==='cancel') { if (!actorIs(a,h.owner)) return refuse('not_authorized'); if (now>=i.expiresAt) return refuse('invitation_expired'); ended='cancelled' }
    else if (c.op==='expire') { if (a.kind!=='system' || now<i.expiresAt) return refuse('not_due'); ended='expired' }
    else if (c.op==='terminate-invitation') { if (!systemPairOrLife(a,i.recipient,h.owner)) return refuse('not_authorized'); ended=now>=i.expiresAt?'expired':'cancelled' }
    else return refuse('invalid_view')
    if (!endInvite(p,i,ended,now)) return refuse('index_or_revision_mismatch')
    p.writes.push({collection:'households',value:{...nextBase,pending:h.pending.filter(id=>id!==i.id)}}); return p.finish()
  }
  if ((c.op==='leave' || c.op==='revoke' || c.op==='terminate') && (v.op==='leave' || v.op==='revoke' || v.op==='terminate')) {
    if (v.member.state!=='present') return refuse(v.member.state==='not-loaded'?'incomplete_view':'membership_missing')
    const m=v.member.value
    if (m.id!==c.membershipId || m.revision!==c.memberRevision || m.state!=='active' || !memberBound(m,h) || !h.active.includes(m.id)) return refuse('membership_changed')
    let reason:MemberEnd
    if (c.op==='leave') { if (!actorIs(a,m.member)) return refuse('not_authorized'); reason='left' }
    else if (c.op==='revoke') { if (!actorIs(a,h.owner)) return refuse('not_authorized'); reason='revoked' }
    else { if (!systemPairOrLife(a,m.member,h.owner) || a.kind!=='system' || (a.cause!=='blocked' && a.cause!=='unfriended' && a.cause!=='member_life_changed' && a.cause!=='character_erased')) return refuse('not_authorized'); reason=a.cause }
    if (!endMember(p,h,m,reason,now)) return refuse('index_or_revision_mismatch')
    p.writes.push({collection:'households',value:{...nextBase,active:h.active.filter(id=>id!==m.id)}}); return p.finish()
  }
  if (c.op==='close' && v.op==='close') {
    if (!(c.reason==='owner_closed' && actorIs(a,h.owner)) && !(a.kind==='system' && c.reason===a.cause && systemClose(a,h,home))) return refuse('not_authorized')
    const reason:MemberEnd=c.reason==='owner_closed'?'household_closed':c.reason
    for (const m of v.roster) if (!endMember(p,h,m,reason,now)) return refuse('index_or_revision_mismatch')
    for (const i of v.pending) if (!endInvite(p,i,now>=i.expiresAt?'expired':'cancelled',now)) return refuse('index_or_revision_mismatch')
    p.writes.push({collection:'households',value:{...nextBase,state:'closed',closedAt:now,reason:c.reason,active:[],pending:[]}})
    if (!p.changeCharacter(h.owner.character,'hosted',h.id,false) || v.homeIndex.state!=='present' || v.homeIndex.value.revision===Number.MAX_SAFE_INTEGER) return refuse('index_or_revision_mismatch')
    p.writes.push({collection:'homeIndexes',value:{...v.homeIndex.value,householdId:null,revision:v.homeIndex.value.revision+1}})
    p.events.push({type:'household-closed',householdId:h.id,reason:c.reason,at:now}); return p.finish()
  }
  return refuse('invalid_view')
}
