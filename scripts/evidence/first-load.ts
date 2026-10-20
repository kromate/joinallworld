// The first-load check: a visitor with no life opens the landing page, taps, and must be in a scene they can use within two taps,
// without watching a spinner for more than a second at a time. It is the bar from the open-source plan, Phase 13 (the jam rule "no
// login, loads instantly"), and the budgets in src/budgets.ts bound the bytes; this one times what a person sees.
//
//   node --experimental-strip-types scripts/evidence/first-load.ts --base https://joinallworld.com
//   node --experimental-strip-types scripts/evidence/first-load.ts --base http://127.0.0.1:5211      (a dev:open server you started yourself)
//
// It never starts or stops a server, needs no `?diagnostics` hook (it reads only the page's own markup), and uses a fresh profile, so
// the visitor is new. **Against a live address it starts a real guest life there**: run it on purpose, not in a loop. It has not been
// run against production by the author of this file.
//
// What it does, on a phone-sized page (390 x 844):
//   1. opens `<base>/` and waits for the entry page's Play now button (`[data-entry-play]`);
//   2. taps it (tap 1) and watches every animation frame afterwards;
//   3. the page is *interactive* when the scene box `#venue-scene` holds a canvas, shows no waiting card (`.scene-wait`, the loading
//      card with its tips, which stays until the host has drawn: src/app/scene/ScenePane.vue), and the scene is what sits at the
//      middle of the screen (nothing is over it);
//   4. if the scene has drawn and something covers it for 3 s, it taps the first enabled button of the covering panel (tap 2) and
//      counts that tap. A third tap is never made: a page that needs one has failed.
// Exit 0: interactive within --max-taps (default 2) and no continuous wait over --max-wait ms (default 1000). Exit 1: a criterion
// failed. Exit 2: the check could not be carried out (no browser, no Play button, no answer in --timeout seconds, default 60).
// One JSON object is printed with the times, so a run can be kept as evidence next to docs/evidence/frames.md.
//
// A "wait" is any moment when the loading card (`.scene-wait`) is on screen or the Play button reads "Starting…". The wait before
// the first tap is not counted. With software drawing (--gpu swiftshader) frame times mean the computer, not the game.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, sleep, type Page } from './cdp.ts';
import { classifyErrors, defaultGpu } from './views.ts';

export const MAX_TAPS = 2, MAX_WAIT_MS = 1000, COVER_GRACE_MS = 3000;

/** One look at the page, taken every animation frame: when (ms since the first tap), whether a wait is showing, whether it is usable. */
export type Sample = readonly [at: number, waiting: boolean, interactive: boolean];

export interface FirstLoadVerdict { ok: boolean; reached: boolean; interactiveMs: number | null; longestWaitMs: number; taps: number; problems: string[] }

/** The longest unbroken stretch, in ms, during which a wait was showing, up to `until` (default: the last sample). Pure. */
export function longestWait(samples: readonly Sample[], until = Infinity): number {
  let longest = 0, since: number | null = null, last = 0;
  for (const [at, waiting] of samples) {
    if (at > until) break;
    if (waiting) since ??= at;
    else if (since !== null) { longest = Math.max(longest, at - since); since = null; } // the wait lasted until the first look that no longer showed it
    last = at;
  }
  // A wait still showing at the end of the samples ran at least until the last one.
  if (since !== null) longest = Math.max(longest, last - since);
  return Math.round(longest);
}

/** When the page first became interactive, or null. Pure. */
export function firstInteractive(samples: readonly Sample[]): number | null {
  const hit = samples.find(([, , interactive]) => interactive);
  return hit ? Math.round(hit[0]) : null;
}

/** The verdict. A wait counts only until the page is usable; a page never usable fails whatever its waits. Pure. */
export function judgeFirstLoad(samples: readonly Sample[], taps: number, maxTaps = MAX_TAPS, maxWaitMs = MAX_WAIT_MS): FirstLoadVerdict {
  const interactiveMs = firstInteractive(samples), reached = interactiveMs !== null;
  const longestWaitMs = longestWait(samples, interactiveMs ?? Infinity);
  const problems: string[] = [];
  if (!reached) problems.push('the page never became interactive');
  if (taps > maxTaps) problems.push(`it took ${taps} taps; the limit is ${maxTaps}`);
  if (longestWaitMs > maxWaitMs) problems.push(`a wait was on screen for ${longestWaitMs} ms in one stretch; the limit is ${maxWaitMs} ms`);
  return { ok: problems.length === 0, reached, interactiveMs, longestWaitMs, taps, problems };
}

