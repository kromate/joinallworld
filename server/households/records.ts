declare const idBrand: unique symbol
export type Id<K extends string> = string & { readonly [idBrand]: K }
export type CharacterId = Id<'character'>
export type LifeId = Id<'life'>
export type HomeId = Id<'home'>
export type HouseholdId = Id<'household'>
export type InviteId = Id<'invite'>
export type MembershipId = Id<'membership'>
export interface Identity { readonly character: CharacterId; readonly life: LifeId }
export const LIMITS = Object.freeze({ residents: 11, incoming: 16, pendingPerHome: 16, relationships: 20, inviteMs: 604800000 })
export type Permissions = readonly ['sleep', 'cook']
export const PERMISSIONS: Permissions = Object.freeze(['sleep', 'cook'])
export type MemberEnd = 'left' | 'revoked' | 'blocked' | 'unfriended' | 'member_life_changed' | 'character_erased' | 'home_retired' | 'owner_life_changed' | 'household_closed'
export type HomeEnd = 'owner_closed' | 'home_retired' | 'owner_life_changed' | 'character_erased'
export type PairCause = 'blocked' | 'unfriended'
export type SystemCause = PairCause | 'member_life_changed' | 'owner_life_changed' | 'character_erased' | 'home_retired'
interface Versioned<K extends string> { readonly id: Id<K>; readonly revision: number }
export interface Home extends Versioned<'home'> { readonly owner: Identity; readonly epoch: number; readonly state: 'available' | 'retired' }
interface HouseholdBase extends Versioned<'household'> {
  readonly homeId: HomeId; readonly epoch: number; readonly owner: Identity
  readonly createdAt: number; readonly lastEventAt: number
  readonly active: readonly MembershipId[]; readonly pending: readonly InviteId[]
}
export type Household = HouseholdBase & ({ readonly state: 'open' } | { readonly state: 'closed'; readonly closedAt: number; readonly reason: HomeEnd })
interface InviteBase extends Versioned<'invite'> {
  readonly householdId: HouseholdId; readonly homeId: HomeId; readonly epoch: number
  readonly owner: Identity; readonly recipient: Identity; readonly permissions: Permissions
  readonly createdAt: number; readonly expiresAt: number
}
export type Invite = InviteBase & ({ readonly state: 'pending' } | { readonly state: 'accepted'; readonly answeredAt: number; readonly membershipId: MembershipId } | { readonly state: 'declined' | 'cancelled' | 'expired'; readonly answeredAt: number })
interface MemberBase extends Versioned<'membership'> {
  readonly householdId: HouseholdId; readonly homeId: HomeId; readonly epoch: number; readonly inviteId: InviteId
  readonly owner: Identity; readonly member: Identity; readonly permissions: Permissions; readonly acceptedAt: number
}
export type Member = MemberBase & ({ readonly state: 'active' } | { readonly state: 'ended'; readonly endedAt: number; readonly reason: MemberEnd })
export interface CharacterIndex extends Versioned<'character'> { readonly hosted: readonly HouseholdId[]; readonly joined: readonly MembershipId[]; readonly incoming: readonly InviteId[] }
export interface LifeIndex extends Versioned<'life'> { readonly joined: readonly MembershipId[] }
export interface HomeIndex extends Versioned<'home'> { readonly householdId: HouseholdId | null }
export interface LifeFact extends Versioned<'life'> { readonly who: Identity; readonly state: 'available' | 'retired' | 'erased' }
export interface PairFact { readonly a: Identity; readonly b: Identity; readonly revision: number; readonly friends: boolean; readonly blocked: boolean }
export type Point<T> = { readonly state: 'not-loaded' } | { readonly state: 'absent' } | { readonly state: 'present'; readonly value: T }
export interface CharacterRead { readonly id: CharacterId; readonly point: Point<CharacterIndex> }
export interface LifeRead { readonly id: LifeId; readonly point: Point<LifeIndex> }
export type Authority =
  | { readonly kind: 'actor'; readonly actor: LifeFact; readonly pair: Point<PairFact> }
  | { readonly kind: 'system'; readonly subject: Identity; readonly cause: SystemCause; readonly evidence: { readonly kind: 'home' } | { readonly kind: 'life'; readonly value: LifeFact } | { readonly kind: 'pair'; readonly value: PairFact } }
