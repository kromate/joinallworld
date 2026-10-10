#!/usr/bin/env node
/**
 * City map audit: every city's own map as a player in that city sees it, in a real browser.
 *
 *   node --experimental-strip-types scripts/journeys/maps.ts --out <folder> [--cities lagos,kaduna] [--port 4361] [--debug-port 4362] [--fund 12000000]
 *
 * It builds nothing: run `npm run build` first. It starts the built app (scripts/journeys/serve.ts, a fresh data folder, no outside
 * request) and ONE headless Chrome (muted), plays a guest in from the landing screen's "Play now", takes an admin credit once, and
 * then travels from city to city by the game's own intercity links (the same server action the travel card sends), taking the
 * cheapest unvisited neighbour each time. In every city it opens the Map tab and saves, at 1280x800:
 *   <city>-1-whole.jpg   the city map after "Whole city" (list hidden)
 *   <city>-2-list.jpg    the same view with the place list open
 *   <city>-3-zoom.jpg    a zoom on the busiest part (where most place labels sit)
 * It also saves the World, Africa and Nigeria atlas levels, and writes maps.json: places listed, district labels, the pack's own
 * counts of roads, water, districts and places, label overlap, console errors and the time the map took to appear.
 * Screenshots are waited for on real conditions (the map's labels exist, then two frames in a row are identical or a short cap).
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Browser, sleep } from './cdp.ts';
import { cityCatalogue, linksFrom, loadCityMap } from '../../src/game/cities/registry.ts';

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
};
const out = resolve(arg('out'));
const port = Number(arg('port', '4361')), debugPort = Number(arg('debug-port', '4362'));
const funding = Number(arg('fund', '12000000'));
const only = arg('cities', '').split(',').map((id) => id.trim()).filter(Boolean);
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'maps-run-'));
const dataDir = join(work, 'data'), cookieFile = join(work, 'founder.cookie'), profile = join(work, 'chrome');

const must = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
let server: ChildProcess | null = null, chrome: ChildProcess | null = null;
const serverLog: string[] = [];

async function startServer(): Promise<void> {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/journeys/serve.ts', '--port', String(port), '--data', dataDir, '--cookie-file', cookieFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  server = child;
  child.stdout!.on('data', (chunk) => serverLog.push(String(chunk)));
  child.stderr!.on('data', (chunk) => serverLog.push(String(chunk)));
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (serverLog.join('').includes('journey server ready') && child.exitCode === null) return;
    if (child.exitCode !== null) throw new Error(`The server stopped at start: ${serverLog.join('').slice(-400)}`);
    await sleep(200);
  }
  throw new Error('The server did not become ready');
}
async function startBrowser(): Promise<Browser> {
  const bin = process.env['CHROME_BIN'] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  mkdirSync(profile, { recursive: true });
  chrome = spawn(bin, ['--headless=new', '--mute-audio', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
  const b = await Browser.attach(debugPort, chrome, profile);
  await b.setViewport({ width: 1280, height: 800, scale: 1, mobile: false });
  return b;
}
async function stopAll(b: Browser | null): Promise<void> {
  try { b?.ws?.close(); } catch { /* closed */ }
  try { chrome?.kill('SIGTERM'); } catch { /* gone */ }
  const child = server;
  if (child && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 25000).unref(); });
  await sleep(500);
  for (const dir of [profile, work]) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* removed */ } }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------
const NOISE = [/status of 401 \(Unauthorized\) .*\/api\/session$/, /status of 409 \(Conflict\) .*\/api\/street\/me$/, /status of 409 \(Conflict\) .*\/api\/life\?city=[a-z-]+$/];
const shown = (selector: string): string => `[...document.querySelectorAll(${JSON.stringify(selector)})].some((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; })`;

async function cookieOf(b: Browser): Promise<string> {
  const jar = await b.send('Network.getCookies', { urls: [base] });
  return (jar.cookies as { name: string; value: string }[]).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}
