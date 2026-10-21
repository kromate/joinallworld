// Validates scripts/places/briefs/<city>.json against docs/agent-plans/unique-places/CONTRACT.md.
// Usage: node --experimental-strip-types scripts/places/validate-briefs.ts [city ...]
// With no arguments every briefs/*.json file is checked.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIEFS = join(HERE, 'briefs');
const FACTORY = join(HERE, '..', 'scene-factory', 'generated', 'briefs');

// Enums copied from CONTRACT.md. Keep in sync with the contract.
const ARCHETYPES = ['airport-terminal', 'mosque-domed', 'mosque-sahelian', 'church-gothic', 'church-classical', 'church-modern', 'temple-asian', 'shrine-small', 'stadium', 'monument', 'park-landscape', 'market-open', 'market-hall', 'mall', 'hospital', 'campus-block', 'office-tower', 'office-low', 'civic-palace', 'civic-small', 'transport-station', 'restaurant', 'shophouse', 'museum-theatre', 'hotel', 'industrial', 'heritage-fort', 'manor'];
const MATERIALS = ['render', 'painted-render', 'concrete', 'exposed-concrete', 'brick', 'red-brick', 'stone', 'sandstone', 'limestone', 'marble', 'granite', 'glass-curtain', 'metal-cladding', 'timber', 'mud-render', 'laterite', 'tile-cladding', 'stucco', 'whitewash', 'flint', 'terracotta'];
const ROOF_MATERIALS = ['metal-sheet', 'corrugated', 'clay-tile', 'slate', 'concrete', 'membrane', 'copper', 'gold-leaf', 'thatch', 'timber-shingle', 'glass'];
const STYLES = ['modernist', 'brutalist', 'contemporary', 'high-tech', 'postmodern', 'international', 'colonial', 'georgian', 'victorian', 'gothic-revival', 'neoclassical', 'baroque', 'art-deco', 'sahelian', 'hausa-arewa', 'yoruba', 'swahili', 'arab-islamic', 'ottoman', 'mughal', 'persian', 'east-asian', 'south-asian', 'southeast-asian', 'andean', 'caribbean', 'nordic', 'soviet', 'vernacular', 'tudor'];
const FEATURES = ['control-tower', 'jet-bridge', 'curved-canopy', 'flat-canopy', 'colonnade', 'portico', 'pediment', 'arcade', 'dome', 'onion-dome', 'minaret', 'spire', 'bell-tower', 'clock-tower', 'buttresses', 'rose-window', 'stained-glass', 'pagoda-roof', 'stupa', 'toron-beams', 'pinnacles', 'crenellation', 'courtyard', 'atrium-glass', 'balcony-bands', 'brise-soleil', 'louvres', 'pilotis', 'podium', 'setback-tiers', 'crown', 'mast', 'helipad', 'floodlights', 'stand-roof', 'scoreboard', 'ring-roof', 'stalls', 'sheds', 'umbrellas', 'kiosk', 'gate', 'fence-wall', 'fountain', 'statue', 'obelisk', 'pavilion', 'bandstand', 'steps', 'terrace', 'pier', 'platform-canopy', 'rail-tracks', 'bus-bays', 'flags', 'signage-board', 'red-cross-sign', 'ambulance-bay', 'car-park', 'solar-panels', 'water-tank', 'chimney', 'flare-stack', 'storage-tanks', 'ramparts', 'cannon', 'arches', 'mosaic', 'relief-pattern', 'painted-mural', 'awning', 'roof-terrace', 'neon-strip', 'windmill', 'canopy-walkway', 'shopfront', 'bay-window', 'railings', 'lock-ups'];
const CLIMATES = ['savanna', 'rainforest', 'sahel', 'desert', 'temperate', 'mediterranean', 'tropical-maritime', 'highland', 'cold'];
const FOOTPRINTS = ['rect', 'L', 'U', 'T', 'H', 'ring', 'oval', 'round', 'cross', 'irregular'];
const ROOFS = ['flat', 'gable', 'hip', 'shed', 'barrel', 'dome', 'multi-dome', 'tensile', 'sawtooth', 'pyramidal', 'mansard', 'stepped', 'curved', 'wave', 'none'];
const WINDOWS = ['curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre', 'none'];
const GROUNDS = ['laterite', 'asphalt', 'paving', 'grass', 'sand', 'cobble', 'snow'];
const TREES = ['palm', 'broadleaf', 'acacia', 'conifer', 'none'];
const FORECOURTS = ['parking', 'plaza', 'garden', 'road', 'water', 'none'];
const CONFIDENCE = ['high', 'medium', 'low'];

