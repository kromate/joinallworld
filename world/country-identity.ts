import { validateInventory } from './inventory.ts';
import type { InventoryNode, WorldInventory } from './production-types.ts';
import type { CountryIdentityComparison } from './country-types.ts';

const NE_ID = /^NE_ID:(0|-?[1-9][0-9]*)$/;
function compareCodepoints(left: string, right: string): number {
  const a=Array.from(left,character=>character.codePointAt(0)!);
  const b=Array.from(right,character=>character.codePointAt(0)!);
  for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]!==b[i]) return a[i]!-b[i]!;
  return a.length-b.length;
}
function canonical(value: unknown): string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('country identity metadata contains a non-finite number');return JSON.stringify(value);}
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object'){
    const record=value as Record<string,unknown>;
    return `{${Object.keys(record).sort(compareCodepoints).map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('country identity metadata is not JSON data');
}
interface BoundCountry { node: InventoryNode; featureKey: string; countryId: string }

function bindInventory(inventory: WorldInventory, label: string): Map<string,BoundCountry> {
  validateInventory(inventory);
  if(inventory.sources.length!==1)throw new TypeError(`${label} inventory must have exactly one pinned source`);
  const sourceId=inventory.sources[0]!.id;
  const assigned=new Map<string,BoundCountry>();
  let nigeria=0;
  for(const node of inventory.nodes){
    if(node.kind!=='country'){
      if(node.sourceFeatureIds.length)throw new Error(`${label} non-country node carries a source feature assignment`);
      continue;
    }
    if(node.sourceFeatureIds.length!==1)throw new Error(`${label} country ${node.id} must own exactly one source feature`);
    const reference=node.sourceFeatureIds[0]!;
    const prefix=`${sourceId}:`;
    if(!reference.startsWith(prefix))throw new Error(`${label} country source reference does not use the unique pinned source ID`);
    const featureKey=reference.slice(prefix.length);
    const match=NE_ID.exec(featureKey);
    if(!match)throw new TypeError(`${label} country source feature key must be an exact NE_ID safe integer`);
    const numeric=Number(match[1]);
    if(!Number.isSafeInteger(numeric)||String(numeric)!==match[1])throw new TypeError(`${label} country NE_ID is not a canonical safe integer`);
    const isNigeria=node.countryCode==='NG';
    const expectedId=isNigeria?'legacy-ng':`country:natural-earth:${encodeURIComponent(featureKey)}`;
    if(node.id!==expectedId)throw new Error(`${label} country ID does not match its stable NE_ID identity: ${featureKey}`);
    if(isNigeria){
      nigeria++;
      if(node.provider!=='legacy-ng'||node.outline!=='missing'||inventory.outlines.some(outline=>outline.nodeId===node.id))throw new Error(`${label} Nigeria must remain the protected no-outline legacy provider`);
    }else if(node.provider!=='world')throw new Error(`${label} non-Nigeria country has a protected or unsupported provider`);
    if(assigned.has(featureKey))throw new Error(`${label} repeats Natural Earth source feature key ${featureKey}`);
    assigned.set(featureKey,{node,featureKey,countryId:expectedId});
  }
  if(nigeria!==1)throw new Error(`${label} inventory must contain exactly one source-backed protected Nigeria country`);
  if(assigned.size!==inventory.sourceUnitCount)throw new Error(`${label} source units are not each assigned to exactly one country`);
  return assigned;
}

/** Compare source-feature country identity across two independently validated inventories. */
export function compareCountryIdentities(baselineValue: WorldInventory, candidateValue: WorldInventory): CountryIdentityComparison {
  const baseline=bindInventory(baselineValue,'baseline');
  const candidate=bindInventory(candidateValue,'candidate');
  const retained:CountryIdentityComparison['retained']=[];
  const added:CountryIdentityComparison['added']=[];
  const missing:CountryIdentityComparison['missing']=[];
  for(const key of [...baseline.keys()].sort(compareCodepoints)){
    const before=baseline.get(key)!;const after=candidate.get(key);
    if(!after){missing.push({featureKey:key,countryId:before.countryId,name:before.node.name});continue;}
    if(before.countryId!==after.countryId)throw new Error(`retained source feature key changed country identity: ${key}`);
    const metadataChanged=before.node.name!==after.node.name||before.node.parentId!==after.node.parentId
      ||before.node.countryCode!==after.node.countryCode||canonical(before.node.bounds)!==canonical(after.node.bounds);
    retained.push({featureKey:key,countryId:before.countryId,baselineName:before.node.name,candidateName:after.node.name,metadataChanged});
  }
  for(const key of [...candidate.keys()].sort(compareCodepoints)){
    if(!baseline.has(key)){const entry=candidate.get(key)!;added.push({featureKey:key,countryId:entry.countryId,name:entry.node.name});}
  }
  if(baseline.size!==retained.length+missing.length||candidate.size!==retained.length+added.length)throw new Error('country identity comparison does not conserve source units');
  const exceptions=missing.map(entry=>`Baseline feature ${entry.featureKey} (${entry.countryId}) is missing from candidate; no replacement ID or migration was inferred.`);
  return {schemaVersion:1,baselineSourceId:baselineValue.sources[0]!.id,candidateSourceId:candidateValue.sources[0]!.id,
    baselineUnits:baselineValue.sourceUnitCount,candidateUnits:candidateValue.sourceUnitCount,retained,added,missing,protectedCountryId:'legacy-ng',exceptions};
}
