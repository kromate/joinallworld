import { FURNITURE } from '../content/furniture.ts';
import { HOUSE_DESIGNS } from '../content/world.ts';
import { homeOf } from '../content/housing.ts';
import { housesFor } from '../cities/housingRuntime.ts';
import { footprint, plotOf, doorSlot, windowSlot } from '../home-layout.ts';
import { planOf, wallsOf } from '../home-plan.ts';
import type { LifeState } from '../../types/life.ts';
import type { BuildingDraft, BuildingPiece, GridEdge, LegacyBlueprint, MaterialCounts, MaterialQuote } from '../../types/building.ts';

export const BUILDING = Object.freeze({ beta: true, plotWidthMetres: 12, plotDepthMetres: 16, cellMetres: 0.5, floors: 3, units: 6, pieces: 256, rooms: 96, plots: 4 });
export const BUILD_PRICES = Object.freeze({ beta: true, wall: 5000, window: 8000, door: 10000, stairs: 40000, roof: 500 });
export const edgeCells = (edge: GridEdge): { x: number; y: number; axis: 'x' | 'y' }[] => Array.from({ length: edge.length }, (_, index) => ({ x: edge.x + (edge.axis === 'x' ? index : 0), y: edge.y + (edge.axis === 'y' ? index : 0), axis: edge.axis }));
/** Two-metre wall kit modules: shorter runs still use one module. Moving pieces reuses material. */
export function materialCounts(draft: BuildingDraft): MaterialCounts {
  const count: MaterialCounts = { wall: 0, window: 0, door: 0, stairs: 0, roof: 0 };
  for (const piece of draft.pieces) {
    if (piece.kind === 'wall') count.wall += 1;
    else if (piece.kind === 'roof') count.roof += piece.w * piece.h;
    else count[piece.kind] += 1;
  }
  return count;
}
/** Call only with compiler-validated drafts. Removed material never credits cash. */
export function quoteMaterialDiff(before: BuildingDraft, after: BuildingDraft): MaterialQuote {
  const a = materialCounts(before), b = materialCounts(after), added: MaterialCounts = { wall: 0, window: 0, door: 0, stairs: 0, roof: 0 };
  let total = 0;
  for (const kind of ['wall', 'window', 'door', 'stairs', 'roof'] as const) { added[kind] = Math.max(0, b[kind] - a[kind]); total += added[kind] * BUILD_PRICES[kind]; }
  return { before: a, after: b, added, total, demolitionRefund: 0, beta: true };
}

/** One existing furniture cell becomes one construction cell, with an explicit primary-lot origin. */
export function buildLegacyBlueprint(state: LifeState): LegacyBlueprint {
  const home = homeOf(state, HOUSE_DESIGNS, housesFor(state.estate.city)), plan = planOf(plotOf(home.grid, home.owned)), rooms = plan.floors.flatMap((floor, level) => floor.map((room, index) => ({ ...room, x: room.x + 2, y: room.y + 2, id: `legacy-room-${level}-${index}`, floor: level })));
  const pieces: BuildingPiece[] = [];
  let sequence = 0;
  const putEdge = (kind: 'wall' | 'door' | 'window', floor: number, edge: GridEdge, id = `legacy-piece-${sequence++}`) => pieces.push({ id, kind, floor, edge });
  const addRun = (floor: number, edge: GridEdge) => {
    for (let index = 0; index < edge.length; index += 4) putEdge('wall', floor, { x: edge.x + (edge.axis === 'x' ? index : 0), y: edge.y + (edge.axis === 'y' ? index : 0), axis: edge.axis, length: Math.min(4, edge.length - index) });
  };
  for (let floor = 0; floor < plan.floors.length; floor++) {
    addRun(floor, { axis: 'x', x: 2, y: 2, length: plan.plot.w });
    addRun(floor, { axis: 'x', x: 2, y: 2 + plan.plot.d, length: plan.plot.w });
    addRun(floor, { axis: 'y', x: 2, y: 2, length: plan.plot.d });
    addRun(floor, { axis: 'y', x: 2 + plan.plot.w, y: 2, length: plan.plot.d });
    for (const wall of wallsOf(plan, floor)) addRun(floor, { x: wall.x0 + 2, y: wall.y0 + 2, axis: wall.x0 === wall.x1 ? 'y' : 'x', length: Math.abs(wall.x1 - wall.x0) + Math.abs(wall.y1 - wall.y0) });
    // Fill each generated inner doorway with a wall frame and an opening on it.
    const floorRooms = plan.floors[floor]!;
    for (let a = 0; a < floorRooms.length; a++) for (let b = a + 1; b < floorRooms.length; b++) {
      const r = floorRooms[a]!, s = floorRooms[b]!;
      let edge: GridEdge | null = null;
      if (r.x + r.w === s.x || s.x + s.w === r.x) { const lo = Math.max(r.y, s.y), hi = Math.min(r.y + r.h, s.y + s.h); if (hi > lo) edge = { axis: 'y', x: Math.max(r.x, s.x) + 2, y: lo + 2 + Math.floor((hi - lo - (hi - lo >= 4 ? 2 : 1)) / 2), length: hi - lo >= 4 ? 2 : 1 }; }
      else if (r.y + r.h === s.y || s.y + s.h === r.y) { const lo = Math.max(r.x, s.x), hi = Math.min(r.x + r.w, s.x + s.w); if (hi > lo) edge = { axis: 'x', x: lo + 2 + Math.floor((hi - lo - (hi - lo >= 4 ? 2 : 1)) / 2), y: Math.max(r.y, s.y) + 2, length: hi - lo >= 4 ? 2 : 1 }; }
      if (edge) { addRun(floor, edge); putEdge('door', floor, edge); }
    }
    putEdge('window', floor, { axis: 'x', x: windowSlot(home.grid) + 2, y: 2, length: 1 });
  }
  putEdge('door', 0, { axis: 'y', x: 2, y: doorSlot(home.grid) + 2, length: 1 }, 'legacy-front-door');
  for (const stairs of plan.stairs) pieces.push({ ...stairs, x: stairs.x + 2, y: stairs.y + 2, id: `legacy-piece-${sequence++}`, kind: 'stairs' });
  const furniture = state.home.items.map((item) => ({ ...item }));
  const occupancy = furniture.flatMap((item) => { const def = FURNITURE[item.itemId]; if (!def || def.wall) return []; const size = footprint(def, item.rot); return [{ id: item.id, x: item.x + 2, y: item.y + 2, w: size.w, h: size.h, floor: item.floor ?? 0, solid: def.shape !== 'rug' && def.shape !== 'mat' }]; });
  return { draft: { rooms, pieces, units: [{ id: 'legacy-home', roomIds: rooms.map((room) => room.id), doorId: 'legacy-front-door' }] }, furniture, storage: { ...state.home.storage }, ...(state.home.overflow ? { overflow: { ...state.home.overflow } } : {}), occupancy, transform: { origin: { x: 2, y: 2 }, cellsPerFurnitureCell: 1, cellMetres: BUILDING.cellMetres } };
}
