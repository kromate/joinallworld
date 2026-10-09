import {
  LIMITS, isCharacterIndex, isHome, isHomeIndex, isHousehold, isInvite,
  isLifeFact, isLifeIndex, isMember, isPair, isView, parseCommand, point as isPoint, record,
  type Authority, type CharacterId, type CharacterRead, type Command,
  type Home, type Household, type Identity, type Invite, type LifeFact,
  type LifeId, type LifeRead, type Member, type Point, type View,
} from './records.ts'

/** Transaction-local point access. Every missing row is explicit; not-loaded is never absence. */
export interface ConsentReadTransaction {
  now(): number
  sessionLife(): Promise<Point<unknown>>
  systemAuthority(): Promise<Point<Authority>>
  home(id: string): Promise<Point<unknown>>
  homeIndex(id: string): Promise<Point<unknown>>
  household(id: string): Promise<Point<unknown>>
  characterIndex(id: string): Promise<Point<unknown>>
  lifeIndex(id: string): Promise<Point<unknown>>
  lifeFact(id: string): Promise<Point<unknown>>
  pairFact(a: Identity, b: Identity): Promise<Point<unknown>>
  invite(id: string): Promise<Point<unknown>>
  member(id: string): Promise<Point<unknown>>
}

export type ConsentViewLoad = Readonly<{ ok: true; command: Command; view: View }> | Readonly<{ ok: false; code: string }>
const fail = (code: string): ConsentViewLoad => ({ ok: false, code })
type KnownPoint<T> = Exclude<Point<T>, { readonly state: 'not-loaded' }>
const hasPoint = <T>(p: Point<unknown>, check: (x: unknown) => x is T): p is Point<T> => isPoint(p, check)
const idOf = (x: unknown): string | undefined => record(x) && typeof x.id === 'string' ? x.id : undefined
const unique = <T>(xs: readonly T[]): boolean => new Set(xs).size === xs.length
const linkedMemberInvites = async (tx: ConsentReadTransaction, members: readonly Member[], household: Household): Promise<boolean> => {
  if (members.length > LIMITS.residents) return false
  for (const member of members) {
    const p = await point(tx.invite(member.inviteId), isInvite)
    if (!p || p.state !== 'present') return false
    const invite = p.value
    if (invite.state !== 'accepted' || invite.membershipId !== member.id || invite.answeredAt !== member.acceptedAt || invite.householdId !== household.id || invite.homeId !== household.homeId || invite.epoch !== household.epoch || invite.owner.character !== member.owner.character || invite.owner.life !== member.owner.life || invite.recipient.character !== member.member.character || invite.recipient.life !== member.member.life || invite.permissions[0] !== member.permissions[0] || invite.permissions[1] !== member.permissions[1]) return false
  }
  return true
}

async function point<T>(read: Promise<Point<unknown>>, check: (x: unknown) => x is T): Promise<KnownPoint<T> | null> {
  const p = await read
  return hasPoint(p, check) && p.state !== 'not-loaded' ? p : null
}
async function indexedCharacters(tx: ConsentReadTransaction, ids: readonly CharacterId[]): Promise<readonly CharacterRead[] | null> {
  if (ids.length > 28 || !unique(ids)) return null
  const out: CharacterRead[] = []
  for (const id of ids) {
    const p = await point(tx.characterIndex(id), isCharacterIndex)
    if (!p) return null
    if (p.state === 'present' && p.value.id !== id) return null
    out.push({ id, point: p })
  }
  return out
}
async function indexedLives(tx: ConsentReadTransaction, ids: readonly LifeId[]): Promise<readonly LifeRead[] | null> {
  if (ids.length > LIMITS.residents || !unique(ids)) return null
  const out: LifeRead[] = []
  for (const id of ids) {
    const p = await point(tx.lifeIndex(id), isLifeIndex)
    if (!p) return null
    if (p.state === 'present' && p.value.id !== id) return null
    out.push({ id, point: p })
  }
  return out
}
async function rows<T>(ids: readonly string[], max: number, read: (id: string) => Promise<Point<unknown>>, check: (x: unknown) => x is T): Promise<readonly T[] | null> {
  if (ids.length > max || !unique(ids)) return null
  const out: T[] = []
  for (const id of ids) {
    const p = await point(read(id), check)
    if (!p || p.state !== 'present' || idOf(p.value) !== id) return null
    out.push(p.value)
  }
  return out
}

