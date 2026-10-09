import * as THREE from 'three';

/** UV-space iris sizing is measured from each authored eye's forward pole and UV bounds. */
export interface AuthoredEyeUvIsland {
  readonly centerU: number;
  readonly centerV: number;
  readonly radiusU: number;
  readonly radiusV: number;
}

export interface AuthoredEyeMaterialMetrics {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly islands: readonly [AuthoredEyeUvIsland, AuthoredEyeUvIsland];
}

const MAX_VERTEX_UV_DISTANCE = 0.00001;
const SCLERA = new THREE.Color('#f3e6d5');
const LIMBAL = new THREE.Color('#21130e');
const IRIS = new THREE.Color('#57351f');
const IRIS_LIGHT = new THREE.Color('#80512d');
const PUPIL = new THREE.Color('#100b08');

/** Read eye centers from the forwardmost authored vertices, then normalize by actual island bounds. */
export function measureAuthoredEyeUv(geometry: THREE.BufferGeometry): AuthoredEyeMaterialMetrics {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!position || !uv || position.count !== uv.count) throw new Error('Authored Eyes needs matching position and uv attributes');
  const sides = [-1, 1].map(sign => {
    const vertices: number[] = [];
    let frontZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (Math.sign(position.getX(i)) !== sign) continue;
      vertices.push(i);
      frontZ = Math.max(frontZ, position.getZ(i));
    }
    if (!vertices.length) throw new Error(`Authored eye island missing for x sign ${sign}`);
    const pole = vertices.filter(i => frontZ - position.getZ(i) <= MAX_VERTEX_UV_DISTANCE);
    const centerU = pole.reduce((sum, i) => sum + uv.getX(i), 0) / pole.length;
    const centerV = pole.reduce((sum, i) => sum + uv.getY(i), 0) / pole.length;
    const radiusU = Math.max(...vertices.map(i => Math.abs(uv.getX(i) - centerU)));
    const radiusV = Math.max(...vertices.map(i => Math.abs(uv.getY(i) - centerV)));
    if (radiusU <= 0 || radiusV <= 0) throw new Error('Authored eye UV island has no measurable area');
    return { centerU, centerV, radiusU, radiusV };
  });
  const index = geometry.getIndex();
  return {
    vertexCount: position.count,
    triangleCount: index ? index.count / 3 : position.count / 3,
    islands: sides as [AuthoredEyeUvIsland, AuthoredEyeUvIsland],
  };
}

/** Replace only the material on the existing Eyes mesh; caller owns the returned restoration/disposal. */
export function applyAuthoredEyeMaterial(root: THREE.Object3D): { metrics: AuthoredEyeMaterialMetrics; dispose(): void } {
  let eye: THREE.Mesh | undefined;
  root.traverse(node => { if (!eye && node.name === 'Eyes' && (node as THREE.Mesh).isMesh) eye = node as THREE.Mesh; });
  if (!eye) throw new Error('Authored character is missing the Eyes mesh');
  const mesh = eye;
  const metrics = measureAuthoredEyeUv(mesh.geometry);
  const original = mesh.material;
  if (Array.isArray(original)) throw new Error('Authored Eyes must have a single material');
  const material = original.clone() as THREE.MeshStandardMaterial;
  material.color.copy(SCLERA);
  material.roughness = 0.27;
  material.metalness = 0;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    const [a, b] = metrics.islands;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAuthoredEyeUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAuthoredEyeUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAuthoredEyeUv;\nuniform vec4 authoredEyeA;\nuniform vec4 authoredEyeB;\nuniform vec3 authoredLimbal;\nuniform vec3 authoredIris;\nuniform vec3 authoredIrisLight;\nuniform vec3 authoredPupil;')
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 eyeA = (vAuthoredEyeUv - authoredEyeA.xy) / authoredEyeA.zw;
vec2 eyeB = (vAuthoredEyeUv - authoredEyeB.xy) / authoredEyeB.zw;
float useA = step(dot(eyeA, eyeA), dot(eyeB, eyeB));
vec2 eyeUv = mix(eyeB, eyeA, useA);
float eyeRadius = length(eyeUv);
float limbalMask = 1.0 - smoothstep(0.34, 0.39, eyeRadius);
float irisMask = 1.0 - smoothstep(0.29, 0.34, eyeRadius);
float pupilMask = 1.0 - smoothstep(0.125, 0.155, eyeRadius);
float irisGrain = 0.5 + 0.5 * sin(atan(eyeUv.y, eyeUv.x) * 18.0 + eyeRadius * 95.0);
vec3 irisColor = mix(authoredIris, authoredIrisLight, irisGrain * 0.36);
diffuseColor.rgb = mix(diffuseColor.rgb, authoredLimbal, limbalMask);
diffuseColor.rgb = mix(diffuseColor.rgb, irisColor, irisMask);
diffuseColor.rgb = mix(diffuseColor.rgb, authoredPupil, pupilMask);`);
    shader.uniforms.authoredEyeA = { value: new THREE.Vector4(a.centerU, a.centerV, a.radiusU, a.radiusV) };
    shader.uniforms.authoredEyeB = { value: new THREE.Vector4(b.centerU, b.centerV, b.radiusU, b.radiusV) };
    shader.uniforms.authoredLimbal = { value: LIMBAL };
    shader.uniforms.authoredIris = { value: IRIS };
    shader.uniforms.authoredIrisLight = { value: IRIS_LIGHT };
    shader.uniforms.authoredPupil = { value: PUPIL };
  };
  material.customProgramCacheKey = () => `${previousKey()}|authored-eye-uv-v1`;
  mesh.material = material;
  let disposed = false;
  return {
    metrics,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh.material === material) mesh.material = original;
      material.dispose();
    },
  };
}
