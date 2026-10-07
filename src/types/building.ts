import type { PlotAddress, PlacedItem, HomeState } from './life.ts';
import type { Plot } from '../game/home-layout.ts';
import type { HousePlan, PlanStairs, PlanWall } from '../game/home-plan.ts';

/** Provided by registry authority, never reconstructed from a client draft. */
export interface OwnedFootprint { primary: PlotAddress; acknowledgedExtras: readonly PlotAddress[] }
export interface GridRect { x: number; y: number; w: number; h: number }
export interface GridEdge { x: number; y: number; axis: 'x' | 'y'; length: number }
export interface BuildingRoom extends GridRect { id: string; label: string; floor: number }
interface Piece { id: string; floor: number }
export type BuildingPiece =
  | (Piece & { kind: 'wall'; edge: GridEdge })
  | (Piece & { kind: 'door'; edge: GridEdge })
  | (Piece & { kind: 'window'; edge: GridEdge })
  | (Piece & GridRect & { kind: 'stairs'; dir: 1 | -1 })
  | (Piece & GridRect & { kind: 'roof'; style: 'flat' | 'gable' | 'hip' | 'twin' });
export interface BuildingUnit { id: string; roomIds: string[]; doorId: string }
export interface BuildingDraft { rooms: BuildingRoom[]; pieces: BuildingPiece[]; units: BuildingUnit[] }
export interface BuildingEnvelope { v: 1; revision: number; data: string }
export interface BuildingIssue { code: string; id?: string; reason: string }
/** Furniture projected into construction cells; original saved positions are never rewritten here. */
export interface BuildingOccupancy extends GridRect { id: string; floor: number; solid: boolean }
export interface CompileOptions { furniture?: readonly BuildingOccupancy[]; occupiedUnitIds?: readonly string[]; baseline?: BuildingDraft }
export interface BuildingDoor { id: string; floor: number; edge: GridEdge; inside: { x: number; y: number }; outside: { x: number; y: number } }
export interface CompiledBuilding {
  draft: BuildingDraft;
  plot: Plot;
  plan: HousePlan;
  walls: PlanWall[][];
  slabs: GridRect[][];
  stairs: PlanStairs[];
  doors: BuildingDoor[];
  openings: { id: string; floor: number; kind: 'door' | 'window'; edge: GridEdge }[];
  roofs: Extract<BuildingPiece, { kind: 'roof' }>[];
  masks: { slab: ReadonlySet<string>; walls: ReadonlySet<string>; walkWalls: ReadonlySet<string>; doors: ReadonlySet<string>; windows: ReadonlySet<string>; stairs: ReadonlySet<string>; reserved: ReadonlySet<string> };
  /** Translate primary-relative cells to the compiled, zero-based Plot. */
  origin: { x: number; y: number };
  cellMetres: number;
}
export type BuildingResult = { ok: true; value: CompiledBuilding } | { ok: false; issues: BuildingIssue[] };
export interface MaterialCounts { wall: number; window: number; door: number; stairs: number; roof: number }
export interface MaterialQuote { before: MaterialCounts; after: MaterialCounts; added: MaterialCounts; total: number; demolitionRefund: 0; beta: true }
export interface LegacyBlueprint {
  draft: BuildingDraft;
  furniture: PlacedItem[];
  storage: HomeState['storage'];
  overflow?: HomeState['overflow'];
  occupancy: BuildingOccupancy[];
  transform: { origin: { x: number; y: number }; cellsPerFurnitureCell: 1; cellMetres: number };
}
