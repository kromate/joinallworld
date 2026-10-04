import './register-dependencies.mjs';
import { writeFile,readFile,mkdir } from 'node:fs/promises';
const {buildVehicle,VEHICLE_TYPES,VEHICLE_DETAILS}=await import('../vehicles/index.js');
const {buildPerson,LOOK_OPTIONS,DETAILS}=await import('../people/index.js');
const {buildEnvironment,ENVIRONMENT_TYPES}=await import('../environment/index.js');
const {loadGeography,buildGeography,GEOGRAPHY_LEVELS}=await import('../geo/index.js');
const measure=model=>{const result={triangles:model.userData.triangles,drawCalls:model.userData.drawCalls};model.userData.dispose();return result;};
const report={vehicles:{},environment:{},people:{},geography:{}};
for(const type of VEHICLE_TYPES)report.vehicles[type]=Object.fromEntries(VEHICLE_DETAILS.map(detail=>[detail,measure(buildVehicle(type,{detail}))]));
for(const type of ENVIRONMENT_TYPES)report.environment[type]=Object.fromEntries(VEHICLE_DETAILS.map(detail=>[detail,measure(buildEnvironment(type,{detail}))]));
for(const detail of DETAILS){let min=Infinity,max=0,maxCalls=0,count=0;
  for(const body of LOOK_OPTIONS.body)for(const hair of LOOK_OPTIONS.hair[body])for(const outfit of LOOK_OPTIONS.outfit[body])for(const fabric of LOOK_OPTIONS.fabric){
    const value=measure(buildPerson({body,hair,outfit,fabric,accessories:['glasses','headwrap','chain','watch','backpack']},{detail,marker:'crown'}));min=Math.min(min,value.triangles);max=Math.max(max,value.triangles);maxCalls=Math.max(maxCalls,value.drawCalls);count++;
  }
  report.people[detail]={min,max,maxCalls,combinations:count,rigged:measure(buildPerson({body:'woman',hair:'braids',outfit:'casual'},{detail,rig:true}))};
}
for(const level of GEOGRAPHY_LEVELS){const data=await loadGeography(level);report.geography[level]={...measure(buildGeography(data)),features:data.features.length,bytes:(await readFile(new URL(`../geo/data/${level}.js`,import.meta.url))).byteLength};}
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/measurements.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
