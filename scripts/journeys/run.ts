#!/usr/bin/env node
/**
 * Played travel journeys: a brand-new guest, a real browser, the real screens.
 *
 *   node --experimental-strip-types scripts/journeys/run.ts --out <folder> [--cities cairo,rabat,kigali,kampala,lusaka]
 *        [--port 4311] [--debug-port 4331] [--phone] [--keep-data]
 *
 * It builds nothing: run `npm run build` first. It starts the built app itself (scripts/journeys/serve.ts, a fresh data folder,
 * the repo's sign-in stand-in, no outside request), starts ONE headless Chrome at a time (scripts/journeys/cdp.ts), and stops both
 * when it ends. For every city, as a new guest created through the start screens:
 *   1  onboard through the start flow (and land at home)      6  the home in Lagos, the name and the look are unchanged
 *   2  the destination is on the map with a fare              7  fly back through the Home tab and arrive at the owned home
 *   3  too little money: the fare is refused, nothing charged 8  the same purchase sent again is not charged twice
 *   4  one admin credit with one idempotency id, replayed     9  stop the server, start it on the same data: same life
 *   5  buy the ticket and travel; arrive; money down by exactly the fare; a receipt line
 * `--phone` adds the simulated-phone run (390x844 and 320x568, touch, 3x scale, 4G-like network, 4x slower CPU).
 * Screenshots and one JSON result per city go to --out. The exit code is not zero when any step fails.
 * Server calls are made by the page itself, with its own cookie, only to READ the player's life or to repeat a purchase (step 8);
 * the one other call is the funding credit of step 4, made with the founder fixture session of serve.ts.
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
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const out = resolve(arg('out'));
const port = Number(arg('port', '4311')), debugPort = Number(arg('debug-port', '4331'));
const requested = arg('cities', 'cairo,rabat,kigali,kampala,lusaka').split(',').map((city) => city.trim()).filter(Boolean);
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'journey-run-'));
const dataDir = join(work, 'data'), cookieFile = join(work, 'founder.cookie');

/** Where each destination is found: the map level and the row (a country in Africa, a state in Nigeria) that holds it. */
const DESTINATIONS: Record<string, { name: string; level: 'africa' | 'nigeria'; row: string }> = {
  cairo: { name: 'Cairo', level: 'africa', row: 'Egypt' },
  rabat: { name: 'Rabat', level: 'africa', row: 'Morocco' },
  kigali: { name: 'Kigali', level: 'africa', row: 'Rwanda' },
  kampala: { name: 'Kampala', level: 'africa', row: 'Uganda' },
  lusaka: { name: 'Lusaka', level: 'africa', row: 'Zambia' },
  abuja: { name: 'Abuja', level: 'nigeria', row: 'Federal Capital Territory' },
};

// ---- the server -----------------------------------------------------------------------------------------------------
let server: ChildProcess | null = null;
const serverLog: string[] = [];
async function startServer(): Promise<void> {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/journeys/serve.ts', '--port', String(port), '--data', dataDir, '--cookie-file', cookieFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  server = child;
  child.stdout!.on('data', (chunk) => serverLog.push(String(chunk)));
  child.stderr!.on('data', (chunk) => serverLog.push(String(chunk)));
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (serverLog.join('').includes('journey server ready') && child.exitCode === null) return;
    if (child.exitCode !== null) throw new Error(`The journey server stopped at start: ${serverLog.join('').slice(-400)}`);
    await sleep(200);
  }
  throw new Error('The journey server did not become ready');
}
async function stopServer(): Promise<void> {
  const child = server;
  if (!child || child.exitCode !== null) { server = null; return; }
  await new Promise<void>((done) => { child.once('exit', () => done()); child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 25000).unref(); });
  server = null;
}

// ---- results --------------------------------------------------------------------------------------------------------
type Status = 'PASS' | 'FAIL' | 'NOT RUN';
interface StepResult { step: number; name: string; status: Status; detail: Record<string, unknown>; shot?: string }
interface CityResult { city: string; steps: StepResult[]; consoleErrors: string[]; notes: string[]; ok: boolean }

class Journey {
  readonly steps: StepResult[] = [];
  readonly notes: string[] = [];
  readonly unexpectedRefusals: string[] = [];
  private shotNo = 0;
  readonly city: string;
  readonly browser: Browser;
  readonly tag: string;
  constructor(city: string, browser: Browser, tag = city) { this.city = city; this.browser = browser; this.tag = tag; }
  async shot(label: string): Promise<string> {
    const file = `${this.tag}-${String(++this.shotNo).padStart(2, '0')}-${label}.png`;
    await this.browser.screenshot(join(out, file));
    return file;
  }
  /** Runs one numbered step: any thrown failure is recorded with a screenshot and the journey goes on to what it still can. */
  async run(step: number, name: string, body: (detail: Record<string, unknown>) => Promise<void>): Promise<boolean> {
    const detail: Record<string, unknown> = {};
    let status: Status = 'PASS';
    const seen = this.browser.requests.length;
    try { await body(detail); } catch (error) { status = 'FAIL'; detail['failure'] = error instanceof Error ? error.message : String(error); }
    // Every failed request the page itself made during the step (by the browser's own record), with the one expected 401 left out.
    const failedCalls: string[] = [];
    for (const request of this.browser.requests.slice(seen)) {
      if ((request.status ?? 0) < 400 || (request.status === 401 && request.url.endsWith('/api/session'))) continue;
      const line = `${request.status} ${request.method} ${request.url.replace(base, '')} ${((await this.browser.responseBody(request.requestId)) ?? '').slice(0, 160)}`;
      failedCalls.push(line);
      if (!KNOWN_REFUSALS.some((pattern) => pattern.test(line))) this.unexpectedRefusals.push(`step ${step}: ${line}`);
    }
    if (failedCalls.length) detail['pageRequestsRefused'] = failedCalls;
    const shot = await this.shot(`step${step}-${status === 'PASS' ? 'ok' : 'fail'}`).catch(() => undefined);
    this.steps.push({ step, name, status, detail, ...(shot ? { shot } : {}) });
    console.log(`  [${this.tag}] step ${step} ${status}: ${name}${status === 'FAIL' ? ` -- ${String(detail['failure']).slice(0, 300)}` : ''}`);
    return status === 'PASS';
  }
  skip(step: number, name: string, why: string): void { this.steps.push({ step, name, status: 'NOT RUN', detail: { why } }); console.log(`  [${this.tag}] step ${step} NOT RUN: ${name} (${why})`); }
}

