import * as THREE from 'three';
import maleUrl from './skin-assets/mobile/1024/middleage_african_male_q90.jpg?url';
import femaleUrl from './skin-assets/mobile/1024/middleage_african_female_q90.jpg?url';

const maps = {
  man: {url: maleUrl, bytes: 126259, reference: [0.14787665282263032,0.04880991231432766,0.021870639694593016]},
  woman: {url: femaleUrl, bytes: 124599, reference: [0.145267316941515,0.04278947357020705,0.02141900069570399]},
} as const;

/** Use only the body's compatible hm08 UV skin map. Clothing retains its own material. */
export async function applySkinMaterial(root: THREE.Group, body: 'man'|'woman', skin: string) {
  const mesh = root.getObjectByName('Body') as THREE.SkinnedMesh | undefined;
  if (!mesh?.isSkinnedMesh || Array.isArray(mesh.material)) throw new Error('Authored skin requires one Body material');
  const original = mesh.material;
  const source = maps[body];
  const texture = await new THREE.TextureLoader().loadAsync(source.url);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  const material = original.clone() as THREE.MeshStandardMaterial;
  const target = new THREE.Color(skin);
  material.color.setRGB(target.r/source.reference[0], target.g/source.reference[1], target.b/source.reference[2]);
  material.map = texture; material.roughness = .78; material.metalness = 0;
  mesh.material = material;
  let disposed = false;
  return {
    metrics: {width:1024,height:1024,assetBytes:source.bytes,source:'MakeHuman CC0 hm08 skin',colorReference:source.reference},
    dispose() {
      if(disposed)return;disposed=true;
      if(mesh.material===material)mesh.material=original;
      material.dispose(); texture.dispose();
    },
  };
}