/** Runs in the page before anything else: sample the page every frame once `window.__awTap` is set. Samples go to `window.__awSamples`. */
export const PROBE = `(() => {
  window.__awSamples = []; window.__awTap = null;
  const usable = () => {
    const box = document.getElementById('venue-scene');
    if (!box || !box.querySelector('canvas') || box.querySelector('.scene-wait')) return false;
    const middle = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!middle && (middle === box || box.contains(middle));
  };
  const tick = () => {
    if (window.__awTap !== null) {
      const play = document.querySelector('[data-entry-play]');
      const waiting = !!document.querySelector('#venue-scene .scene-wait') || (!!play && /Starting/.test(play.textContent || ''));
      window.__awSamples.push([Math.round((performance.now() - window.__awTap) * 10) / 10, waiting, usable()]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2), at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function tapAt(page: Page, x: number, y: number): Promise<void> {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** The middle of an element, in page pixels, or null when it is not there. */
const centreOf = (selector: string): string => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`;

/** The first enabled button of whatever covers the middle of the screen: the panel a second tap would dismiss. Marked so it can be found. */
const COVERING_BUTTON = `(() => {
  const box = document.getElementById('venue-scene');
  let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  for (let up = 0; node && up < 7; up++, node = node.parentElement) {
    if (box && box.contains(node)) return null;
    const button = node.matches && node.matches('button:not([disabled])') ? node : node.querySelector && node.querySelector('button:not([disabled])');
    if (button) { const r = button.getBoundingClientRect(); return { at: [r.x + r.width / 2, r.y + r.height / 2], label: (button.textContent || button.getAttribute('aria-label') || '').trim().slice(0, 60) }; }
  }
  return null;
})()`;

interface Report extends FirstLoadVerdict { base: string; gpu: string; place: string | null; tappedSecond: string | null; consoleErrors: string[]; knownErrors: number }

async function main(): Promise<void> {
  const base = (arg('base') ?? 'http://127.0.0.1:5211').replace(/\/+$/, '');
  const gpu = arg('gpu') === 'swiftshader' ? 'swiftshader' : arg('gpu') === 'metal' ? 'metal' : defaultGpu();
  const maxTaps = Number(arg('max-taps') ?? MAX_TAPS), maxWait = Number(arg('max-wait') ?? MAX_WAIT_MS), timeoutMs = Number(arg('timeout') ?? 60) * 1000;
  const browser = await launchBrowser({ width: 390, height: 844, scale: 2, gpu });
  const { page } = browser;
  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await page.send('Page.navigate', { url: `${base}/` });
    if (!(await page.until('!!document.querySelector("[data-entry-play]")', 30_000))) throw new Error('The entry page never showed its Play now button in 30 s (a returning-player profile, or not the landing page?).');
    let taps = 0, tappedSecond: string | null = null;
    const play = await page.eval<[number, number] | null>(centreOf('[data-entry-play]'));
    if (!play) throw new Error('The Play now button has no size on the page.');
    await page.eval('window.__awTap = performance.now()');
    await tapAt(page, play[0], play[1]); taps++;
    const stop = Date.now() + timeoutMs;
    let drawnAt: number | null = null;
    while (Date.now() < stop) {
      await sleep(100);
      const state = await page.eval<{ usable: boolean; drawn: boolean }>(`(() => { const s = window.__awSamples; const last = s[s.length - 1]; const box = document.getElementById('venue-scene'); return { usable: !!last && last[2], drawn: !!(box && box.querySelector('canvas') && !box.querySelector('.scene-wait')) }; })()`);
      if (state.usable) break;
      if (state.drawn) {
        drawnAt ??= Date.now();
        if (Date.now() - drawnAt >= COVER_GRACE_MS && taps === 1) {
          const covering = await page.eval<{ at: [number, number]; label: string } | null>(COVERING_BUTTON);
          if (covering) { tappedSecond = covering.label || '(a button without a label)'; await tapAt(page, covering.at[0], covering.at[1]); taps++; }
        }
      }
    }
    const samples = await page.eval<Sample[]>('window.__awSamples');
    const place = await page.eval<string | null>(`(() => { try { return (window.__jaw && window.__jaw.venue && window.__jaw.venue.location) || null } catch { return null } })()`);
    const seen = classifyErrors(page.errors);
    const verdict = judgeFirstLoad(samples, taps, maxTaps, maxWait);
    const problems = [...verdict.problems, ...seen.unexpected.map((e) => `console error: ${e}`)];
    const report: Report = { ...verdict, ok: problems.length === 0, problems, base, gpu, place, tappedSecond, consoleErrors: seen.unexpected, knownErrors: seen.known.length };
    console.log(JSON.stringify(report));
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); });
}
