import { createBatch, releaseObjects, sceneMaterials } from '../build.ts';
import type { Kit } from '../kit.ts';
import type { SkinnedBody } from '../body/skinned.ts';
import type { ObjectAction } from './sequence.ts';

/** Rigid original props follow sampled wrists; surface geometry remains fitted to the actual furniture. */
export function createUseProps(kit: Kit) {
  const object = new kit.THREE.Group(), held = new kit.THREE.Group(), leftHeld = new kit.THREE.Group(), surface = new kit.THREE.Group();
  const point = new kit.THREE.Vector3(), headPoint = new kit.THREE.Vector3();
  object.name = 'object-use-props'; held.name = 'right-hand-prop'; leftHeld.name = 'left-hand-prop'; object.visible = false;
  let key = '', right: ReturnType<typeof object.getObjectByName>, left: typeof right, head: typeof right;
  let meshes: ReturnType<ReturnType<typeof createBatch>['build']>['meshes'] = [];
  function build(action: ObjectAction) {
    releaseObjects(meshes); object.clear(); held.clear(); leftHeld.clear(); surface.clear(); meshes = [];
    const prop = createBatch(kit.THREE), tool = createBatch(kit.THREE), bowl = createBatch(kit.THREE), water = createBatch(kit.THREE);
    if (action.pose === 'bucket') {
      tool.cyl(0, -0.014, 0, 0.065, 0.035, '#d9574f', { seg: 12, open: true });
      tool.cyl(0, 0.002, 0, 0.055, 0.006, '#8fc6d8', { seg: 12 });
      tool.ball(0.04, 0.008, 0, 0.024, 0.014, 0.024, '#f3f1ea', { seg: 6 });
    } else if (action.pose === 'eat') {
      bowl.cyl(0.03, -0.025, 0.03, 0.13, 0.08, '#d9574f', { seg: 12, open: true });
      bowl.cyl(0.03, -0.005, 0.03, 0.11, 0.008, '#e3d5b1', { seg: 12 });
      tool.box(0.055, -0.0375, 0.055, 0.008, 0.01, 0.17, '#c9cdd0', { rx: -0.6, ry: Math.PI / 4 });
      tool.ball(0.11, -0.075, 0.11, 0.025, 0.007, 0.03, '#e3d5b1', { seg: 6 });
    } else if (action.pose === 'drink') {
      tool.cyl(0, -0.07, 0.035, 0.055, 0.12, '#9d4656', { seg: 12, open: true });
      tool.cyl(0, -0.01, 0.035, 0.046, 0.006, '#7d283d', { seg: 12 });
    } else if (action.pose === 'cook' || action.pose === 'cookLow') {
      const y = action.pose === 'cookLow' ? 0.79 : 1;
      prop.cyl(-0.16, y - 0.027, 0.48, 0.18, 0.144, '#55595e', { seg: 14, open: true });
      prop.cyl(-0.16, y, 0.48, 0.15, 0.008, '#c87535', { seg: 14 });
      prop.box(0.08, y, 0.48, 0.11, 0.035, 0.045, '#35383c');
      tool.cyl(0, -0.07, 0, 0.008, 0.14, '#d9c8a2', { seg: 6 });
      tool.ball(0, -0.14, 0, 0.027, 0.008, 0.035, '#d9c8a2', { seg: 6 });
    }
    if (action.surface) {
      const { w, d } = action.surface;
      if (action.pose === 'soak') {
        water.box(0, 0, 0, w * 0.65, 0.035, d * 0.65, '#edf3f1');
        for (const x of [-0.28, 0, 0.28]) water.ball(x * w, 0.025, 0.08 * d, w * 0.12, 0.04, d * 0.14, '#ffffff', { seg: 6 });
      } else {
        for (const x of [-0.07, 0.03, 0.1]) water.cyl(x * w, -0.6 * d, 0, 0.009, 1.2 * d, '#a9dae4', { seg: 4, layer: 'glass' });
        water.ball(0, -1.15 * d, 0, w * 0.25, 0.035, d * 0.2, '#f2f6f4', { seg: 6 });
      }
    } else if (action.table && (action.pose === 'eat' || action.pose === 'drink')) water.cyl(0, 0.012, 0, 0.13, 0.024, '#f3f1ea', { seg: 12 });
    const add = (batch: typeof prop, parent: typeof object) => { for (const mesh of batch.build(sceneMaterials(kit)).meshes) { parent.add(mesh); meshes.push(mesh); } };
    add(prop, object); add(tool, held); add(bowl, leftHeld); add(water, surface); object.add(held, leftHeld, surface);
  }
  function atBone(node: typeof right, target: typeof held) {
    if (node) { node.getWorldPosition(point); object.worldToLocal(point); target.position.copy(point); }
  }
  return {
    object,
    update(action: ObjectAction, body: SkinnedBody | null) {
      if (!body && !action.surface) { object.visible = false; return; }
      const next = `${action.id}|${body?.key ?? 'fallback'}`;
      if (next !== key) { key = next; build(action); right = body?.object.getObjectByName('hand_r'); left = body?.object.getObjectByName('hand_l'); head = body?.object.getObjectByName('Head'); }
      const sx = body?.scaleX ?? 1, sy = body?.scale ?? 1, sz = body?.scaleZ ?? 1;
      object.visible = true;
      if (action.use.kind === 'floor') object.position.set(action.use.x, action.use.y + 0.045 * sy, action.use.z);
      else object.position.copy(body?.object.position ?? point.set(action.use.x, action.use.top, action.use.z));
      if (action.table && (action.pose === 'cook' || action.pose === 'cookLow')) {
        const bottom = (action.pose === 'cookLow' ? 0.79 : 1) - 0.099;
        object.position.y = action.table.y - bottom * sy;
      }
      object.rotation.y = action.use.ry; object.scale.set(sx, sy, sz);
      if (body) {
        body.object.updateWorldMatrix(true, true); atBone(right, held); atBone(left, leftHeld);
        if (head && action.pose === 'eat') {
          head.getWorldPosition(headPoint); object.worldToLocal(headPoint);
          const up = Math.min(1, Math.max(0, (held.position.y - 1.15) / Math.max(0.05, headPoint.y - 0.05 - 1.15)));
          held.rotation.x = -Math.PI / 2 * up;
        } else held.rotation.x = 0;
      }
      const fixed = action.surface ?? action.table;
      surface.visible = Boolean(fixed);
      if (fixed) {
        point.set(fixed.x, fixed.y, fixed.z); object.parent?.localToWorld(point); object.worldToLocal(point);
        surface.position.copy(point); surface.rotation.y = fixed.ry - object.rotation.y; surface.scale.set(1 / sx, 1 / sy, 1 / sz);
      }
    },
    hide() { object.visible = false; },
    dispose() { releaseObjects(meshes); meshes = []; object.removeFromParent(); },
  };
}
