#!/usr/bin/env node
/**
 * Screenshots and timings of the city map in a real browser, for a visual check of a destination's map detail.
 *
 *   node --experimental-strip-types scripts/journeys/map-shots.ts --out <folder> [--port 4311] [--debug-port 4331] [--cities kigali,cairo]
 *
 * It builds nothing (run `npm run build` first). It starts the built app (scripts/journeys/serve.ts, fresh data folder, no outside
 * request) and ONE headless Chrome, plays one new guest through the "Play now" shortcut, settles through Sim > Profile, funds it once
 * through the founder fixture route, then takes one set of map screenshots in the home city and in each destination. The last
 * destination is also shot at phone size (device metrics and touch only: a simulation, not a phone).
 * Timings are software-rendered headless numbers: comparable with each other, not with a real device.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Browser, sleep } from './cdp.ts';

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
};
const out = resolve(arg('out'));
const port = Number(arg('port', '4311')), debugPort = Number(arg('debug-port', '4331'));
const cities = arg('cities', 'kigali,cairo').split(',').map((c) => c.trim()).filter(Boolean);
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'mapshots-'));
const dataDir = join(work, 'data'), cookieFile = join(work, 'founder.cookie');
const ROWS: Record<string, { name: string; row: string; level?: 'africa' | 'nigeria' }> = {
  abuja: { name: 'Abuja', row: 'Federal Capital Territory', level: 'nigeria' }, accra: { name: 'Accra', row: 'Ghana' },
  cairo: { name: 'Cairo', row: 'Egypt' }, kigali: { name: 'Kigali', row: 'Rwanda' }, rabat: { name: 'Rabat', row: 'Morocco' },
  kampala: { name: 'Kampala', row: 'Uganda' }, lusaka: { name: 'Lusaka', row: 'Zambia' },
};
const PLACE_TO_OPEN: Record<string, string> = { cairo: 'Khan El Khalili', kigali: '', lagos: '' };
// --water "cairo=0.5,0.5;rabat=0.2,0.5": where on the screen (fractions of width, height, from the whole-city view) to zoom in on the main water.
const waterAt: Record<string, [number, number]> = {};
for (const part of arg('water', '').split(';').filter(Boolean)) { const [c, xy] = part.split('='); const [x, y] = xy!.split(',').map(Number); waterAt[c!.trim()] = [x!, y!]; }
// --short "abuja,accra": cities that only get the default view and the simple map (the comparison cities).
const short = new Set(arg('short', 'lagos,abuja,accra').split(',').filter(Boolean));
const waterOnly = process.argv.includes('--water-only');

let server: ChildProcess | null = null;
const serverLog: string[] = [];
async function startServer(): Promise<void> {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/journeys/serve.ts', '--port', String(port), '--data', dataDir, '--cookie-file', cookieFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  server = child;
  console.log(`server pid ${child.pid}`);
  child.stdout!.on('data', (c) => serverLog.push(String(c)));
  child.stderr!.on('data', (c) => serverLog.push(String(c)));
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (serverLog.join('').includes('journey server ready') && child.exitCode === null) return;
    if (child.exitCode !== null) throw new Error(`server stopped: ${serverLog.join('').slice(-400)}`);
    await sleep(200);
  }
  throw new Error('server not ready');
}
async function stopServer(): Promise<void> {
  const child = server;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((done) => { child.once('exit', () => done()); child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 20000).unref(); });
}

const must = (c: unknown, m: string): void => { if (!c) throw new Error(m); };
async function cookieOf(b: Browser): Promise<string> {
  const jar = await b.send('Network.getCookies', { urls: [base] });
  return (jar.cookies as { name: string; value: string }[]).map((c) => `${c.name}=${c.value}`).join('; ');
}
async function lifeRaw(b: Browser, city: string): Promise<{ status: number; state: any }> {
  const r = await fetch(`${base}/api/life?city=${city}`, { headers: { Cookie: await cookieOf(b) } });
  const body = await r.json().catch(() => null) as { state?: unknown } | null;
  return { status: r.status, state: body?.state };
}
async function until(check: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  for (;;) { if (await check().catch(() => false)) return; if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await sleep(250); }
}
async function dismiss(b: Browser, waitMs = 4000): Promise<void> {
  const end = Date.now() + waitMs;
  for (;;) {
    const p = await b.locate('button.tour-skip, button.is-quiet').catch(() => null);
    if (p) { await b.tapAt(p.x, p.y); await sleep(400); continue; }
    if (Date.now() > end) return;
    await sleep(250);
  }
}
const gameShown = (b: Browser): Promise<void> => b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 60000, 'the game screen');
async function chooseIkeja(b: Browser): Promise<void> {
  for (let t = 0; t < 4; t++) {
    await b.click('[data-key="area:ikeja"]', undefined, 30000);
    if (await b.waitFor(`(() => { const n = document.querySelector('[data-key="primary"], [data-key="next"]'); return !!n && !n.disabled; })()`, 4000, 'Next').catch(() => false)) return;
  }
  throw new Error('Ikeja did not unlock Next');
}
async function fund(playerId: string, amount: number): Promise<void> {
  const cookie = readFileSync(cookieFile, 'utf8').trim();
  const r = await fetch(`${base}/api/admin/players/${playerId}/act`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ clientId: `${Date.now()}:${randomUUID()}`, action: 'credit', amount, reason: 'Map check fixture' }) });
  must(r.status === 200, `credit answered ${r.status}`);
}
const shownNow = (s: string): string => `[...document.querySelectorAll(${JSON.stringify(s)})].some((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; })`;

/** Play now, then settle through Sim > Profile (the full creator's last tap is not used). */
async function settle(b: Browser): Promise<string> {
  console.log('settle step 1');
  await b.goto(base + '/');
  console.log('settle step 2');
  await b.waitFor(`!!document.querySelector('[data-qs-name]')`, 60000, 'the start screen');
  await sleep(600);
  console.log('settle step 3');
  await b.type('[data-qs-name]', 'Map Checker');
  console.log('settle step 4');
  await b.click('[data-key="play-now"]');
  await gameShown(b); await dismiss(b);
  console.log('settle step 5');
  await b.click('.hud-name');
  console.log('settle step 6');
  await b.click('.sim-link', 'Make this life yours');
  console.log('settle step 7');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'spirit'`, 20000, 'spirit');
  console.log('settle step 8');
  await b.click('[data-key="primary"]');
  console.log('settle step 9');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'home'`, 20000, 'home');
  await chooseIkeja(b);
  console.log('settle step 10');
  await b.click('[data-key="primary"]');
  console.log('settle step 11');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'ready'`, 20000, 'ready');
  console.log('settle step 12');
  await b.click('[data-key="primary"]', 'Start your life');
  console.log('settle step 13');
  await b.waitFor(`(async () => { const m = await fetch('/api/life?city=lagos').then((r) => r.json()); return m.state.onboarding.done && !document.querySelector('[data-cr-root]'); })()`, 60000, 'settled');
  await gameShown(b); await dismiss(b);
  return b.eval<string>(`fetch('/api/session').then((r) => r.json()).then((j) => j.session.id)`);
}

let current = 'lagos';
async function fly(b: Browser, city: string): Promise<void> {
  const t = ROWS[city]!;
  if (!(await b.eval<boolean>(shownNow('[data-atlas-levels]'))) && !(await b.eval<boolean>(shownNow('.map-levels-cur')))) await b.click('[data-nav="map"]');
  await b.waitFor(`${shownNow('.map-levels-cur')} || ${shownNow('[data-atlas-levels]')}`, 30000, 'the map');
  const level = t.level ?? 'africa', wanted = level === 'africa' ? 1 : 2;
  if (!(await b.eval<boolean>(shownNow('[data-atlas-levels]')))) { await b.click('.map-levels-cur'); await b.click(`[data-map-level="${level}"]`); }
  else { const cur = await b.eval<string>(`document.querySelector('[data-atlas-levels]').textContent.trim().toLowerCase()`); if (!cur.startsWith(level)) { await b.click('[data-atlas-levels]'); await b.click(`[data-atlas-level="${wanted}"]`); } }
  await b.waitFor(`${shownNow('[data-atlas-levels]')} && document.querySelector('[data-atlas-levels]').textContent.trim().toLowerCase().startsWith(${JSON.stringify(level)})`, 30000, `${level} level`);
  if (!(await b.eval<boolean>(`!!document.querySelector('[data-atlas-search]') && document.querySelector('[data-atlas-search]').getBoundingClientRect().width > 1`))) await b.click('[data-atlas-list]').catch(() => undefined);
  await b.waitFor(`!!document.querySelector('[data-atlas-search]') && document.querySelector('[data-atlas-search]').getBoundingClientRect().width > 1`, 15000, 'search');
  await b.type('[data-atlas-search]', t.row);
  await b.click('[data-atlas-pick]', t.row);
  await b.waitFor(`document.querySelector('[data-atlas-go="${city}:air"]')`, 30000, 'flight line');
  await b.click(`[data-atlas-go="${city}:air"]`);
  if (await b.waitFor<string>(`document.querySelector('[data-atlas-sure]') ? 'ask' : ''`, 4000, 'confirm').catch(() => '')) await b.click('[data-atlas-sure]');
  await until(async () => { const m = await lifeRaw(b, current); return m.state?.estate?.city === city && !m.state.activeAction; }, 150000, `arrival in ${t.name}`);
  await until(async () => !(await lifeRaw(b, city)).state?.activeAction, 60000, 'the action to end');
  current = city;
  await gameShown(b); await dismiss(b);
}

const timings: Record<string, unknown> = {};
const notes: string[] = [];

/** Opens the map and measures: ms from the tap to a first full render (the map element built and labels drawn, two frames after). */
async function openMap(b: Browser, key: string): Promise<void> {
  await b.eval(`window.__rafs = 0; (function tick(){ window.__rafs++; requestAnimationFrame(tick); })(); true`);
  const t0 = Date.now();
  await b.click('[data-nav="map"]');
  if (!(await b.waitFor<boolean>(shownNow('.map-handle'), 8000, 'the map panel').catch(() => false))) {
    // A touch tap on the tab did not open the map: press the tab's own click once, and say so.
    notes.push(`${key}: the touch tap on the Map tab did not open the map; opened with a scripted click`);
    await b.eval(`document.querySelector('[data-nav="map"]').click(); true`);
  }
  await b.waitFor(shownNow('.map-handle'), 60000, 'the map panel on screen');
  await b.waitFor(`(() => { const c = document.querySelector('[data-map]'); return !!c && (c.dataset.map === '3d' || c.dataset.map === '2d') && document.querySelectorAll('.m3-label').length > 0; })()`, 120000, 'the city map to render');
  await b.eval(`new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))`);
  timings[`${key}.msToFirstRender`] = Date.now() - t0;
  timings[`${key}.kind`] = await b.eval<string>(`document.querySelector('[data-map]').dataset.map`);
  await sleep(3000);
}

/** About five seconds of slow panning with the mouse; rAF callbacks counted by the page. */
async function pan(b: Browser, key: string): Promise<void> {
  const { width, height } = b.viewport;
  const x0 = width * 0.4, y0 = height * 0.5;
  const before = await b.eval<number>(`window.__rafs`);
  const t0 = Date.now();
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  let i = 0;
  while (Date.now() - t0 < 5000) {
    i++;
    const x = x0 + Math.sin(i / 12) * 150, y = y0 + Math.cos(i / 16) * 90;
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0, y: y0, button: 'left', clickCount: 1 });
  const frames = (await b.eval<number>(`window.__rafs`)) - before;
  timings[`${key}.panFps`] = Math.round((frames / ((Date.now() - t0) / 1000)) * 10) / 10;
}

async function listOpen(b: Browser): Promise<void> {
  const open = await b.eval<boolean>(`(() => { const l = document.querySelector('#map-list'); return !!l && !l.hidden && l.getBoundingClientRect().height > 1; })()`);
  if (!open) { await b.click('.map-handle'); await sleep(900); }
}
async function scrollList(b: Browser, to: 'top' | 'middle' | 'bottom'): Promise<number> {
  return b.eval<number>(`(() => {
    const root = document.querySelector('#map-list'); if (!root) return -1;
    const els = [root, ...root.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY));
    const el = els[els.length - 1] || els[0]; if (!el) return -2;
    el.scrollTop = ${JSON.stringify(to)} === 'top' ? 0 : ${JSON.stringify(to)} === 'bottom' ? el.scrollHeight : (el.scrollHeight - el.clientHeight) / 2;
    return el.scrollHeight;
  })()`);
}
async function listText(b: Browser): Promise<string[]> {
  // Walk the list from the top to collect every row (the list loads more rows as it is scrolled).
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const rows = await b.eval<string[]>(`[...document.querySelectorAll('#map-list .map-list button')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
    const before = seen.size;
    rows.forEach((r) => seen.add(r));
    await b.eval(`(() => { const root = document.querySelector('#map-list'); const els = [root, ...root.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)); const el = els[els.length - 1]; if (el) el.scrollTop += el.clientHeight * 0.8; return true; })()`);
    await sleep(350);
    if (i > 3 && seen.size === before) break;
  }
  await scrollList(b, 'top');
  return [...seen];
}
async function click3(b: Browser, name: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) { await b.click(`[data-m3="${name}"]`, undefined, 8000).catch(() => undefined); await sleep(700); }
}

