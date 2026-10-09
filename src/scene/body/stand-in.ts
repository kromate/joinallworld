/**
 * The skinned body standing in for the player's own figure in a venue scene (the home room has its own: the
 * "SKINNED BODY" section of home-scene.ts). The venue host (src/venue-world.ts) owns it and hands it what it already
 * hands the scene's walk: move(x, y, z, ry), pose(name, seat), gait(phase, jog, y). The scene itself is not touched: its
 * procedural figure is only hidden while the body is in, and shown again the moment the body goes.
 *
 * Same rules as at home (gate.ts): fetched after a scene's first frame, only on a device bodyAllowed() accepts with a
 * WebGL2 renderer; any failure keeps the procedural figure for the rest of the session. No frames of its own: a pose
 * is a still frame, walking samples the host's stride phase (the stairs clips while the floor height climbs or drops
 * under the stride), and only sit-enter / sit-exit, and the door clip on coming into a scene, run in time, stepped by
 * the host's motion loop while `easing` is true.
 */
import { bodyAllowed, drawsWebGL2, importBody } from './gate.ts';
import type { BodyPose, SkinnedBody } from './skinned.ts';
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';

/** The scene's procedural poses (characters.ts) as body poses. */
export const BODY_POSE: Readonly<Record<string, BodyPose>> = Object.freeze({ stand: 'idle', relax: 'idle', sit: 'sit', walk: 'walk', jog: 'jog', wave: 'interact', work: 'interact', dance: 'dance' });
/** The procedural figure's seat height when a sitting pose gives none (drawAvatar's default), in avatar units. */
const SEAT = 0.6;
/** Rise over run under the stride that counts as a stair or ramp (a ramp shallower than this walks). */
export const CLIMB = 0.3;

/** What the stand-in needs of a scene: where it draws, the figure to hide, and the scene's avatar scale. */
export interface StandInScene {
  group: THREE.Object3D;
  avatar: THREE.Object3D;
  scale: number;
  /** Height of a verified support surface, or null when this footprint is unsupported. */
  contactHeightAt?: (x: number, z: number, expectedY: number) => number | null;
}

/** Preflight every sampled sole vertex before mutating either leg. */
export function solveSupportedFeet(body: Pick<SkinnedBody, 'sampleFootContacts' | 'solveFeet' | 'easing' | 'seated'>,
  contactHeightAt: StandInScene['contactHeightAt']): boolean {
  if (!contactHeightAt || body.easing || body.seated) return false;
  const contacts = body.sampleFootContacts();
  if (!contacts.length) return false;
  const targets = new Map<string, number>();
  for (const contact of contacts) {
    const points = contact.points ?? [contact];
    if (!points.length) return false;
    let highest: number | null = null;
    for (const point of points) {
      const height = contactHeightAt(point.x, point.z, point.y);
      if (height === null || !Number.isFinite(height)) return false;
      highest = highest === null ? height : Math.max(highest, height);
    }
    if (highest === null) return false;
    // The solver resamples points after each leg fit. A per-side fixed target remains stable,
    // while selecting the highest supported point keeps the sole from clipping through paving.
    const previous = targets.get(contact.side);
    if (previous !== undefined && Math.abs(previous - highest) > 0.0005) return false;
    targets.set(contact.side, highest);
  }
  if (targets.size !== 2) return false;
  body.solveFeet((point) => targets.get(point.side) ?? Number.NaN);
  return true;
}

export interface StandIn {
  /** True while a sit-enter / sit-exit / door plays (the host steps it). */
  readonly easing: boolean;
  /** The body, once it is in and shown (tests, diagnostics). */
  readonly shown: boolean;
  /** Name/crown position over the visible body's head, in the attached scene's coordinates. */
  tagPosition(): { x: number; y: number; z: number } | null;
  /** The scene the player is in now; null where the body does not stand in (the home room, the map). A new scene is
   *  come into through its door: the next standing pose plays the door clip (when the host animates). */
  attach(scene: StandInScene | null): void;
  /** After a frame was drawn: start fetching the body, once. */
  start(renderer: { getContext?: () => unknown } | null | undefined): void;
  wear(look: unknown, seed: unknown): void;
  move(x: number, y: number, z: number, ry: number): void;
  pose(name: string, seat: number | undefined, animate: boolean): void;
  /** One walking frame at the stride phase; `y` the floor height under the walker (the stairs clips on a slope). */
  gait(phase: number, jog: boolean, y?: number): void;
  step(dt: number): boolean;
  settle(): void;
  dispose(): void;
}

/**
 * onReady: the body came in (or went) on its own, between frames — draw one. allowed: the device check (tests pass
 * false or a fake device; the default reads navigator).
 */