// ---- page helpers ---------------------------------------------------------------------------------------------------
const naira = (n: number): string => `₦${n.toLocaleString('en-US')}`;
const digits = (text: string): number => Number(text.replace(/[^0-9]/g, ''));
const must = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };

/** The cookie the browser holds for the app, so the player's own life can be read without adding noise to the page's console. */
async function cookieOf(b: Browser): Promise<string> {
  const jar = await b.send('Network.getCookies', { urls: [base] });
  return (jar.cookies as { name: string; value: string }[]).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}
/** The player's own life as the server holds it (read-only). */
async function lifeRaw(b: Browser, city: string): Promise<{ status: number; state: any }> {
  const response = await fetch(`${base}/api/life?city=${city}`, { headers: { Cookie: await cookieOf(b) } });
  const body = await response.json().catch(() => null) as { state?: unknown } | null;
  return { status: response.status, state: body?.state };
}
async function life(b: Browser, city: string): Promise<any> {
  const answer = await lifeRaw(b, city);
  must(answer.status === 200 && answer.state, `GET /api/life?city=${city} answered ${answer.status}`);
  return answer.state;
}
/** Polls (outside the page) until the check is true. */
async function until(check: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms waiting for ${what}`);
    await sleep(250);
  }
}
const hudCash = (b: Browser): Promise<number> => b.eval<string>(`document.querySelector('.hud-cash')?.textContent || ''`).then(digits);
async function sessionId(b: Browser): Promise<string> {
  const id = await b.eval<string | null>(`fetch('/api/session').then((r) => r.json()).then((j) => j.session?.id ?? null)`);
  must(id, 'the page has no session id');
  return id as string;
}
/** Closes the guide tour and any quiet offer that is in front of the game. */
async function dismiss(b: Browser, waitMs = 5000): Promise<void> {
  // The guide's tour comes up a moment after the game does: wait a little for it, then close whatever is in front.
  const end = Date.now() + waitMs;
  for (;;) {
    const point = await b.locate('button.tour-skip, button.is-quiet').catch(() => null);
    if (point) { await b.tapAt(point.x, point.y); await sleep(400); continue; }
    if (Date.now() > end) return;
    await sleep(250);
  }
}
async function gameShown(b: Browser): Promise<void> { await b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 60000, 'the game screen with the wallet'); }
/**
 * Browser log lines for refusals the app is built to give and handle: no session yet on the first visit (401 /api/session), the street journey
 * not begun (409 street_journey_missing) and the page's last read of the city just left (409 city_moved, which says where the character is).
 * The page's refused requests are also kept with their bodies per step; one that is not one of these is counted as an error below.
 */
const KNOWN_LOG_NOISE = [/status of 401 \(Unauthorized\) .*\/api\/session$/, /status of 409 \(Conflict\) .*\/api\/street\/me$/, /status of 409 \(Conflict\) .*\/api\/life\?city=[a-z-]+$/];
const KNOWN_REFUSALS = [/street_journey_missing/, /"error":"city_moved"/];
const realErrors = (b: Browser): string[] => b.consoleErrors.filter((line) => !KNOWN_LOG_NOISE.some((pattern) => pattern.test(line)));

/** Chooses Ikeja on the Home step: the list is clicked again when the first tap landed before the area list was ready. */
async function chooseIkeja(b: Browser): Promise<void> {
  for (let tries = 0; tries < 4; tries++) {
    await b.click('[data-key="area:ikeja"]', undefined, 30000);
    if (await b.waitFor(`(() => { const next = document.querySelector('[data-key="primary"], [data-key="next"]'); return !!next && !next.disabled; })()`, 4000, 'the Next button to unlock').catch(() => false)) return;
  }
  throw new Error('Choosing Ikeja never unlocked the Next button on the Home step');
}

/** Taps "Start your life" and makes sure the tap was taken (a request left the page); a tap that lands while the step is still settling is repeated. */
async function tapStartYourLife(b: Browser): Promise<void> {
  const before = b.requests.length;
  for (let tries = 0; tries < 4; tries++) {
    await sleep(500);
    await b.click('[data-key="primary"]', 'Start your life');
    const taken = await b.waitFor<boolean>(`!!document.querySelector('[data-cr-error]') || !!document.querySelector('.hud-cash') || window.__creatorMounts > 0`, 4000, 'the tap to be taken').catch(() => false) || b.requests.slice(before).some((request) => request.method === 'POST');
    if (taken) return;
  }
  throw new Error('"Start your life" was tapped four times and nothing was sent');
}

// ---- step 1: the start screens --------------------------------------------------------------------------------------
async function start(b: Browser, j: Journey, name: string, detail: Record<string, unknown>): Promise<void> {
  await b.goto(base + '/');
  await b.waitFor(`!!document.querySelector('[data-qs-name]')`, 60000, 'the start screen');
  await sleep(600);
  await b.type('[data-qs-name]', name);
  await j.shot('start-you');
  for (let at = 0; at < 4; at++) {
    if (at === 3) await chooseIkeja(b);
    await b.click('[data-key="primary"], [data-key="next"]', undefined, 30000);
    await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === ${JSON.stringify(['look', 'spirit', 'home', 'ready'][at])}`, 20000, `the ${['Look', 'Spirit', 'Home', 'Ready'][at]} step`);
  }
  await j.shot('start-ready');
  // A remount of the creator after the tap is watched for (it is a defect when it happens): the page's own state is read, not guessed.
  await b.eval(`window.__creatorMounts = 0; new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches('[data-cr-root]') || n.querySelector('[data-cr-root]'))) window.__creatorMounts++; }).observe(document.body, { childList: true, subtree: true }); true`);
  const asked = b.requests.length;
  await tapStartYourLife(b);
  // Done when the creator has closed on the game, or (a defect) the creator has been built again at its first step.
  const outcome = await b.waitFor<string>(`(() => {
    const root = document.querySelector('[data-cr-root]');
    if (window.__creatorMounts > 0 && root && root.dataset.step === 'who') return 'creator-back-at-start';
    if (!root && document.querySelector('.hud-cash')) return 'settled';
    return '';
  })()`, 90000, 'the creator to finish or return').catch((error) => { detail['requestsAfterTap'] = b.requests.slice(asked).filter((r) => r.url.includes('/api/')).map((r) => `${r.method} ${r.url.replace(base, '')} ${r.status ?? ''}`); throw error; });
  detail['startOutcome'] = outcome;
  if (outcome === 'settled') { detail['onePass'] = true; return; }
  // The creator came back to its first step with the guest already created: the traits, dream, lottery and home were never sent.
  detail['onePass'] = false;
  detail['finding'] = 'Start your life created the guest but did not send the traits, dream, lottery and home; the creator returned to step 1.';
  detail['requests'] = b.requests.filter((request) => request.method === 'POST' && request.url.includes('/api/')).map((request) => `${request.url.replace(base, '')} ${(request.body ?? '').match(/"type":"[^"]+"/)?.[0] ?? ''}`.trim());
  await j.shot('start-creator-returned');
  j.notes.push('Start your life did not finish the settling in one pass (guest created, creator returned to step 1); settled through Sim > Profile > Make this life yours.');
  await b.click('[data-key="play-now"]');
  await gameShown(b);
  await dismiss(b);
  await b.click('.hud-name');
  await b.click('.sim-link', 'Make this life yours');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'spirit'`, 20000, 'the Spirit step of the settle screen');
  await b.click('[data-key="primary"]');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'home'`, 20000, 'the Home step of the settle screen');
  await chooseIkeja(b);
  await b.click('[data-key="primary"]');
  await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'ready'`, 20000, 'the Ready step');
  await b.click('[data-key="primary"]', 'Start your life');
  await b.waitFor(`(async () => { const m = await fetch('/api/life?city=lagos').then((r) => r.json()); return m.state.onboarding.done && !document.querySelector('[data-cr-root]'); })()`, 60000, 'the settled life');
}

// ---- the map and the ticket -----------------------------------------------------------------------------------------
const shownNow = (selector: string): string => `[...document.querySelectorAll(${JSON.stringify(selector)})].some((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; })`;
async function openMapAt(b: Browser, level: 'africa' | 'nigeria'): Promise<void> {
  // The world map stays built underneath the city map: only what is on screen counts.
  if (!(await b.eval<boolean>(shownNow('[data-atlas-levels]'))) && !(await b.eval<boolean>(shownNow('.map-levels-cur')))) await b.click('[data-nav="map"]');
  await b.waitFor(`${shownNow('.map-levels-cur')} || ${shownNow('[data-atlas-levels]')}`, 30000, 'the map');
  const wanted = level === 'africa' ? 1 : 2;
  const atlasOn = await b.eval<boolean>(shownNow('[data-atlas-levels]'));
  const current = atlasOn ? await b.eval<string>(`document.querySelector('[data-atlas-levels]').textContent.trim()`) : '';
  if (!current.toLowerCase().startsWith(level)) {
    if (atlasOn) { await b.click('[data-atlas-levels]'); await b.click(`[data-atlas-level="${wanted}"]`); }
    else { await b.click('.map-levels-cur'); await b.click(`[data-map-level="${level}"]`); }
  }
  await b.waitFor(`${shownNow('[data-atlas-levels]')} && document.querySelector('[data-atlas-levels]').textContent.trim().toLowerCase().startsWith(${JSON.stringify(level)})`, 30000, `the ${level} map level`);
}
/** Finds the destination on the map and opens its card; returns the fare shown on its flight line. */
async function openDestination(b: Browser, city: string): Promise<{ fare: number; enabled: boolean; why: string }> {
  const target = DESTINATIONS[city]!;
  await openMapAt(b, target.level);
  const searchShown = (): Promise<boolean> => b.eval<boolean>(`!!document.querySelector('[data-atlas-search]') && document.querySelector('[data-atlas-search]').getBoundingClientRect().width > 1`);
  // The list of places is always open on a wide screen and behind "Find a place" on a narrow one.
  const open = await b.waitFor<boolean>(`!!document.querySelector('[data-atlas-search]') && document.querySelector('[data-atlas-search]').getBoundingClientRect().width > 1`, 6000, 'the list').catch(() => false);
  if (!open && !(await searchShown())) await b.click('[data-atlas-list]');
  await b.waitFor(`!!document.querySelector('[data-atlas-search]') && document.querySelector('[data-atlas-search]').getBoundingClientRect().width > 1`, 15000, 'the search box of the map list');
  await b.type('[data-atlas-search]', target.row);
  await b.click('[data-atlas-pick]', target.row);
  await b.waitFor(`document.querySelector('[data-atlas-go="${city}:air"]')`, 30000, `the flight line to ${target.name}`);
  return b.eval(`(() => { const go = document.querySelector('[data-atlas-go="${city}:air"]'); const li = go.closest('li'); const why = li?.querySelector('.atlas-way-why')?.textContent?.trim() || ''; return { fare: Number(go.getAttribute('aria-label').match(/₦([\\d,]+)/)?.[1].replace(/,/g, '')), enabled: !go.disabled, why }; })()`);
}
const sheetText = (b: Browser): Promise<string> => b.eval<string>(`(document.querySelector('.atlas-sheet') || document.body).innerText`);
/** The page's own request that carried the travel purchase, with its id and the server's answer. */
function travelRequest(b: Browser, to: string): { actionId: string; cityId: string; payload: unknown; requestId: string } | null {
  for (const request of [...b.requests].reverse()) {
    if (request.method !== 'POST' || !request.url.endsWith('/api/action') || !request.body) continue;
    const body = JSON.parse(request.body);
    if (body.type === 'estate.relocate' && body.payload?.to === to) return { actionId: body.actionId, cityId: body.cityId, payload: body.payload, requestId: request.requestId };
  }
  return null;
}

/** One admin credit with a single idempotency id, replayed once. Returns the amount's balance after and whether the replay was recognised. */
async function fund(playerId: string, amount: number, reason: string): Promise<{ clientId: string; after: unknown; duplicate: boolean }> {
  const cookie = readFileSync(cookieFile, 'utf8').trim();
  const clientId = `${Date.now()}:${randomUUID()}`;
  const send = async () => {
    const response = await fetch(`${base}/api/admin/players/${playerId}/act`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ clientId, action: 'credit', amount, reason }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const first = await send();
  must(first.status === 200 && first.body['code'] === 'credited', `the admin credit answered ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
  const again = await send();
  must(again.status === 200 && again.body['duplicate'] === true && again.body['after'] === first.body['after'], `the replayed credit was not recognised as the same (${JSON.stringify(again.body).slice(0, 200)})`);
  return { clientId, after: first.body['after'], duplicate: true };
}

