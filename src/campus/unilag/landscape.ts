import { CAMPUS_MAP } from './map.generated.ts';
import { boundsOf, pointInRing } from './geo.ts';

/** Decorative planting, not a surveyed tree inventory. Shared with collision. */
const footprints=CAMPUS_MAP.buildings.map(b=>({ring:b.ring,bounds:boundsOf(b.ring)}));
const segments=CAMPUS_MAP.roads.flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i]!,b,width:r.width})));
const trees:Array<{x:number;z:number;size:number}>=[];
const [x0,z0,x1,z1]=CAMPUS_MAP.bounds;
for(let x=x0+12;x<x1;x+=27)for(let z=z0+12;z<z1;z+=27){
  const seed=Math.abs(Math.sin(x*12.9898+z*78.233)*43758.5453)%1;
  if(seed>.64)continue;
  const px=x+(seed-.5)*14,pz=z+Math.sin(seed*120)*8;
  if(!pointInRing([px,pz],CAMPUS_MAP.boundary))continue;
  if(CAMPUS_MAP.surfaces.some(s=>pointInRing([px,pz],s.ring)))continue;
  if(footprints.some(({bounds:[a,b,c,d]})=>px>a-7&&px<c+7&&pz>b-7&&pz<d+7))continue;
  if(segments.some(({a:[ax,az],b:[bx,bz],width})=>{
    const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(px-ax-t*dx,pz-az-t*dz)<width/2+7;
  }))continue;
  trees.push({x:px,z:pz,size:.75+seed*.65});
}
export const CAMPUS_TREES=trees;
