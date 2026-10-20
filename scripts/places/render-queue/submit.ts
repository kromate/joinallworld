// Submit a PlaceModelV2 spec to the shared render queue and wait for the render. Agents NEVER start Blender themselves.
//   node --experimental-strip-types scripts/places/render-queue/submit.ts --city abuja --venue airport \
//        --spec scripts/places/models/abuja/airport.json [--facts auto|none|<file>] [--photo /tmp/places-evidence/abuja/airport.jpg] \
//        [--views close,lod1,lod2] [--wait 120] [--no-validate] [--queue <dir>] [--json]
//   node --experimental-strip-types scripts/places/render-queue/submit.ts --collect <jobid> [--wait 60]
// Style comes from briefs/<city>.json (style), facts from data/facts/<city>.json (venues[<venue>]) when --facts auto (the default).
// Prints status, triangles, warnings and the image paths (<venueId>.png, <venueId>.photo.png, cmp-<city>-<venue>.png when --photo).
// Exit code: 0 ok, 1 build error/rejected, 2 bad input or validation errors, 3 timed out (job stays queued: --collect later), 4 no server.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, validateModel } from '../validate-model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLACES = resolve(HERE, '..');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1] : def;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const queue = resolve(arg('queue', join(HERE, 'q'))!);
const wait = Number(arg('wait', '120'));
const asJson = flag('json');

function serverAlive(): boolean {
  const dir = join(queue, 'workers');
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const hb = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { last: number; state: string };
      if (hb.state !== 'stopped' && hb.state !== 'idle-exit' && Date.now() / 1000 - hb.last < 90) return true;
    } catch { /* half-written heartbeat */ }
  }
  return false;
}

async function collect(jobid: string): Promise<number> {
  const donePath = join(queue, 'done', `${jobid}.json`);
  const t0 = Date.now();
  while (!existsSync(donePath)) {
    if (Date.now() - t0 > wait * 1000) {
      console.error(`timed out after ${wait}s waiting for ${jobid}. The job stays queued; collect later with --collect ${jobid}`);
      if (!serverAlive()) console.error('No render server heartbeat found: start one with scripts/places/render-queue/run.sh');
      return 3;
    }
    await sleep(250);
  }
  await sleep(50);
  const res = JSON.parse(readFileSync(donePath, 'utf8')) as {
    status: string; seconds: number; worker: string; images: string[]; warnings: string[]; errors: string[]; triangles?: Record<string, number>;
    report?: string; bounds?: { size: number[] }; breakdown?: Record<string, number>; cmp?: string; traceback?: string;
  };
  if (asJson) { console.log(JSON.stringify(res, null, 1)); return res.status === 'ok' ? 0 : 1; }
  console.log(`${jobid}: ${res.status.toUpperCase()} in ${res.seconds}s (server ${res.worker})`);
  if (res.triangles) console.log(`triangles: LOD0 ${res.triangles.lod0}, LOD1 ${res.triangles.lod1}, LOD2 ${res.triangles.lod2}` + (res.bounds ? `; size ${res.bounds.size.map((v) => v.toFixed(1)).join(' x ')} m` : ''));
  if (res.breakdown) {
    const top = Object.entries(res.breakdown).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join('  ');
    console.log(`LOD0 triangles by part: ${top}`);
  }
  for (const e of res.errors) console.log(`ERROR  ${e}`);
  for (const w of res.warnings) console.log(`warn   ${w}`);
  for (const p of res.images) console.log(`image  ${p}`);
  if (res.report) console.log(`report ${res.report}`);
  return res.status === 'ok' ? 0 : 1;
}

async function main(): Promise<number> {
  const col = arg('collect');
  if (col) return collect(col);
  const city = arg('city');
  const venue = arg('venue');
  const specPath = arg('spec');
  if (!city || !venue || !specPath) {
    console.error('usage: submit.ts --city <city> --venue <venueId> --spec <spec.json> [--facts auto|none|file] [--photo file] [--views close,lod1,lod2] [--wait 120] [--no-validate]');
    return 2;
  }
  let spec: Record<string, unknown>;
  try { spec = JSON.parse(readFileSync(resolve(specPath), 'utf8')); } catch (e) { console.error(`cannot read spec ${specPath}: ${(e as Error).message}`); return 2; }

  if (!flag('no-validate')) {
    const res = validateModel(spec, loadRegistry(), { city, venueId: venue });
    for (const w of res.warnings) console.log(`validate warn   ${w}`);
    if (res.errors.length) {
      for (const e of res.errors) console.error(`validate ERROR  ${e}`);
      console.error(`spec rejected: ${res.errors.length} validation error(s) (use --no-validate to render anyway)`);
      return 2;
    }
  }
  const briefsPath = join(PLACES, 'briefs', `${city}.json`);
  if (!existsSync(briefsPath)) { console.error(`no ${briefsPath}`); return 2; }
  const style = (JSON.parse(readFileSync(briefsPath, 'utf8')) as { style?: unknown }).style ?? {};
  let facts: unknown = null;
  const factsArg = arg('facts', 'auto')!;
  if (factsArg === 'auto') {
    const fp = join(PLACES, 'data', 'facts', `${city}.json`);
    if (existsSync(fp)) facts = (JSON.parse(readFileSync(fp, 'utf8')) as { venues?: Record<string, unknown> }).venues?.[venue] ?? null;
    if (!facts) console.log(`note: no OSM/Wikidata facts for ${city}/${venue}; footprint.osm is unavailable`);
  } else if (factsArg !== 'none') {
    facts = JSON.parse(readFileSync(resolve(factsArg), 'utf8'));
  }
  // the comparison photo: --photo, else the first photo evidence entry that names a local file
  let photo = arg('photo');
  if (!photo && Array.isArray(spec.evidence)) {
    const e = (spec.evidence as { kind?: string; file?: string }[]).find((x) => x.kind === 'photo' && typeof x.file === 'string' && existsSync(x.file));
    if (e) photo = e.file;
  }
  const views = (arg('views', '') ?? '').split(',').filter(Boolean);
  const jobid = `${Date.now()}-${city}-${venue}-${Math.random().toString(36).slice(2, 7)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  mkdirSync(join(queue, 'in'), { recursive: true });
  mkdirSync(join(queue, 'done'), { recursive: true });
  const job = { city, venueId: venue, spec, style, facts, views, photo: photo ? resolve(photo) : undefined };
  const tmp = join(queue, `.${jobid}.tmp`);
  writeFileSync(tmp, JSON.stringify(job));
  renameSync(tmp, join(queue, 'in', `${jobid}.json`));   // atomic: servers never see a half-written job
  if (!serverAlive()) {
    console.error('No render server heartbeat found: start one with scripts/places/render-queue/run.sh (the job is queued and will run when one starts).');
    if (wait <= 0) return 4;
  }
  const queued = readdirSync(join(queue, 'in')).filter((f) => f.endsWith('.json')).length;
  if (!asJson) console.log(`queued ${jobid} (${queued} job(s) waiting)`);
  if (wait <= 0) { console.log(`collect later with: --collect ${jobid}`); return 0; }
  return collect(jobid);
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
