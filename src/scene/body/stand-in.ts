/**
 * The skinned body standing in for the player's own figure in a venue scene (the home room has its own: the
 * "SKINNED BODY" section of home-scene.ts). The venue host (src/venue-world.ts) owns it and hands it what it already
 * hands the scene's walk: move(x, y, z, ry), pose(name, seat), gait(phase, jog). The scene itself is not touched: its
 * procedural figure is only hidden while the body is in, and shown again the moment the body goes.
 *
 * Same rules as at home (gate.ts): fetched after a scene's first frame, only on a device bodyAllowed() accepts with a
 * WebGL2 renderer; any failure keeps the procedural figure for the rest of the session. No frames of its own: a pose
 * is a still frame, walking samples the host's stride phase, and only sit-enter / sit-exit run in time, stepped by the
 * host's motion loop while `easing` is true.
 */
import { bodyAllowed, drawsWebGL2, importBody } from './gate.ts';
import type { BodyPose, SkinnedBody } from './skinned.ts';
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';

/** The scene's procedural poses (characters.ts) as body poses. */
export const BODY_POSE: Readonly<Record<string, BodyPose>> = Object.freeze({ stand: 'idle', relax: 'idle', sit: 'sit', walk: 'walk', jog: 'jog', wave: 'interact', work: 'interact', dance: 'dance' });
/** The procedural figure's seat height when a sitting pose gives none (drawAvatar's default), in avatar units. */
const SEAT = 0.6;

/** What the stand-in needs of a scene: where it draws, the figure to hide, and the scene's avatar scale. */
export interface StandInScene { group: THREE.Object3D; avatar: THREE.Object3D; scale: number }

export interface StandIn {
  /** True while a sit-enter / sit-exit plays (the host steps it). */
  readonly easing: boolean;
  /** The body, once it is in and shown (tests, diagnostics). */
  readonly shown: boolean;
  /** The scene the player is in now; null where the body does not stand in (the home room, the map). */
  attach(scene: StandInScene | null): void;
  /** After a frame was drawn: start fetching the body, once. */
  start(renderer: { getContext?: () => unknown } | null | undefined): void;
  wear(look: unknown, seed: unknown): void;
  move(x: number, y: number, z: number, ry: number): void;
  pose(name: string, seat: number | undefined, animate: boolean): void;
  gait(phase: number, jog: boolean): void;
  step(dt: number): boolean;
  settle(): void;
  dispose(): void;
}

/**
 * onReady: the body came in (or went) on its own, between frames — draw one. allowed: the device check (tests pass
 * false or a fake device; the default reads navigator).
 */
export function createStandIn(kit: Kit, onReady: () => void, allowed: boolean = bodyAllowed()): StandIn {
  let body: SkinnedBody | null = null, loading = false, failed = !allowed, gone = false, scene: StandInScene | null = null;
  let look: unknown = null, seed: unknown = null, posed: BodyPose = 'idle', seat = SEAT, at = { x: 0, y: 0, z: 0, ry: 0 };

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
  }
  function drop() {
    body?.dispose();
    body = null;
    if (scene) scene.avatar.visible = true;
  }
  return {
    get easing() { return Boolean(body?.easing && scene); },
    get shown() { return Boolean(body && scene && body.object.parent === scene.group); },
    attach(next) {
      if (next === scene || (next && scene && next.group === scene.group && next.avatar === scene.avatar)) { scene = next; return; }
      if (scene) scene.avatar.visible = true;
      body?.object.removeFromParent();
      scene = next;
      mount();
    },
    start(renderer) {
      if (body || loading || failed || gone || !scene) return;
      if (!drawsWebGL2(renderer)) { failed = true; return; }
      loading = true;
      setTimeout(() => {
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
      seat = Number.isFinite(nextSeat) ? nextSeat! : SEAT;
      if (!body) return;
      body.show(posed, animate && (body.pose === 'walk' || body.pose === 'jog' || body.pose === 'sit'));
      put();
    },
    gait(phase, jog) { if (body) { body.stride(phase, jog); put(); } },
    step(dt) { const more = body?.step(dt) ?? false; put(); return more && Boolean(scene); },
    settle() { body?.settle(); put(); },
    dispose() { gone = true; drop(); scene = null; },
  };
}
