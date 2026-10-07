/**
 * The skinned body's poses and which clip shows each (no imports, so tests and the scenes can read them without the
 * lazy body chunk). The clip names are the ones in BODY_MANIFEST.clips.names (clip-pack.glb).
 */
/** What the body can show. lie: on the back on a bed or mat; soak: sitting low in a tub; wash: at a bucket or shower. */
export type BodyPose = 'idle' | 'walk' | 'jog' | 'sit' | 'interact' | 'dance' | 'lie' | 'soak' | 'wash';
/** Where a resting pose's still frame is taken, as a share of its clip. */
export const STILL: Readonly<Record<BodyPose, { clip: string; at: number }>> = {
  idle: { clip: 'idle', at: 0 }, walk: { clip: 'walk', at: 0.25 }, jog: { clip: 'jog', at: 0.25 },
  sit: { clip: 'sit', at: 0 }, interact: { clip: 'interact', at: 0.4 }, dance: { clip: 'dance', at: 0.25 },
  lie: { clip: 'sleep', at: 0 }, soak: { clip: 'bathe-sit', at: 0.1 }, wash: { clip: 'bathe-stand', at: 0.75 },
};
/** The bounded clip into a resting pose, and the one out of it (none out when walking off: the stride takes over). */
export const INTO: Readonly<Partial<Record<BodyPose, string>>> = { sit: 'sit-enter', lie: 'lie-down' };
export const OUT: Readonly<Partial<Record<BodyPose, string>>> = { sit: 'sit-exit', lie: 'get-up' };
/** Arriving through a door, and walking on a slope (up, down). */
export const DOOR = 'door';
export const STAIRS = Object.freeze({ up: 'stairs-up', down: 'stairs-down' });
/** Poses placed by sitOn (and the clips that leave them, which keep that placement until they end). */
export const SEATED: ReadonlySet<string> = new Set(['sit', 'soak', 'lie', 'sit-exit', 'get-up']);