type Obj = Record<string, unknown>;
const HEX = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Report {
  errors: string[] = [];
  warnings: string[] = [];
  err(path: string, msg: string): void { this.errors.push(`${path}: ${msg}`); }
  warn(path: string, msg: string): void { this.warnings.push(`${path}: ${msg}`); }
}

function oneOf(r: Report, path: string, v: unknown, list: string[]): void {
  if (typeof v !== 'string' || !list.includes(v)) r.err(path, `${JSON.stringify(v)} not in [${list.join('|')}]`);
}
function hex(r: Report, path: string, v: unknown): void {
  if (typeof v !== 'string' || !HEX.test(v)) r.err(path, `invalid hex colour ${JSON.stringify(v)}`);
}
function num(r: Report, path: string, v: unknown, min: number, max: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) r.err(path, `${JSON.stringify(v)} not a number in [${min}, ${max}]`);
}
function str(r: Report, path: string, v: unknown, min = 1): void {
  if (typeof v !== 'string' || v.trim().length < min) r.err(path, 'missing or empty string');
}
function sources(r: Report, path: string, v: unknown): void {
  if (!Array.isArray(v)) { r.err(path, 'must be an array'); return; }
  v.forEach((s, i) => {
    if (!isObj(s)) { r.err(`${path}[${i}]`, 'must be an object'); return; }
    if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) r.err(`${path}[${i}].url`, 'must be an http(s) URL');
    str(r, `${path}[${i}].what`, s.what);
  });
}

function checkStyle(r: Report, city: string, s: unknown): void {
  const p = 'style';
  if (!isObj(s)) { r.err(p, 'missing'); return; }
  if (s.schema !== 'allworld-city-style') r.err(`${p}.schema`, 'must be allworld-city-style');
  if (s.version !== 1) r.err(`${p}.version`, 'must be 1');
  if (s.city !== city) r.err(`${p}.city`, `must be ${city}`);
  oneOf(r, `${p}.climate`, s.climate, CLIMATES);
  str(r, `${p}.vernacular`, s.vernacular, 20);
  const list = (k: string, min: number, max: number, each: (path: string, v: unknown) => void): void => {
    const v = s[k];
    if (!Array.isArray(v) || v.length < min || v.length > max) { r.err(`${p}.${k}`, `must be an array of ${min}-${max}`); return; }
    v.forEach((x, i) => each(`${p}.${k}[${i}]`, x));
  };
  list('wallColours', 4, 8, (pa, v) => hex(r, pa, v));
  list('roofColours', 2, 6, (pa, v) => hex(r, pa, v));
  list('wallMaterials', 1, 21, (pa, v) => oneOf(r, pa, v, MATERIALS));
  list('roofMaterials', 1, 11, (pa, v) => oneOf(r, pa, v, ROOF_MATERIALS));
  oneOf(r, `${p}.ground`, s.ground, GROUNDS);
  list('vegetation', 1, 5, (pa, v) => oneOf(r, pa, v, TREES));
  str(r, `${p}.ornament`, s.ornament, 10);
  sources(r, `${p}.sources`, s.sources);
  if (Array.isArray(s.sources) && s.sources.length === 0) r.err(`${p}.sources`, 'at least one source required');
}

