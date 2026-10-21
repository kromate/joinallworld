// Validates PlaceModelV2 specs (docs/agent-plans/unique-places/PLACE-MODEL.md) against CONTRACT.md enums and the parts registry.
// Usage: node --experimental-strip-types scripts/places/validate-model.ts <spec.json | city ...>   (a city name checks models/<city>/*.json)
// Exit code 1 when any spec has errors; warnings never fail. Part types are read from `python3 scripts/places/blender/parts/list.py --json`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Enums copied from CONTRACT.md. Keep in sync with the contract and validate-briefs.ts.
const MATERIALS = ['render', 'painted-render', 'concrete', 'exposed-concrete', 'brick', 'red-brick', 'stone', 'sandstone', 'limestone', 'marble', 'granite', 'glass-curtain', 'metal-cladding', 'timber', 'mud-render', 'laterite', 'tile-cladding', 'stucco', 'whitewash', 'flint', 'terracotta'];
const ROOF_MATERIALS = ['metal-sheet', 'corrugated', 'clay-tile', 'slate', 'concrete', 'membrane', 'copper', 'gold-leaf', 'thatch', 'timber-shingle', 'glass'];
const ROOFS = ['flat', 'gable', 'hip', 'shed', 'barrel', 'dome', 'multi-dome', 'tensile', 'sawtooth', 'pyramidal', 'mansard', 'stepped', 'curved', 'wave', 'none'];
const WINDOWS = ['curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre', 'none', 'plain', 'round', 'rect', 'pointed'];
const GROUNDS = ['laterite', 'asphalt', 'paving', 'grass', 'sand', 'cobble', 'snow'];
const TREES = ['palm', 'broadleaf', 'acacia', 'conifer', 'none'];
const FORECOURTS = ['parking', 'plaza', 'garden', 'road', 'water', 'none'];
const FOOTPRINT_KINDS = ['rect', 'L', 'U', 'T', 'H', 'ring', 'oval', 'round', 'cross', 'irregular'];
const VERIFIED = ['photo', 'footprint', 'text'];
const EVIDENCE_KINDS = ['photo', 'osm', 'wikidata', 'text'];
const VIEWS = ['front', 'side', 'back', 'aerial', 'street', 'interior', 'detail'];
const MATCH = ['close', 'fair', 'rough'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const MASS_KEYS = ['type', 'id', 'footprint', 'at', 'rotDeg', 'z0', 'height', 'storeys', 'wall', 'roof', 'note', 'notes'];
const WALL_KEYS = ['material', 'colour', 'trimColour', 'windows', 'windowRatio', 'faces', 'bands', 'plinth', 'bay', 'cornice', 'parapet', 'glassColour', 'groundKind', 'groundHeight', 'accentColour', 'pattern', 'windowShape'];
const ROOF_KEYS = ['form', 'colour', 'material', 'pitch', 'rise', 'overhang', 'parapet', 'axis', 'profile', 'drum', 'lantern', 'finial', 'tiers', 'teeth', 'rows', 'cols', 'high', 'curve', 'waves', 'thickness', 'infill', 'ribs'];
const PART_KEYS = ['type', 'id', 'at', 'rotDeg', 'params', 'on', 'note', 'notes', 'lod'];
const TOP_KEYS = ['schema', 'version', 'city', 'venueId', 'name', 'verified', 'evidence', 'camera', 'parts', 'site', 'review', 'notes', 'note'];

type Obj = Record<string, unknown>;
export type Registry = Record<string, { file?: string; params: { name: string }[] }>;
export interface Result { errors: string[]; warnings: string[] }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Report implements Result {
  errors: string[] = [];
  warnings: string[] = [];
  err(path: string, msg: string): void { this.errors.push(`${path}: ${msg}`); }
  warn(path: string, msg: string): void { this.warnings.push(`${path}: ${msg}`); }
}

function oneOf(r: Report, path: string, v: unknown, list: string[]): void {
  if (typeof v !== 'string' || !list.includes(v)) r.err(path, `${JSON.stringify(v)} not in [${list.join('|')}]`);
}
function hex(r: Report, path: string, v: unknown): void {
  if (typeof v !== 'string' || !HEX.test(v)) r.err(path, `invalid #rrggbb colour ${JSON.stringify(v)}`);
}
function num(r: Report, path: string, v: unknown, min: number, max: number): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { r.err(path, `${JSON.stringify(v)} not a number in [${min}, ${max}]`); return false; }
  return true;
}
function str(r: Report, path: string, v: unknown): void {
  if (typeof v !== 'string' || v.trim().length < 2) r.err(path, 'missing or empty string');
}
function unknownKeys(r: Report, path: string, o: Obj, allowed: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) r.warn(`${path}.${k}`, 'unknown key (the composer ignores it)');
}
function xy(r: Report, path: string, v: unknown, allowZ: boolean): void {
  if (!Array.isArray(v) || v.length < 2 || v.length > (allowZ ? 3 : 2)) { r.err(path, `expected [x, y${allowZ ? ', z?' : ''}]`); return; }
  v.forEach((n, i) => num(r, `${path}[${i}]`, n, i < 2 ? -400 : -50, i < 2 ? 400 : 200));
}

