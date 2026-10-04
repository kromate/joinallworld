// The Invite app without a DOM: what a house is called, and why Knock is off. Pure.
import type { HouseView, KnockState } from '../../../types/social.ts'

export const HOST_STATUS: Readonly<Record<string, string>> = { home: 'At home', out: 'Online, but not at home', reconnecting: 'Reconnecting…', offline: 'Offline' }
export const statusText = (status: string): string => HOST_STATUS[status] ?? 'Unavailable'

/** The state of the knock I made at this house. */
export interface KnockView { waiting: boolean; expired: boolean }
export function knockView(knock: KnockState | null, now: number): KnockView {
  const waiting = Boolean(knock) && (knock?.status === 'knocking' || knock?.status === 'sending') && (knock.status === 'sending' || (knock.expiresAt ?? 0) > now)
  const expired = knock?.status === 'knocking' && (knock.expiresAt ?? 0) <= now
  return { waiting, expired }
}
/** Why Knock is off, or null. Nothing is off while I am inside. */
export function knockReason(house: Pick<HouseView, 'host' | 'hostStatus' | 'guests' | 'capacity'>, inside: boolean, waiting: boolean): string | null {
  if (inside) return null
  if (house.hostStatus !== 'home') return `${house.host.name} must be at home to answer (${HOST_STATUS[house.hostStatus] ?? 'unavailable'}).`
  if (house.guests.length >= house.capacity) return `The house is full (${house.capacity} guests).`
  return waiting ? 'Knocking… waiting for an answer.' : null
}
/** The house line under a visit: who is in the room now. */
export function roomLine(room: { host: string; members: { name: string }[] } | null, hostId: string): string {
  return room?.host === hostId ? `in the room now: ${room.members.map((member) => member.name).join(', ')}` : 'joining the room…'
}
/** The sentence on the invite card about whether knocks ring. */
export const homeLine = (guests: number, capacity: number, athome: boolean): string => `${guests} of ${capacity} guests inside · ${athome ? 'you are home, knocks will ring' : 'you are out, so knocks will not ring'}`
