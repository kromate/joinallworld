/**
 * OWNER: scenes
 * The arithmetic of pointer gestures, shared by the 3D map, the simple map and the venue scene: what a press
 * turns out to be (a tap or a drag), which drag a button and its modifier keys ask for, how far two fingers
 * have twisted, how far past its edge a dragged view may be pulled, and how fast a flick was.
 * Plain numbers in and out, no DOM, so it runs under `node --test`.
 *
 * Pointer positions are in the page's own pixels (clientX / clientY, which are what getBoundingClientRect
 * measures too). The wide-screen interface zoom (--ui-zoom) is CSS `zoom` on the interface layer; the map and the
 * scene sit outside it, and anything that does sit inside a zoomed element is measured with `localPoint`, which
 * takes the element's own pixel scale (its on-screen width over its layout width).
 */

/** A press that moves less than this (CSS pixels; touch is looser) and ends within TAP_MS is a tap; anything else is a drag. */
export const TAP_MOVE = 6, TAP_MOVE_TOUCH = 10, TAP_MS = 350;
/** Radians per pixel of a rotating drag: across, and down. */
export const ROTATE_YAW = 0.0052, ROTATE_PITCH = 0.0042;
/** How long a double tap may take, and how far apart its two taps may land. */
export const DOUBLE_TAP_MS = 320, DOUBLE_TAP_PX = 28;

const TAU = Math.PI * 2;

/** The farthest a press may travel and still be a tap. */
export const tapMove = (pointerType: string): number => (pointerType === 'touch' || pointerType === 'pen' ? TAP_MOVE_TOUCH : TAP_MOVE);
/** Is a press that travelled `distance` pixels in `ms` milliseconds a tap? */
export const isTap = (distance: number, ms: number, pointerType = 'mouse'): boolean => distance < tapMove(pointerType) && ms < TAP_MS;
/** Has a press that is still down become a drag? (Time alone does not make it one: it only stops it being a tap.) */
export const isDrag = (distance: number, pointerType = 'mouse'): boolean => distance >= tapMove(pointerType);

export type DragKind = 'pan' | 'rotate';
export interface ButtonLike { button: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; pointerType?: string }
/**
 * What a press drags. On the map: the left button and one finger pan (the ground follows the pointer); the right
 * button, or the left with Shift, Ctrl, Alt or Cmd held, rotates; the middle button pans. In the scene it is the other way
 * round: the left button and one finger orbit, and the right or middle button, or Shift, pans.
 */
export function dragKind(event: ButtonLike, surface: 'map' | 'scene'): DragKind {
  const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
  const modifier = Boolean(event.shiftKey || event.ctrlKey || event.altKey || event.metaKey);
  if (surface === 'map') return !touch && (event.button === 2 || (event.button === 0 && modifier)) ? 'rotate' : 'pan';
  return !touch && (event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey === true)) ? 'pan' : 'rotate';
}

/** A pointer position in an element's own pixels, from the cached box (left, top, and its on-screen pixels per layout pixel). */
export interface PointerBox { left: number; top: number; scale: number }
export const localPoint = (clientX: number, clientY: number, box: PointerBox): { x: number; y: number } => ({ x: (clientX - box.left) / box.scale, y: (clientY - box.top) / box.scale });
/** The on-screen pixels of one layout pixel of an element: 1 unless it sits inside CSS `zoom` or a transform. */
export const pixelScale = (rectWidth: number, layoutWidth: number): number => (rectWidth > 0 && layoutWidth > 0 && Number.isFinite(rectWidth / layoutWidth) ? rectWidth / layoutWidth : 1);

/** An angle brought into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turn = angle - Math.floor((angle + Math.PI) / TAU) * TAU;
  return turn === -Math.PI ? Math.PI : turn;
}
/** The yaw nearest to `yaw` that looks due north (a whole number of turns): where a "north up" tap turns to. */
export const northUp = (yaw: number): number => Math.round(yaw / TAU) * TAU;
/** How far a finger pair has twisted between two moments, in radians (positive = clockwise on screen), shortest way round. */
export const twist = (a0: { x: number; y: number }, b0: { x: number; y: number }, a1: { x: number; y: number }, b1: { x: number; y: number }): number =>
  wrapAngle(Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x));

/** Past its edge a dragged view gives: only a fraction of the pull gets through, and never more than `margin` in all. */
export function rubber(value: number, low: number, high: number, margin: number): number {
  if (value >= low && value <= high) return value;
  const over = value < low ? low - value : value - high, give = margin * (1 - Math.exp(-over / (margin * 2.5)));
  return value < low ? low - give : high + give;
}

/** A short memory of where a drag has been, for the speed of a flick. */
export interface Flick { push(x: number, z: number, at: number): void; velocity(at: number, maxAge?: number): { x: number; z: number } | null; clear(): void }
export function createFlick(): Flick {
  const samples: { x: number; z: number; at: number }[] = [];
  return {
    push(x, z, at) { samples.push({ x, z, at }); while (samples.length > 6) samples.shift(); },
    /** Units a second over the last `maxAge` ms, or null when the pointer had stopped before it was let go. */
    velocity(at, maxAge = 90) {
      const last = samples[samples.length - 1];
      if (!last || at - last.at > maxAge) return null;
      // The moves of the last 120 ms; on a slow screen, where they are further apart, the one before the last.
      let first = samples.find((sample) => last.at - sample.at <= 120) ?? last;
      if (first === last && samples.length > 1) first = samples[samples.length - 2]!;
      const span = (last.at - first.at) / 1000;
      return span > 0.012 ? { x: (last.x - first.x) / span, z: (last.z - first.z) / span } : null;
    },
    clear() { samples.length = 0; },
  };
}
/** A glide's speed after `dt` seconds: it loses most of its speed in about half a second. */
export const glide = (speed: number, dt: number): number => speed * Math.exp(-dt * 5.5);

/** The one-line how-to, per kind of device and map. */
export const MAP_HINT_KEY = 'allworld:map-hint';
export function mapHint(touch: boolean, flat: boolean): string {
  if (touch) return flat ? 'Drag to move · pinch to zoom' : 'Drag to move · two fingers to turn and zoom';
  return flat ? 'Drag to move · scroll to zoom · tap a place to go there' : 'Drag to move · right-drag or two fingers to rotate · scroll to zoom';
}