export function loadRegistry(): Registry | null {
  const py = join(HERE, 'blender', 'parts', 'list.py');
  const res = spawnSync('python3', [py, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) return null;
  try { return (JSON.parse(res.stdout) as { parts: Registry }).parts; } catch { return null; }
}

function checkMass(r: Report, p: Obj, path: string, ids: Set<string>, hasOsmEvidence: boolean): { w: number } {
  unknownKeys(r, path, p, MASS_KEYS);
  const id = p.id;
  if (typeof id !== 'string' || !id) r.err(`${path}.id`, 'every mass needs a unique string id');
  else if (ids.has(id)) r.err(`${path}.id`, `duplicate id ${id}`);
  else ids.add(id);
  let w = 0;
  const fp = p.footprint;
  if (!isObj(fp)) r.err(`${path}.footprint`, 'must be an object: {rect}|{polygon}|{osm:true}|{kind,size}');
  else {
    const forms = ['rect', 'polygon', 'osm', 'kind'].filter((k) => fp[k] !== undefined && fp[k] !== false);
    if (forms.length !== 1) r.err(`${path}.footprint`, `needs exactly one of rect, polygon, osm, kind (found ${forms.join(',') || 'none'})`);
    if (Array.isArray(fp.rect)) {
      if (fp.rect.length !== 2) r.err(`${path}.footprint.rect`, 'expected [width, depth]');
      else {
        fp.rect.forEach((n, i) => num(r, `${path}.footprint.rect[${i}]`, n, 0.5, 400));
        const m = Math.max(Number(fp.rect[0]), Number(fp.rect[1]));
        w = m;
        if (m > 118) r.warn(`${path}.footprint.rect`, `${m} m exceeds the 120 m scene clamp; the composer will scale it down (model the recognisable portion instead)`);
        if (m < 2) r.warn(`${path}.footprint.rect`, 'very small mass');
      }
    }
    if (fp.polygon !== undefined) {
      if (!Array.isArray(fp.polygon) || fp.polygon.length < 3) r.err(`${path}.footprint.polygon`, 'needs at least 3 [x, y] points');
      else fp.polygon.forEach((pt, i) => { if (!Array.isArray(pt) || pt.length !== 2 || pt.some((n) => typeof n !== 'number' || !Number.isFinite(n))) r.err(`${path}.footprint.polygon[${i}]`, 'expected [x, y]'); });
    }
    if (fp.osm !== undefined) {
      if (fp.osm !== true) r.err(`${path}.footprint.osm`, 'must be true');
      if (!hasOsmEvidence) r.warn(`${path}.footprint.osm`, 'uses the OSM outline but evidence has no {kind: "osm"} entry');
      for (const k of ['scale']) if (fp[k] !== undefined) num(r, `${path}.footprint.${k}`, fp[k], 0.02, 20);
      if (fp.fit !== undefined) num(r, `${path}.footprint.fit`, fp.fit, 3, 118);
      if (fp.simplify !== undefined) num(r, `${path}.footprint.simplify`, fp.simplify, 0, 20);
      if (fp.rotDeg !== undefined) num(r, `${path}.footprint.rotDeg`, fp.rotDeg, -360, 360);
    }
    if (fp.kind !== undefined) {
      oneOf(r, `${path}.footprint.kind`, fp.kind, FOOTPRINT_KINDS);
      if (!Array.isArray(fp.size) || fp.size.length !== 2) r.err(`${path}.footprint.size`, 'kind footprints need size [w, d]');
      else fp.size.forEach((n, i) => num(r, `${path}.footprint.size[${i}]`, n, 2, 400));
    }
  }
  if (p.at !== undefined) xy(r, `${path}.at`, p.at, false);
  if (p.rotDeg !== undefined) num(r, `${path}.rotDeg`, p.rotDeg, -360, 360);
  if (p.z0 !== undefined) num(r, `${path}.z0`, p.z0, -5, 120);
  num(r, `${path}.height`, p.height, 0.5, 138);
  if (p.storeys !== undefined) {
    if (num(r, `${path}.storeys`, p.storeys, 1, 60) && !Number.isInteger(p.storeys)) r.err(`${path}.storeys`, 'must be an integer');
    else if (typeof p.height === 'number' && typeof p.storeys === 'number') {
      const per = p.height / p.storeys;
      if (per < 2.2 || per > 12) r.warn(`${path}`, `${per.toFixed(1)} m per storey looks odd (height ${p.height}, storeys ${p.storeys})`);
    }
  }
  if (p.wall !== undefined) {
    if (!isObj(p.wall)) r.err(`${path}.wall`, 'must be an object');
    else {
      const wall = p.wall;
      unknownKeys(r, `${path}.wall`, wall, WALL_KEYS);
      if (wall.material !== undefined) oneOf(r, `${path}.wall.material`, wall.material, MATERIALS);
      for (const k of ['colour', 'trimColour', 'glassColour', 'accentColour']) if (wall[k] !== undefined) hex(r, `${path}.wall.${k}`, wall[k]);
      if (wall.windows !== undefined) oneOf(r, `${path}.wall.windows`, wall.windows, WINDOWS);
      if (wall.windowRatio !== undefined) num(r, `${path}.wall.windowRatio`, wall.windowRatio, 0, 0.92);
      if (wall.plinth !== undefined) num(r, `${path}.wall.plinth`, wall.plinth, 0, 4);
      if (wall.faces !== undefined) {
        if (!isObj(wall.faces)) r.err(`${path}.wall.faces`, 'must be {front,back,left,right}');
        else for (const [k, v] of Object.entries(wall.faces)) {
          if (!['front', 'back', 'left', 'right'].includes(k)) r.warn(`${path}.wall.faces.${k}`, 'unknown side');
          oneOf(r, `${path}.wall.faces.${k}`, v, WINDOWS);
        }
      }
      if (typeof wall.bands === 'string') hex(r, `${path}.wall.bands`, wall.bands);
      else if (isObj(wall.bands) && wall.bands.colour !== undefined) hex(r, `${path}.wall.bands.colour`, wall.bands.colour);
    }
  } else r.warn(`${path}.wall`, 'no wall: the composer will use the city style colours (is that what the photo shows?)');
  if (p.roof !== undefined) {
    if (!isObj(p.roof)) r.err(`${path}.roof`, 'must be an object');
    else {
      const roof = p.roof;
      unknownKeys(r, `${path}.roof`, roof, ROOF_KEYS);
      if (roof.form !== undefined) oneOf(r, `${path}.roof.form`, roof.form, ROOFS);
      if (roof.material !== undefined) oneOf(r, `${path}.roof.material`, roof.material, ROOF_MATERIALS);
      if (roof.colour !== undefined) hex(r, `${path}.roof.colour`, roof.colour);
      if (roof.pitch !== undefined) num(r, `${path}.roof.pitch`, roof.pitch, 3, 80);
      if (roof.rise !== undefined) num(r, `${path}.roof.rise`, roof.rise, 0.2, 80);
      if (roof.overhang !== undefined) num(r, `${path}.roof.overhang`, roof.overhang, 0, 20);
    }
  }
  return { w };
}

export function validateModel(spec: unknown, registry: Registry | null, opts: { city?: string; venueId?: string } = {}): Result {
  const r = new Report();
  if (!isObj(spec)) { r.err('spec', 'must be a JSON object'); return r; }
  unknownKeys(r, 'spec', spec, TOP_KEYS);
  if (spec.schema !== 'allworld-place-model') r.err('schema', 'must be "allworld-place-model"');
  if (spec.version !== 2) r.err('version', 'must be 2');
  str(r, 'city', spec.city);
  str(r, 'venueId', spec.venueId);
  if (opts.city && spec.city !== opts.city) r.err('city', `spec says ${JSON.stringify(spec.city)} but the target city is ${opts.city}`);
  if (opts.venueId && spec.venueId !== opts.venueId) r.err('venueId', `spec says ${JSON.stringify(spec.venueId)} but the target venue is ${opts.venueId}`);
  oneOf(r, 'verified', spec.verified, VERIFIED);

  // evidence
  let photos = 0;
  let osm = 0;
  if (!Array.isArray(spec.evidence)) r.err('evidence', 'must be an array (use [] only for verified: "text")');
  else {
    spec.evidence.forEach((e, i) => {
      const path = `evidence[${i}]`;
      if (!isObj(e)) { r.err(path, 'must be an object'); return; }
      oneOf(r, `${path}.kind`, e.kind, EVIDENCE_KINDS);
      str(r, `${path}.used`, e.used);
      if (e.kind === 'photo') {
        photos++;
        if (typeof e.url !== 'string' || !/^https?:\/\//.test(e.url)) r.err(`${path}.url`, 'photo evidence needs an http(s) url');
        if (typeof e.licence !== 'string' || !e.licence) r.warn(`${path}.licence`, 'record the licence (and author) of every photo used');
        if (e.view !== undefined) oneOf(r, `${path}.view`, e.view, VIEWS); else r.warn(`${path}.view`, 'say which view the photo shows');
      } else if (e.kind === 'osm') {
        osm++;
        if (typeof e.ref !== 'string' || !/^(way|relation|node)\/\d+$/.test(e.ref)) r.err(`${path}.ref`, 'expected way/123, relation/123 or node/123');
      }
    });
  }
  if (spec.verified === 'photo') {
    if (photos === 0) r.err('verified', '"photo" requires at least one photo entry in evidence');
    if (!isObj(spec.camera)) r.warn('camera', 'verified: "photo" without a camera: the comparison render cannot match the photo viewpoint');
    if (!isObj(spec.review)) r.warn('review', 'add review {rounds, match, gaps} after comparing with the photo');
  } else if (spec.verified === 'footprint' && osm === 0) r.err('verified', '"footprint" requires an {kind: "osm"} evidence entry');
  else if (spec.verified === 'text' && photos > 0) r.warn('verified', 'photo evidence is listed but verified is "text": compare with the photo and upgrade it');
  if (spec.camera !== undefined) {
    if (!isObj(spec.camera)) r.err('camera', 'must be an object');
    else {
      const c = spec.camera;
      num(r, 'camera.yawDeg', c.yawDeg, -180, 180);
      num(r, 'camera.pitchDeg', c.pitchDeg, -10, 80);
      num(r, 'camera.fovDeg', c.fovDeg, 15, 110);
      if (c.aspect !== undefined) num(r, 'camera.aspect', c.aspect, 0.5, 2.5);
    }
  }

  // parts
  const hasOsmEvidence = osm > 0;
  if (!Array.isArray(spec.parts) || spec.parts.length === 0) r.err('parts', 'needs at least one part');
  else {
    if (spec.parts.length > 120) r.err('parts', 'more than 120 parts');
    const ids = new Set<string>();
    let masses = 0;
    let span = 0;
    spec.parts.forEach((p, i) => {
      const path = `parts[${i}]`;
      if (!isObj(p)) { r.err(path, 'must be an object'); return; }
      if (p.type === 'mass') { masses++; span = Math.max(span, checkMass(r, p, path, ids, hasOsmEvidence).w); return; }
      unknownKeys(r, path, p, PART_KEYS);
      if (typeof p.type !== 'string') { r.err(`${path}.type`, 'missing'); return; }
      const reg = registry?.[p.type];
      if (registry && !reg) r.err(`${path}.type`, `unknown part type ${JSON.stringify(p.type)} (python3 scripts/places/blender/parts/list.py)`);
      if (!registry) r.warn(path, 'parts registry unavailable: part types not checked');
      if (p.at !== undefined) xy(r, `${path}.at`, p.at, true);
      if (p.rotDeg !== undefined) num(r, `${path}.rotDeg`, p.rotDeg, -360, 360);
      if (p.params !== undefined) {
        if (!isObj(p.params)) { r.err(`${path}.params`, 'must be an object'); return; }
        const known = reg ? reg.params.map((q) => q.name) : [];
        for (const [k, v] of Object.entries(p.params)) {
          if (reg && known.length && !known.includes(k)) r.warn(`${path}.params.${k}`, `not a parameter of ${p.type} (known: ${known.join(', ')})`);
          if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 500)) r.err(`${path}.params.${k}`, `${v} is not a sane number`);
          if (typeof v === 'string' && /colou?r$/i.test(k) && !HEX.test(v)) r.err(`${path}.params.${k}`, `invalid #rrggbb colour ${JSON.stringify(v)}`);
        }
      }
    });
    if (masses === 0) r.warn('parts', 'no mass part: only free-standing parts');
    if (masses > 40) r.err('parts', 'more than 40 masses');
    if (span > 120) r.warn('parts', `a mass spans ${span} m`);
    if (spec.parts.length < 3 && spec.verified !== 'text') r.warn('parts', 'very few parts for a place backed by evidence: is every visible signature feature modelled?');
  }

  // site
  if (spec.site !== undefined) {
    if (!isObj(spec.site)) r.err('site', 'must be an object');
    else {
      const s = spec.site;
      if (s.ground !== undefined) oneOf(r, 'site.ground', s.ground, GROUNDS);
      if (s.forecourt !== undefined) oneOf(r, 'site.forecourt', s.forecourt, FORECOURTS);
      if (s.extent !== undefined) {
        if (!Array.isArray(s.extent) || s.extent.length !== 2) r.err('site.extent', 'expected [w, d]');
        else s.extent.forEach((n, i) => num(r, `site.extent[${i}]`, n, 10, 160));
      }
      if (typeof s.trees === 'number') num(r, 'site.trees', s.trees, 0, 60);
      else if (Array.isArray(s.trees)) {
        if (s.trees.length > 80) r.err('site.trees', 'more than 80 trees');
        s.trees.forEach((t, i) => {
          if (!isObj(t)) { r.err(`site.trees[${i}]`, 'must be an object'); return; }
          if (t.kind !== undefined) oneOf(r, `site.trees[${i}].kind`, t.kind, TREES);
          xy(r, `site.trees[${i}].at`, t.at, false);
        });
      } else if (s.trees !== undefined) r.err('site.trees', 'must be a count or a list of {kind, at}');
    }
  }
  if (spec.review !== undefined) {
    if (!isObj(spec.review)) r.err('review', 'must be an object');
    else {
      num(r, 'review.rounds', spec.review.rounds, 0, 3);
      oneOf(r, 'review.match', spec.review.match, MATCH);
      if (typeof spec.review.gaps !== 'string') r.warn('review.gaps', 'say what still differs from the photo');
    }
  }
  return r;
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const files: string[] = [];
  const modelsDir = join(HERE, 'models');
  for (const a of args) {
    if (existsSync(a) && a.endsWith('.json')) files.push(resolve(a));
    else if (existsSync(join(modelsDir, a))) {
      for (const f of readdirSync(join(modelsDir, a))) if (f.endsWith('.json')) files.push(join(modelsDir, a, f));
    } else console.error(`not found: ${a}`);
  }
  if (!files.length) { console.error('usage: validate-model.ts <spec.json | city> ...'); process.exit(2); }
  const registry = loadRegistry();
  let bad = 0;
  for (const f of files) {
    let spec: unknown;
    try { spec = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.log(`${f}\n  ERROR invalid JSON: ${(e as Error).message}`); bad++; continue; }
    const res = validateModel(spec, registry);
    console.log(`${f}: ${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
    for (const e of res.errors) console.log(`  ERROR ${e}`);
    for (const w of res.warnings) console.log(`  warn  ${w}`);
    if (res.errors.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
