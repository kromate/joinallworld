import * as THREE from 'three';
import type { AvatarBodyRegion } from '../../game/wardrobe/catalogue.ts';
import { buildWardrobeGeometry, captureWardrobeRestFrame } from './geometry.ts';
import type { ResolvedWardrobeLook, WardrobeGeometry, WardrobePresentation } from './geometry.ts';
export type { WardrobePresentation } from './geometry.ts';

export interface WardrobeMetrics {
  readonly triangles: number;
  readonly hiddenTriangles: number;
  readonly addedDrawCalls: 0 | 1;
  readonly bytes: number;
  readonly itemTriangles: Readonly<Record<string, number>>;
}
export interface WardrobeRenderer {
  readonly object: THREE.SkinnedMesh;
  readonly metrics: WardrobeMetrics;
  readonly lastError: string | null;
  /** A null look restores the exact original body indices and removes the overlay. */
  wear(resolved: ResolvedWardrobeLook | null): boolean;
  /** Transient modest clothing for object use. Never written into saved or owned wardrobe data. */
  setPresentation(presentation: WardrobePresentation): boolean;
  dispose(): void;
}

function boneRegion(name: string): AvatarBodyRegion | null {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (name.startsWith('spine_') || name.startsWith('clavicle_')) return 'torso';
  if (name.startsWith('upperarm_')) return 'upperarms';
  if (name.startsWith('lowerarm_')) return 'forearms';
  if (name === 'pelvis') return 'hips';
  if (name.startsWith('thigh_') || name.startsWith('calf_')) return 'legs';
  if (name.startsWith('foot_') || name.startsWith('ball_')) return 'feet';
  return null;
}
const FABRIC_VERTEX = /* glsl */ `
attribute vec2 wardrobeUv;
attribute float wardrobeCloth;
varying vec2 vWardrobeUv;
varying float vWardrobeCloth;`;
const FABRIC_FRAGMENT = /* glsl */ `
uniform float uWardrobeFabric;
varying vec2 vWardrobeUv;
varying float vWardrobeCloth;
float wardrobeLine(float distance, float width) {
  float aa = max(fwidth(distance), 0.009);
  return 1.0 - smoothstep(width - aa, width + aa, abs(distance));
}`;
const FABRIC_COLOUR = /* glsl */ `
#include <color_fragment>
if (vWardrobeCloth > 0.5 && uWardrobeFabric > 0.5) {
  vec2 uv = vWardrobeUv * 18.0;
  vec2 cell = fract(uv) - 0.5;
  if (uWardrobeFabric < 1.5) {
    // Original alternating diamond/rosette repeat, inspired by geometric wax-print cloth.
    float diamond = wardrobeLine(abs(cell.x) + abs(cell.y) - 0.32, 0.035);
    float rosette = wardrobeLine(length(cell) - 0.19, 0.028);
    float alternate = mod(floor(uv.x) + floor(uv.y), 2.0);
    float ink = mix(diamond, rosette, alternate);
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.82, mix(diffuseColor.rgb, vec3(0.83, 0.59, 0.22), 0.44), ink);
  } else if (uWardrobeFabric < 2.5) {
    // Original resist-dye rings and small crossed dots.
    float ring = wardrobeLine(length(cell) - 0.25, 0.025);
    float cross = wardrobeLine(cell.x, 0.018) * wardrobeLine(cell.y, 0.018);
    float resist = max(ring, cross);
    vec3 dyed = mix(diffuseColor.rgb, vec3(0.07, 0.14, 0.27), 0.34);
    diffuseColor.rgb = mix(dyed, mix(diffuseColor.rgb, vec3(0.76, 0.81, 0.72), 0.6), resist * 0.8);
  } else {
    // Original narrow woven bands with a finer cross-thread repeat.
    float band = wardrobeLine(fract(uv.x * 0.65) - 0.5, 0.12);
    float thread = wardrobeLine(fract(uv.y * 3.0) - 0.5, 0.035);
    diffuseColor.rgb *= mix(0.76, 1.18, band) * mix(0.96, 1.08, thread);
  }
}
if (vWardrobeCloth > 1.5) {
  // Geometry tags the Agbada torso front; the back and sleeves retain the ordinary cloth tag.
  float y = vWardrobeUv.y;
  float hem = smoothstep(-0.02, -0.005, y) * (1.0 - smoothstep(0.43, 0.445, y));
  float twinRibbon = wardrobeLine(abs(vWardrobeUv.x) - 0.05, 0.008);
  float stitch = 0.78 + 0.22 * wardrobeLine(fract(y * 42.0) - 0.5, 0.13);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.43, 0.11), twinRibbon * hem * stitch);
}`;
function fabricChoice(fabric: string): number {
  return fabric === 'ankara' ? 1 : fabric === 'adire' ? 2 : fabric === 'asooke' ? 3 : 0;
}
const EMPTY: WardrobeMetrics = Object.freeze({ triangles: 0, hiddenTriangles: 0, addedDrawCalls: 0, bytes: 0, itemTriangles: {} });

