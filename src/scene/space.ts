/**
 * OWNER: scenes
 * Personal space and gaze for the people who stand in a venue scene (pure: no THREE, no DOM, no clock).
 *
 * DISTANCE. People who came together stand closer than people who did not (Hall's personal and
 * social zones). A figure here is about 2.6 units tall, so one metre is about 1.5 units; the gaps
 * below are centre to centre, in scene units. FIGURE_GAP is the floor: two bodies never overlap.
 * Strangers keep the widest gap a room can spare, so a full venue is not people standing
 * shoulder to shoulder with nobody they know.
 *
 * GAZE. A person glances at someone who comes close, then looks away (a stranger after about a
 * second, a friend holds it and turns all the way). It happens once per approach: they are not
 * armed again until the other person has left and come back. Everything is a small state machine
 * that is stepped with dt by the scene's existing crowd easing, so it needs no timer and no frame
 * of its own, and a venue where nobody comes near stays idle.
 */

/** The least distance between two bodies (centre to centre): shoulders clear of each other. */
export const FIGURE_GAP = 1.0;
export type Tie = 'friend' | 'group' | 'stranger';
/** The distance each pair of people would like to keep, in scene units. */
export const COMFORT_GAP: Readonly<Record<Tie, number>> = Object.freeze({ friend: 1.3, group: 1.35, stranger: 1.9 });

/** Who the two are to each other: standing at the same spot makes a group; two friends of the player are friends. */
export function tieOf(a: { spot?: string | null; friend?: boolean }, b: { spot?: string | null; friend?: boolean }): Tie {
  if (a.spot != null && a.spot === b.spot) return 'group';
  return a.friend === true && b.friend === true ? 'friend' : 'stranger';
}
/** The gap two people would like, never under FIGURE_GAP. */
export const gapFor = (tie: Tie): number => Math.max(FIGURE_GAP, COMFORT_GAP[tie]);

export interface Standing { x: number; z: number }
/** Pairs of figures closer than `gap` (default: the floor). For tests and for checking a crowd after it is placed. */
export function crowded<T extends Standing>(people: readonly T[], gap = FIGURE_GAP): [T, T][] {
  const found: [T, T][] = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    if (Math.hypot(people[i]!.x - people[j]!.x, people[i]!.z - people[j]!.z) < gap - 1e-6) found.push([people[i]!, people[j]!]);
  }
  return found;
}

/** How far away someone is noticed, how far round to the side (half-angle, radians), and when they are forgotten. */
export const GAZE_RANGE = 4.2, GAZE_REARM = 6.5, GAZE_FIELD = 1.9;
/** How much of the turn towards the other person is made, and how long it is held, for each kind of tie. */
const SHARE: Readonly<Record<Tie, number>> = { friend: 1, group: 0.8, stranger: 0.55 };
const HOLD: Readonly<Record<Tie, number>> = { friend: 3.2, group: 2.2, stranger: 0.9 };
/** A head or body turns at this speed (radians per second) towards the other person and back. */
const TURN_IN = 5.5, TURN_BACK = 2.6, MAX_TURN = 1.25;

export interface GazeState { phase: 'rest' | 'look' | 'away'; held: number; armed: boolean; offset: number }
export const newGaze = (): GazeState => ({ phase: 'rest', held: 0, armed: true, offset: 0 });

/** The angle from where someone faces to where another stands, in (-π, π]. */
export function bearing(from: Standing, facing: number, to: Standing): number {
  let angle = Math.atan2(to.x - from.x, to.z - from.z) - facing;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  return angle;
}
/** Would this person notice the other right now? (Used to decide whether a frame is worth running at all.) */
export function notices(g: GazeState, from: Standing, facing: number, to: Standing): boolean {
  if (g.phase !== 'rest' || !g.armed) return false;
  return Math.hypot(to.x - from.x, to.z - from.z) < GAZE_RANGE && Math.abs(bearing(from, facing, to)) < GAZE_FIELD;
}
/** Is anything still turning? (The scene keeps its frames running while this is true, and no longer.) */
export const gazing = (g: GazeState): boolean => g.phase !== 'rest' || Math.abs(g.offset) > 0.002;
/** Called whenever the other person has moved: forget them once they are far off, and say whether a frame is now worth running. */
export function watch(g: GazeState, from: Standing, facing: number, to: Standing): boolean {
  if (Math.hypot(to.x - from.x, to.z - from.z) > GAZE_REARM) g.armed = true;
  return gazing(g) || notices(g, from, facing, to);
}

/**
 * Advance one person's gaze by `dt` seconds. `from` is where they stand, `facing` where their body
 * faces at rest, `to` the other person. g.offset is how far, from facing, they are turned now.
 */
export function stepGaze(g: GazeState, dt: number, from: Standing, facing: number, to: Standing, tie: Tie): GazeState {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance > GAZE_REARM) g.armed = true;
  if (g.phase === 'rest' && notices(g, from, facing, to)) { g.phase = 'look'; g.held = 0; g.armed = false; }
  let target = 0, rate = TURN_BACK;
  if (g.phase === 'look') {
    const wanted = bearing(from, facing, to) * SHARE[tie];
    target = Math.max(-MAX_TURN, Math.min(MAX_TURN, wanted)); rate = TURN_IN;
    g.held += dt;
    if (g.held >= HOLD[tie]) g.phase = 'away';
  }
  const gap = target - g.offset, move = Math.sign(gap) * Math.min(Math.abs(gap), rate * dt);
  g.offset += move;
  if (g.phase === 'away' && Math.abs(g.offset) <= 0.002) { g.offset = 0; g.phase = 'rest'; }
  return g;
}