async function wheelZoom(b: Browser, fx: number, fy: number, notches: number): Promise<void> {
  const { width, height } = b.viewport;
  for (let i = 0; i < notches; i++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width * fx, y: height * fy, deltaX: 0, deltaY: -120 }); await sleep(250); }
}
async function simpleMap(b: Browser, shot: (l: string) => Promise<void>, label: string, prefix: string): Promise<void> {
  const hasSwitch = await b.eval<boolean>(`(() => { const s = document.querySelector('.cmap-switch'); return !!s && !s.hidden && s.getBoundingClientRect().width > 1; })()`);
  if (!hasSwitch) { notes.push(`${prefix}: no Simple map switch offered`); return; }
  await b.click('.cmap-switch');
  await b.waitFor(`document.querySelector('[data-map]')?.dataset.map === '2d'`, 60000, 'the simple map');
  await sleep(3500);
  await shot(label);
  await b.click('.cmap-switch');
  await b.waitFor(`document.querySelector('[data-map]')?.dataset.map === '3d'`, 60000, 'the 3D map');
  await sleep(3000);
}

async function mapSet(b: Browser, prefix: string, place: string, opts: { phone?: boolean } = {}): Promise<void> {
  const shot = async (label: string): Promise<void> => { await sleep(700); await b.screenshot(join(out, `${prefix}-${label}.png`)); console.log(`shot ${prefix}-${label}`); };
  await openMap(b, prefix);
  if (waterOnly) {
    const w = waterAt[prefix];
    await click3(b, 'fit', 1); await sleep(1500);
    await shot('02-whole-city');
    if (w) { await wheelZoom(b, w[0], w[1], 6); await sleep(1800); await shot('05-zoom-water'); }
    return;
  }
  await shot('01-default');
  if (opts.phone) { await listOpen(b); await shot('02-list'); await scrollList(b, 'bottom'); await shot('03-list-bottom'); }
  await pan(b, prefix);
  if (opts.phone) { await b.click('.map-handle').catch(() => undefined); await sleep(600); }
  await click3(b, 'fit', 1); await sleep(1500);
  if (short.has(prefix) && !opts.phone) { await simpleMap(b, shot, '08-simple-map', prefix); return; }
  await shot(opts.phone ? '04-whole-city' : '02-whole-city');
  if (opts.phone) return;
  await click3(b, 'in', 3); await sleep(1800);
  await shot('03-zoom-centre');
  await click3(b, 'in', 2); await sleep(1800);
  await shot('04-zoom-closer');
  await click3(b, 'fit', 1); await sleep(1200);
  { const w = waterAt[prefix]; if (w) { await wheelZoom(b, w[0], w[1], 6); await sleep(1800); await shot('04b-zoom-water'); await click3(b, 'fit', 1); await sleep(1200); } }
  await listOpen(b);
  await scrollList(b, 'top'); await shot('05-list-top');
  const total = await scrollList(b, 'bottom'); notes.push(`${prefix}: list scroll height ${total}`);
  await shot('06-list-bottom');
  await scrollList(b, 'top');
  const rows = await listText(b);
  writeFileSync(join(out, `${prefix}-places.txt`), rows.join('\n') + '\n');
  // One place opened from the list.
  const picked = await b.eval<string>(`(() => { const rows = [...document.querySelectorAll('#map-list .map-list button')]; const w = ${JSON.stringify(place.toLowerCase())}; const r = (w && rows.find((x) => x.innerText.toLowerCase().includes(w))) || rows.find((x) => !x.classList.contains('is-here')) || rows[0]; if (!r) return ''; r.scrollIntoView({ block: 'center' }); r.click(); return r.innerText.replace(/\\s+/g, ' ').trim(); })()`);
  notes.push(`${prefix}: opened "${picked}"`);
  await sleep(2500);
  await shot('07-place-card');
  await b.press('Escape', 'Escape', 27); await sleep(800);
  await simpleMap(b, shot, '08-simple-map', prefix);
}