/** Build the reducer view from trusted transaction reads; command data never supplies authority. */
export async function loadConsentView(rawCommand: unknown, tx: ConsentReadTransaction): Promise<ConsentViewLoad> {
  const command = parseCommand(rawCommand)
  if (!command) return fail('invalid_command')
  const now = tx.now()
  if (!Number.isSafeInteger(now) || now < 0) return fail('invalid_time')

  if (command.op === 'register') {
    const home = await point(tx.home(command.homeId), isHome)
    const homeIndex = await point(tx.homeIndex(command.homeId), isHomeIndex)
    const household = await point(tx.household(command.householdId), isHousehold)
    const session = await point(tx.sessionLife(), isLifeFact)
    if (!home || !homeIndex || !household || !session || home.state !== 'present' || session.state !== 'present') return fail('registration_facts_unproven')
    if (home.value.id !== command.homeId || (homeIndex.state === 'present' && homeIndex.value.id !== command.homeId)) return fail('home_binding_mismatch')
    const characters = await indexedCharacters(tx, [home.value.owner.character])
    if (!characters) return fail('owner_index_unproven')
    const view: View = { op: 'register', now, home, household, homeIndex, authority: { kind: 'actor', actor: session.value, pair: { state: 'absent' } }, characters, lives: [] }
    if (!isView(view)) return fail('canonical_view_invalid')
    return { ok: true, command, view }
  }

  const householdPoint = await point(tx.household(command.householdId), isHousehold)
  if (!householdPoint) return fail('household_read_invalid')
  // Without the household there is no trusted home binding to follow. Refuse rather than
  // guessing a current home from the actor or a request field.
  if (householdPoint.state !== 'present') return fail('household_missing')
  const h: Household = householdPoint.value
  if (h.id !== command.householdId) return fail('household_key_mismatch')
  const homePoint = await point(tx.home(h.homeId), isHome)
  const homeIndex = await point(tx.homeIndex(h.homeId), isHomeIndex)
  if (!homePoint || !homeIndex || homePoint.state !== 'present') return fail('home_binding_unproven')
  const home: Home = homePoint.value
  if (home.id !== h.homeId || (homeIndex.state === 'present' && homeIndex.value.id !== h.homeId)) return fail('home_binding_mismatch')

  const systemPoint = await tx.systemAuthority()
  if (!isPoint(systemPoint, (x): x is Authority => record(x) && (x.kind === 'actor' || x.kind === 'system')) || systemPoint.state === 'not-loaded') return fail('system_authority_unproven')
  const session = await point(tx.sessionLife(), isLifeFact)
  if (!session) return fail('session_identity_unproven')
  let authority: Authority
  if (systemPoint.state === 'present') {
    if (systemPoint.value.kind !== 'system') return fail('invalid_system_authority')
    authority = systemPoint.value
  }
  else if (session.state === 'present') {
    let pair: Point<unknown> = { state: 'absent' }
    if (command.op === 'invite') pair = await tx.pairFact(home.owner, command.recipient)
    else if (command.op === 'accept') {
      const invitePoint = await point(tx.invite(command.inviteId), isInvite)
      if (!invitePoint || invitePoint.state !== 'present') return fail('invitation_unproven')
      pair = await tx.pairFact(invitePoint.value.recipient, home.owner)
    }
    if (!hasPoint(pair, isPair)) return fail('relationship_read_invalid')
    authority = { kind: 'actor', actor: session.value, pair }
  } else {
    return fail('actor_identity_absent')
  }

  const ownerFact = async (): Promise<LifeFact | null> => {
    const p = await point(tx.lifeFact(home.owner.life), isLifeFact)
    return p?.state === 'present' && p.value.who.life === home.owner.life && p.value.who.character === home.owner.character ? p.value : null
  }
  let characters: readonly CharacterRead[] | null = null
  let lives: readonly LifeRead[] | null = null
  let view: View

  {
    if (h.state !== 'open' || h.homeId !== home.id) return fail('household_closed_or_unbound')
    const roster = command.op === 'invite' || command.op === 'accept' || command.op === 'close'
      ? await rows(h.active, LIMITS.residents, id => tx.member(id), isMember) : null
    const pending = command.op === 'invite' || command.op === 'close'
      ? await rows(h.pending, LIMITS.pendingPerHome, id => tx.invite(id), isInvite) : null
    if ((command.op === 'invite' || command.op === 'accept' || command.op === 'close') && roster === null) return fail('roster_incomplete')
    if ((command.op === 'invite' || command.op === 'close') && pending === null) return fail('pending_incomplete')
    if (roster && !await linkedMemberInvites(tx, roster, h)) return fail('member_invite_crosslink_mismatch')

    let memberPoint: Point<Member> | undefined
    let invitePoint: Point<Invite> | undefined
    let freshInvite: Point<Invite> | undefined
    let freshMember: Point<Member> | undefined
    let recipient: LifeFact | undefined
    let owner: LifeFact | undefined

    if (command.op === 'invite') {
      freshInvite = await point(tx.invite(command.inviteId), isInvite) ?? undefined
      const fact = await point(tx.lifeFact(command.recipient.life), isLifeFact)
      if (!freshInvite || !fact || fact.state !== 'present' || fact.value.who.character !== command.recipient.character || fact.value.who.life !== command.recipient.life) return fail('recipient_unproven')
      recipient = fact.value
      characters = await indexedCharacters(tx, [home.owner.character, command.recipient.character])
    } else if (command.op === 'accept' || command.op === 'decline' || command.op === 'cancel' || command.op === 'expire' || command.op === 'terminate-invitation') {
      invitePoint = await point(tx.invite(command.inviteId), isInvite) ?? undefined
      if (!invitePoint || invitePoint.state !== 'present') return fail('invitation_unproven')
      const i = invitePoint.value
      if (i.householdId !== h.id || i.homeId !== h.homeId || i.epoch !== h.epoch || i.owner.character !== h.owner.character || i.owner.life !== h.owner.life) return fail('invitation_crosslink_mismatch')
      const charIds = command.op === 'accept' ? [h.owner.character, i.recipient.character] : [i.recipient.character]
      characters = await indexedCharacters(tx, charIds)
      if (command.op === 'accept') {
        freshMember = await point(tx.member(command.membershipId), isMember) ?? undefined
        owner = await ownerFact() ?? undefined
        lives = await indexedLives(tx, [i.recipient.life])
        if (!freshMember || !owner || !lives) return fail('accept_facts_unproven')
      }
    } else if (command.op === 'leave' || command.op === 'revoke' || command.op === 'terminate') {
      memberPoint = await point(tx.member(command.membershipId), isMember) ?? undefined
      if (!memberPoint || memberPoint.state !== 'present') return fail('membership_unproven')
      const m = memberPoint.value
      if (m.householdId !== h.id || m.homeId !== h.homeId || m.epoch !== h.epoch || m.owner.character !== h.owner.character || m.owner.life !== h.owner.life) return fail('membership_crosslink_mismatch')
      if (!await linkedMemberInvites(tx, [m], h)) return fail('member_invite_crosslink_mismatch')
      characters = await indexedCharacters(tx, [m.member.character])
      lives = await indexedLives(tx, [m.member.life])
      if (!characters || !lives) return fail('membership_indexes_unproven')
    } else {
      // close: every linked row's mutable indexes are required for atomic handoff/removal.
      const members = roster ?? []
      const invites = pending ?? []
      if (members.some(m => m.householdId !== h.id || m.homeId !== h.homeId || m.epoch !== h.epoch || m.owner.character !== h.owner.character || m.owner.life !== h.owner.life) || invites.some(i => i.householdId !== h.id || i.homeId !== h.homeId || i.epoch !== h.epoch || i.owner.character !== h.owner.character || i.owner.life !== h.owner.life)) return fail('close_crosslink_mismatch')
      const charIds: CharacterId[] = [h.owner.character]
      for (const member of members) charIds.push(member.member.character)
      for (const invite of invites) charIds.push(invite.recipient.character)
      const lifeIds = members.map(m => m.member.life)
      characters = await indexedCharacters(tx, charIds)
      lives = await indexedLives(tx, lifeIds)
      if (!characters || !lives) return fail('close_indexes_unproven')
    }

    if (!characters) return fail('character_indexes_unproven')
    const viewLives = lives ?? []
    switch (command.op) {
      case 'invite':
        if (!freshInvite || !recipient || !roster || !pending) return fail('invite_view_incomplete')
        view = { now, home: homePoint, household: householdPoint, homeIndex, authority, characters, lives: viewLives, op: 'invite', freshInvite, roster, pending, recipient }; break
      case 'accept':
        if (!invitePoint || !freshMember || !roster || !owner) return fail('accept_view_incomplete')
        view = { now, home: homePoint, household: householdPoint, homeIndex, authority, characters, lives: viewLives, op: 'accept', invite: invitePoint, freshMember, roster, owner }; break
      case 'decline': case 'cancel': case 'expire': case 'terminate-invitation':
        if (!invitePoint) return fail('invitation_view_incomplete')
        view = { now, home: homePoint, household: householdPoint, homeIndex, authority, characters, lives: viewLives, op: command.op, invite: invitePoint }; break
      case 'leave': case 'revoke': case 'terminate':
        if (!memberPoint) return fail('membership_view_incomplete')
        view = { now, home: homePoint, household: householdPoint, homeIndex, authority, characters, lives: viewLives, op: command.op, member: memberPoint }; break
      case 'close':
        if (!roster || !pending) return fail('close_view_incomplete')
        view = { now, home: homePoint, household: householdPoint, homeIndex, authority, characters, lives: viewLives, op: 'close', roster, pending }; break
    }
  }
  if (!isView(view) || view.op !== command.op) return fail('canonical_view_invalid')
  return { ok: true, command, view }
}
