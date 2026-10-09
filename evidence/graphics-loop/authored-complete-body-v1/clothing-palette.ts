import * as THREE from 'three';

const SHADER_KEY = 'joinallworld.authored-clothing-palette.v1';
const VERTEX_MARKER = '#include <begin_vertex>';
const FRAGMENT_MARKER = '#include <map_fragment>';
const CENTER_Y_METRES = 0.91;
const TRANSITION_WIDTH_METRES = 0.002;

export interface AuthoredClothingPaletteColors {
  readonly shirt: THREE.ColorRepresentation;
  readonly trousers: THREE.ColorRepresentation;
}

export interface AuthoredClothingPalette {
  /** Private material clone. It uses the source material's standard lighting and roughness. */
  readonly material: THREE.MeshStandardMaterial;
  /** Update this actor's palette, including already compiled WebGL programs. */
  setColors(colors: AuthoredClothingPaletteColors): void;
  /** Remove owned shader references and dispose only the private material clone. */
  dispose(): void;
}

interface PaletteShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Authored clothing palette: ${message}`);
}

function insertAfter(source: string, marker: string, code: string, label: string): string {
  const first = source.indexOf(marker);
  assert(first >= 0, `Three.js shader no longer contains ${label} marker`);
  assert(source.indexOf(marker, first + marker.length) < 0, `Three.js shader has ambiguous ${label} marker`);
  return source.slice(0, first + marker.length) + code + source.slice(first + marker.length);
}

function asLinearColor(value: THREE.ColorRepresentation): THREE.Color {
  return value instanceof THREE.Color ? value.clone() : new THREE.Color(value);
}

/**
 * Create an actor-private palette material for the connected authored casual suit.
 * The source garment has no shirt/pants material seam: this blends palette color
 * over a 2 mm band centered at authored rest-local Y=0.91 m. It does not alter
 * vertices, indices, skinning, morphs, or the underlying body mask.
 */
export function createAuthoredClothingPalette(
  source: THREE.MeshStandardMaterial,
  colors: AuthoredClothingPaletteColors,
): AuthoredClothingPalette {
  const material = source.clone();
  const shirt = asLinearColor(colors.shirt);
  const trousers = asLinearColor(colors.trousers);
  const shaders = new Set<PaletteShader>();
  let disposed = false;

  // The authored GLB material is a neutral palette placeholder. Make the shader
  // palette the base color while keeping the source's map, normals and lighting.
  material.color.setRGB(1, 1, 1);
  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    const typed = shader as unknown as PaletteShader;
    typed.uniforms.uAuthoredShirtColor = { value: shirt };
    typed.uniforms.uAuthoredTrouserColor = { value: trousers };
    typed.uniforms.uAuthoredPaletteCenterY = { value: CENTER_Y_METRES };
    typed.uniforms.uAuthoredPaletteHalfWidth = { value: TRANSITION_WIDTH_METRES / 2 };
    typed.vertexShader = typed.vertexShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vAuthoredClothingRestY;`,
    );
    typed.fragmentShader = typed.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vAuthoredClothingRestY;\nuniform vec3 uAuthoredShirtColor;\nuniform vec3 uAuthoredTrouserColor;\nuniform float uAuthoredPaletteCenterY;\nuniform float uAuthoredPaletteHalfWidth;`,
    );
    typed.vertexShader = insertAfter(
      typed.vertexShader,
      VERTEX_MARKER,
      '\nvAuthoredClothingRestY = position.y;\n',
      'rest-local position',
    );
    typed.fragmentShader = insertAfter(
      typed.fragmentShader,
      FRAGMENT_MARKER,
      '\nfloat authoredClothingShirtBlend = smoothstep(uAuthoredPaletteCenterY - uAuthoredPaletteHalfWidth, uAuthoredPaletteCenterY + uAuthoredPaletteHalfWidth, vAuthoredClothingRestY);\ndiffuseColor.rgb *= mix(uAuthoredTrouserColor, uAuthoredShirtColor, authoredClothingShirtBlend);\n',
      'standard-map',
    );
    shaders.add(typed);
  };
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousCacheKey()}|${SHADER_KEY}`;

  return {
    material,
    setColors(nextColors) {
      assert(!disposed, 'cannot update a disposed palette');
      shirt.copy(asLinearColor(nextColors.shirt));
      trousers.copy(asLinearColor(nextColors.trousers));
      for (const shader of shaders) {
        shader.uniforms.uAuthoredShirtColor!.value = shirt;
        shader.uniforms.uAuthoredTrouserColor!.value = trousers;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shaders.clear();
      material.dispose();
    },
  };
}

export const AUTHORED_CLOTHING_PALETTE_CONTRACT = Object.freeze({
  shaderKey: SHADER_KEY,
  centerYMetres: CENTER_Y_METRES,
  transitionWidthMetres: TRANSITION_WIDTH_METRES,
  vertexMarker: VERTEX_MARKER,
  fragmentMarker: FRAGMENT_MARKER,
});
