import { createWalkGrid } from '../../scene/walk-grid.ts';
import type { WalkCircle, WalkGrid, WalkPoint, WalkRect } from '../../scene/walk-grid.ts';
import { CAMPUS_MAP } from './map.generated.ts';
import { pointInRing } from './geo.ts';
import type { MetreRing } from './geo.ts';
import { ANCHORS, ZONES, zoneAtPoint } from './layout.ts';
import type { CampusZone } from './layout.ts';
import { CAMPUS_TREES } from './landscape.ts';

export interface CampusWalk { grids:Map<string,WalkGrid>; zoneAt:(x:number,z:number)=>CampusZone|null; route:(from:WalkPoint,to:WalkPoint)=>WalkPoint[]|null }
const CELL=2, RADIUS=.4;
const distanceToRing=(x:number,z:number,ring:MetreRing):number=>{
  let best=Infinity;
  for(let index=1;index<ring.length;index++){const [ax,az]=ring[index-1]!,[bx,bz]=ring[index]!,dx=bx-ax,dz=bz-az;const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}
  return best;
};
const blockedBy=(x:number,z:number,ring:MetreRing)=>pointInRing([x,z],ring)||distanceToRing(x,z,ring)<=RADIUS;

export function createGeographicCampusWalk(extraFootprints:Record<string,Array<WalkRect|WalkCircle>>={}):CampusWalk{
  const gateColumns:WalkRect[]=[[-1.5,-2.5,1.5,2.5],[-1.5,-16.7,1.5,-15.3],[-1.5,15.3,1.5,16.7]];
  const treeTrunks:WalkCircle[]=CAMPUS_TREES.map(tree=>[tree.x,tree.z,.45*tree.size]);
  const grid=createWalkGrid({bounds:[CAMPUS_MAP.bounds[0],CAMPUS_MAP.bounds[1],CAMPUS_MAP.bounds[2],CAMPUS_MAP.bounds[3]],block:[...gateColumns,...treeTrunks,...Object.values(extraFootprints).flat()],cell:CELL,radius:RADIUS});
  const [minX,minZ]=grid.bounds;
  // A trunk smaller than the cell diagonal may contain no cell centre; always
  // claim its containing cell so the rendered trunk cannot be walked through.
  for(const tree of CAMPUS_TREES){const column=Math.floor((tree.x-minX)/grid.cell),row=Math.floor((tree.z-minZ)/grid.cell);if(column>=0&&row>=0&&column<grid.cols&&row<grid.rows)grid.cells[row*grid.cols+column]=1;}
  for(let row=0;row<grid.rows;row++){
    const z=minZ+(row+.5)*grid.cell, crossings:number[]=[];
    for(let index=1;index<CAMPUS_MAP.boundary.length;index++){
      const [ax,az]=CAMPUS_MAP.boundary[index-1]!,[bx,bz]=CAMPUS_MAP.boundary[index]!;
      if((az>z)===(bz>z))continue;
      crossings.push(ax+(bx-ax)*(z-az)/(bz-az));
    }
    crossings.sort((a,b)=>a-b);
    for(let column=0;column<grid.cols;column++){
      const x=minX+(column+.5)*grid.cell;let inside=false;
      for(let index=0;index+1<crossings.length;index+=2)if(x>=crossings[index]!&&x<=crossings[index+1]!){inside=true;break;}
      if(!inside)grid.cells[row*grid.cols+column]=1;
    }
  }
  for(const feature of [...CAMPUS_MAP.buildings,...CAMPUS_MAP.surfaces.filter(surface=>surface.kind==='water'||surface.kind==='wetland'||surface.kind==='pool')]){
    const ring=feature.ring,xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
    const c0=Math.max(0,Math.floor((Math.min(...xs)-RADIUS-minX)/grid.cell)),c1=Math.min(grid.cols-1,Math.floor((Math.max(...xs)+RADIUS-minX)/grid.cell));
    const r0=Math.max(0,Math.floor((Math.min(...zs)-RADIUS-minZ)/grid.cell)),r1=Math.min(grid.rows-1,Math.floor((Math.max(...zs)+RADIUS-minZ)/grid.cell));
    for(let row=r0;row<=r1;row++)for(let column=c0;column<=c1;column++){const x=minX+(column+.5)*grid.cell,z=minZ+(row+.5)*grid.cell;if(blockedBy(x,z,ring))grid.cells[row*grid.cols+column]=1;}
  }
  const grids=new Map(ZONES.map(zone=>[zone.id,grid]));
  const zoneAt=(x:number,z:number)=>Number.isFinite(x)&&Number.isFinite(z)?zoneAtPoint(x,z):null;
  for(const anchor of Object.values(ANCHORS)){
    if(grid.free(anchor.x,anchor.z))continue;
    const nearest=grid.nearest(anchor.x,anchor.z,20);if(!nearest)continue;
    anchor.x=nearest.x;anchor.z=nearest.z;anchor.zone=zoneAt(nearest.x,nearest.z)?.id??anchor.zone;
  }
  const route=(from:WalkPoint,to:WalkPoint):WalkPoint[]|null=>{
    if(!zoneAt(from.x,from.z)||!zoneAt(to.x,to.z)||!grid.free(from.x,from.z)||!grid.free(to.x,to.z))return null;
    if(from.x===to.x&&from.z===to.z)return [];
    const path=grid.path(from.x,from.z,to.x,to.z),last=path?.at(-1);
    return path&&last&&Math.abs(last.x-to.x)<1e-7&&Math.abs(last.z-to.z)<1e-7?path:null;
  };
  return {grids,zoneAt,route};
}