async function lifeOf(b: Browser, city: string): Promise<any> {
  const response = await fetch(`${base}/api/life?city=${city}`, { headers: { Cookie: await cookieOf(b) } });
  const body = await response.json().catch(() => null) as { state?: any } | null;
  return { status: response.status, state: body?.state };
}
/** Closes the guide tour and any quiet offer in front of the game. */
async function dismiss(b: Browser, waitMs = 3000): Promise<void> {
  const end = Date.now() + waitMs;
  for (;;) {
    const point = await b.locate('button.tour-skip, button.is-quiet').catch(() => null);
    if (point) { await b.tapAt(point.x, point.y); await sleep(300); continue; }
    if (Date.now() > end) return;
    await sleep(250);
  }
}
async function fund(playerId: string, amount: number): Promise<void> {
  const cookie = readFileSync(cookieFile, 'utf8').trim();
  const intent: Record<string, unknown> = { clientId: `${Date.now()}:${randomUUID()}`, action: 'credit', amount, reason: 'Map audit fixture' };
  const send = async () => {
    const response = await fetch(`${base}/api/admin/players/${playerId}/act`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(intent) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  let answer = await send();
  // A large credit asks once for the route's own confirmation token.
  if (answer.body['code'] === 'confirmation_required') { intent['confirm'] = answer.body['token']; answer = await send(); }
  must(answer.status === 200 && answer.body['code'] === 'credited', `the admin credit answered ${answer.status} ${JSON.stringify(answer.body).slice(0, 200)}`);
}

/** A JPEG of the page; two frames in a row that match (or the cap) count as settled. */
async function settledShot(b: Browser, file: string, capMs = 7000): Promise<boolean> {
  const grab = async (): Promise<string> => (await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })).data as string;
  let last = await grab(), settled = false;
  const end = Date.now() + capMs;
  while (Date.now() < end) {
    await sleep(500);
    const next = await grab();
    if (createHash('sha1').update(next).digest('hex') === createHash('sha1').update(last).digest('hex')) { last = next; settled = true; break; }
    last = next;
  }
  writeFileSync(join(out, file), Buffer.from(last, 'base64'));
  return settled;
}

// ---- the page's own view of a map ------------------------------------------------------------------------------------
interface Labels { places: number; districtLabels: number; overlapPairs: number; clipped: number; centre: { x: number; y: number } | null }
async function labels(b: Browser): Promise<Labels> {
  return b.eval<Labels>(`(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const venues = [...document.querySelectorAll('[data-venue]')].filter(vis).map((e) => e.getBoundingClientRect());
    const district = [...document.querySelectorAll('[data-lga]')].filter(vis).length;
    let overlap = 0;
    for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
      const a = venues[i], c = venues[j];
      if (a.left < c.right - 2 && c.left < a.right - 2 && a.top < c.bottom - 2 && c.top < a.bottom - 2) overlap++;
    }
    const clipped = venues.filter((r) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight).length;
    // The busiest part: the label whose neighbourhood (200 px) holds most labels, on the open map area (the list sits at the left).
    let best = null, bestN = -1;
    for (const r of venues) {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const n = venues.filter((o) => Math.hypot(o.left + o.width / 2 - x, o.top + o.height / 2 - y) < 200).length;
      if (n > bestN) { bestN = n; best = { x, y }; }
    }
    return { places: venues.length, districtLabels: district, overlapPairs: overlap, clipped, centre: best };
  })()`);
}
const listHeader = (b: Browser): Promise<string> => b.eval<string>(`document.querySelector('.map-handle-text')?.innerText?.replace(/\\s+/g, ' ').trim() || ''`);
const listOpen = (b: Browser): Promise<boolean> => b.eval<boolean>(`document.querySelector('.map-handle')?.getAttribute('aria-expanded') === 'true'`);
async function setList(b: Browser, wantOpen: boolean): Promise<void> {
  if ((await listOpen(b)) === wantOpen) return;
  await b.click('.map-handle');
  await b.waitFor(`document.querySelector('.map-handle')?.getAttribute('aria-expanded') === '${wantOpen}'`, 8000, `the list to ${wantOpen ? 'open' : 'close'}`);
  await sleep(400);
}

