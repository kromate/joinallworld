import './register-dependencies.ts';
import type { BodyId } from '../people/index.ts';
import { writeFile,readFile,mkdir } from 'node:fs/promises';
const {buildVehicle,VEHICLE_TYPES,VEHICLE_DETAILS}=await import('../vehicles/index.ts');
const {buildPerson,LOOK_OPTIONS,DETAILS}=await import('../people/index.ts');
const {buildEnvironment,ENVIRONMENT_TYPES}=await import('../environment/index.ts');
const {loadGeography,buildGeography,GEOGRAPHY_LEVELS}=await import('../geo/index.ts');
/** What the report keeps of a model before it is disposed. */
interface Measure{triangles:number;drawCalls:number}
const measure=(model:{userData:Measure&{dispose:()=>void}}):Measure=>{const result={triangles:model.userData.triangles,drawCalls:model.userData.drawCalls};model.userData.dispose();return result;};
const report:{vehicles:Record<string,Record<string,Measure>>;environment:Record<string,Record<string,Measure>>;people:Record<string,unknown>;geography:Record<string,unknown>}={vehicles:{},environment:{},people:{},geography:{}};
for(const type of VEHICLE_TYPES)report.vehicles[type]=Object.fromEntries(VEHICLE_DETAILS.map(detail=>[detail,measure(buildVehicle(type,{detail}))]));
for(const type of ENVIRONMENT_TYPES)report.environment[type]=Object.fromEntries(VEHICLE_DETAILS.map(detail=>[detail,measure(buildEnvironment(type,{detail}))]));
for(const detail of DETAILS){let min=Infinity,max=0,maxCalls=0,count=0;
  for(const body of LOOK_OPTIONS.body as readonly BodyId[])for(const hair of LOOK_OPTIONS.hair[body])for(const outfit of LOOK_OPTIONS.outfit[body])for(const fabric of LOOK_OPTIONS.fabric){
    const value=measure(buildPerson({body,hair,outfit,fabric,accessories:['glasses','headwrap','chain','watch','backpack']},{detail,marker:'crown'}));min=Math.min(min,value.triangles);max=Math.max(max,value.triangles);maxCalls=Math.max(maxCalls,value.drawCalls);count++;
  }
  report.people[detail]={min,max,maxCalls,combinations:count,rigged:measure(buildPerson({body:'woman',hair:'braids',outfit:'casual'},{detail,rig:true}))};
}
for(const level of GEOGRAPHY_LEVELS){const data=await loadGeography(level);report.geography[level]={...measure(buildGeography(data)),features:data.features.length,bytes:(await readFile(new URL(`../geo/data/${level}.ts`,import.meta.url))).byteLength};}
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/measurements.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
