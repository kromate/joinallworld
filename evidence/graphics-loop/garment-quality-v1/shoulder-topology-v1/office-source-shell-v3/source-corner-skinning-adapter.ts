import type * as THREE from 'three';

/**
 * Review-only material adapter for the four per-influence bind-space points.
 * It replaces only Three's vertex-position skinning chunk. It assumes the
 * standard USE_SKINNING uniforms/attributes are present and is intended only
 * for the isolated office source-corner chart fixture.
 */
export const SOURCE_CORNER_SKINNING_VERTEX_ATTRIBUTES=`
attribute vec3 sourceBind0;
attribute vec3 sourceBind1;
attribute vec3 sourceBind2;
attribute vec3 sourceBind3;
`;

export const SOURCE_CORNER_SKINNING_VERTEX_CHUNK=`
#ifdef USE_SKINNING
  vec4 sourceCornerSkinned = vec4( 0.0 );
  sourceCornerSkinned += getBoneMatrix( skinIndex.x ) * vec4( sourceBind0, 1.0 ) * skinWeight.x;
  sourceCornerSkinned += getBoneMatrix( skinIndex.y ) * vec4( sourceBind1, 1.0 ) * skinWeight.y;
  sourceCornerSkinned += getBoneMatrix( skinIndex.z ) * vec4( sourceBind2, 1.0 ) * skinWeight.z;
  sourceCornerSkinned += getBoneMatrix( skinIndex.w ) * vec4( sourceBind3, 1.0 ) * skinWeight.w;
  transformed = ( bindMatrixInverse * sourceCornerSkinned ).xyz;
#endif
`;
export const SOURCE_CORNER_SKINNING_CACHE_KEY='allworld-source-corner-skinning-v1';

/**
 * Returns a material compiler hook without changing the supplied material.
 * The caller must restrict this hook to the chart material. Standard skin
 * normal handling remains approximate and is explicitly not validated here.
 */
export function sourceCornerSkinningHook(material:THREE.Material):typeof material.onBeforeCompile{
  const prior=material.onBeforeCompile;
  return (shader,renderer)=>{
    prior.call(material,shader,renderer);
    const common='#include <common>',skinning='#include <skinning_vertex>';
    if(!shader.vertexShader.includes(common)||!shader.vertexShader.includes(skinning))throw new Error('Expected standard Three.js skinning chunks');
    shader.vertexShader=shader.vertexShader.replace(common,`${common}\n${SOURCE_CORNER_SKINNING_VERTEX_ATTRIBUTES}`);
    shader.vertexShader=shader.vertexShader.replace(skinning,SOURCE_CORNER_SKINNING_VERTEX_CHUNK);
  };
}
