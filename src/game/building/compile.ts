// Geometry and topology are lazy. This module has no storage, clocks, scene objects or ownership writes.
import { BUILDING, edgeCells } from './model.ts';
import { ESTATE, validPlot } from '../content/world.ts';
import type { BuildingDraft, BuildingIssue, BuildingPiece, BuildingResult, BuildingRoom, BuildingUnit, CompileOptions, GridEdge, GridRect, OwnedFootprint } from '../../types/building.ts';
import type { PlanWall } from '../home-plan.ts';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value);
const floor = (value: unknown): value is number => whole(value) && value >= 0 && value < BUILDING.floors;
const cellKey = (f: number, x: number, y: number) => `${f}:${x},${y}`;
const edgeKey = (f: number, axis: 'x' | 'y', x: number, y: number) => `${f}:${axis}:${x},${y}`;
const eachCell = (rect: GridRect, fn: (x: number, y: number) => void) => { for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) fn(x, y); };
const failed = (code: string, reason: string, itemId?: string): BuildingResult => ({ ok: false, issues: [{ code, reason, ...(itemId ? { id: itemId } : {}) }] });

function rect(value: Record<string, unknown>): GridRect | null {
  const { x, y, w, h } = value;
  return whole(x) && Math.abs(x) <= 96 && whole(y) && y >= 0 && y <= 32 && whole(w) && w > 0 && w <= 96 && whole(h) && h > 0 && h <= 32 ? { x, y, w, h } : null;
}
function readDraft(value: unknown): BuildingDraft | null {
  if (!record(value) || !Array.isArray(value.rooms) || value.rooms.length < 1 || value.rooms.length > BUILDING.rooms || !Array.isArray(value.pieces) || value.pieces.length > BUILDING.pieces || !Array.isArray(value.units) || value.units.length < 1 || value.units.length > BUILDING.units) return null;
  const rooms: BuildingRoom[] = [], pieces: BuildingPiece[] = [], units: BuildingUnit[] = [];
  for (const raw of value.rooms) {
    if (!record(raw) || !id(raw.id) || !floor(raw.floor) || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 32) return null;
    const shape = rect(raw); if (!shape) return null;
    rooms.push({ id: raw.id, floor: raw.floor, label: raw.label, ...shape });
  }
  for (const raw of value.pieces) {
    if (!record(raw) || !id(raw.id) || !floor(raw.floor)) return null;
    const kind = raw.kind;
    if (kind === 'wall' || kind === 'door' || kind === 'window') {
      const e = raw.edge;
      if (!record(e) || !whole(e.x) || Math.abs(e.x) > 96 || !whole(e.y) || e.y < 0 || e.y > 32 || (e.axis !== 'x' && e.axis !== 'y') || !whole(e.length) || e.length < 1 || e.length > 4) return null;
      pieces.push({ id: raw.id, floor: raw.floor, kind, edge: { x: e.x, y: e.y, axis: e.axis, length: e.length } });
    } else if (kind === 'stairs' || kind === 'roof') {
      const shape = rect(raw); if (!shape) return null;
      if (kind === 'stairs') {
        if ((raw.dir !== 1 && raw.dir !== -1) || shape.w < 4 || shape.h < 2 || raw.floor >= BUILDING.floors - 1) return null;
        pieces.push({ id: raw.id, floor: raw.floor, kind, ...shape, dir: raw.dir });
      } else {
        if (raw.style !== 'flat' && raw.style !== 'gable' && raw.style !== 'hip' && raw.style !== 'twin') return null;
        pieces.push({ id: raw.id, floor: raw.floor, kind, ...shape, style: raw.style });
      }
    } else return null;
  }
  for (const raw of value.units) {
    if (!record(raw) || !id(raw.id) || !id(raw.doorId) || !Array.isArray(raw.roomIds) || raw.roomIds.length < 1 || raw.roomIds.length > BUILDING.rooms || !raw.roomIds.every(id)) return null;
    units.push({ id: raw.id, doorId: raw.doorId, roomIds: [...raw.roomIds] });
  }
  return { rooms, pieces, units };
}
function fingerprint(draft: BuildingDraft): string {
  const order = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify([order(draft.rooms).map((r) => [r.id, r.floor, r.label, r.x, r.y, r.w, r.h]), order(draft.pieces).map((p) => p.kind === 'wall' || p.kind === 'door' || p.kind === 'window' ? [p.id, p.kind, p.floor, p.edge.axis, p.edge.x, p.edge.y, p.edge.length] : p.kind === 'stairs' ? [p.id, p.kind, p.floor, p.x, p.y, p.w, p.h, p.dir] : [p.id, p.kind, p.floor, p.x, p.y, p.w, p.h, p.style]), order(draft.units).map((u) => [u.id, [...u.roomIds].sort(), u.doorId])]);
}

