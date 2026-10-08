import type { PlayerRef } from './protocol.ts'
import type { FamilyId } from './life.ts'

export interface FamilyLink {
  id: string
  owner: string
  slot: FamilyId
  player: string
  at: number
  state: 'pending' | 'accepted'
}

/** Both indexes are changed in the same social-store transaction. */
export interface FamilyBook {
  slots: Partial<Record<FamilyId, FamilyLink>>
  incoming: Record<string, FamilyLink>
}

export type FamilyFailure = 'not_friends' | 'slot_occupied' | 'already_linked' | 'inbox_full' | 'no_invitation'
export type FamilyOutcome = { ok: true; link: FamilyLink } | { ok: false; code: FamilyFailure }

export type FamilyCommand =
  | { op: 'invite'; slot: FamilyId; player: string }
  | { op: 'answer'; id: string; accept: boolean }
  | { op: 'remove'; id: string }
export interface FamilyLinkView extends FamilyLink { other: PlayerRef }
export interface FamilyView { slots: FamilyLinkView[]; incoming: FamilyLinkView[] }
