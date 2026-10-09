import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readDist, startupFiles, firstPaintFiles, measure as measureFiles, addSizes } from '../../../scripts/download-budget.ts';
async function measure(root, budgetPath) {
 const report=JSON.parse(await readFile(budgetPath,'utf8'));
 const dist=readDist(root);
 const startup=startupFiles(dist,'lagos') ?? firstPaintFiles(dist);
 const startupSize=measureFiles(dist,startup);
 const groups=report.lazyGroups;
 if(!Array.isArray(groups) || groups.some(g=>!Number.isInteger(g.files) || ['raw','gzip','brotli'].some(k=>!Number.isFinite(g.size[k])))) throw new Error('Invalid exact-build lazy budget groups');
 const files=startup.size+groups.reduce((n,g)=>n+g.files,0);
 const all=addSizes([startupSize,...groups.map(g=>g.size)]);
 const actualRaw=[...dist.values()].reduce((n,b)=>n+b.length,0);
 if(files!==dist.size || all.raw!==actualRaw) throw new Error(`Exact budget partition disagrees with emitted build: files ${files}/${dist.size}, raw ${all.raw}/${actualRaw}`);
 return {root,files,all,measurement:'Existing exact-build quality11 budget lazy groups plus independently measured Lagos startup; partition checked against every emitted file count/raw byte',
  graphics:[...dist].filter(([name])=>/\.(glb|gltf|jpg|jpeg|png|ktx2)$/.test(name)).map(([name,b])=>({path:name,raw:b.length,sha256:createHash('sha256').update(b).digest('hex')})),
  graphicsGroups:groups.filter(g=>/\.(glb|gltf|jpg|jpeg|png|ktx2) files$/.test(g.group))};
}
const baseline=await measure('/tmp/graphics-baseline-dist','/tmp/graphics-baseline-budget.json');
const candidate=await measure('/tmp/graphics-native-dist','/tmp/graphics-native-budget.json');
console.log(JSON.stringify({scope:'exact production baseline versus native release source; aggregate compressed distribution is not first-journey or phone-performance proof',baseline,candidate,change:Object.fromEntries(['raw','gzip','brotli'].map(k=>[k,candidate.all[k]-baseline.all[k]]))},null,2));
