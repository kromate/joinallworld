import * as THREE from 'three';
import type { Look } from '../avatar-look.ts';
import type { BodyKey } from './manifest.ts';
import { EYE_SOCKETS } from './face-shader.ts';

type Surface = 'skin' | 'brow' | 'white' | 'iris' | 'pupil' | 'glint';
type Shape = 'neutral' | 'smile' | 'grin' | 'blink';
export interface FacialDetail {
  readonly object: THREE.SkinnedMesh;
  readonly triangles: number;
  wear(look: Look): void;
  sleep(value: boolean): void;
  /** Sample only while the host already draws animation; this module never schedules frames. */
  sample(seconds: number): void;
  dispose(): void;
}

/** Project an atlas location into the immutable bind mesh, including quantization/texture transforms. */
function atlasPoint(base: THREE.SkinnedMesh, target: THREE.Vector2): THREE.Vector3 {
  const position = base.geometry.getAttribute('position'), uv = base.geometry.getAttribute('uv');
  const region = base.geometry.getAttribute('color'), index = base.geometry.index;
  if (!uv || !position || !region || !index) throw new Error('Facial detail requires the body atlas');
  const materials = Array.isArray(base.material) ? base.material : [base.material];
  const map = materials.find(material => 'map' in material && material.map instanceof THREE.Texture);
  const texture = map && 'map' in map && map.map instanceof THREE.Texture ? map.map : null;
  texture?.updateMatrix();
  const tex = (i: number) => {
    const p = new THREE.Vector2(uv.getX(i), uv.getY(i));
    if (texture) p.applyMatrix3(texture.matrix);
    return p;
  };
  let closest = Infinity;
  const result = new THREE.Vector3();
  for (let at = 0; at < index.count; at += 3) {
    const ia = index.getX(at), ib = index.getX(at + 1), ic = index.getX(at + 2);
    if (region.getX(ia) < 0.5 || region.getX(ib) < 0.5 || region.getX(ic) < 0.5) continue;
    const a = tex(ia), b = tex(ib), c = tex(ic);
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-10) continue;
    const wa = ((b.y - c.y) * (target.x - c.x) + (c.x - b.x) * (target.y - c.y)) / denominator;
    const wb = ((c.y - a.y) * (target.x - c.x) + (a.x - c.x) * (target.y - c.y)) / denominator;
    const wc = 1 - wa - wb;
    // The source has open eye sockets. The nearest adjacent triangle supplies the socket's plane.
    const outside = Math.max(0, -wa, -wb, -wc);
    const distance = outside + target.distanceTo(a.clone().add(b).add(c).multiplyScalar(1 / 3)) * 0.001;
    if (distance >= closest) continue;
    closest = distance;
    result.set(0, 0, 0);
    for (const [i, weight] of [[ia, wa], [ib, wb], [ic, wc]]) {
      result.addScaledVector(new THREE.Vector3().fromBufferAttribute(position, i!), weight!);
    }
  }
  if (!Number.isFinite(closest)) throw new Error('Facial atlas has no matching surface');
  return result.applyMatrix4(base.matrix);
}

