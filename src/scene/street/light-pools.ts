/**
 * OWNER: scenes
 * The warm pools of light on the ground under street lamps (and the spill in front of lit shop windows): ONE InstancedMesh of flat
 * quads, one draw call for all of them, each a radial gradient drawn on a small canvas in code (no file). Additive, no depth write,
 * only at dusk and night, and dark in a power cut except for a shop on a generator. The street's lamps and shops come from two places
 * (the street plan and the lazily loaded scenery), so each hands in its own list by name and the mesh is rebuilt from both.
 *
 * Not drawn on the phone tier (the caller does not make it): the phone keeps the pool discs it always had inside its glow batch, so
 * its draw-call count does not move.
 */
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';

/** One pool: its centre on the ground, how far it reaches on each side (x, z), its warmth and strength, and whether it follows the lit share. */
export interface PoolSpot {
  x: number
  z: number
  /** Half the quad's size along x and z (scene units): the gradient reaches 0 at the edge. */
  rx: number
  rz: number
  colour: string
  /** 0 to 1 or more. */
  strength: number
  /** A lamp (always lit when powered): -1. A shop: its draw, lit while below the share. */
  seed: number
  /** Stays lit in a power cut. */
  generator: boolean
}

/** How high the quads float above the ground (the kerb top is 0.13). */
const POOL_Y = 0.16;
const SODIUM = '#ffb35e';
export const LAMP_POOL_RADIUS = 4.6;
/** A street lamp's pool. */
export const lampPool = (x: number, z: number): PoolSpot => ({ x, z, rx: LAMP_POOL_RADIUS, rz: LAMP_POOL_RADIUS, colour: SODIUM, strength: 1, seed: -1, generator: false });

export interface PoolLevel { /** pool strength of the hour (0 by day) */ pool: number; share: number; power: 0 | 1; wet: boolean }
export interface LightPools {
  /** Replace the spots one source (the plan's lamps, the scenery's shops) contributes. */
  setSource(key: string, spots: readonly PoolSpot[]): void
  setLevel(level: PoolLevel): void
  readonly count: number
  dispose(): void
}

function gradientTexture(THREE: typeof import('three')): THREE.CanvasTexture | null {
  const canvas = globalThis.document?.createElement?.('canvas'), g = canvas?.getContext?.('2d');
  // A stand-in canvas (a test's) may lack gradients: no texture then, and the pool is a plain flat square (nobody sees it there).
  if (!canvas || !g || typeof g.createRadialGradient !== 'function') return null;
  canvas.width = canvas.height = 64;
  const ring = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  // A bright, quick fall-off near the lamp and a long soft tail: what a sodium lamp does to a road.
  for (const [at, alpha] of [[0, 0.95], [0.18, 0.62], [0.42, 0.27], [0.7, 0.08], [1, 0]] as const) ring.addColorStop(at, `rgba(255,255,255,${alpha})`);
  g.fillStyle = ring; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const PARS_VERTEX = /* glsl */`
attribute vec2 aLit;
varying vec2 vLit;
`;
const PARS_FRAGMENT = /* glsl */`
uniform float uPool;
uniform float uShare;
uniform float uPower;
varying vec2 vLit;
`;
// A lamp (seed below zero) is lit whenever there is power; a shop is lit while its draw is under the share; a generator keeps a shop lit.
const FRAGMENT_LEVEL = /* glsl */`
#include <color_fragment>
float poolOn = (vLit.x < uShare ? 1.0 : 0.0) * max(uPower, vLit.y * 0.8);
diffuseColor.rgb *= uPool * poolOn;
`;

export function createLightPools(kit: Kit, parent: THREE.Object3D): LightPools {
  const { THREE } = kit;
  const map = gradientTexture(THREE);
  const level = { pool: { value: 0 }, share: { value: 0 }, power: { value: 1 } };
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', ...(map ? { map } : {}), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPool = level.pool; shader.uniforms.uShare = level.share; shader.uniforms.uPower = level.power;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PARS_VERTEX}`).replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PARS_FRAGMENT}`).replace('#include <color_fragment>', FRAGMENT_LEVEL);
  };
  material.customProgramCacheKey = () => 'street-light-pools-1';
  const sources = new Map<string, readonly PoolSpot[]>();
  let mesh: THREE.InstancedMesh | null = null, geometry: THREE.BufferGeometry | null = null, count = 0, wetBoost = 1, disposed = false;

  function rebuild(): void {
    if (mesh) { parent.remove(mesh); mesh.dispose(); mesh = null; }
    geometry?.dispose(); geometry = null;
    const spots = [...sources.values()].flat();
    count = spots.length;
    if (!count || disposed) return;
    geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const lit = new Float32Array(count * 2);
    mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), colour = new THREE.Color();
    spots.forEach((spot, i) => {
      mesh!.setMatrixAt(i, matrix.compose(position.set(spot.x, POOL_Y, spot.z), new THREE.Quaternion(), scale.set(spot.rx * 2, 1, spot.rz * 2)));
      mesh!.setColorAt(i, colour.set(spot.colour).multiplyScalar(spot.strength));
      lit[i * 2] = spot.seed; lit[i * 2 + 1] = spot.generator ? 1 : 0;
    });
    geometry.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 2));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = 'street-light-pools';
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 2;
    mesh.visible = level.pool.value > 0;
    parent.add(mesh);
  }

  return {
    setSource(key, spots) { sources.set(key, spots); rebuild(); },
    setLevel(next) {
      wetBoost = next.wet ? 1.35 : 1;
      level.pool.value = next.pool * wetBoost; level.share.value = next.share; level.power.value = next.power;
      // A lamp's pool (seed -1) is lit by any share, including 0 by day: the strength is what is 0 by day.
      if (mesh) mesh.visible = level.pool.value > 0;
    },
    get count() { return count; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh) { parent.remove(mesh); mesh.dispose(); mesh = null; }
      geometry?.dispose(); geometry = null;
      map?.dispose(); material.dispose();
    },
  };
}