/**
 * Attach as a sibling of base, before or after a pose has been sampled. Captures only immutable inverse-bind
 * positions. The overlay shares the original Skeleton and keeps the same mesh-node transform and bind matrix.
 * Dispose this renderer before disposing the body; it does not own its skeleton, bones, texture or base material.
 */
export function createWardrobeRenderer(base: THREE.SkinnedMesh, matte = false): WardrobeRenderer {
  const rest = captureWardrobeRestFrame(base);
  const indexAttribute = base.geometry.index;
  if (!indexAttribute) throw new Error('Wardrobe requires an indexed skinned body');
  const sourceIndex = indexAttribute;
  const originalIndex = sourceIndex.clone();
  const originalDrawRange = { ...base.geometry.drawRange };
  const originalGroups = base.geometry.groups.map(group => ({ ...group }));
  const position = base.geometry.getAttribute('position'), skinIndex = base.geometry.getAttribute('skinIndex'), skinWeight = base.geometry.getAttribute('skinWeight'), colour = base.geometry.getAttribute('color');
  if (!position || !skinIndex || !skinWeight) throw new Error('Wardrobe requires an indexed skinned body');
  const original = originalIndex.array;
  const regions: (AvatarBodyRegion | null)[] = [];
  const neckLimit = (rest.bones.get('neck_01')?.point.y ?? 1.5) + 0.045;
  for (let vertex = 0; vertex < position.count; vertex++) {
    if (colour && colour.itemSize === 4 && colour.getW(vertex) > 0.5) { regions.push('hair'); continue; }
    let strongest = 0;
    for (let channel = 1; channel < 4; channel++) if (skinWeight.getComponent(vertex, channel) > skinWeight.getComponent(vertex, strongest)) strongest = channel;
    const name = base.skeleton.bones[skinIndex.getComponent(vertex, strongest)]?.name ?? '';
    const region = boneRegion(name);
    // The exposed upper neck and every face/head vertex remain. A scarf only covers the lower neck.
    regions.push(region === 'head' || region === 'neck' && (rest.points[vertex]?.y ?? Infinity) > neckLimit ? null : region);
  }
  const material = matte ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  const fabricUniform = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uWardrobeFabric = fabricUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${FABRIC_VERTEX}`).replace('#include <begin_vertex>', '#include <begin_vertex>\n vWardrobeUv = wardrobeUv; vWardrobeCloth = wardrobeCloth;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${FABRIC_FRAGMENT}`).replace('#include <color_fragment>', FABRIC_COLOUR);
  };
  material.customProgramCacheKey = () => 'allworld-wardrobe-fabric-v2';
  const object = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material);
  object.name = 'avatar-wardrobe';
  object.position.copy(base.position); object.quaternion.copy(base.quaternion); object.scale.copy(base.scale);
  object.matrix.copy(base.matrix); object.matrixAutoUpdate = base.matrixAutoUpdate;
  object.bindMode = base.bindMode;
  object.bind(base.skeleton, base.bindMatrix);
  object.frustumCulled = false;
  object.visible = false;
  base.parent?.add(object);
  let look: ResolvedWardrobeLook | null = null, presentation: WardrobePresentation = 'everyday', signature = '', disposed = false, metrics: WardrobeMetrics = EMPTY, lastError: string | null = null;

  function restore(): void {
    sourceIndex.copyArray(originalIndex.array);
    sourceIndex.needsUpdate = true;
    base.geometry.setDrawRange(originalDrawRange.start, originalDrawRange.count);
    base.geometry.clearGroups();
    for (const group of originalGroups) base.geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  function mask(generated: WardrobeGeometry): number {
    const { hides, coverage } = generated;
    const rangesByRegion = new Map<AvatarBodyRegion, typeof coverage>();
    for (const range of coverage) rangesByRegion.set(range.region, [...(rangesByRegion.get(range.region) ?? []), range]);
    const covered = (vertex: number, region: AvatarBodyRegion): boolean => {
      const ranges = rangesByRegion.get(region) ?? [];
      const y = rest.points[vertex]?.y ?? Infinity;
      return !ranges.length || ranges.some(range => y >= range.minY && y <= range.maxY);
    };
    if (!hides.size) { restore(); return 0; }
    let kept = 0;
    for (let i = 0; i < original.length; i += 3) {
      const a = original[i]!, b = original[i + 1]!, c = original[i + 2]!;
      const ra = regions[a], rb = regions[b], rc = regions[c];
      // Boundary triangles remain. Remove a triangle only if all three corners are fully covered.
      if (ra && rb && rc && hides.has(ra) && hides.has(rb) && hides.has(rc) && covered(a, ra) && covered(b, rb) && covered(c, rc)) continue;
      sourceIndex.setX(kept++, a); sourceIndex.setX(kept++, b); sourceIndex.setX(kept++, c);
    }
    sourceIndex.needsUpdate = true;
    base.geometry.setDrawRange(0, kept);
    base.geometry.clearGroups();
    return (original.length - kept) / 3;
  }
  function rebuild(): boolean {
    if (disposed) return false;
    const nextSignature = JSON.stringify([look, presentation]);
    if (signature === nextSignature) { lastError = null; return true; }
    let generated: WardrobeGeometry | null = null;
    if (look) {
      try { generated = buildWardrobeGeometry(rest, look, presentation); }
      catch (error: unknown) { lastError = error instanceof Error ? error.message : 'Wardrobe geometry failed'; return false; }
    }
    // Authoring errors leave the existing clothed base and previous overlay intact; masks change only after success.
    const old = object.geometry;
    if (generated) {
      const hiddenTriangles = mask(generated);
      object.geometry = generated.geometry;
      fabricUniform.value = fabricChoice(look?.look.fabric ?? 'plain');
      object.visible = true;
      metrics = { triangles: generated.triangles, hiddenTriangles, addedDrawCalls: 1, bytes: generated.bytes, itemTriangles: generated.itemTriangles };
    } else {
      restore(); object.geometry = new THREE.BufferGeometry(); object.visible = false; metrics = EMPTY;
    }
    old.dispose(); signature = nextSignature; lastError = null; return true;
  }
  return {
    object,
    get metrics() { return metrics; },
    get lastError() { return lastError; },
    wear(resolved) { const previous = look; look = resolved; if (rebuild()) return true; look = previous; return false; },
    setPresentation(next) { const previous = presentation; presentation = next; if (rebuild()) return true; presentation = previous; return false; },
    dispose() {
      if (disposed) return;
      disposed = true; restore();
      object.removeFromParent(); object.geometry.dispose(); material.dispose();
      look = null; metrics = EMPTY;
    },
  };
}