/** The birth lottery can pay more than a fare: one admin debit (with the route's own confirmation) brings the wallet under it. */
async function debit(playerId: string, amount: number, reason: string): Promise<void> {
  const cookie = readFileSync(cookieFile, 'utf8').trim();
  const intent: Record<string, unknown> = { clientId: `${Date.now()}:${randomUUID()}`, action: 'debit', amount, reason };
  const send = async () => { const response = await fetch(`${base}/api/admin/players/${playerId}/act`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(intent) }); return { status: response.status, body: await response.json() as Record<string, unknown> }; };
  let answer = await send();
  if (answer.body['code'] === 'confirmation_required') { intent['confirm'] = answer.body['token']; answer = await send(); }
  must(answer.status === 200 && answer.body['code'] === 'debited', `the admin debit answered ${answer.status} ${JSON.stringify(answer.body).slice(0, 200)}`);
}

// ---- the journey for one city ---------------------------------------------------------------------------------------
async function journey(city: string, phone: { width: number; height: number } | null): Promise<CityResult> {
  const target = DESTINATIONS[city]!;
  const tag = phone ? `${city}-phone${phone.width}` : city;
  const b = await Browser.launch(debugPort);
  const j = new Journey(city, b, tag);
  console.log(`${tag}: chrome pid ${b.child.pid}`);
  const bag: Record<string, any> = {};
  try {
    await b.setViewport(phone ? { width: phone.width, height: phone.height, scale: 3, mobile: true } : { width: 1280, height: 800, scale: 1, mobile: false });
    if (phone) await b.throttle(true);
    const playerName = `Journey ${target.name}`;

    const onboarded = await j.run(1, 'Onboard through the start screens and land at home', async (detail) => {
      const began = Date.now();
      await start(b, j, playerName, detail);
      await gameShown(b);
      await dismiss(b);
      detail['seconds'] = Math.round((Date.now() - began) / 100) / 10;
      const state = await life(b, 'lagos');
      must(state.onboarding.done, 'the life is not settled');
      must(state.estate.lga === 'ikeja' && state.estate.city === 'lagos', `the home is not in Ikeja, Lagos (${state.estate.city}/${state.estate.lga})`);
      bag['name'] = state.name; bag['look'] = JSON.stringify(state.onboarding.look); bag['home'] = { lga: state.estate.lga, plot: state.estate.plot, style: state.estate.style, home: state.estate.home };
      bag['cashAtHome'] = state.cash;
      bag['playerId'] = await sessionId(b);
      Object.assign(detail, { name: state.name, cash: state.cash, home: state.estate.home?.name ?? state.estate.lga });
      if (detail['onePass'] === false) throw new Error('The player was settled only after the recovery route: Start your life did not complete in one pass (see the finding in this step).');
    });
    // The recovery route still leaves a settled player: carry on with the journey whatever step 1 said about the one-pass start.
    const settled = bag['playerId'] !== undefined;
    if (!settled) { for (const [n, name] of [[2, 'Destination listed with a fare'], [3, 'Too little money'], [4, 'Fund once, replay'], [5, 'Buy, travel, arrive'], [6, 'Home retained'], [7, 'Fly back'], [8, 'Duplicate purchase'], [9, 'Restart']] as const) j.skip(n, name, 'the player could not be created'); return finish(j, b, city); }
    if (!onboarded) j.notes.push('Step 1 failed on its one-pass check; the journey continued with the settled player.');

    await j.run(2, 'Open the map; the destination is listed with a fare', async (detail) => {
      const line = await openDestination(b, city);
      Object.assign(detail, { fare: line.fare, why: line.why });
      must(line.fare > 0, 'no fare is shown');
      bag['fare'] = line.fare;
      await j.shot('card');
    });

    await j.run(3, 'Too little money: refused with a message, nothing charged', async (detail) => {
      let cash = (await life(b, 'lagos')).cash;
      if (cash >= bag['fare']) {
        const take = cash - (bag['fare'] - 1000);
        await debit(bag['playerId'], take, `Journey ${city} birth cash above the fare`);
        detail['debited'] = take;
        cash = (await life(b, 'lagos')).cash;
        await b.waitFor(`(document.querySelector('.hud-cash')?.textContent || '').replace(/[^0-9]/g, '') === ${JSON.stringify(String(cash))}`, 30000, 'the wallet on screen after the debit');
      }
      detail['cashBefore'] = cash;
      must(cash < bag['fare'], `the fixture player already holds ${naira(cash)}, enough for the ${naira(bag['fare'])} fare`);
      const line = await openDestination(b, city);
      detail['buttonEnabled'] = line.enabled; detail['message'] = line.why;
      must(!line.enabled, 'the flight line is enabled although the player cannot pay');
      must(/need ₦[\d,]+ more/i.test(line.why), `no clear message beside the disabled flight (${JSON.stringify(line.why)})`);
      // The server's own refusal, asked directly with a fresh id: the same answer, nothing charged.
      const refusal = await b.eval<any>(`fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cityId: 'lagos', type: 'estate.relocate', payload: { to: ${JSON.stringify(city)}, mode: 'air' }, actionId: Date.now() + ':' + crypto.randomUUID() }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
      detail['serverRefusal'] = { status: refusal.status, ok: refusal.body?.ok, code: refusal.body?.code, reason: refusal.body?.reason };
      must(refusal.body?.ok === false, `the server did not refuse the unaffordable flight (${JSON.stringify(refusal.body).slice(0, 200)})`);
      const after = (await life(b, 'lagos')).cash;
      detail['cashAfter'] = after;
      must(after === cash, `the refused attempt changed the balance (${cash} -> ${after})`);
    });

    await j.run(4, 'Fund once through the admin credit; replay shows no double credit', async (detail) => {
      const before = (await life(b, 'lagos')).cash;
      const amount = bag['fare'] * 2 + 200000;
      const credit = await fund(bag['playerId'], amount, `Journey ${city} fixture`);
      const after = (await life(b, 'lagos')).cash;
      Object.assign(detail, { cashBefore: before, credited: amount, cashAfter: after, clientId: credit.clientId, replayRecognised: credit.duplicate });
      must(after === before + amount, `the balance moved by ${after - before}, not by the single credit of ${amount}`);
      const lines = ((await life(b, 'lagos')).ledger as any[]).filter((line) => String(line.reason).includes(`Journey ${city} fixture`));
      detail['creditLines'] = lines.length;
      must(lines.length === 1, `${lines.length} ledger lines for the credit (expected 1)`);
      await b.waitFor(`(document.querySelector('.hud-cash')?.textContent || '').replace(/[^0-9]/g, '') === ${JSON.stringify(String(after))}`, 30000, 'the wallet on screen to show the credited balance');
    });

    const arrived = await j.run(5, `Buy the ticket and travel to ${target.name}`, async (detail) => {
      const line = await openDestination(b, city);
      must(line.enabled, `the flight line is still disabled after funding (${line.why})`);
      const before = (await life(b, 'lagos')).cash;
      detail['cashBefore'] = before; detail['fare'] = line.fare;
      await b.click(`[data-atlas-go="${city}:air"]`);
      // A fare above half the cash in hand asks once, in place.
      const asked = await b.waitFor<string>(`document.querySelector('[data-atlas-sure]') ? 'ask' : (document.querySelector('.trip-bar, [data-trip]') ? 'going' : '')`, 8000, 'the confirmation or the trip').catch(() => 'going');
      if (asked === 'ask') { detail['confirmed'] = true; await j.shot('confirm'); await b.click('[data-atlas-sure]'); }
      const request = travelRequest(b, city);
      must(request, 'no travel purchase left the page');
      bag['trip'] = request;
      const began = Date.now();
      await j.shot('in-flight');
      // The flight is a real wait: the server's own timer says when it is over.
      await until(async () => { const m = await lifeRaw(b, 'lagos'); return m.state?.estate?.city === city && !m.state.activeAction; }, 120000, `the arrival in ${target.name}`);
      detail['flightSeconds'] = Math.round((Date.now() - began) / 100) / 10;
      const there = await life(b, city);
      Object.assign(detail, { cashAfter: there.cash, location: there.location, city: there.estate.city });
      must(before - there.cash === line.fare, `the balance fell by ${before - there.cash}, the fare is ${line.fare}`);
      detail['fareCharged'] = before - there.cash;
      const receipt = (there.ledger as any[]).filter((entry) => entry.amount === -line.fare && /fare|flight|ticket|travel/i.test(String(entry.reason)));
      detail['receiptLines'] = receipt.map((entry) => ({ reason: entry.reason, amount: entry.amount, balance: entry.balance }));
      must(receipt.length === 1, `${receipt.length} fare lines in the ledger (expected 1)`);
      const body = await b.responseBody(request.requestId);
      detail['actionId'] = request.actionId;
      detail['actionReply'] = body ? (() => { try { const r = JSON.parse(body); return { ok: r.ok, duplicate: r.duplicate, receipt: r.receipt ?? r.receiptId ?? null }; } catch { return null; } })() : null;
      bag['cashAfterTrip'] = there.cash; bag['ledgerAfterTrip'] = (there.ledger as any[]).length;
      await gameShown(b); await dismiss(b);
      await b.waitFor(`!!document.querySelector('canvas') && document.querySelector('.hud-cash')`, 30000, 'the destination scene');
      await j.shot('arrived');
      // The scene is drawn (the screenshot is judged by eye; here: the venue is named on screen and a canvas of real size exists).
      await b.waitFor(`[...document.querySelectorAll('canvas')].some((c) => c.getBoundingClientRect().width > 200)`, 30000, 'the destination scene canvas');
      const scene = await b.eval<{ canvas: number; text: string }>(`(() => ({ canvas: [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().width > 200).length, text: document.body.innerText }))()`);
      detail['sceneCanvases'] = scene.canvas;
      must(scene.canvas > 0, 'no scene canvas on the destination screen');
      must(scene.text.includes(target.name), `the destination screen never names ${target.name}`);
      // Destination controls: one place action in the scene, then the map opens on the destination.
      await dismiss(b, 1500);
      const action = await b.eval<string>(`(() => { const a = [...document.querySelectorAll('.life-action')].find((x) => x.getBoundingClientRect().width > 1 && !x.disabled); return a ? a.innerText.replace(/\\s+/g, ' ').slice(0, 60) : ''; })()`);
      must(action, 'the destination scene offers no action');
      detail['action'] = action;
      await b.click('.life-action');
      await until(async () => { const m = await lifeRaw(b, city); return !!m.state?.activeAction || (m.state?.ledger || []).length > 0; }, 20000, 'the place action to start');
      await b.click('[data-nav="map"]');
      await b.waitFor(`(document.querySelector('.map-levels-cur')?.textContent || '').includes(${JSON.stringify(target.name)})`, 30000, `the ${target.name} city map`);
      detail['mapChip'] = await b.eval<string>(`document.querySelector('.map-levels-cur')?.textContent?.trim()`);
      await j.shot('city-map');
      const places = await b.eval<number>(`document.querySelectorAll('[class*="is-open"]').length`);
      detail['placesOpen'] = places;
      must(places > 0, 'the destination map lists no open place');
      // The wallet statement shows the fare.
      await b.click('.hud-cash');
      for (let tries = 0; tries < 4; tries++) {
        await sleep(700);
        await b.click('button', 'Statement');
        if (await b.waitFor(`!!document.querySelector('.statement-app')`, 4000, 'the statement').catch(() => false)) break;
      }
      await b.waitFor(`document.querySelector('.statement-app')`, 10000, 'the statement');
      const statement = await b.eval<string>(`document.querySelector('.statement-app').innerText`);
      detail['statementShowsFare'] = statement.includes(line.fare.toLocaleString('en-US'));
      must(detail['statementShowsFare'], `the statement does not show ${naira(line.fare)}`);
      await j.shot('statement');
    });

    if (arrived) {
      await j.run(6, 'Home retained: the Lagos home, the name and the look are unchanged', async (detail) => {
        // While the player is away the server answers for the city they are in; the Lagos home is the stored record of the place left.
        const there = await life(b, city);
        const away = there.estate.away?.lagos;
        detail['awayLagos'] = away ? { lga: away.lga ?? null, home: away.home?.name ?? null } : null;
        must(away, 'the Lagos home is not kept while away');
        const kept = Object.keys(bag['home']).filter((key) => away[key] !== undefined);
        detail['comparedFields'] = kept;
        must(away.lga === 'ikeja' && kept.length >= 2, `the stored Lagos home is not the Ikeja home (${away.lga}, fields ${kept.join(',')})`);
        for (const key of kept) must(JSON.stringify(away[key]) === JSON.stringify(bag['home'][key]), `the stored Lagos home changed: ${key}`);
        must(there.name === bag['name'], `the name changed (${bag['name']} -> ${there.name})`);
        must(JSON.stringify(there.onboarding.look) === bag['look'], 'the look changed');
        Object.assign(detail, { name: there.name, lagosHome: away.home?.name ?? away.lga });
        await b.waitFor(`(document.querySelector('.hud-name')?.textContent || '').includes(${JSON.stringify(bag['name'])})`, 10000, 'the name on screen');
      });

      await j.run(7, 'Fly back through the Home tab and arrive at the owned home', async (detail) => {
        const before = (await life(b, city)).cash;
        // The place action of step 5 must be over before a ticket can be bought (the card says so otherwise).
        await until(async () => !(await lifeRaw(b, city)).state?.activeAction, 40000, 'the place action to finish');
        // The statement of step 5 is still open: close it, then use the Home tab.
        // Escape is the app's own way out of a sheet (statement, then the phone's home screen, then closed).
        const homeFree = `(() => { const el = document.querySelector('[data-nav="home"]'); if (!el) return false; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); })()`;
        for (let presses = 0; presses < 4 && !(await b.eval<boolean>(homeFree)); presses++) { await b.press('Escape', 'Escape', 27); await sleep(700); }
        await b.waitFor(homeFree, 10000, 'the Home tab to be free of sheets');
        await b.click('[data-nav="home"]');
        await b.click('[data-visitor="home"]');
        await b.waitFor(`document.querySelector('[data-atlas-go="lagos:air"]')`, 30000, 'the flight home');
        const fare = await b.eval<number>(`Number(document.querySelector('[data-atlas-go="lagos:air"]').getAttribute('aria-label').match(/₦([\\d,]+)/)[1].replace(/,/g, ''))`);
        detail['cashBefore'] = before; detail['fare'] = fare;
        await j.shot('flight-home');
        await b.click('[data-atlas-go="lagos:air"]');
        const asked = await b.waitFor<string>(`document.querySelector('[data-atlas-sure]') ? 'ask' : (document.querySelector('.trip-bar, [data-trip]') ? 'going' : '')`, 8000, 'the confirmation or the trip').catch(() => 'going');
        if (asked === 'ask') await b.click('[data-atlas-sure]');
        await until(async () => { const m = await lifeRaw(b, 'lagos'); return m.state?.estate?.city === 'lagos' && !m.state.activeAction; }, 120000, 'the arrival back in Lagos');
        const home = await life(b, 'lagos');
        Object.assign(detail, { cashAfter: home.cash, location: home.location, city: home.estate.city, lga: home.estate.lga });
        must(before - home.cash === fare, `the return fare charged ${before - home.cash}, the card said ${fare}`);
        must(home.estate.lga === 'ikeja' && home.estate.home, 'the owned home is not the player\'s home on return');
        must(JSON.stringify(home.estate.home) === JSON.stringify(bag['home'].home), 'the home on return is not the one the player left');
        must(home.location === 'home', `the player arrived at "${home.location}", not at the owned home`);
        bag['cashBack'] = home.cash; bag['ledgerBack'] = (home.ledger as any[]).length;
        await gameShown(b); await dismiss(b);
        await j.shot('back-home');
      });

      await j.run(8, 'The same travel purchase sent again is not charged twice', async (detail) => {
        const trip = bag['trip'];
        const before = (await life(b, 'lagos')).cash;
        const reply = await b.eval<any>(`fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cityId: ${JSON.stringify(trip.cityId)}, type: 'estate.relocate', payload: ${JSON.stringify(trip.payload)}, actionId: ${JSON.stringify(trip.actionId)} }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
        const after = (await life(b, 'lagos')).cash;
        Object.assign(detail, { actionId: trip.actionId, status: reply.status, duplicate: reply.body?.duplicate ?? null, ok: reply.body?.ok ?? null, cashBefore: before, cashAfter: after });
        must(after === before, `the repeated purchase changed the balance (${before} -> ${after})`);
        must(reply.body?.duplicate === true || reply.body?.ok === false, `the repeat was neither recognised as the same purchase nor refused (${JSON.stringify(reply.body).slice(0, 200)})`);
      });

      await j.run(9, 'Restart on the same data: the same life, home, balance and receipts', async (detail) => {
        const before = await life(b, 'lagos');
        await stopServer();
        await startServer();
        await b.goto(base + '/');
        await gameShown(b); await dismiss(b);
        const after = await life(b, 'lagos');
        Object.assign(detail, { cashBefore: before.cash, cashAfter: after.cash, nameAfter: after.name, lga: after.estate.lga, ledgerBefore: before.ledger.length, ledgerAfter: after.ledger.length, ledger: (after.ledger as any[]).map((entry) => `${entry.amount} ${entry.reason}`) });
        must(await sessionId(b) === bag['playerId'], 'a different player came back after the restart');
        must(after.name === before.name && after.cash === before.cash, 'the name or the balance changed over the restart');
        must(after.estate.lga === 'ikeja' && after.estate.city === 'lagos', 'the home is not the same after the restart');
        must(JSON.stringify(after.ledger) === JSON.stringify(before.ledger), 'the receipts (wallet lines) changed over the restart');
        const outbound = (after.ledger as any[]).filter((entry) => entry.amount === -bag['fare'] && String(entry.reason).includes(`Lagos \u2192 ${target.name}`));
        const inbound = (after.ledger as any[]).filter((entry) => String(entry.reason).includes(`${target.name} \u2192 Lagos`));
        detail['outboundReceipts'] = outbound.length; detail['returnReceipts'] = inbound.length;
        must(outbound.length === 1, `${outbound.length} outbound fare receipts after the restart (expected 1)`);
        must(inbound.length === 1, `${inbound.length} return fare receipts after the restart (expected 1)`);
        await b.waitFor(`(document.querySelector('.hud-cash')?.textContent || '').replace(/[^0-9]/g, '') === ${JSON.stringify(String(after.cash))}`, 30000, 'the wallet on screen after reload');
      });
    } else for (const [n, name] of [[6, 'Home retained'], [7, 'Fly back'], [8, 'Duplicate purchase'], [9, 'Restart']] as const) j.skip(n, name, 'step 5 did not arrive');
  } catch (error) {
    j.notes.push(`journey aborted: ${error instanceof Error ? error.message : String(error)}`);
  }
  return finish(j, b, tag);
}