/** Primary-relative draft coordinates; extras are already acknowledged by the caller's registry. */
export function compileBlueprint(authority: OwnedFootprint, input: unknown, options: CompileOptions = {}): BuildingResult {
  const primary = authority.primary;
  if (!primary || !validPlot(primary.estate, primary.plot) || typeof primary.lga !== 'string' || !Array.isArray(authority.acknowledgedExtras) || authority.acknowledgedExtras.length >= BUILDING.plots) return failed('invalid_footprint', 'Use the current registry-owned footprint.');
  const plots = [primary, ...authority.acknowledgedExtras], row = Math.floor(primary.plot / ESTATE.plots);
  if (plots.some((p) => !p || p.lga !== primary.lga || p.estate !== primary.estate || !validPlot(p.estate, p.plot) || Math.floor(p.plot / ESTATE.plots) !== row)) return failed('invalid_footprint', 'Plots must touch on the same street.');
  const slots = plots.map((p) => p.plot).sort((a, b) => a - b);
  if (slots.some((p, index) => index > 0 && p !== slots[index - 1]! + 1)) return failed('invalid_footprint', 'Plots must be distinct and contiguous.');
  const width = plots.length * 24, depth = 32, offset = (primary.plot - slots[0]!) * 24;
  const draft = readDraft(input);
  if (!draft) return failed('invalid_draft', 'Check room, unit and kit limits and integer half-metre coordinates.');
  if (options.occupiedUnitIds?.length && (!options.baseline || fingerprint(draft) !== fingerprint(options.baseline))) return failed('occupied_units', 'Structural edits wait until every unit is empty.');
  const ids = new Set<string>();
  for (const item of [...draft.rooms, ...draft.pieces, ...draft.units]) { if (ids.has(item.id)) return failed('duplicate_id', 'Every room, piece and unit needs a distinct ID.', item.id); ids.add(item.id); }
  const rooms = draft.rooms.map((r) => ({ ...r, x: r.x + offset }));
  const pieces: BuildingPiece[] = draft.pieces.map((p) => p.kind === 'wall' || p.kind === 'door' || p.kind === 'window' ? { ...p, edge: { ...p.edge, x: p.edge.x + offset } } : { ...p, x: p.x + offset });
  const inside = (r: GridRect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= depth;
  const slab = new Set<string>(), roomAt = new Map<string, string>(), unitAt = new Map<string, string>();
  let floors = 1;
  for (const room of rooms) {
    if (!inside(room)) return failed('out_of_bounds', 'Build only inside acknowledged lots.', room.id);
    floors = Math.max(floors, room.floor + 1);
    let overlap = false;
    eachCell(room, (x, y) => { const key = cellKey(room.floor, x, y); overlap ||= slab.has(key); slab.add(key); roomAt.set(key, room.id); });
    if (overlap) return failed('room_overlap', 'Rooms cannot overlap.', room.id);
  }
  for (const room of rooms) if (room.floor > 0) {
    let unsupported = false; eachCell(room, (x, y) => { unsupported ||= !slab.has(cellKey(room.floor - 1, x, y)); });
    if (unsupported) return failed('unsupported_floor', 'Upper rooms need a floor directly below them.', room.id);
  }
  const byRoom = new Map(rooms.map((r) => [r.id, r]));
  for (const unit of draft.units) {
    if (new Set(unit.roomIds).size !== unit.roomIds.length) return failed('duplicate_room', 'A unit lists each room once.', unit.id);
    for (const roomId of unit.roomIds) {
      const room = byRoom.get(roomId); if (!room) return failed('missing_room', 'Choose existing rooms.', unit.id);
      let overlap = false; eachCell(room, (x, y) => { const key = cellKey(room.floor, x, y); overlap ||= unitAt.has(key); unitAt.set(key, unit.id); });
      if (overlap) return failed('unit_overlap', 'A room belongs to one unit.', unit.id);
    }
  }
  const walls = new Set<string>(), doorMask = new Set<string>(), windows = new Set<string>(), stairMask = new Set<string>(), reserved = new Set<string>(), roofMask = new Set<string>();
  const openings: { id: string; floor: number; kind: 'door' | 'window'; edge: GridEdge }[] = [];
  const stairs = pieces.filter((p): p is Extract<BuildingPiece, { kind: 'stairs' }> => p.kind === 'stairs');
  const roofs = pieces.filter((p): p is Extract<BuildingPiece, { kind: 'roof' }> => p.kind === 'roof');
  const adjacent = (e: { x: number; y: number; axis: 'x' | 'y' }) => e.axis === 'x' ? [[e.x, e.y - 1], [e.x, e.y]] : [[e.x - 1, e.y], [e.x, e.y]];
  for (const p of pieces) {
    if (p.kind === 'wall' || p.kind === 'door' || p.kind === 'window') {
      for (const e of edgeCells(p.edge)) {
        if (e.x < 0 || e.y < 0 || e.x > width || e.y > depth || (e.axis === 'x' ? e.x >= width : e.y >= depth) || !adjacent(e).some(([x, y]) => slab.has(cellKey(p.floor, x!, y!)))) return failed('invalid_edge', 'Attach kit pieces to a room.', p.id);
        const key = edgeKey(p.floor, e.axis, e.x, e.y), mask = p.kind === 'wall' ? walls : p.kind === 'door' ? doorMask : windows;
        if (mask.has(key) || (p.kind === 'door' && windows.has(key)) || (p.kind === 'window' && doorMask.has(key))) return failed('piece_overlap', 'Pieces of the same kind and openings cannot overlap.', p.id);
        mask.add(key);
      }
      if (p.kind !== 'wall') openings.push({ id: p.id, floor: p.floor, kind: p.kind, edge: p.edge });
    } else {
      if (!inside(p)) return failed('out_of_bounds', 'Keep stairs and roofs inside the lot.', p.id);
    }
  }
  for (const opening of openings) for (const e of edgeCells(opening.edge)) {
    const key = edgeKey(opening.floor, e.axis, e.x, e.y);
    if (!walls.has(key)) return failed('missing_wall', 'A door or window needs its wall frame.', opening.id);
    if (opening.kind === 'window' && adjacent(e).every(([x, y]) => slab.has(cellKey(opening.floor, x!, y!)))) return failed('interior_window', 'Windows belong on exterior walls.', opening.id);
    if (opening.kind === 'door') {
      const neighbors = adjacent(e), units = neighbors.map(([x, y]) => unitAt.get(cellKey(opening.floor, x!, y!)));
      if (units[0] && units[1] && units[0] !== units[1]) return failed('cross_unit_door', 'Unit entrances open onto shared space.', opening.id);
      for (const [x, y] of neighbors) reserved.add(cellKey(opening.floor, x!, y!));
    }
  }
  // Every exposed room edge is a wall or a framed opening; a missing wall cannot grant access.
  for (const room of rooms) for (const e of [...edgeCells({ axis: 'x', x: room.x, y: room.y, length: room.w }), ...edgeCells({ axis: 'x', x: room.x, y: room.y + room.h, length: room.w }), ...edgeCells({ axis: 'y', x: room.x, y: room.y, length: room.h }), ...edgeCells({ axis: 'y', x: room.x + room.w, y: room.y, length: room.h })]) {
    const cells = adjacent(e), owners = cells.map(([x, y]) => unitAt.get(cellKey(room.floor, x!, y!)));
    if ((!cells.every(([x, y]) => slab.has(cellKey(room.floor, x!, y!))) || owners[0] !== owners[1]) && !walls.has(edgeKey(room.floor, e.axis, e.x, e.y))) return failed('unsealed_room', 'Exterior and unit boundaries need walls.', room.id);
  }
  const blocked = new Set<string>([...walls].filter((key) => !doorMask.has(key)));
  const links = new Map<string, string[]>();
  const rail = (f: number, e: GridEdge) => { for (const point of edgeCells(e)) blocked.add(edgeKey(f, point.axis, point.x, point.y)); };
  for (const s of stairs) {
    let invalid = false;
    const stairOwners = new Set<string | undefined>();
    eachCell(s, (x, y) => {
      for (const f of [s.floor, s.floor + 1]) {
        const key = cellKey(f, x, y); invalid ||= !slab.has(key) || stairMask.has(key); stairMask.add(key); reserved.add(key);
        stairOwners.add(unitAt.get(key));
      }
    });
    if (invalid || s.floor + 1 >= floors) return failed('invalid_stairs', 'Stairs need clear room space on both floors.', s.id);
    if (stairOwners.size > 1) return failed('cross_unit_stairs', 'Stairs stay within one unit or shared space.', s.id);
    const foot = s.dir === 1 ? s.x : s.x + s.w, head = s.dir === 1 ? s.x + s.w : s.x;
    for (const f of [s.floor, s.floor + 1]) {
      rail(f, { axis: 'x', x: s.x, y: s.y, length: s.w }); rail(f, { axis: 'x', x: s.x, y: s.y + s.h, length: s.w });
      rail(f, { axis: 'y', x: f === s.floor ? head : foot, y: s.y, length: s.h });
      const approachX = f === s.floor ? (s.dir === 1 ? foot - 1 : foot) : (s.dir === 1 ? head : head - 1);
      for (let y = s.y; y < s.y + s.h; y++) { const key = cellKey(f, approachX, y); if (!slab.has(key)) return failed('stairs_approach', 'Leave a landing at each stair end.', s.id); reserved.add(key); }
    }
    const mid = s.x + Math.floor(s.w / 2);
    for (let y = s.y; y < s.y + s.h; y++) { const a = cellKey(s.floor, mid, y), b = cellKey(s.floor + 1, mid, y); links.set(a, [...(links.get(a) ?? []), b]); links.set(b, [...(links.get(b) ?? []), a]); }
  }
  for (const roof of roofs) {
    let invalid = false; eachCell(roof, (x, y) => { const key = cellKey(roof.floor, x, y); invalid ||= !slab.has(key) || slab.has(cellKey(roof.floor + 1, x, y)) || roofMask.has(key); roofMask.add(key); });
    if (invalid) return failed('invalid_roof', 'Roofs cover supported top-floor cells without overlaps.', roof.id);
  }
  const occupied = new Set<string>();
  if ((options.furniture?.length ?? 0) > 960) return failed('furniture_limit', 'Too many placed objects for a bounded preview.');
  for (const raw of options.furniture ?? []) {
    if (!floor(raw.floor) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.w) || !Number.isFinite(raw.h) || raw.w <= 0 || raw.h <= 0) return failed('invalid_furniture', 'Check the saved furniture footprint.', raw.id);
    const r = { x: Math.floor(raw.x + offset), y: Math.floor(raw.y), w: Math.ceil(raw.x + offset + raw.w) - Math.floor(raw.x + offset), h: Math.ceil(raw.y + raw.h) - Math.floor(raw.y) };
    if (!inside(r)) return failed('furniture_out_of_bounds', 'Preview moving or storing this piece first.', raw.id);
    let conflict = false; eachCell(r, (x, y) => { const key = cellKey(raw.floor, x, y); conflict ||= !slab.has(key) || (raw.solid && reserved.has(key)); if (raw.solid) occupied.add(key); });
    if (conflict) return failed('occupied_egress', 'Keep doors, stairs and landings clear.', raw.id);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if ((x + 1 < r.x + r.w && blocked.has(edgeKey(raw.floor, 'y', x + 1, y))) || (y + 1 < r.y + r.h && blocked.has(edgeKey(raw.floor, 'x', x, y + 1)))) return failed('furniture_wall', 'Preview moving or storing furniture before building its wall.', raw.id);
  }
  const walk = new Set(slab);
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) walk.add(cellKey(0, x, y));
  const gate = cellKey(0, offset + 12, depth - 1);
  if (unitAt.has(gate) || occupied.has(gate)) return failed('blocked_gate', 'Keep shared ground clear at the street entrance.');
  const neighbors = (key: string) => {
    const [fText = '', point = ''] = key.split(':'), [xText = '', yText = ''] = point.split(','), f = Number(fText), x = Number(xText), y = Number(yText);
    return [[x + 1, y, edgeKey(f, 'y', x + 1, y)], [x - 1, y, edgeKey(f, 'y', x, y)], [x, y + 1, edgeKey(f, 'x', x, y + 1)], [x, y - 1, edgeKey(f, 'x', x, y)]].flatMap(([nx, ny, edge]) => typeof nx === 'number' && typeof ny === 'number' && typeof edge === 'string' && !blocked.has(edge) ? [cellKey(f, nx, ny)] : []).concat(links.get(key) ?? []);
  };
  const reach = (unitId: string | null) => {
    const allowed = (key: string) => walk.has(key) && !occupied.has(key) && (!unitAt.has(key) || unitAt.get(key) === unitId);
    const seen = new Set<string>(), queue = [gate]; if (allowed(gate)) seen.add(gate);
    for (let index = 0; index < queue.length; index++) for (const next of neighbors(queue[index]!)) if (allowed(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    return seen;
  };
  const doors = [];
  for (const unit of draft.units) {
    const opening = pieces.find((p) => p.id === unit.doorId);
    if (!opening || opening.kind !== 'door') return failed('missing_unit_door', 'Every unit needs an entrance door.', unit.id);
    const reachable = reach(unit.id);
    let entrance: { x: number; y: number } | undefined, exit: { x: number; y: number } | undefined;
    for (const edge of edgeCells(opening.edge)) {
      const points = adjacent(edge);
      const inside = points.find(([x, y]) => unitAt.get(cellKey(opening.floor, x!, y!)) === unit.id), outside = points.find(([x, y]) => !unitAt.has(cellKey(opening.floor, x!, y!)) && walk.has(cellKey(opening.floor, x!, y!)));
      if (inside && outside && reachable.has(cellKey(opening.floor, inside[0]!, inside[1]!))) { entrance = { x: inside[0]!, y: inside[1]! }; exit = { x: outside[0]!, y: outside[1]! }; break; }
    }
    if (!entrance || !exit) return failed('unreachable_unit_door', 'A unit door must reach the shared yard and street.', unit.id);
    for (const roomId of unit.roomIds) {
      const r = byRoom.get(roomId)!; let unreachable = false, free = 0;
      eachCell(r, (x, y) => { const key = cellKey(r.floor, x, y); if (!occupied.has(key)) { free++; unreachable ||= !reachable.has(key); } });
      if (!free || unreachable) return failed('unreachable_room', 'Every usable room cell needs an exit route.', r.id);
    }
    doors.push({ id: opening.id, floor: opening.floor, edge: opening.edge, inside: entrance, outside: exit });
  }
  const publicReach = reach(null);
  for (const s of stairs) if (!unitAt.has(cellKey(s.floor, s.x, s.y)) && !publicReach.has(cellKey(s.floor, s.x, s.y))) return failed('unreachable_stairs', 'Shared stairs must reach the yard.', s.id);
  const wallRuns: PlanWall[][] = Array.from({ length: floors }, () => []);
  for (const key of walls) {
    if (doorMask.has(key) || windows.has(key)) continue;
    const [fText = '', axis = '', point = ''] = key.split(':'), [xText = '', yText = ''] = point.split(','), f = Number(fText), x = Number(xText), y = Number(yText);
    wallRuns[f]?.push({ x0: x, y0: y, x1: x + (axis === 'x' ? 1 : 0), y1: y + (axis === 'y' ? 1 : 0) });
  }
  const planStairs = stairs.map(({ floor, x, y, w, h, dir }) => ({ floor, x, y, w, h, dir }));
  const plot = { grid: 24, w: width, d: depth, floors, rule: (f: number, cells: [number, number][]) => {
    if (cells.some(([x, y]) => !slab.has(cellKey(f, x, y)))) return 'Keep furniture on a room floor.';
    if (cells.some(([x, y]) => reserved.has(cellKey(f, x, y)))) return 'Keep doors and stairs clear.';
    const covered = new Set(cells.map(([x, y]) => cellKey(f, x, y)));
    for (const [x, y] of cells) if ((covered.has(cellKey(f, x + 1, y)) && blocked.has(edgeKey(f, 'y', x + 1, y))) || (covered.has(cellKey(f, x, y + 1)) && blocked.has(edgeKey(f, 'x', x, y + 1)))) return 'Keep furniture clear of walls.';
    return null;
  } };
  // A stairwell is a hole in the upper slab, while its ramp remains a walkable link.
  for (const s of stairs) eachCell(s, (x, y) => slab.delete(cellKey(s.floor + 1, x, y)));
  const slabs: GridRect[][] = Array.from({ length: floors }, () => []);
  for (let f = 0; f < floors; f++) for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width;) {
      if (!slab.has(cellKey(f, x, y))) { x++; continue; }
      const start = x; while (x < width && slab.has(cellKey(f, x, y))) x++;
      const previous = slabs[f]!.find((r) => r.x === start && r.w === x - start && r.y + r.h === y);
      if (previous) previous.h++; else slabs[f]!.push({ x: start, y, w: x - start, h: 1 });
    }
  }
  return { ok: true, value: { draft, plot, plan: { plot, floors: Array.from({ length: floors }, (_, f) => rooms.filter((r) => r.floor === f).map(({ label, x, y, w, h }) => ({ label, x, y, w, h }))), stairs: planStairs }, walls: wallRuns, slabs, stairs: planStairs, doors, openings, roofs, masks: { slab, walls, walkWalls: blocked, doors: doorMask, windows, stairs: stairMask, reserved }, origin: { x: offset, y: 0 }, cellMetres: BUILDING.cellMetres } };
}
