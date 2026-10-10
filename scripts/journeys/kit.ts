/** Shared helpers of the feature journeys (money.ts, showcase.ts, places.ts): steps with screenshots, the start screen, page-side calls. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Browser, sleep } from './cdp.ts';

export const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
};
export const must = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
export const digits = (text: string): number => Number(text.replace(/[^0-9]/g, ''));
export { sleep };

export type Status = 'PASS' | 'FAIL' | 'NOT RUN';
export interface StepResult { step: string; name: string; status: Status; detail: Record<string, unknown>; shot?: string }

export class Journey {
  readonly steps: StepResult[] = [];
  readonly notes: string[] = [];
  readonly out: string;
  readonly feature: string;
  private shotNo = 0;
  constructor(out: string, feature: string) { this.feature = feature; this.out = resolve(out); mkdirSync(this.out, { recursive: true }); }
  async shot(b: Browser, label: string): Promise<string> {
    const file = `${this.feature}-${String(++this.shotNo).padStart(2, '0')}-${label}.png`;
    await b.screenshot(join(this.out, file));
    return file;
  }
  /** One step: a thrown failure is recorded (with a screenshot of every page given) and the journey goes on. */
  async run(step: string, name: string, pages: Browser[], body: (detail: Record<string, unknown>) => Promise<void>): Promise<boolean> {
    const detail: Record<string, unknown> = {};
    let status: Status = 'PASS';
    try { await body(detail); } catch (error) { status = 'FAIL'; detail['failure'] = error instanceof Error ? error.message : String(error); }
    const shots: string[] = [];
    for (const [i, page] of pages.entries()) shots.push(await this.shot(page, `step${step}-${status === 'PASS' ? 'ok' : 'FAIL'}${pages.length > 1 ? '-p' + (i + 1) : ''}`).catch(() => ''));
    this.steps.push({ step, name, status, detail, shot: shots.join(', ') });
    this.save();
    console.log(`[${this.feature}] step ${step} ${status}: ${name}${status === 'FAIL' ? ` -- ${String(detail['failure']).slice(0, 400)}` : ''}`);
    return status === 'PASS';
  }
  skip(step: string, name: string, why: string): void { this.steps.push({ step, name, status: 'NOT RUN', detail: { why } }); console.log(`[${this.feature}] step ${step} NOT RUN: ${name} (${why})`); }
  private save(extra: Record<string, unknown> = {}, console_: Record<string, string[]> = {}): void {
    writeFileSync(join(this.out, `${this.feature}.json`), JSON.stringify({ feature: this.feature, ok: this.steps.every((s) => s.status !== 'FAIL'), steps: this.steps, notes: this.notes, consoleErrors: console_, ...extra }, null, 2));
  }
  finish(extra: Record<string, unknown> = {}, console_: Record<string, string[]> = {}): number {
    const ok = this.steps.every((s) => s.status !== 'FAIL');
    writeFileSync(join(this.out, `${this.feature}.json`), JSON.stringify({ feature: this.feature, ok, steps: this.steps, notes: this.notes, consoleErrors: console_, ...extra }, null, 2));
    console.log(`[${this.feature}] ${ok ? 'ALL STEPS PASSED' : 'FAILURES'} (${this.steps.filter((s) => s.status === 'PASS').length}/${this.steps.length})`);
    return ok ? 0 : 1;
  }
}

/** Browser log lines the app is built to give. */
const NOISE = [/status of 401 \(Unauthorized\) .*\/api\/session$/, /status of 409 \(Conflict\) .*\/api\/street\/me$/, /status of 409 \(Conflict\) .*\/api\/life\?city=[a-z-]+$/];
export const realErrors = (b: Browser): string[] => b.consoleErrors.filter((line) => !NOISE.some((p) => p.test(line)));

export async function dismiss(b: Browser, waitMs = 5000): Promise<void> {
  const end = Date.now() + waitMs;
  for (;;) {
    const point = await b.locate('button.tour-skip, button.is-quiet').catch(() => null);
    if (point) { await b.tapAt(point.x, point.y); await sleep(400); continue; }
    if (Date.now() > end) return;
    await sleep(250);
  }
}
export async function gameShown(b: Browser): Promise<void> { await b.waitFor(`!!document.querySelector('.hud-cash') && !document.querySelector('[data-cr-root]')`, 60000, 'the game screen with the wallet'); }

