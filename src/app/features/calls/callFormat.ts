// Small pure helpers for the call screens: the clock, the avatar colour, and where a friend is (only what friends can already see).
import type { PlayerRef } from '../../../types/protocol.ts'

export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
/** A stable hue for a name, so one player always has one colour. */
export function hueOf(name: string): number {
  let hash = 0
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) % 360
  return hash
}
export const initialOf = (name: string): string => (name.trim().charAt(0) || '?').toUpperCase()

export interface FriendView { id: string; status?: string; venue?: string; cityId?: string; founder?: true }
/**
 * "at Freedom Park, Lagos" for a friend who is online at a public venue, from the same facts the friends list already
 * shows; null for anyone else, so a stranger's place is never guessed at.
 */
export function whereText(friend: FriendView | undefined, venueName: (id: string) => string, cityName: (id: string) => string): string | null {
  if (!friend || friend.status !== 'online' || !friend.venue || friend.venue === 'home' || friend.venue === 'visit' || !friend.cityId) return null
  return `at ${venueName(friend.venue)}, ${cityName(friend.cityId)}`
}
export const isFounder = (peer: PlayerRef | null, friend: FriendView | undefined): boolean => peer?.founder === true || friend?.founder === true
export function statusText(phase: string, role: string | null, name: string, mic: string): string {
  switch (phase) {
    case 'calling': return 'Calling…'
    case 'ringing': return 'Ringing…'
    case 'incoming': return 'Incoming voice call'
    case 'starting': return role === 'callee' ? 'Opening your microphone…' : 'Waiting for your microphone…'
    case 'needs-tap': return `${name} answered`
    case 'connecting': return 'Connecting…'
    default: return mic === 'asking' ? 'Waiting for your microphone…' : ''
  }
}