interface Expected { readonly householdId: HouseholdId; readonly revision: number; readonly epoch: number }
export type Command =
  | { readonly op: 'register'; readonly householdId: HouseholdId; readonly homeId: HomeId; readonly epoch: number }
  | (Expected & { readonly op: 'invite'; readonly inviteId: InviteId; readonly recipient: Identity })
  | (Expected & { readonly op: 'accept'; readonly inviteId: InviteId; readonly membershipId: MembershipId })
  | (Expected & { readonly op: 'decline' | 'cancel' | 'expire' | 'terminate-invitation'; readonly inviteId: InviteId })
  | (Expected & { readonly op: 'leave' | 'revoke' | 'terminate'; readonly membershipId: MembershipId; readonly memberRevision: number })
  | (Expected & { readonly op: 'close'; readonly reason: HomeEnd })
interface BaseView {
  readonly now: number; readonly home: Point<Home>; readonly household: Point<Household>; readonly homeIndex: Point<HomeIndex>
  readonly authority: Authority; readonly characters: readonly CharacterRead[]; readonly lives: readonly LifeRead[]
}
export type View =
  | (BaseView & { readonly op: 'register' })
  | (BaseView & { readonly op: 'invite'; readonly freshInvite: Point<Invite>; readonly roster: readonly Member[]; readonly pending: readonly Invite[]; readonly recipient: LifeFact })
  | (BaseView & { readonly op: 'accept'; readonly invite: Point<Invite>; readonly freshMember: Point<Member>; readonly roster: readonly Member[]; readonly owner: LifeFact })
  | (BaseView & { readonly op: 'decline' | 'cancel' | 'expire' | 'terminate-invitation'; readonly invite: Point<Invite> })
  | (BaseView & { readonly op: 'leave' | 'revoke' | 'terminate'; readonly member: Point<Member> })
  | (BaseView & { readonly op: 'close'; readonly roster: readonly Member[]; readonly pending: readonly Invite[] })
export type Collection = 'households' | 'invites' | 'members' | 'characterIndexes' | 'lifeIndexes' | 'homeIndexes' | 'homes' | 'lifeFacts' | 'pairFacts'
export interface Expectation { readonly collection: Collection; readonly id: string; readonly revision: number | null }
export type Write =
  | { readonly collection: 'households'; readonly value: Household }
  | { readonly collection: 'invites'; readonly value: Invite }
  | { readonly collection: 'members'; readonly value: Member }
  | { readonly collection: 'characterIndexes'; readonly value: CharacterIndex }
  | { readonly collection: 'lifeIndexes'; readonly value: LifeIndex }
  | { readonly collection: 'homeIndexes'; readonly value: HomeIndex }
export type Event =
  | { readonly kind: 'household-opened'; readonly householdId: HouseholdId; readonly at: number }
  | { readonly kind: 'invitation-created' | 'invitation-ended'; readonly inviteId: InviteId; readonly state: Invite['state']; readonly at: number }
  | { readonly kind: 'membership-accepted'; readonly membershipId: MembershipId; readonly at: number }
  | { readonly kind: 'membership-ended'; readonly membershipId: MembershipId; readonly member: Identity; readonly reason: MemberEnd; readonly at: number }
  | { readonly kind: 'household-closed'; readonly householdId: HouseholdId; readonly reason: HomeEnd; readonly at: number }
/** Mandatory atomic consumer request; never a claim that escrow was refunded. At most 11 per patch. */
export interface LiabilityHandoff { readonly membershipId: MembershipId; readonly householdId: HouseholdId; readonly homeId: HomeId; readonly epoch: number; readonly payer: Identity; readonly owner: Identity; readonly endReason: MemberEnd; readonly effectiveAt: number; readonly requirement: 'bar-delivery-and-settle-undelivered-atomically' }
export type Result = { readonly ok: false; readonly code: string } | { readonly ok: true; readonly expected: readonly Expectation[]; readonly writes: readonly Write[]; readonly events: readonly Event[]; readonly liabilities: readonly LiabilityHandoff[] }