/** A new guest through the landing screen ("Play now"). */
export async function playNow(b: Browser, base: string, name: string): Promise<void> {
  await b.goto(base + '/');
  await b.waitFor(`!!document.querySelector('[data-qs-name]')`, 60000, 'the start screen');
  await sleep(600);
  await b.type('[data-qs-name]', name);
  await b.click('[data-key="play-now"]');
  await gameShown(b);
  await dismiss(b);
}

/** A page-side JSON call with the page's own cookie. */
export function pageCall(b: Browser, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return b.eval(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
}
export const actionId = (): string => `${Date.now()}:${crypto.randomUUID()}`;
export async function life(b: Browser, city = 'lagos'): Promise<any> {
  const r = await pageCall(b, `/api/life?city=${city}`);
  must(r.status === 200 && r.body?.state, `GET /api/life answered ${r.status}`);
  return r.body.state;
}
export const sessionId = async (b: Browser): Promise<string> => { const r = await pageCall(b, '/api/session'); must(r.body?.session?.id, 'no session id'); return r.body.session.id; };
export const text = (b: Browser, selector = 'body'): Promise<string> => b.eval<string>(`(document.querySelector(${JSON.stringify(selector)}) || document.body).innerText`);
/** Whether any element matching the selector (and text) is visible. */
export const visible = (b: Browser, selector: string, wanted?: string): Promise<boolean> => b.locate(selector, wanted).then((p) => !!p);
export async function until(check: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  for (;;) { if (await check().catch(() => false)) return; if (Date.now() > end) throw new Error(`Timed out after ${ms} ms waiting for ${what}`); await sleep(250); }
}
/** Simulated phone: touch, 3x scale (as the travel journeys), 4G-like network, 4x slower CPU. Label results "simulated phone". */
export async function phone(b: Browser, width: number, height: number): Promise<void> { await b.setViewport({ width, height, scale: 3, mobile: true }); await b.throttle(true); }
export async function desktop(b: Browser, width = 480, height = 900): Promise<void> { await b.setViewport({ width, height, scale: 1, mobile: false }); await b.throttle(false); }
/** Horizontal overflow and tiny/clipped controls of what is on screen: a quick, honest layout probe. */
export function layoutProbe(b: Browser, scope = 'body'): Promise<{ scrollW: number; clientW: number; offscreen: string[]; small: string[] }> {
  return b.eval(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) || document.body, vw = document.documentElement.clientWidth;
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const controls = [...root.querySelectorAll('button, a[href], input, select, textarea, [role=button]')].filter(vis);
    const label = (e) => ((e.innerText || e.value || e.getAttribute('aria-label') || e.name || e.tagName) + '').replace(/\\s+/g, ' ').trim().slice(0, 30);
    return {
      scrollW: document.documentElement.scrollWidth, clientW: vw,
      offscreen: controls.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).map(label),
      small: controls.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 32 || r.width < 32; }).map((e) => label(e) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)),
    };
  })()`);
}

/**
 * Moves the page's own clock (Date) forward by `offsetMs`, now and on every later load, so it agrees with a lab whose clock was moved
 * (the app stamps its request ids with the page clock, and the server refuses ids that are too old). Timers are not touched.
 */
const clockScripts = new WeakMap<Browser, string>();
export async function syncClock(b: Browser, offsetMs: number): Promise<void> {
  const source = `(() => { window.__clockOffset = ${offsetMs}; if (window.__datePatched) return; window.__datePatched = true; const R = Date; const now = () => R.now() + window.__clockOffset; class D extends R { constructor(...a) { if (a.length === 0) super(now()); else super(...a); } static now() { return now(); } } window.Date = D; })();`;
  const previous = clockScripts.get(b);
  if (previous) await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: previous });
  const added = await b.send('Page.addScriptToEvaluateOnNewDocument', { source });
  clockScripts.set(b, added.identifier as string);
  await b.eval(source);
}
