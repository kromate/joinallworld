// Talking to a person in the scene: while their card is open, the player stands about a metre and a bit from them, both
// face each other (smooth turns, no snaps) and the person greets with a gesture. When the card closes, both return to their
// routine. The person's side lives in the ambient layer (talk(id, 'you')); the player's side is a short walk toward them,
// and the walk itself turns the avatar (src/scene/movement.ts eases the turn). Reduced motion: the host places everyone at
// once and the person simply faces the player, with no gesture.
import { watch } from 'vue'
import type { Shell } from '../state/shell.ts'
import type { SceneWorld } from '../types/scene.ts'

/** Talking distance in scene units (a little over a metre), the longest a talk holds the person turned, and the allowed slack before the player steps. */
export const TALK_REACH = 1.3
export const TALK_HOLD_MS = 30 * 60_000
const SLACK = 0.25

type Point = { x: number; z: number }

/** Where the player should stand to talk: on the line from the person to the player, at talking distance. Null when already there. */
export function talkStand(person: Point, you: Point, reach = TALK_REACH): Point | null {
  const dx = you.x - person.x, dz = you.z - person.z, d = Math.hypot(dx, dz)
  if (d < 0.01) return { x: person.x, z: person.z + reach }
  if (Math.abs(d - reach) <= SLACK) return null
  return { x: person.x + (dx / d) * reach, z: person.z + (dz / d) * reach }
}

/** The point on the line from the person to the player at a given distance. */
export function standAt(person: Point, you: Point, reach: number): Point {
  const dx = you.x - person.x, dz = you.z - person.z, d = Math.hypot(dx, dz) || 1
  return d < 0.01 ? { x: person.x, z: person.z + reach } : { x: person.x + (dx / d) * reach, z: person.z + (dz / d) * reach }
}

/** The last leg of a walk is a straight line to the person, so the avatar arrives facing them: first stand off here, then come in. */
export const LEAD_REACH = 2.2

type Talker = Pick<SceneWorld, 'talk' | 'ambientPeople' | 'walkTo' | 'wakeAmbient' | 'position'>

/**
 * Begin a talk with a person of the scene. Null when they are not one of the scene's people (nothing happens, the card works as before).
 * The person may still be settling into place, or walk on, when the card opens, so every 400 ms the player's place is checked against
 * where the person really is, and a new walk is asked for only when the place to stand has moved on or the last walk is over. The
 * walk in is first to a lead point and then straight at the person, so the avatar arrives facing them. `stop` ends the checks.
 */
export function beginTalk(venue: Talker, id: string): { stop(): void } | null {
  if (!venue.talk(id, 'you', TALK_HOLD_MS)) return null
  const first = venue.position()
  let last = `${first.x},${first.z}`, lastTo: Point | null = null, faced = false, tries = 0, waiting = 0, done = 0
  const check = () => {
    const at = venue.position(), key = `${at.x},${at.z}`, moving = key !== last
    last = key
    const person = venue.ambientPeople().find((item) => item.id === id)
    if (!person?.you) return
    // While the player walks, the person keeps turning with them: the frame window is opened again.
    if (moving) venue.wakeAmbient()
    const d = Math.hypot(person.x - person.you.x, person.z - person.you.z)
    const stand = talkStand(person, person.you)
    // Far off, or close but not yet turned: stand off at the lead point first; from there the walk in is a straight line to the person.
    const lead = !!stand && d > LEAD_REACH + 0.6 || (d < LEAD_REACH - 0.3 && !faced)
    const to = lead ? standAt(person, person.you, LEAD_REACH) : stand
    if (!to) { done++; return }
    done = 0
    if (lead) faced = true
    // The walk asked for last is still on its way (frames can be slow): leave it.
    if (lastTo && Math.hypot(to.x - lastTo.x, to.z - lastTo.z) < 0.6 && Math.hypot(person.you.x - lastTo.x, person.you.z - lastTo.z) > 0.5 && waiting++ < 60) return
    if (tries >= 8) return
    tries++; waiting = 0; lastTo = to
    venue.walkTo(to.x, to.z)
  }
  check()
  const timer = setInterval(() => { check(); if (done > 12) clearInterval(timer) }, 400)
  venue.wakeAmbient()
  return { stop: () => clearInterval(timer) }
}

export function endTalk(venue: Pick<SceneWorld, 'talk' | 'wakeAmbient'>, id: string): void {
  venue.talk(id, 'you', 0)
  venue.wakeAmbient()
}

/** Follow the person card: a talk begins when it opens on someone, and ends when it closes or moves on. Returns the stop function. */
export function followTalk(shell: Pick<Shell, 'sheet'>, venue: () => SceneWorld | null): () => void {
  let talking: string | null = null, checks: { stop(): void } | null = null
  const stopTalk = () => { checks?.stop(); checks = null; const world = venue(); if (talking && world) endTalk(world, talking); talking = null }
  const stop = watch(() => {
    const open = shell.sheet.value
    const npc = open?.kind === 'panel' && open.id === 'person' ? (open.params as { npc?: string } | null)?.npc : undefined
    return npc ? `npc:${npc}` : null
  }, (id) => {
    if (id === talking) return
    stopTalk()
    const world = venue()
    checks = id && world ? beginTalk(world, id) : null
    if (checks) talking = id
  }, { flush: 'post' })
  return () => { stop(); stopTalk() }
}
