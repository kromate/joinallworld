/**
 * Scene character facade.
 *
 * The model library is the default implementation. Passing `?models=legacy` to the host's URL
 * selects the verbatim pre-library module for comparison. Crowd helpers stay here because they
 * belong to the scene contract rather than the standalone model domain.
 */
import * as THREE from 'three';
import * as legacy from './characters-legacy.js';
import * as models from '../models/people/index.js';
import { createBatch, sceneMaterials, kitResources, releaseObjects } from './build.js';
import { modelLibraryEnabled } from '../models/integration/flags.js';

const useModels = modelLibraryEnabled();
const selected = useModels ? models : legacy;

export const LOOK_OPTIONS = legacy.LOOK_OPTIONS;
export const DETAILS = legacy.DETAILS;
export const PARTS = legacy.PARTS;
export const POSES = legacy.POSES;
// Keep the saved-game normalization shape stable; the adapter adds only explicit model extensions.
export const normalizeLook = legacy.normalizeLook;
export const ACCESSORY_SLOTS = legacy.ACCESSORY_SLOTS;

function modelLook(input, seed) {
  const look = legacy.normalizeLook(input, seed);
  if (input && typeof input === 'object') {
    const extended = {};
    if (Object.prototype.hasOwnProperty.call(input, 'height')) extended.height = input.height;
    if (Object.prototype.hasOwnProperty.call(input, 'build')) extended.build = input.build;
    return { ...look, ...extended };
  }
  return look;
}

export function drawAvatar(batch, input, options = {}) {
  if (!useModels) return legacy.drawAvatar(batch, input, options);
  return models.drawAvatar(batch, modelLook(input, options.seed), options);
}

export function buildAvatar(kit, look, options = {}) {
  if (!useModels) return legacy.buildAvatar(kit, look, options);
  return models.buildAvatar(kit, modelLook(look, options.seed), options);
}

export function poseAvatar(avatar, options = {}) {
  return selected.poseAvatar(avatar, options);
}

function tagFor(person, index, top) {
  const kind = person.kind === 'npc' || person.kind === 'self' ? person.kind : 'player';
  const name = String(person.name ?? person.id ?? '');
  return {
    id: String(person.id ?? `person-${index}`),
    name,
    kind,
    text: kind === 'player' ? `@${name}` : name,
    marker: kind === 'npc' ? 'dot' : kind === 'self' ? 'crown' : 'tag',
    colour: kind === 'npc' ? '#58d68a' : kind === 'self' ? '#ffd34d' : '#6fb4ff',
    position: { x: person.x || 0, y: top, z: person.z || 0 },
  };
}

/** Draw people into an existing batch and return the existing DOM tag contract. */
export function drawCrowd(batch, people = []) {
  return people.map((person, index) => {
    const kind = person.kind === 'npc' ? 'npc' : person.kind === 'self' ? 'crown' : 'player';
    const drawn = drawAvatar(batch, person.look, {
      x: person.x || 0, y: person.y || 0, z: person.z || 0, ry: person.ry || 0,
      pose: person.pose, seat: person.seat, detail: person.detail ?? 'low',
      seed: person.seed ?? person.id ?? person.name ?? index,
      marker: person.marker === undefined ? kind : person.marker,
    });
    return tagFor(person, index, drawn.top);
  });
}

/** Build a low-detail merged crowd with the same ownership and disposal semantics as before. */
export function buildCrowd(kit, people = []) {
  if (!useModels) return legacy.buildCrowd(kit, people);
  const batch = createBatch(kit.THREE);
  const tags = drawCrowd(batch, people);
  const built = batch.build(sceneMaterials(kit));
  const group = new THREE.Group();
  built.meshes.forEach((mesh) => group.add(mesh));
  const registry = kitResources(kit).disposers;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    registry.delete(dispose);
    releaseObjects(built.meshes);
    group.parent?.remove(group);
    group.clear();
  };
  registry.add(dispose);
  return { group, tags, triangles: built.triangles, dispose };
}

/** Preserve the old compact colour projection used by legacy callers. */
export function appearanceToLook(appearance, seed) {
  if (!useModels) return legacy.appearanceToLook(appearance, seed);
  const look = normalizeLook(appearance, seed);
  return { shirt: look.outfitColor, pants: look.bottomsColor, skin: look.skin, hair: look.hairColor };
}

/** Preserve the original kit-based person helper for callers outside the avatar model domain. */
export const person = legacy.person;
