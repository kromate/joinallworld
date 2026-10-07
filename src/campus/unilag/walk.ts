import type { WalkCircle, WalkGrid, WalkPoint, WalkRect } from '../../scene/walk-grid.ts';
import type { CampusBuilding } from './layout.ts';
import { createGeographicCampusWalk } from './navigation.ts';
import type { CampusWalk } from './navigation.ts';

export type { WalkCircle, WalkGrid, WalkPoint, WalkRect, CampusWalk };
export interface PortalHop { zone:string; portal:import('./layout.ts').Portal }

/** Legacy rectangle view for consumers that have not yet adopted map polygons. */
export function footprintOf(building:CampusBuilding):WalkRect[]{
  if(building.kind==='open-space'||building.kind==='gate'||building.w<=0||building.d<=0)return [];
  return [[building.x-building.w/2,building.z-building.d/2,building.x+building.w/2,building.z+building.d/2]];
}

export function createCampusWalk(extraFootprints:Record<string,Array<WalkRect|WalkCircle>>={}):CampusWalk{return createGeographicCampusWalk(extraFootprints);}