let b: Browser | null = null;
try {
  await startServer();
  b = await Browser.launch(debugPort);
  console.log(`chrome pid ${b.child.pid}`);
  b.child.on('exit', () => undefined);
  await b.setViewport({ width: 1280, height: 800, scale: 1, mobile: false });
  const id = await settle(b);
  await fund(id, 9000000);
  await until(async () => ((await lifeRaw(b!, 'lagos')).state?.cash ?? 0) >= 9000000, 30000, 'funded wallet');
  await dismiss(b, 1000);
  await mapSet(b, 'lagos', '');
  for (const city of cities) {
    await fly(b, city);
    await mapSet(b, city, PLACE_TO_OPEN[city] ?? '');
  }
  // Phone: the last city, reloaded at phone size.
  const last = cities[cities.length - 1]!;
  await b.setViewport({ width: 390, height: 844, scale: 3, mobile: true });
  await b.goto(base + '/');
  await gameShown(b); await dismiss(b);
  await mapSet(b, `${last}-phone`, '', { phone: true });
  const errors = b.consoleErrors.filter((e) => !/401|409/.test(e));
  writeFileSync(join(out, 'timings.json'), JSON.stringify({ note: 'headless software rendering; comparable only with each other', timings, notes, consoleErrors: errors }, null, 2));
  console.log(JSON.stringify({ timings, notes, errors }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (b) await b.screenshot(join(out, 'aborted.png')).catch(() => undefined);
  writeFileSync(join(out, 'timings.json'), JSON.stringify({ aborted: String(error), timings, notes }, null, 2));
  process.exitCode = 1;
} finally {
  b?.close();
  await stopServer();
  rmSync(work, { recursive: true, force: true });
}
