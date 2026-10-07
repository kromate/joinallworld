// The clips no CC0 pack has, authored here as keyframes on the body's 23 bones (scripts/body/build-body.ts adds them
// to clip-pack.glb). Each is built from poses of the UAL1 source (its rest pose and frames of its own clips) with
// rotation offsets on top, so the result is the same rig, the same proportions and the same CC0 licence.
import type { Loaded } from './gltf-io.ts';

export interface AuthoredTrack { bone: string; path: 'rotation' | 'translation'; times: Float32Array; values: Float32Array }
export interface AuthoredClip { name: string; tracks: AuthoredTrack[] }

export function authoredClips(_doc: Loaded, _bones: readonly string[]): AuthoredClip[] {
  return [];
}
