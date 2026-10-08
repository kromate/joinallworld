import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve('.cache/world-research/pilot/accra.osm');
const output = resolve('world/pilots/accra.geojson');
const xml = await readFile(input, 'utf8');
const nodes = new Map<string, [number, number]>();
for (const match of xml.matchAll(/<node\b([^>]*)\/?>(?:\s*<\/node>)?/g)) {
  const a = match[1] ?? '', id = /\bid="(\d+)"/.exec(a)?.[1], lat = Number(/\blat="([^"]+)"/.exec(a)?.[1]), lon = Number(/\blon="([^"]+)"/.exec(a)?.[1]);
  if (id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(id, [lon, lat]);
}
const features: unknown[] = [];
for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
  const id = /\bid="(\d+)"/.exec(match[1] ?? '')?.[1];
  if (!id) continue;
  const body = match[2] ?? '', refs = [...body.matchAll(/<nd\b[^>]*\bref="(\d+)"[^>]*\/?\s*>/g)].map(x=>nodes.get(x[1]!));
  if (refs.some(p=>!p) || refs.length < 2) continue;
  const tags: Record<string,string> = {};
  for (const tag of body.matchAll(/<tag\b([^>]*)\/?\s*>/g)) {
    const a=tag[1]??'', k=/\bk="([^"]*)"/.exec(a)?.[1], v=/\bv="([^"]*)"/.exec(a)?.[1];
    if(k&&v) tags[k]=v;
  }
  const isBuilding = tags.building !== undefined && tags.building !== 'no';
  const isRoad = tags.highway !== undefined;
  if (!isBuilding && !isRoad) continue;
  const coordinates = refs as [number,number][];
  let geometry: unknown;
  if (isBuilding && coordinates[0]![0] === coordinates.at(-1)![0] && coordinates[0]![1] === coordinates.at(-1)![1]) geometry={type:'Polygon',coordinates:[coordinates]};
  else if(isRoad) geometry={type:'LineString',coordinates};
  else continue;
  const properties: Record<string,string> = {};
  for (const key of ['building','height','building:levels','highway','layer']) if(tags[key]!==undefined) properties[key]=tags[key]!;
  features.push({type:'Feature',id,properties,geometry});
}
features.sort((a,b)=>String((a as {id:string}).id).localeCompare(String((b as {id:string}).id)));
await writeFile(output, `${JSON.stringify({type:'FeatureCollection',metadata:{exceptions:['OSM relations are not resolved by this way-based pilot converter.']},features})}\n`);
console.log(`Wrote ${features.length} source ways to ${output}; relations and contributor identities omitted.`);