export const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
export const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const id = <K extends string>(x: unknown): x is Id<K> => typeof x === 'string' && UUID.test(x)
export const identity = (x: unknown): x is Identity => record(x) && id<'character'>(x.character) && id<'life'>(x.life)
export const same = (a: Identity, b: Identity): boolean => a.character === b.character && a.life === b.life
export const oneOf = <T extends string>(x: unknown, choices: readonly T[]): x is T => typeof x === 'string' && choices.some(v => v === x)
function denseArray(x: unknown, max: number): x is unknown[] {
  if (!Array.isArray(x) || x.length > max) return false
  for (let index = 0; index < x.length; index++) if (!Object.hasOwn(x, index)) return false
  return true
}
const permissions = (x: unknown): x is Permissions => denseArray(x, 2) && x.length === 2 && x[0] === 'sleep' && x[1] === 'cook'
const ids = <K extends string>(x: unknown, max: number): x is readonly Id<K>[] => denseArray(x, max) && x.every(id<K>) && new Set(x).size === x.length
const version = <K extends string>(x: unknown): x is Versioned<K> & Record<string, unknown> => record(x) && id<K>(x.id) && integer(x.revision)
export const homeEnd = (x: unknown): x is HomeEnd => oneOf(x, ['owner_closed','home_retired','owner_life_changed','character_erased'])
const memberEnd = (x: unknown): x is MemberEnd => oneOf(x, ['left','revoked','blocked','unfriended','member_life_changed','character_erased','home_retired','owner_life_changed','household_closed'])
export const isHome = (x: unknown): x is Home => version<'home'>(x) && identity(x.owner) && integer(x.epoch) && oneOf(x.state,['available','retired'])
export function isHousehold(x: unknown): x is Household {
  if (!version<'household'>(x) || !id<'home'>(x.homeId) || !integer(x.epoch) || !identity(x.owner) || !integer(x.createdAt) || !integer(x.lastEventAt) || x.lastEventAt < x.createdAt || !ids<'membership'>(x.active,LIMITS.residents) || !ids<'invite'>(x.pending,LIMITS.pendingPerHome)) return false
  return x.state === 'open' ? x.closedAt === undefined && x.reason === undefined : x.state === 'closed' && integer(x.closedAt) && x.closedAt === x.lastEventAt && homeEnd(x.reason) && x.active.length === 0 && x.pending.length === 0
}
export function isInvite(x: unknown): x is Invite {
  if (!version<'invite'>(x) || !id<'household'>(x.householdId) || !id<'home'>(x.homeId) || !integer(x.epoch) || !identity(x.owner) || !identity(x.recipient) || x.owner.character === x.recipient.character || !permissions(x.permissions) || !integer(x.createdAt) || !integer(x.expiresAt) || x.expiresAt !== x.createdAt + LIMITS.inviteMs) return false
  if (x.state === 'pending') return x.answeredAt === undefined && x.membershipId === undefined
  if (!integer(x.answeredAt) || x.answeredAt < x.createdAt) return false
  if (x.state === 'accepted') return x.answeredAt < x.expiresAt && id<'membership'>(x.membershipId)
  return oneOf(x.state,['declined','cancelled','expired']) && x.membershipId === undefined && (x.state === 'expired' ? x.answeredAt >= x.expiresAt : x.answeredAt < x.expiresAt)
}
export function isMember(x: unknown): x is Member {
  if (!version<'membership'>(x) || !id<'household'>(x.householdId) || !id<'home'>(x.homeId) || !id<'invite'>(x.inviteId) || !integer(x.epoch) || !identity(x.owner) || !identity(x.member) || x.owner.character === x.member.character || !permissions(x.permissions) || !integer(x.acceptedAt)) return false
  return x.state === 'active' ? x.endedAt === undefined && x.reason === undefined : x.state === 'ended' && integer(x.endedAt) && x.endedAt >= x.acceptedAt && memberEnd(x.reason)
}
export const isCharacterIndex = (x: unknown): x is CharacterIndex => version<'character'>(x) && ids<'household'>(x.hosted,20) && ids<'membership'>(x.joined,20) && x.hosted.length + x.joined.length <= 20 && ids<'invite'>(x.incoming,16)
export const isLifeIndex = (x: unknown): x is LifeIndex => version<'life'>(x) && ids<'membership'>(x.joined,20)
export const isHomeIndex = (x: unknown): x is HomeIndex => version<'home'>(x) && (x.householdId === null || id<'household'>(x.householdId))
export const isLifeFact = (x: unknown): x is LifeFact => version<'life'>(x) && identity(x.who) && x.id === x.who.life && oneOf(x.state,['available','retired','erased'])
export const isPair = (x: unknown): x is PairFact => record(x) && identity(x.a) && identity(x.b) && x.a.character !== x.b.character && integer(x.revision) && typeof x.friends === 'boolean' && typeof x.blocked === 'boolean'
export const point = <T>(x: unknown, check: (v: unknown) => v is T): x is Point<T> => record(x) && (x.state === 'present' ? check(x.value) : (x.state === 'absent' || x.state === 'not-loaded') && x.value === undefined)
const isAuthority = (x: unknown): x is Authority => {
  if (!record(x)) return false
  if (x.kind === 'actor') return isLifeFact(x.actor) && point(x.pair,isPair)
  if (x.kind !== 'system' || !identity(x.subject) || !oneOf(x.cause,['blocked','unfriended','member_life_changed','owner_life_changed','character_erased','home_retired']) || !record(x.evidence)) return false
  return x.evidence.kind === 'home' || x.evidence.kind === 'life' && isLifeFact(x.evidence.value) || x.evidence.kind === 'pair' && isPair(x.evidence.value)
}
export function parseCommand(x: unknown): Command | null {
  if (!record(x) || !id<'household'>(x.householdId) || !integer(x.epoch)) return null
  if (x.op === 'register') return id<'home'>(x.homeId) ? {op:x.op, householdId:x.householdId, homeId:x.homeId, epoch:x.epoch} : null
  if (!integer(x.revision)) return null
  const expected = {householdId:x.householdId, revision:x.revision, epoch:x.epoch}
  switch (x.op) {
    case 'invite': return id<'invite'>(x.inviteId) && identity(x.recipient) ? {...expected,op:x.op,inviteId:x.inviteId,recipient:x.recipient} : null
    case 'accept': return id<'invite'>(x.inviteId) && id<'membership'>(x.membershipId) ? {...expected,op:x.op,inviteId:x.inviteId,membershipId:x.membershipId} : null
    case 'decline': case 'cancel': case 'expire': case 'terminate-invitation': return id<'invite'>(x.inviteId) ? {...expected,op:x.op,inviteId:x.inviteId} : null
    case 'leave': case 'revoke': case 'terminate': return id<'membership'>(x.membershipId) && integer(x.memberRevision) ? {...expected,op:x.op,membershipId:x.membershipId,memberRevision:x.memberRevision} : null
    case 'close': return homeEnd(x.reason) ? {...expected,op:x.op,reason:x.reason} : null
    default: return null
  }
}
const members = (x: unknown): x is readonly Member[] => denseArray(x, 11) && x.every(isMember)
const invites = (x: unknown): x is readonly Invite[] => denseArray(x, 16) && x.every(isInvite)
const isCharacterRead = (v: unknown): v is CharacterRead => record(v) && id<'character'>(v.id) && point(v.point,isCharacterIndex) && (v.point.state !== 'present' || v.point.value.id === v.id)
const isLifeRead = (v: unknown): v is LifeRead => record(v) && id<'life'>(v.id) && point(v.point,isLifeIndex) && (v.point.state !== 'present' || v.point.value.id === v.id)
export function isView(x: unknown): x is View {
  if (!record(x) || !integer(x.now) || !point(x.home,isHome) || !point(x.household,isHousehold) || !point(x.homeIndex,isHomeIndex) || !isAuthority(x.authority)) return false
  if (!denseArray(x.characters, 28) || !x.characters.every(isCharacterRead) || new Set(x.characters.map(v => v.id)).size !== x.characters.length) return false
  if (!denseArray(x.lives, 11) || !x.lives.every(isLifeRead) || new Set(x.lives.map(v => v.id)).size !== x.lives.length) return false
  switch (x.op) {
    case 'register': return true
    case 'invite': return point(x.freshInvite,isInvite) && members(x.roster) && invites(x.pending) && isLifeFact(x.recipient)
    case 'accept': return point(x.invite,isInvite) && point(x.freshMember,isMember) && members(x.roster) && isLifeFact(x.owner)
    case 'decline': case 'cancel': case 'expire': case 'terminate-invitation': return point(x.invite,isInvite)
    case 'leave': case 'revoke': case 'terminate': return point(x.member,isMember)
    case 'close': return members(x.roster) && invites(x.pending)
    default: return false
  }
}
export const pairKey = (p: PairFact): string => [p.a.character,p.b.character].sort().join(':')