interface PackStats { roads: number | null; majorRoads: number | null; waterPolygons: number | null; waterLines: number | null; waterNames: string[]; districts: number | null; districtNames: string[]; places: number | null; homes: number | null; hasContext: boolean | null; extent: string | null; error?: string }
/** What the city's own map data holds (the same pack the page builds). */
async function packStats(id: string): Promise<PackStats> {
  try {
    const map: any = await loadCityMap(id);
    const loaded: any = await map.loadScene();
    const pack = loaded.default ?? loaded;
    return {
      roads: pack.roads?.length ?? 0, majorRoads: (pack.roads ?? []).filter((road: any) => road.major).length,
      waterPolygons: pack.water?.length ?? 0, waterLines: pack.waters?.length ?? 0, waterNames: (pack.waters ?? []).map((w: any) => w.name).filter(Boolean).slice(0, 12),
      districts: pack.lgas?.length ?? 0, districtNames: (pack.lgas ?? []).map((l: any) => l.name).slice(0, 60),
      places: Object.keys(pack.sites ?? {}).length, homes: Object.keys(pack.homes ?? {}).length, hasContext: Boolean(pack.context), extent: pack.extent ?? null,
    };
  } catch (error) {
    return { roads: null, majorRoads: null, waterPolygons: null, waterLines: null, waterNames: [], districts: null, districtNames: [], places: null, homes: null, hasContext: null, extent: null, error: String((error as Error).message ?? error).slice(0, 200) };
  }
}

/** "Play now" leaves a guest who has not chosen a home: settle through Sim > Profile > "Make this life yours" (Ikeja), so travel is allowed. */
async function settle(b: Browser): Promise<void> {
  await b.click('.hud-name');
  await b.click('.sim-link', 'Make this life yours');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'spirit'`, 30000, 'the Spirit step of the settle screen');
  await b.click('[data-key="primary"]');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'home'`, 30000, 'the Home step');
  for (let tries = 0; tries < 4; tries++) {
    await b.click('[data-key="area:ikeja"]', undefined, 30000);
    if (await b.waitFor(`(() => { const next = document.querySelector('[data-key="primary"], [data-key="next"]'); return !!next && !next.disabled; })()`, 4000, 'Next to unlock').catch(() => false)) break;
  }
  await b.click('[data-key="primary"]');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'ready'`, 30000, 'the Ready step');
  await b.click('[data-key="primary"]', 'Start your life');
  await b.waitFor(`(async () => { const m = await fetch('/api/life?city=lagos').then((r) => r.json()); return m.state.onboarding.done && !document.querySelector('[data-cr-root]'); })()`, 90000, 'the settled life');
  await dismiss(b, 3000);
}

// ---- the atlas levels ------------------------------------------------------------------------------------------------
async function openMap(b: Browser): Promise<void> {
  // The Map tab toggles: press it only when no map is on screen.
  if (!(await b.eval<boolean>(`${shown('[data-atlas-levels]')} || ${shown('.map-levels-cur')}`))) await b.click('[data-nav="map"]');
  await b.waitFor(`${shown('[data-atlas-levels]')} || ${shown('.map-levels-cur')}`, 30000, 'the map');
}
async function atlasLevel(b: Browser, level: 'world' | 'africa' | 'nigeria', record: Record<string, unknown>): Promise<void> {
  await openMap(b);
  const want = level === 'world' ? 0 : level === 'africa' ? 1 : 2;
  if (await b.eval<boolean>(shown('[data-atlas-levels]'))) { await b.click('[data-atlas-levels]'); await b.click(`[data-atlas-level="${want}"]`); }
  else { await b.click('.map-levels-cur'); await b.click(`[data-map-level="${level}"]`); }
  await b.waitFor(shown('[data-atlas-pick]'), 30000, `the ${level} list of places`);
  await sleep(1500);
  const settled = await settledShot(b, `atlas-${level}.jpg`, 12000);
  const info: any = await b.eval(`(() => ({ rows: [...document.querySelectorAll('[data-atlas-pick]')].map((e) => ({ id: e.getAttribute('data-atlas-pick'), text: e.innerText.replace(/\\s+/g, ' ').trim(), open: e.classList.contains('is-open') })) }))()`);
  // Only the count is kept for the long lists; the open rows are kept in full.
  record[level] = { settled, rows: info.rows.length, open: info.rows.filter((row: any) => row.open).map((row: any) => row.text), notOpen: info.rows.length - info.rows.filter((row: any) => row.open).length };
}

// ---- one city's map --------------------------------------------------------------------------------------------------
interface CityRecord { id: string; name: string; country: string; arrived: boolean; viaHop: string | null; kind: string | null; header: string; listedRows: number; mapMs: number | null; shots: string[]; settled: boolean[]; whole: Labels | null; zoom: Labels | null; pack: PackStats | null; consoleErrors: string[]; failure: string | null; text: string }

async function captureCity(b: Browser, id: string, name: string, country: string, via: string | null): Promise<CityRecord> {
  const record: CityRecord = { id, name, country, arrived: true, viaHop: via, kind: null, header: '', listedRows: 0, mapMs: null, shots: [], settled: [], whole: null, zoom: null, pack: null, consoleErrors: [], failure: null, text: '' };
  const errorsBefore = b.consoleErrors.length;
  try {
    await dismiss(b, 1500);
    const began = Date.now();
    // The page remembers an open atlas: its "Back to the city" button comes back to the city map.
    if (await b.eval<boolean>(shown('[data-atlas-city]'))) await b.click('[data-atlas-city]');
    await openMap(b);
    await b.waitFor(`(document.querySelector('.map-levels-cur')?.textContent || '').includes(${JSON.stringify(name)})`, 30000, `the ${name} map chip`);
    await b.waitFor(`document.querySelectorAll('[data-venue]').length > 0`, 60000, 'place labels on the city map');
    record.mapMs = Date.now() - began;
    record.kind = await b.eval<string>(`document.querySelector('[data-m3="fit"]') ? '3d' : document.querySelector('[data-cmap="fit"]') ? '2d' : 'unknown'`);
    await setList(b, false);
    const fit = record.kind === '2d' ? '[data-cmap="fit"]' : '[data-m3="fit"]';
    await b.click(fit);
    await sleep(600);
    record.header = await listHeader(b);
    const settled1 = await settledShot(b, `${id}-1-whole.jpg`);
    record.whole = await labels(b);
    await setList(b, true);
    const settled2 = await settledShot(b, `${id}-2-list.jpg`);
    record.listedRows = await b.eval<number>(`[...document.querySelectorAll('.map-list button')].filter((e) => e.getBoundingClientRect().width > 1).length`);
    // The busiest part: wheel in over the densest cluster of labels, list hidden so the whole map is open.
    await setList(b, false);
    await b.click(fit); await sleep(600);
    const where = (await labels(b)).centre ?? { x: 640, y: 400 };
    for (let tick = 0; tick < 4; tick++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: where.x, y: where.y, deltaX: 0, deltaY: -240 }); await sleep(250); }
    const settled3 = await settledShot(b, `${id}-3-zoom.jpg`);
    record.zoom = await labels(b);
    record.shots = [`${id}-1-whole.jpg`, `${id}-2-list.jpg`, `${id}-3-zoom.jpg`];
    record.settled = [settled1, settled2, settled3];
    record.text = await b.eval<string>(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600)`);
  } catch (error) {
    record.failure = error instanceof Error ? error.message : String(error);
    await settledShot(b, `${id}-failure.jpg`, 1500).catch(() => undefined);
    record.shots = [`${id}-failure.jpg`];
  }
  record.consoleErrors = b.consoleErrors.slice(errorsBefore).filter((line) => !NOISE.some((pattern) => pattern.test(line)));
  return record;
}

