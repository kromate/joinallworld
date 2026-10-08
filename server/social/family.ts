import type { FamilyId } from '../../src/types/life.ts'
import type { FamilyBook, FamilyLink, FamilyOutcome } from '../../src/types/family.ts'

export const FAMILY_INVITE_TTL = 7 * 24 * 60 * 60 * 1000
export const FAMILY_INCOMING_LIMIT = 16
export const FAMILY_SLOTS: readonly FamilyId[] = ['mummy', 'daddy', 'tobi', 'grandma']
export const isFamilySlot = (value: unknown): value is FamilyId => typeof value === 'string' && FAMILY_SLOTS.some(slot => slot === value)

type Players = Record<string, { familyLinks?: FamilyBook }>
type MayLink = (owner: string, player: string) => boolean
const book = (players: Players, id: string): FamilyBook => players[id]!.familyLinks ??= { slots: {}, incoming: {} }
const live = (link: FamilyLink, now: number): boolean => link.state === 'accepted' || now - link.at < FAMILY_INVITE_TTL

/** The request id prevents an old cancel/answer from changing a replacement invitation. */
export function removeFamilyLink(players: Players, actor: string, link: FamilyLink): boolean {
  if (actor !== link.owner && actor !== link.player) return false
  const owned = players[link.owner]?.familyLinks?.slots[link.slot]
  if (!owned || owned.id !== link.id) return false
  delete players[link.owner]!.familyLinks!.slots[link.slot]
  const incoming = players[link.player]?.familyLinks?.incoming[link.id]
  if (incoming?.owner === link.owner) delete players[link.player]!.familyLinks!.incoming[link.id]
  return true
}

/** Only visits this player's four slots and bounded incoming index, never every player. */
export function pruneFamily(players: Players, id: string, now: number, mayLink: MayLink): boolean {
  const mine = players[id]?.familyLinks
  if (!mine) return false
  let changed = false
  for (const link of Object.values(mine.slots)) {
    if (!live(link, now) || !players[link.player] || !mayLink(id, link.player)) changed = removeFamilyLink(players, id, link) || changed
  }
  for (const link of Object.values(mine.incoming)) {
    const owned = players[link.owner]?.familyLinks?.slots[link.slot]
    if (owned?.id !== link.id) { delete mine.incoming[link.id]; changed = true; continue }
    if (!live(owned, now) || !mayLink(link.owner, id)) changed = removeFamilyLink(players, id, owned) || changed
  }
  return changed
}

/** Authentication, UUID parsing, rate limiting and retry receipts belong to the HTTP boundary. */
export function inviteFamily(players: Players, owner: string, slot: FamilyId, player: string, requestId: string, now: number, mayLink: MayLink): FamilyOutcome {
  if (owner === player || !players[owner] || !players[player] || !mayLink(owner, player)) return { ok: false, code: 'not_friends' }
  pruneFamily(players, owner, now, mayLink)
  pruneFamily(players, player, now, mayLink)
  const mine = book(players, owner), theirs = book(players, player)
  if (mine.slots[slot]) return { ok: false, code: 'slot_occupied' }
  if (Object.values(mine.slots).some(link => link.player === player)) return { ok: false, code: 'already_linked' }
  if (Object.keys(theirs.incoming).length >= FAMILY_INCOMING_LIMIT) return { ok: false, code: 'inbox_full' }
  const link: FamilyLink = { id: requestId, owner, slot, player, at: now, state: 'pending' }
  mine.slots[slot] = link
  theirs.incoming[requestId] = { ...link }
  return { ok: true, link }
}

export function answerFamily(players: Players, recipient: string, requestId: string, accept: boolean, now: number, mayLink: MayLink): FamilyOutcome {
  pruneFamily(players, recipient, now, mayLink)
  const incoming = players[recipient]?.familyLinks?.incoming[requestId]
  const link = incoming && players[incoming.owner]?.familyLinks?.slots[incoming.slot]
  if (!link || link.id !== requestId || link.player !== recipient) return { ok: false, code: 'no_invitation' }
  if (!accept) {
    removeFamilyLink(players, recipient, link)
    return { ok: true, link }
  }
  link.state = 'accepted'
  book(players, recipient).incoming[requestId] = { ...link }
  return { ok: true, link }
}

/** Called on friendship removal, blocking or deletion; unblocking must never restore consent. */
export function unlinkFamilyPair(players: Players, a: string, b: string): void {
  for (const owner of [a, b]) for (const link of Object.values(players[owner]?.familyLinks?.slots ?? {})) {
    if (link.player === (owner === a ? b : a)) removeFamilyLink(players, owner, link)
  }
}

export function clearPlayerFamily(players: Players, id: string): void {
  const mine = players[id]?.familyLinks
  if (!mine) return
  for (const link of [...Object.values(mine.slots), ...Object.values(mine.incoming)]) removeFamilyLink(players, id, link)
  delete players[id]!.familyLinks
}
