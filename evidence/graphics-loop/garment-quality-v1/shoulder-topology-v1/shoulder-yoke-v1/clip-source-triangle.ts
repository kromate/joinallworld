/** Evidence-only convex clipping primitive for source-surface yoke faces. */
export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Influence = readonly [number, number];
export type ClipCorner = Readonly<{ position: Vec3; normal: Vec3; uv: Vec2; influences: readonly Influence[]; barycentric: readonly [number, number, number] }>;
export type ClipPlane = Readonly<{ normal: Vec3; offset: number; keep: 'positive' | 'negative' }>;
export type ClippedTriangle = Readonly<{ sourceFace: number; corners: readonly [ClipCorner, ClipCorner, ClipCorner] }>;
const mix3=(a:Vec3,b:Vec3,t:number):Vec3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=(a:Vec3):Vec3=>{const n=Math.hypot(...a);if(!(Number.isFinite(n)&&n>1e-12))throw new Error('Clipped source normal is degenerate');return[a[0]/n,a[1]/n,a[2]/n];};
function interpolate(a:ClipCorner,b:ClipCorner,t:number):ClipCorner{
  const combined=new Map<number,number>();for(const [i,w]of a.influences)combined.set(i,(combined.get(i)??0)+w*(1-t));for(const [i,w]of b.influences)combined.set(i,(combined.get(i)??0)+w*t);
  const entries=[...combined].filter(([,w])=>w>1e-8).sort((x,y)=>y[1]-x[1]).slice(0,4),sum=entries.reduce((n,e)=>n+e[1],0);if(!(Number.isFinite(sum)&&sum>0))throw new Error('Clipped vertex has no skin influence');
  const barycentric=a.barycentric.map((v,i)=>v+(b.barycentric[i]!-v)*t) as [number,number,number];
  return{position:mix3(a.position,b.position,t),normal:unit(mix3(a.normal,b.normal,t)),uv:[a.uv[0]+(b.uv[0]-a.uv[0])*t,a.uv[1]+(b.uv[1]-a.uv[1])*t],influences:entries.map(([i,w])=>[i,w/sum] as const),barycentric};
}
function sd(p:Vec3,plane:ClipPlane){const d=dot(plane.normal,p)+plane.offset;return plane.keep==='positive'?d:-d;}
/** Clip one indexed source triangle against convex halfspaces; face identity and barycentrics survive. */
export function clipSourceTriangle(sourceFace:number,input:readonly[ClipCorner,ClipCorner,ClipCorner],planes:readonly ClipPlane[],epsilon=1e-8):ClippedTriangle[]{
  if(!Number.isInteger(sourceFace)||sourceFace<0||!Number.isFinite(epsilon)||epsilon<0)throw new Error('Invalid clipping input');
  let polygon=[...input];
  for(const plane of planes){if(!(Math.hypot(...plane.normal)>1e-12&&Number.isFinite(plane.offset)))throw new Error('Invalid clipping plane');const output:ClipCorner[]=[];
    for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,da=sd(a.position,plane),db=sd(b.position,plane),ia=da>=-epsilon,ib=db>=-epsilon;if(ia)output.push(a);if(ia!==ib){const den=da-db;if(Math.abs(den)<1e-15)throw new Error('Unstable clipping intersection');output.push(interpolate(a,b,Math.max(0,Math.min(1,da/den))));}}
    polygon=output;if(polygon.length<3)return[];
  }
  const result:ClippedTriangle[]=[];for(let i=1;i+1<polygon.length;i++)result.push({sourceFace,corners:[polygon[0]!,polygon[i]!,polygon[i+1]!]});return result;
}