// ---- the route -------------------------------------------------------------------------------------------------------
async function travel(b: Browser, from: string, to: string, mode: string, playerId: string): Promise<void> {
  const answer = await b.eval<any>(`fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cityId: ${JSON.stringify(from)}, type: 'estate.relocate', payload: { to: ${JSON.stringify(to)}, mode: ${JSON.stringify(mode)} }, actionId: Date.now() + ':' + crypto.randomUUID() }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
  must(answer.body?.ok === true, `the trip ${from} to ${to} by ${mode} was refused: ${JSON.stringify(answer.body).slice(0, 240)}`);
  const end = Date.now() + 150000;
  for (;;) {
    const life = await lifeOf(b, to).catch(() => ({ status: 0, state: null }));
    if (life.state?.estate?.city === to && !life.state.activeAction) break;
    if (Date.now() > end) throw new Error(`no arrival in ${to} within 150 s`);
    await sleep(1000);
  }
  void playerId;
}

/** The first hop of the cheapest route (by fare, over open cities) from here to the nearest city still to do. */
function nextHop(from: string, todo: ReadonlySet<string>, open: ReadonlySet<string>): { to: string; mode: string; fare: number } | null {
  const cost = new Map<string, number>([[from, 0]]), first = new Map<string, { to: string; mode: string; fare: number }>(), done = new Set<string>();
  for (;;) {
    let at: string | null = null;
    for (const [id, c] of cost) if (!done.has(id) && (at === null || c < cost.get(at)!)) at = id;
    if (at === null) return null;
    if (todo.has(at) && at !== from) return first.get(at) ?? null;
    done.add(at);
    for (const link of linksFrom(at) as { to: string; mode: string; fare: number }[]) {
      if (!open.has(link.to) || done.has(link.to)) continue;
      const next = cost.get(at)! + link.fare;
      if (next < (cost.get(link.to) ?? Infinity)) { cost.set(link.to, next); first.set(link.to, at === from ? link : first.get(at)!); }
    }
  }
}

async function main(): Promise<void> {
  const catalogue = (cityCatalogue() as any[]).map((city) => ({ id: city.id as string, name: city.name as string, open: Boolean(city.open), country: String(city.countryISO ?? 'ng') }));
  const open = new Set(catalogue.filter((city) => city.open).map((city) => city.id));
  const byId = new Map(catalogue.map((city) => [city.id, city]));
  let started: Browser | null = null;
  try { await startServer(); started = await startBrowser(); } catch (error) { await stopAll(started); throw error; }
  const b: Browser = started;
  const results: CityRecord[] = [];
  const atlas: Record<string, unknown> = {};
  try {
    await b.goto(base + '/');
    await b.waitFor(`!!document.querySelector('[data-key="play-now"]')`, 90000, 'the landing "Play now"');
    await b.click('[data-key="play-now"]');
    await b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 120000, 'the game screen');
    await dismiss(b, 4000);
    await settle(b);
    const playerId = await b.eval<string>(`fetch('/api/session').then((r) => r.json()).then((j) => j.session?.id ?? null)`);
    must(playerId, 'the page has no session id');
    await fund(playerId, funding);
    let here = (await lifeOf(b, 'lagos')).state?.estate?.city as string;
    must(here, 'the player has no city');
    for (const level of ['world', 'africa', 'nigeria'] as const) { try { await atlasLevel(b, level, atlas); } catch (error) { atlas[level] = { failure: String(error) }; } }
    writeFileSync(join(out, 'atlas.json'), JSON.stringify(atlas, null, 1));
    // A fresh page puts the player back in the city scene, so the Map tab opens the city map.
    await b.goto(base + '/');
    await b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 120000, 'the game after the atlas');
    await dismiss(b, 4000);
    // The order: where the player is, then the cheapest unvisited neighbour each time (an open city only).
    const todo = new Set(catalogue.filter((city) => city.open && (only.length === 0 || only.includes(city.id))).map((city) => city.id));
    let via: string | null = null;
    const finish = (): void => { writeFileSync(join(out, 'maps.json'), JSON.stringify({ viewport: '1280x800', fundedWith: funding, cities: results }, null, 1)); };
    while (todo.size > 0) {
      if (!todo.has(here)) {
        // Hop to the cheapest linked city still to do; if none is linked directly, through the cheapest linked city that has one.
        const hop = nextHop(here, todo, open);
        must(hop, `no route from ${here} to anything still to do (${[...todo].join(',')})`);
        const life = (await lifeOf(b, here)).state;
        if (life.cash < hop.fare + 100000) await fund(playerId, funding);
        console.log(`  travel ${here} -> ${hop.to} (${hop.mode}, ${hop.fare})`);
        await travel(b, here, hop.to, hop.mode, playerId);
        via = `${here} by ${hop.mode} (fare ${hop.fare})`;
        here = hop.to;
        await sleep(1500);
        if (!todo.has(here)) continue;
      }
      const entry = byId.get(here)!;
      console.log(`${entry.id}: capture`);
      const record = await captureCity(b, entry.id, entry.name, entry.country, via);
      record.pack = await packStats(entry.id);
      results.push(record);
      todo.delete(here);
      finish();
      console.log(`  ${record.failure ? 'FAILED ' + record.failure.slice(0, 160) : `${record.kind} ${record.header} rows=${record.listedRows} ${record.mapMs}ms`}`);
      if (record.failure) { await b.goto(base + '/'); await b.waitFor(`!!document.querySelector('.hud-cash')`, 90000, 'the game after a reload').catch(() => undefined); await dismiss(b, 3000); }
    }
  } finally {
    await stopAll(b);
  }
}

main().then(() => { console.log('done'); process.exit(0); }, (error) => { console.error(error); process.exit(1); });