/** One draw call, one shared skeleton, no downloaded assets: modeled eyes, lids and expressive brows. */
export function createFacialDetail(base: THREE.SkinnedMesh, key: BodyKey, look: Look): FacialDetail {
  base.updateMatrix();
  const fromMetres = base.matrix.clone().invert();
  const head = base.skeleton.bones.findIndex(bone => bone.name === 'Head');
  if (head < 0) throw new Error('Facial detail requires the Head joint');
  const eyes = [atlasPoint(base, new THREE.Vector2(...EYE_SOCKETS[key].left)), atlasPoint(base, new THREE.Vector2(...EYE_SOCKETS[key].right))];
  const surfaces: Surface[] = [], indices: number[] = [];
  let topologyBuilt = false;
  let buildingShape: Shape = 'neutral';
  let vertices: number[] = [];
  const vertex = (point: THREE.Vector3, surface: Surface): number => {
    const i = vertices.length / 3;
    point.applyMatrix4(fromMetres); vertices.push(point.x, point.y, point.z);
    if (buildingShape === 'neutral' && !topologyBuilt) surfaces.push(surface);
    return i;
  };
  const triangle = (a: number, b: number, c: number) => { if (buildingShape === 'neutral' && !topologyBuilt) indices.push(a, b, c); };
  // Concentric rings produce smooth rounded surfaces and stable topology for every expression.
  const disc = (center: THREE.Vector3, rx: number, ry: number, depth: number, surface: Surface, rings = 3) => {
    const middle = vertex(center.clone().add(new THREE.Vector3(0, 0, depth)), surface);
    let previous: number[] = [];
    for (let ring = 1; ring <= rings; ring++) {
      const radius = ring / rings, row: number[] = [];
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12;
        row.push(vertex(center.clone().add(new THREE.Vector3(Math.cos(angle) * rx * radius, Math.sin(angle) * ry * radius, depth * Math.sqrt(Math.max(0, 1 - radius * radius)))), surface));
      }
      for (let i = 0; i < 24; i++) {
        const next = (i + 1) % 24;
        if (ring === 1) triangle(middle, row[i]!, row[next]!);
        else { triangle(previous[i]!, row[i]!, row[next]!); triangle(previous[i]!, row[next]!, previous[next]!); }
      }
      previous = row;
    }
  };
  const ribbon = (points: THREE.Vector3[], width: number, surface: Surface) => {
    const rows = points.map(point => [vertex(point.clone().add(new THREE.Vector3(0, -width / 2, 0)), surface), vertex(point.clone().add(new THREE.Vector3(0, width / 2, 0.0008)), surface)]);
    for (let i = 0; i < rows.length - 1; i++) {
      triangle(rows[i]![0]!, rows[i + 1]![0]!, rows[i + 1]![1]!);
      triangle(rows[i]![0]!, rows[i + 1]![1]!, rows[i]![1]!);
    }
  };
  function build(shape: Shape): Float32Array {
    buildingShape = shape; vertices = [];
    const smile = shape === 'smile' ? 0.65 : shape === 'grin' ? 1 : 0;
    for (const eye of eyes) {
      const closed = shape === 'blink', ry = closed ? 0.0005 : 0.0115 - smile * 0.001;
      disc(eye.clone().add(new THREE.Vector3(0, 0, 0.003)), 0.019, ry, closed ? 0.001 : 0.011, closed ? 'skin' : 'white');
      const front = eye.clone().add(new THREE.Vector3(0, closed ? 0 : 0.0018, closed ? 0.0032 : 0.0142));
      disc(front, 0.0072, closed ? 0.0001 : ry * 0.88, 0.0012, closed ? 'skin' : 'iris', 2);
      disc(front.clone().add(new THREE.Vector3(0, 0, 0.0015)), 0.0031, closed ? 0.00005 : 0.0047, 0.0004, closed ? 'skin' : 'pupil', 1);
      disc(front.clone().add(new THREE.Vector3(-0.0025, 0.0029, 0.0021)), 0.0013, closed ? 0.00005 : 0.0016, 0.0002, closed ? 'skin' : 'glint', 1);
      const lid: THREE.Vector3[] = [], brow: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const x = (i / 12 * 2 - 1) * 0.0195, arch = Math.sqrt(Math.max(0, 1 - (x / 0.020) ** 2));
        lid.push(eye.clone().add(new THREE.Vector3(x, closed ? 0 : ry * arch, 0.003 + 0.005 * arch)));
        brow.push(eye.clone().add(new THREE.Vector3(x * 1.12, 0.018 + 0.004 * arch + smile * 0.003, 0.004 + 0.002 * arch)));
      }
      ribbon(lid, 0.0018, 'brow'); ribbon(brow, 0.0038, 'brow');
    }
    return new Float32Array(vertices);
  }
  const neutral = build('neutral'); topologyBuilt = true;
  const smile = build('smile'), grin = build('grin'), blink = build('blink');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(neutral, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(surfaces.length * 3), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(surfaces.flatMap(() => [head, 0, 0, 0]), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(surfaces.flatMap(() => [1, 0, 0, 0]), 4));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.morphAttributes.position = [smile, grin, blink].map(data => new THREE.BufferAttribute(data, 3));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, side: THREE.DoubleSide });
  const object = new THREE.SkinnedMesh(geometry, material);
  object.name = 'avatar-facial-detail';
  object.userData.anchors = { eyes: eyes.map(point => point.toArray()) };
  object.position.copy(base.position); object.quaternion.copy(base.quaternion); object.scale.copy(base.scale);
  object.matrix.copy(base.matrix); object.matrixAutoUpdate = base.matrixAutoUpdate;
  object.bindMode = base.bindMode; object.bind(base.skeleton, base.bindMatrix); object.frustumCulled = false;
  base.parent?.add(object);
  let expression: Look['expression'] = 'neutral', sleeping = false, disposed = false;
  const fitKey = (value: Look) => JSON.stringify([value.face, value.appearance?.ageAppearance]);
  let fitted = fitKey(look);
  function wear(next: Look) {
    if (fitKey(next) !== fitted) {
      eyes[0]!.copy(atlasPoint(base, new THREE.Vector2(...EYE_SOCKETS[key].left)));
      eyes[1]!.copy(atlasPoint(base, new THREE.Vector2(...EYE_SOCKETS[key].right)));
      const position = geometry.getAttribute('position');
      for (const [i, value] of build('neutral').entries()) position.array[i] = value;
      position.needsUpdate = true;
      for (const [i, shape] of (['smile', 'grin', 'blink'] as const).entries()) {
        const attribute = geometry.morphAttributes.position?.[i];
        if (attribute) { for (const [at, value] of build(shape).entries()) attribute.array[at] = value; attribute.needsUpdate = true; }
      }
      geometry.computeVertexNormals();
      fitted = fitKey(next);
    }
    expression = next.expression;
    const skin = new THREE.Color(next.skin);
    const colors: Record<Surface, THREE.Color> = { skin, brow: new THREE.Color(next.hairColor).multiplyScalar(0.6), white: new THREE.Color('#eee9dd'), iris: new THREE.Color('#67412b'), pupil: new THREE.Color('#100c0a'), glint: new THREE.Color('#ffffff') };
    const attribute = geometry.getAttribute('color');
    surfaces.forEach((surface, i) => { const color = colors[surface]; attribute.setXYZ(i, color.r, color.g, color.b); });
    attribute.needsUpdate = true;
    sample(0);
  }
  function sample(seconds: number) {
    const influences = object.morphTargetInfluences;
    if (!influences) return;
    const cycle = ((seconds % 4.7) + 4.7) % 4.7;
    const blinkAmount = sleeping ? 1 : cycle > 4.45 ? Math.sin((cycle - 4.45) / 0.25 * Math.PI) : 0;
    influences[0] = expression === 'smile' ? 1 - blinkAmount : 0;
    influences[1] = expression === 'grin' ? 1 - blinkAmount : 0;
    influences[2] = blinkAmount;
  }
  wear(look);
  return { object, triangles: indices.length / 3, wear, sample, sleep(value) { sleeping = value; sample(0); }, dispose() { if (disposed) return; disposed = true; object.removeFromParent(); geometry.dispose(); material.dispose(); } };
}
