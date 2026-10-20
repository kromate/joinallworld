// A bot that plays the loop home -> gate -> street -> market -> back home, and reports how it went. Run it before every release.
//
//   npm run dev:open -- --port 5211                      (the script never starts or stops the server)
//   node --experimental-strip-types scripts/evidence/walk.ts --base http://127.0.0.1:5211
//
// It uses the game's own client the way the buttons do (`client.command`, reached through the `?diagnostics` hook) and watches the
// page: time to the first frame, console errors, stalls (a gap of more than 42 ms between animation frames) and frames over 100 ms
// during the first 10 seconds of each scene. One JSON object is printed. Exit code 1 when there is a console error (other than the
// known harmless ones in views.ts) or more stalls in the whole loop than --max-stalls (default STALL_BASELINE, 8); 2 when the walk could not be carried out.
//
// Stalls measured with software drawing (--gpu swiftshader) mean the computer, not the game; use the Mac's GPU for a real answer.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openSession, setCookie, type Page } from './cdp.ts';
import { classifyErrors, defaultGpu, percentile } from './views.ts';

export const STALL_MS = 42, SLOW_FRAME_MS = 100;
/** The gate is "no worse than the baseline": the stalls the loop had on 19 October 2026 (Mac, real GPU). Lower it only in a release that improves it. */
export const STALL_BASELINE = 8;

/**
 * The loop, in order. A stage is a game command (`type` and `payload`) or, with `script`, something done on the scene itself.
 * `target` is the place the scene must show. `fallback` is used when the game says the place is closed (the market shuts at 20:00,
 * and open mode runs on the real clock).
 */
export interface StageSpec { stage: string; type?: string; payload?: Record<string, unknown>; script?: string; target: string; fallback?: { payload: Record<string, unknown>; target: string } }
export const STAGES: readonly StageSpec[] = Object.freeze([
  { stage: 'home', type: 'travel', payload: { id: 'home', mode: 'trek' }, target: 'home' },
  { stage: 'gate', type: 'home.door', payload: { direction: 'outside' }, target: 'neighbourhood' },
  { stage: 'street', script: 'window.__jaw.venue.walkBy(8, 0)', target: 'neighbourhood' },
  { stage: 'market', type: 'travel', payload: { id: 'market', mode: 'trek' }, target: 'market', fallback: { payload: { id: 'amala-shitta', mode: 'trek' }, target: 'amala-shitta' } },
  { stage: 'back', type: 'travel', payload: { id: 'home', mode: 'trek' }, target: 'home' },
]);

export interface StageReport { stage: string; target: string; ok: boolean; ttffMs: number | null; frames: number; stalls: number; slowFrames: number; maxGapMs: number | null; p95GapMs: number | null; errors: string[]; refused?: string }
export interface WalkReport { ok: boolean; maxStalls: number; gpu: string; loadFirstFrameMs: number | null; stages: StageReport[]; consoleErrors: string[]; knownErrors: number; stalls: number; slowFrames: number }

/** What a stage's frame gaps say. Pure, so it can be tested. */
export function judgeGaps(gaps: readonly number[]): { frames: number; stalls: number; slowFrames: number; maxGapMs: number | null; p95GapMs: number | null } {
  const sorted = [...gaps].sort((a, b) => a - b), top = sorted.length ? sorted[sorted.length - 1]! : null, p95 = percentile(sorted, 0.95);
  return { frames: sorted.length, stalls: sorted.filter((gap) => gap > STALL_MS).length, slowFrames: sorted.filter((gap) => gap > SLOW_FRAME_MS).length, maxGapMs: top === null ? null : Math.round(top * 10) / 10, p95GapMs: p95 === null ? null : Math.round(p95 * 10) / 10 };
}

/** Run in the page before anything else: keep the time of every animation frame. */
const FRAME_PROBE = `(() => { window.__awFrames = []; let last = performance.now(); const tick = (now) => { window.__awFrames.push([now, now - last]); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })();`;

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2), at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface StageReply { ttff: number | null; gaps: number[]; errors: string[]; refused?: string }