function checkPlace(r: Report, city: string, id: string, b: unknown): void {
  const p = `places.${id}`;
  if (!isObj(b)) { r.err(p, 'must be an object'); return; }
  if (b.venueId !== id) r.err(`${p}.venueId`, `must equal key ${id}`);
  if (b.city !== city) r.err(`${p}.city`, `must be ${city}`);
  str(r, `${p}.name`, b.name);
  oneOf(r, `${p}.archetype`, b.archetype, ARCHETYPES);
  str(r, `${p}.subject`, b.subject, 10);
  const f = b.form;
  if (!isObj(f)) r.err(`${p}.form`, 'missing');
  else {
    oneOf(r, `${p}.form.footprint`, f.footprint, FOOTPRINTS);
    num(r, `${p}.form.width_m`, f.width_m, 2, 1500);
    num(r, `${p}.form.depth_m`, f.depth_m, 2, 1500);
    num(r, `${p}.form.storeys`, f.storeys, 0, 150);
    num(r, `${p}.form.height_m`, f.height_m, 0, 700);
    oneOf(r, `${p}.form.roof`, f.roof, ROOFS);
    if (f.wings !== undefined) num(r, `${p}.form.wings`, f.wings, 0, 20);
    if (typeof f.storeys === 'number' && typeof f.height_m === 'number' && f.storeys >= 1 && f.height_m > 0) {
      const per = f.height_m / f.storeys;
      if ((per < 2.2 || per > 12) && f.roof !== 'dome' && f.roof !== 'multi-dome') r.warn(`${p}.form`, `height/storeys = ${per.toFixed(1)} m per storey looks odd`);
    }
  }
  const fa = b.facade;
  if (!isObj(fa)) r.err(`${p}.facade`, 'missing');
  else {
    oneOf(r, `${p}.facade.material`, fa.material, MATERIALS);
    if (fa.accent !== null) oneOf(r, `${p}.facade.accent`, fa.accent, MATERIALS);
    if (!Array.isArray(fa.colours) || fa.colours.length !== 3) r.err(`${p}.facade.colours`, 'must be 3 hex colours [main, accent, trim]');
    else fa.colours.forEach((c, i) => hex(r, `${p}.facade.colours[${i}]`, c));
    hex(r, `${p}.facade.roofColour`, fa.roofColour);
    if (fa.roofMaterial !== undefined && fa.roofMaterial !== null) oneOf(r, `${p}.facade.roofMaterial`, fa.roofMaterial, ROOF_MATERIALS);
    oneOf(r, `${p}.facade.windows`, fa.windows, WINDOWS);
    num(r, `${p}.facade.windowRatio`, fa.windowRatio, 0, 1);
  }
  if (!Array.isArray(b.features)) r.err(`${p}.features`, 'must be an array');
  else b.features.forEach((ft, i) => {
    if (!isObj(ft)) { r.err(`${p}.features[${i}]`, 'must be an object'); return; }
    oneOf(r, `${p}.features[${i}].id`, ft.id, FEATURES);
    num(r, `${p}.features[${i}].count`, ft.count, 1, 500);
    if (ft.note !== undefined) str(r, `${p}.features[${i}].note`, ft.note);
  });
  const se = b.setting;
  if (!isObj(se)) r.err(`${p}.setting`, 'missing');
  else {
    oneOf(r, `${p}.setting.ground`, se.ground, GROUNDS);
    oneOf(r, `${p}.setting.trees`, se.trees, TREES);
    oneOf(r, `${p}.setting.forecourt`, se.forecourt, FORECOURTS);
  }
  oneOf(r, `${p}.style`, b.style, STYLES);
  str(r, `${p}.era`, b.era);
  oneOf(r, `${p}.confidence`, b.confidence, CONFIDENCE);
  sources(r, `${p}.sources`, b.sources);
  str(r, `${p}.notes`, b.notes, 10);
  if (b.confidence === 'high' && Array.isArray(b.sources) && b.sources.length === 0) r.err(`${p}.sources`, 'high confidence requires at least one source');
  if (b.confidence === 'medium' && Array.isArray(b.sources) && b.sources.length === 0) r.err(`${p}.sources`, 'medium confidence requires at least one source');
}

function validateCity(city: string): Report {
  const r = new Report();
  const file = join(BRIEFS, `${city}.json`);
  if (!existsSync(file)) { r.err(file, 'file not found'); return r; }
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { r.err(file, `invalid JSON: ${(e as Error).message}`); return r; }
  if (!isObj(doc)) { r.err('root', 'must be an object'); return r; }
  if (doc.schema !== 'allworld-place-briefs') r.err('schema', 'must be allworld-place-briefs');
  if (doc.version !== 1) r.err('version', 'must be 1');
  if (doc.city !== city) r.err('city', `must be ${city}`);
  checkStyle(r, city, doc.style);
  const places = doc.places;
  if (!isObj(places)) { r.err('places', 'missing'); return r; }
  const factoryFile = join(FACTORY, `${city}.json`);
  if (!existsSync(factoryFile)) r.warn('factory', `no scene-factory brief at ${factoryFile}; cannot check coverage`);
  else {
    const factory = JSON.parse(readFileSync(factoryFile, 'utf8')) as { venues: { id: string; scene?: { disposition?: string } }[] };
    const expected = factory.venues.filter((v) => v.scene?.disposition !== 'exclude-home').map((v) => v.id);
    for (const id of expected) if (!(id in places)) r.err(`places.${id}`, 'venue missing from briefs');
    for (const id of Object.keys(places)) if (!expected.includes(id)) r.err(`places.${id}`, 'not a non-home venue of this city');
  }
  for (const [id, b] of Object.entries(places)) checkPlace(r, city, id, b);
  return r;
}

const args = process.argv.slice(2);
const cities = args.length > 0 ? args : readdirSync(BRIEFS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
let failed = false;
for (const city of cities) {
  const r = validateCity(city);
  for (const w of r.warnings) console.log(`warn  ${city} ${w}`);
  for (const e of r.errors) console.log(`ERROR ${city} ${e}`);
  console.log(`${r.errors.length === 0 ? 'ok   ' : 'FAIL '} ${city}: ${r.errors.length} errors, ${r.warnings.length} warnings`);
  if (r.errors.length > 0) failed = true;
}
process.exit(failed ? 1 : 0);
