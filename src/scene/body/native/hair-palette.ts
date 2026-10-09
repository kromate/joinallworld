import * as THREE from 'three';

const SHADER_KEY = 'joinallworld.authored-hair-palette.v1';
const MAP_MARKER = '#include <map_fragment>';
const REFERENCE_FLOOR = 0.001;

/** Alpha-weighted linear RGB means measured from the pinned 512px source maps. */
export const AUTHORED_HAIR_PALETTE_REFERENCES = Object.freeze({
  short02: Object.freeze([0.07420745240635931, 0.0482092392968291, 0.033997361630749644] as const),
  afro01: Object.freeze([0.007146853064792233, 0.0029524422685302002, 0.002917673467253486] as const),
});

export type AuthoredHairAsset = keyof typeof AUTHORED_HAIR_PALETTE_REFERENCES;

export interface AuthoredHairPalette {
  readonly material: THREE.MeshStandardMaterial;
  setColor(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

interface PaletteShader {
  uniforms: Record<string, { value: unknown }>;
  fragmentShader: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Authored hair palette: ${message}`);
}

function asLinearColor(value: THREE.ColorRepresentation): THREE.Color {
  return value instanceof THREE.Color ? value.clone() : new THREE.Color(value);
}

/**
 * Tint the pinned hair texture by its source-relative linear RGB variation.
 * The measured mean makes the requested color the approximate alpha-weighted
 * average while retaining the source map's strand/highlight variation.
 */
export function createAuthoredHairPalette(
  source: THREE.MeshStandardMaterial,
  asset: AuthoredHairAsset,
  color: THREE.ColorRepresentation,
): AuthoredHairPalette {
  assert(source.map, 'source hair material must retain its diffuse texture');
  assert(source.map.colorSpace === THREE.SRGBColorSpace, 'source hair texture must remain sRGB');
  const material = source.clone();
  const target = asLinearColor(color);
  const reference = new THREE.Vector3(...AUTHORED_HAIR_PALETTE_REFERENCES[asset]);
  assert(reference.toArray().every((channel) => Number.isFinite(channel) && channel > REFERENCE_FLOOR),
    `measured ${asset} source reference is invalid`);
  const shaders = new Set<PaletteShader>();
  let disposed = false;

  // The source MHMAT factor is white. Reset it defensively so requested hair
  // color is not multiplied by an asset-specific dark base color.
  material.color.setRGB(1, 1, 1);
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    const typed = shader as unknown as PaletteShader;
    const common = '#include <common>';
    assert(typed.fragmentShader.includes(common), 'standard fragment shader common marker is missing');
    typed.fragmentShader = typed.fragmentShader.replace(common,
      `${common}\nuniform vec3 uAuthoredHairColor;\nuniform vec3 uAuthoredHairReferenceLinear;`);
    assert(typed.fragmentShader.indexOf(MAP_MARKER) >= 0
      && typed.fragmentShader.indexOf(MAP_MARKER, typed.fragmentShader.indexOf(MAP_MARKER) + MAP_MARKER.length) < 0,
    'standard diffuse-map marker is missing or ambiguous');
    const insertion = `\ndiffuseColor.rgb = clamp(uAuthoredHairColor * diffuseColor.rgb / max(uAuthoredHairReferenceLinear, vec3(${REFERENCE_FLOOR.toFixed(3)})), vec3(0.0), vec3(1.0));\n`;
    const marker = typed.fragmentShader.indexOf(MAP_MARKER) + MAP_MARKER.length;
    typed.fragmentShader = typed.fragmentShader.slice(0, marker) + insertion + typed.fragmentShader.slice(marker);
    typed.uniforms.uAuthoredHairColor = { value: target };
    typed.uniforms.uAuthoredHairReferenceLinear = { value: reference };
    shaders.add(typed);
  };
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousCacheKey()}|${SHADER_KEY}`;
  material.needsUpdate = true;

  return {
    material,
    setColor(nextColor) {
      assert(!disposed, 'cannot update a disposed palette');
      target.copy(asLinearColor(nextColor));
      for (const shader of shaders) shader.uniforms.uAuthoredHairColor!.value = target;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shaders.clear();
      material.dispose();
    },
  };
}