/** Do one stage in the page and watch the next `windowMs`: the time until the scene shows `target` and has drawn, and every frame gap. */
async function runStage(page: Page, step: StageSpec, payload: Record<string, unknown> | undefined, target: string, windowMs: number): Promise<StageReply> {
  const before = page.errors.length;
  const act = step.script ? `Promise.resolve(${step.script}).then(() => ({ ok: true }))` : `jaw.client.command(${JSON.stringify(step.type)}, ${JSON.stringify(payload ?? {})})`;
  const reply = await page.eval<{ ttff: number | null; gaps: number[]; refused?: string }>(`new Promise((done) => {
    const jaw = window.__jaw, t0 = performance.now(), until = t0 + ${windowMs}, target = ${JSON.stringify(target)}, start = jaw.venue.diagnostics().renderCount, startAt = jaw.venue.location;
    let ttff = null;
    const finish = (refused) => { const gaps = window.__awFrames.filter((f) => f[0] >= t0 && f[0] <= until).map((f) => f[1]); done({ ttff, gaps, refused }); };
    ${act}.then((r) => {
      if (!r.ok) { finish(String(r.code) + ': ' + String(r.reason || '')); return; }
      const poll = () => {
        const now = performance.now();
        const drawn = jaw.venue.diagnostics().renderCount;
        // The scene's draw counter starts again when the scene changes, so a changed place needs one draw; the same place needs a new one.
        if (ttff === null && jaw.venue.location === target && !jaw.client.state.activeAction && drawn >= 1 && (startAt !== target || drawn > start)) ttff = Math.round(now - t0);
        if (now >= until) finish(); else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
  })`);
  return { ...reply, errors: page.errors.slice(before) };
}

async function main(): Promise<void> {
  const base = (arg('base') ?? 'http://127.0.0.1:5211').replace(/\/+$/, '');
  const gpu = arg('gpu') === 'swiftshader' ? 'swiftshader' : arg('gpu') === 'metal' ? 'metal' : defaultGpu();
  const windowMs = Number(arg('window') ?? 10) * 1000, maxStalls = Number(arg('max-stalls') ?? STALL_BASELINE);
  const browser = await launchBrowser({ width: 1280, height: 800, scale: 2, gpu });
  const { page } = browser;
  const report: WalkReport = { ok: false, maxStalls, gpu, loadFirstFrameMs: null, stages: [], consoleErrors: [], knownErrors: 0, stalls: 0, slowFrames: 0 };
  try {
    const sid = await openSession(base, 'Evidence walk');
    await setCookie(page, base, sid);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_PROBE });
    await page.send('Page.navigate', { url: `${base}/?diagnostics=1` });
    const ready = await page.until('window.__jaw && window.__jaw.venue && window.__jaw.venue.diagnostics().renderCount > 0', 60_000);
    if (!ready) throw new Error('The scene never drew a frame in 60 s.');
    report.loadFirstFrameMs = Math.round(await page.eval<number>('performance.now()'));
    await page.until('window.__jaw.client.state.location === "park" && window.__jaw.venue.location === "park"', 20_000);
    const loading = classifyErrors(page.errors);
    report.consoleErrors.push(...loading.unexpected); report.knownErrors += loading.known.length;
    for (const step of STAGES) {
      let used = step.target, reply = await runStage(page, step, step.payload, step.target, windowMs);
      if (reply.refused?.startsWith('closed') && step.fallback) { used = step.fallback.target; reply = await runStage(page, step, step.fallback.payload, used, windowMs); }
      const judged = judgeGaps(reply.gaps), seen = classifyErrors(reply.errors);
      report.knownErrors += seen.known.length;
      const stage: StageReport = { stage: step.stage, target: used, ok: reply.ttff !== null && !reply.refused && seen.unexpected.length === 0, ttffMs: reply.ttff, ...judged, errors: seen.unexpected, ...(reply.refused ? { refused: reply.refused } : {}) };
      report.stages.push(stage);
      report.consoleErrors.push(...seen.unexpected);
      report.stalls += judged.stalls; report.slowFrames += judged.slowFrames;
      if (reply.refused) break;
    }
    report.ok = report.stages.length === STAGES.length && report.consoleErrors.length === 0 && report.stalls <= maxStalls && report.stages.every((stage) => stage.ok);
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : report.stages.length < STAGES.length ? 2 : 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); });
}