export function createStandIn(kit: Kit, onReady: () => void, allowed: boolean = bodyAllowed()): StandIn {
  const headAt = new kit.THREE.Vector3();
  let body: SkinnedBody | null = null, loading = false, failed = !allowed, gone = false, scene: StandInScene | null = null;
  let look: unknown = null, seed: unknown = null, posed: BodyPose = 'idle', seat = SEAT, at = { x: 0, y: 0, z: 0, ry: 0 };
  // Came into a scene and not yet posed there; the last walking frame (floor height, position) and the slope since.
  let arrived = false, was: { x: number; y: number; z: number } | null = null, climb = 0;
  let standingIntent = true;

  function solveContacts() {
    if (!body || !scene || !standingIntent) return;
    solveSupportedFeet(body, scene.contactHeightAt);
  }

  /** Put the body where the figure is, in its pose. */
  function put() {
    if (!body) return;
    if (posed === 'sit' || body.seated) body.sitOn(at.x, at.y + seat * (scene?.scale ?? 1), at.z, at.ry);
    else body.place(at.x, at.y, at.z, at.ry);
  }
  /** Show the body in the scene in place of the figure, or (no scene, no body) give the figure back. */
  function mount() {
    if (!body || !scene) { body?.object.removeFromParent(); if (scene) scene.avatar.visible = true; return; }
    body.fit(scene.scale);
    if (body.object.parent !== scene.group) scene.group.add(body.object);
    scene.avatar.visible = false;
    body.show(posed, false);
    put();
    solveContacts();
  }
  function drop() {
    body?.dispose();
    body = null;
    if (scene) scene.avatar.visible = true;
  }
  return {
    get easing() { return Boolean(body?.easing && scene); },
    get shown() { return Boolean(body && scene && body.object.parent === scene.group); },
    tagPosition() {
      const head = body?.object.getObjectByName('Head');
      if (!body || !scene || !head) return null;
      body.object.updateWorldMatrix(true, true);
      head.getWorldPosition(headAt); scene.group.worldToLocal(headAt); headAt.y += 0.32 * body.scale;
      return headAt;
    },
    attach(next) {
      if (next === scene || (next && scene && next.group === scene.group && next.avatar === scene.avatar)) { scene = next; return; }
      if (scene) scene.avatar.visible = true;
      body?.object.removeFromParent();
      scene = next;
      arrived = Boolean(next);
      was = null; climb = 0;
      mount();
    },
    start(renderer) {
      if (body || loading || failed || gone || !scene) return;
      if (!drawsWebGL2(renderer)) { failed = true; return; }
      loading = true;
      setTimeout(() => {
        if (gone || !scene) { loading = false; return; }
        importBody().then((module) => module.loadBody(kit, look, seed, scene?.scale ?? 1)).then((loaded) => {
          loading = false;
          if (gone) { loaded.dispose(); return; }
          // The look changed while it loaded: recolour, or (the other body file) fetch again after the next frame.
          if (!loaded.wear(look, seed)) { loaded.dispose(); onReady(); return; }
          body = loaded;
          mount();
          onReady();
        }).catch((error: unknown) => {
          loading = false; failed = true;
          console.warn('Skinned body unavailable; keeping the drawn avatar:', error);
        });
      }, 0);
    },
    wear(nextLook, nextSeed) {
      look = nextLook; seed = nextSeed;
      if (body && !body.wear(look, seed)) { drop(); onReady(); }
    },
    move(x, y, z, ry) { at = { x, y, z, ry }; put(); },
    pose(name, nextSeat, animate) {
      posed = BODY_POSE[name] ?? 'idle';
      standingIntent = name === 'stand' || name === 'relax';
      seat = Number.isFinite(nextSeat) ? nextSeat! : SEAT;
      const door = arrived && posed === 'idle';
      arrived = false;
      if (!body) return;
      if (door) body.enter(animate);
      else body.show(posed, animate && (body.pose === 'walk' || body.pose === 'jog' || body.seated || posed === 'sit'));
      put();
      solveContacts();
    },
    gait(phase, jog, y = at.y) {
      const run = was ? Math.hypot(at.x - was.x, at.z - was.z) : 0;
      climb = was && run > 1e-3 ? (y - was.y) / run : 0;
      was = { x: at.x, y, z: at.z };
      posed = jog ? 'jog' : 'walk';
      standingIntent = climb === 0;
      if (body) { body.stride(phase, jog, Math.abs(climb) >= CLIMB ? climb : 0); put(); solveContacts(); }
    },
    step(dt) { const more = body?.step(dt) ?? false; put(); if (!more) solveContacts(); return more && Boolean(scene); },
    settle() { body?.settle(); put(); solveContacts(); },
    dispose() { gone = true; drop(); scene = null; },
  };
}
