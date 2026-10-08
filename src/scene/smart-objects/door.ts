import { createBatch, releaseObjects, sceneMaterials } from '../build.ts';
import type { Kit } from '../kit.ts';

/** The original three home-door boxes at a real hinge; height follows the scene's avatar and ceiling. */
export function createHingedHomeDoor(kit: Kit, { x, z, width, height = 2.3, handleHeight = height * 1.1 / 2.3, handleOffset = width * 0.3 }: { x: number; z: number; width: number; height?: number; handleHeight?: number; handleOffset?: number }) {
  const object = new kit.THREE.Group(), batch = createBatch(kit.THREE);
  object.name = 'home-door-leaf'; object.position.set(x, 0, z - width / 2);
  batch.box(0.03, height / 2, width / 2, 0.07, height, width, '#5f4a36');
  batch.box(0.075, height / 2 - 0.03, width / 2, 0.02, height - 0.2, width - 0.16, '#8a623d');
  batch.box(0.11, handleHeight, width / 2 + handleOffset, 0.05, 0.07, 0.07, '#d8c27a');
  const handle = new kit.THREE.Vector3();
  const meshes = batch.build(sceneMaterials(kit)).meshes;
  for (const mesh of meshes) object.add(mesh);
  let elapsed = 0, length = 2.4, finish: (() => void) | null = null;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  function complete() { const done = finish; finish = null; object.rotation.y = 0; done?.(); }
  return {
    object,
    get easing() { return finish !== null; },
    get progress() { return Math.min(1, elapsed / length); },
    handlePosition() { object.updateWorldMatrix(true, false); return object.localToWorld(handle.set(0.11, handleHeight, width / 2 + handleOffset)); },
    begin(done: () => void, duration = 2.4) { elapsed = 0; length = duration; finish = done; object.rotation.y = 0; },
    step(dt: number) {
      if (!finish) return false;
      elapsed += Math.max(0, dt);
      if (elapsed >= length) { complete(); return false; }
      const t = elapsed / length, opening = t < 0.22 ? 0 : t < 0.5 ? smooth((t - 0.22) / 0.28) : t < 0.75 ? 1 : smooth((1 - t) / 0.25);
      object.rotation.y = -Math.PI / 2 * opening;
      return true;
    },
    settle: complete,
    cancel() { finish = null; object.rotation.y = 0; },
    dispose() { finish = null; releaseObjects(meshes); object.removeFromParent(); },
  };
}