function finish(j: Journey, b: Browser, tag: string): CityResult {
  const errors = [...realErrors(b), ...j.unexpectedRefusals];
  const ok = j.steps.length > 0 && j.steps.every((step) => step.status === 'PASS') && errors.length === 0;
  const result: CityResult = { city: tag, steps: j.steps, consoleErrors: errors, notes: j.notes, ok };
  writeFileSync(join(out, `${tag}.json`), JSON.stringify({ ...result, tolerated: b.consoleErrors.filter((line) => !errors.includes(line)) }, null, 2));
  b.close();
  return result;
}

// ---- the simulated phone --------------------------------------------------------------------------------------------
/** Time to first use and reachability of the controls a travelling player needs, at a phone's size with a slow network and CPU. */
async function phoneRun(size: { width: number; height: number }): Promise<Record<string, unknown>> {
  const tag = `phone${size.width}`;
  const b = await Browser.launch(debugPort);
  const j = new Journey('phone', b, tag);
  const report: Record<string, unknown> = { simulation: 'simulated phone: device metrics, touch, 3x scale, ~150 ms latency, ~1.6 Mbps down, ~750 kbps up, 4x slower CPU', size };
  const reach = async (label: string, selector: string, text?: string): Promise<void> => {
    const found = await b.eval<any>(`(() => { const wanted = ${JSON.stringify(text ?? null)}; const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getBoundingClientRect().width > 1 && (wanted === null || (e.textContent || '').toLowerCase().includes(wanted.toLowerCase()))); if (!el) return { present: false }; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { present: true, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, reachable: !!top && (el === top || el.contains(top)), w: Math.round(r.width), h: Math.round(r.height), clippedText: el.scrollWidth > el.clientWidth + 1 }; })()`);
    (report['controls'] as Record<string, unknown>)[label] = found;
  };
  report['controls'] = {};
  try {
    await b.setViewport({ ...size, scale: 3, mobile: true });
    await b.throttle(true);
    const t0 = Date.now();
    await b.send('Page.navigate', { url: base + '/' });
    await b.waitFor(`!!document.querySelector('[data-qs-name]')`, 120000, 'the start screen');
    report['secondsToStartScreen'] = Math.round((Date.now() - t0) / 100) / 10;
    await sleep(800);
    await j.shot('start');
    await reach('name field', '[data-qs-name]'); await reach('Play now', '[data-key="play-now"]'); await reach('Next', '[data-key="next"]');
    // On the smallest screen the name field can sit behind the fixed footer; the start screen offers a suggested name, which is kept.
    if (((report['controls'] as Record<string, any>)['name field'] ?? {}).reachable === false) report['nameFieldCoveredByFooter'] = true;
    else await b.type('[data-qs-name]', 'Journey Phone');
    for (let at = 0; at < 4; at++) {
      if (at === 3) { await b.waitFor(`!!document.querySelector('[data-key="area:ikeja"]')`, 60000, 'the area list'); await reach('area Ikeja', '[data-key="area:ikeja"]'); await chooseIkeja(b); }
      await b.click('[data-key="primary"], [data-key="next"]', undefined, 60000);
      await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === ${JSON.stringify(['look', 'spirit', 'home', 'ready'][at])}`, 60000, 'the next step');
      await reach(`${['look', 'spirit', 'home', 'ready'][at]} primary`, '[data-key="primary"]');
    }
    await j.shot('ready');
    const t1 = Date.now();
    await b.eval(`window.__creatorMounts = 0; new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches('[data-cr-root]') || n.querySelector('[data-cr-root]'))) window.__creatorMounts++; }).observe(document.body, { childList: true, subtree: true }); true`);
    await tapStartYourLife(b);
    const outcome = await b.waitFor<string>(`(() => { const root = document.querySelector('[data-cr-root]'); if (window.__creatorMounts > 0 && root && root.dataset.step === 'who') return 'creator-back-at-start'; if (!root && document.querySelector('.hud-cash')) return 'settled'; return ''; })()`, 180000, 'the creator to finish or return');
    report['startOutcome'] = outcome;
    report['secondsStartYourLife'] = Math.round((Date.now() - t1) / 100) / 10;
    let settledOnPhone = outcome === 'settled';
    if (!settledOnPhone) {
      try {
        const tapped = Date.now();
        await b.click('[data-key="play-now"]');
        await b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 150000, 'the game screen with the wallet');
        report['secondsPlayNowToGame'] = Math.round((Date.now() - tapped) / 100) / 10;
        await dismiss(b);
        report['hudNameVisible'] = await b.eval<boolean>(`[...document.querySelectorAll('.hud-name')].some((e) => e.getBoundingClientRect().width > 1)`);
        await j.shot('guest-game');
        await b.click('.hud-name', undefined, 8000); await b.click('.sim-link', 'Make this life yours');
        await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'spirit'`, 60000, 'the settle screen');
        await b.click('[data-key="primary"]');
        await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'home'`, 60000, 'the Home step');
        await chooseIkeja(b); await b.click('[data-key="primary"]');
        await b.waitFor(`document.querySelector('[data-cr-root]')?.dataset.step === 'ready'`, 60000, 'the Ready step');
        await b.click('[data-key="primary"]', 'Start your life');
        await until(async () => (await lifeRaw(b, 'lagos')).state?.onboarding?.done === true, 180000, 'the settled life');
        settledOnPhone = true;
      } catch (error) { report['settleOnPhoneFailed'] = error instanceof Error ? error.message : String(error); await j.shot('settle-failed').catch(() => undefined); }
    }
    if (!settledOnPhone) { report['controls'] = report['controls']; report['clippedOrUnreachable'] = Object.entries(report['controls'] as Record<string, any>).filter(([, v]) => !v.present || !v.inView || !v.reachable || v.clippedText).map(([k]) => k); report['consoleErrors'] = realErrors(b); writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2)); b.close(); return report; }
    await gameShown(b); await dismiss(b);
    report['secondsToInteractiveGame'] = Math.round((Date.now() - t0) / 100) / 10;
    await j.shot('home');
    await reach('wallet', '.hud-cash'); await reach('Map tab', '[data-nav="map"]'); await reach('Phone tab', '[data-nav="phone"]'); await reach('Home tab', '[data-nav="home"]');
    const target = DESTINATIONS['cairo']!;
    const t2 = Date.now();
    const line = await openDestination(b, 'cairo');
    report['secondsMapToFareLine'] = Math.round((Date.now() - t2) / 100) / 10;
    report['cairoFare'] = line.fare; report['flightEnabledWithoutMoney'] = line.enabled; report['flightMessage'] = line.why;
    await reach('flight line', '[data-atlas-go="cairo:air"]'); await reach('level chip', '[data-atlas-levels]'); await reach('close card', '[data-atlas-close]');
    await j.shot('card');
    const cardText = await sheetText(b);
    report['cardMentionsDestination'] = cardText.includes(target.name);
    // Fund once and fly, to see the arrival screen at this size.
    await fund(await sessionId(b), line.fare * 2 + 200000, 'Journey phone fixture');
    await b.waitFor(`(document.querySelector('.hud-cash')?.textContent || '').replace(/[^0-9]/g, '').length >= 6`, 30000, 'the credited wallet');
    await openDestination(b, 'cairo');
    await b.click('[data-atlas-go="cairo:air"]');
    if (await b.waitFor<string>(`document.querySelector('[data-atlas-sure]') ? 'ask' : ''`, 3000, 'confirm').catch(() => '')) await b.click('[data-atlas-sure]');
    const flown = Date.now();
    await until(async () => { const m = await lifeRaw(b, 'lagos'); return m.state?.estate?.city === 'cairo' && !m.state.activeAction; }, 180000, 'the arrival in Cairo');
    report['secondsFlight'] = Math.round((Date.now() - flown) / 100) / 10;
    await gameShown(b); await dismiss(b);
    await b.waitFor(`[...document.querySelectorAll('canvas')].some((c) => c.getBoundingClientRect().width > 200)`, 60000, 'the destination scene');
    await sleep(1500);
    await j.shot('arrived');
    await reach('wallet at destination', '.hud-cash'); await reach('Map tab at destination', '[data-nav="map"]'); await reach('Home tab at destination', '[data-nav="home"]'); await reach('Phone tab at destination', '[data-nav="phone"]');
    await b.click('[data-nav="map"]');
    await b.waitFor(`(document.querySelector('.map-levels-cur')?.textContent || '').includes('Cairo')`, 60000, 'the Cairo map');
    await reach('map level chip', '.map-levels-cur');
    await j.shot('city-map');
    const clipped = Object.entries(report['controls'] as Record<string, any>).filter(([, v]) => !v.present || !v.inView || !v.reachable || v.clippedText).map(([k]) => k);
    report['clippedOrUnreachable'] = clipped;
    report['consoleErrors'] = realErrors(b);
  } catch (error) { report['aborted'] = error instanceof Error ? error.message : String(error); await j.shot('aborted').catch(() => undefined); }
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  b.close();
  return report;
}

// ---- main -----------------------------------------------------------------------------------------------------------
let failed = false;
const results: CityResult[] = [];
try {
  await startServer();
  for (const city of requested) {
    if (!DESTINATIONS[city]) throw new Error(`Unknown destination ${city}`);
    console.log(`journey: ${city}`);
    const result = await journey(city, null);
    results.push(result);
    if (!result.ok) failed = true;
  }
  if (flag('phone')) {
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      console.log(`simulated phone ${size.width}x${size.height}`);
      const report = await phoneRun(size);
      if (report['aborted'] || (report['clippedOrUnreachable'] as string[] | undefined)?.length) failed = true;
    }
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await stopServer();
  if (!flag('keep-data')) rmSync(work, { recursive: true, force: true });
}
const table = results.map((result) => `${result.city.padEnd(10)} ${result.steps.map((step) => `${step.step}:${step.status === 'PASS' ? 'P' : step.status === 'FAIL' ? 'F' : '-'}`).join(' ')}${result.consoleErrors.length ? `  console errors: ${result.consoleErrors.length}` : ''}`);
console.log(table.join('\n'));
writeFileSync(join(out, 'summary.json'), JSON.stringify({ results: results.map((r) => ({ city: r.city, ok: r.ok, steps: r.steps.map((s) => `${s.step}:${s.status}`), notes: r.notes })) }, null, 2));
process.exit(failed ? 1 : 0);
