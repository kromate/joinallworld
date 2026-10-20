// Talking to a person in the scene: while their card is open, the player stands about a metre and a bit from them, both
// face each other (smooth turns, no snaps) and the person greets with a gesture. When the card closes, both return to their
// routine. The person's side lives in the ambient layer (talk(id, 'you')); the player's side is a short walk toward them,
// and the walk itself turns the avatar (src/scene/movement.ts eases the turn). Reduced motion: the host places everyone at
// once and the person simply faces the player, with no gesture.
import { watch } from 'vue'
import type { Shell } from '../state/shell.ts'
import type { SceneWorld } from '../types/scene.ts'

/** Talking distance in scene units (a little over a metre), the longest the card keeps the person turned, and the allowed slack before the player steps. */
export const TALK_REACH = 1.3
export const TALK_HOLD_MS = 90_000
const SLACK = 0.25

type Point = { x: number; z: number }

/** Where the player should stand to talk: on the line from the person to the player, at talking distance. Null when already there. */
export function talkStand(person: Point, you: Point, reach = TALK_REACH): Point | null {
  const dx = you.x - person.x, dz = you.z - person.z, d = Math.hypot(dx, dz)
  if (d < 0.01) return { x: person.x, z: person.z + reach }
  if (Math.abs(d - reach) <= SLACK) return null
  return { x: person.x + (dx / d) * reach, z: person.z + (dz / d) * reach }
}

/** A step toward the person, enough to turn the avatar to face them when they stand at talking distance already. */
export function facingStep(person: Point, you: Point, step = 0.12): Point {
  const dx = person.x - you.x, dz = person.z - you.z, d = Math.hypot(dx, dz) || 1
  return { x: you.x + (dx / d) * step, z: you.z + (dz / d) * step }
}

/** Begin a talk with a person of the scene. False when they are not one of the scene's people (nothing happens, the card works as before). */
export function beginTalk(venue: Pick<SceneWorld, 'talk' | 'ambientPeople' | 'walkTo' | 'wakeAmbient'>, id: string): boolean {
  if (!venue.talk(id, 'you', TALK_HOLD_MS)) return false
  const person = venue.ambientPeople().find((item) => item.id === id)
  if (person?.you) {
    const stand = talkStand(person, person.you) ?? facingStep(person, person.you)
    venue.walkTo(stand.x, stand.z)
  }
  venue.wakeAmbient()
  return true
}

export function endTalk(venue: Pick<SceneWorld, 'talk' | 'wakeAmbient'>, id: string): void {
  venue.talk(id, 'you', 0)
  venue.wakeAmbient()
}

/** Follow the person card: a talk begins when it opens on someone, and ends when it closes or moves on. Returns the stop function. */
export function followTalk(shell: Pick<Shell, 'sheet'>, venue: () => SceneWorld | null): () => void {
  let talking: string | null = null
  const stopTalk = () => { const world = venue(); if (talking && world) endTalk(world, talking); talking = null }
  const stop = watch(() => {
    const open = shell.sheet.value
    const npc = open?.kind === 'panel' && open.id === 'person' ? (open.params as { npc?: string } | null)?.npc : undefined
    return npc ? `npc:${npc}` : null
  }, (id) => {
    if (id === talking) return
    stopTalk()
    const world = venue()
    if (id && world && beginTalk(world, id)) talking = id
  }, { flush: 'post' })
  return () => { stop(); stopTalk() }
}
