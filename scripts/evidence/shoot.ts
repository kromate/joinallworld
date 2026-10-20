// Take the evidence screenshots: named views of the local game, with a fixed in-game clock, plus the numbers that go with them.
//
//   npm run dev:open -- --port 5211                      (in one terminal; this script never starts or stops the server)
//   node --experimental-strip-types scripts/evidence/shoot.ts --view street-dusk,kano-noon,home-night
//   node --experimental-strip-types scripts/evidence/shoot.ts --view all --scale 1 --out docs/evidence/anchors
//   node --experimental-strip-types scripts/evidence/shoot.ts --view all --prove-clock     (each view at 12:00 and 21:00; fails if the scene's brightness barely moves)
//   --clock HH:MM replaces a view's own clock. The clock is pinned twice: the scene is handed one moment for its light, and Date.now in the page is shifted.
//
// For each view it opens a fresh open-mode life over HTTP, plays the steps that bring it to the place (scripts/evidence/views.ts),
// opens a headless Chromium with its own temporary profile, waits for the scene, pins the clock, and writes
//   <out>/<view>.png         what a player sees (the whole page, with its HUD)
//   <out>/<view>-scene.png   the 3D canvas alone
//   <out>/<view>.json        the numbers below, also printed as one JSON line
// The numbers: console errors; draw calls and triangles from the renderer (renderer.info, read through the game's own `?diagnostics`
// hook, so no change to the game is needed); and the gap between animation frames over the dwell (default 10 s) while the scene is
// asked for a frame every time the page can show one, which is the worst case a player's device meets (the game itself draws
// nothing while the street is still).
//
// The browser is always closed and its profile folder deleted, whatever happens. Software drawing (the default) proves the picture
// and the counts; frame times from it say little about a phone or a laptop's GPU: try --gpu metal on a Mac.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, openSession, setCookie, act, sleep, type Page } from './cdp.ts';
import { decodePng } from './png.ts';
import { computeMetrics } from './metrics.ts';
import { PROOF_CLOCKS, VIEWS, classifyErrors, lagosInstant, parseShootArgs, proveClock, summariseGaps, type FrameSummary, type ViewSpec } from './views.ts';

export interface ViewResult {
  view: string;
  ok: boolean;
  location: string | null;
  clock: string;
  consoleErrors: string[];
  knownErrors: number;
  softwareRendered: boolean | null;
  gpuName: string | null;
  drawCalls: number | null;
  triangles: number | null;
  geometries: number | null;
  textures: number | null;
  tier: string | null;
  pixelRatio: number | null;
  size: string;
  gpu: string;
  uncapped: boolean;
  frames: FrameSummary;
  rendersInDwell: number | null;
  png: string;
  scenePng: string;
  /** Mean brightness of the 3D canvas, 0 to 255: how bright the light is. */
  sceneMeanLuminance: number | null;
}

interface LifeView { state: { location: string; activeAction: unknown } }
async function lifeOf(base: string, sid: string, city: string): Promise<LifeView['state']> {
  const reply = await fetch(`${base}/api/life?city=${city}`, { headers: { Cookie: `sid=${sid}` } });
  return (await reply.json() as LifeView).state;
}

/** Play the view's steps and wait until the life is at rest where the view expects it. */
async function arrange(base: string, sid: string, spec: ViewSpec): Promise<void> {
  await lifeOf(base, sid, spec.city); // creates the life, settled with a house in open mode
  for (const step of spec.steps) {
    const reply = await act(base, sid, step.type, step.payload, spec.city);
    if (!reply.ok) throw new Error(`${spec.name}: "${step.type}" was refused (${reply.code ?? 'no code'}: ${reply.reason ?? 'no reason'}). Is the server in open mode (npm run dev:open)?`);
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await lifeOf(base, sid, spec.city);
      if (!state.activeAction) break;
      await sleep(500);
    }
  }
  const at = await lifeOf(base, sid, spec.city);
  if (at.location !== spec.location) throw new Error(`${spec.name}: the life is at "${at.location}", not "${spec.location}".`);
}

/** Hide what is only there because a developer is looking: the diagnostics button and the open-mode badge. */
const HIDE_DEV_CHROME = `(() => {
  const hide = (node) => { if (node) node.style.setProperty('display', 'none', 'important'); };
  hide(document.querySelector('#render-diagnostics')?.parentElement);
  for (const button of document.querySelectorAll('button')) if (button.textContent === 'Open dev mode') hide(button.parentElement);
  return true;
})()`;

async function shootView(page: Page, base: string, spec: ViewSpec, options: ReturnType<typeof parseShootArgs>, outDir: string, stem: string = spec.name): Promise<ViewResult> {
  const sid = await openSession(base, 'Evidence');
  await arrange(base, sid, spec);
  await setCookie(page, base, sid);
  const pinned = lagosInstant(options.day, spec.clock);
  // The page picks its city from the saved character; a fresh browser has none, so say which city this life is in.
  const saved = JSON.stringify({ cityId: spec.city, state: { estate: { city: spec.city } } });
  // Everything that reads the page's clock (street life's walkers and lamps, the ambient crowd) must see the pinned hour too: shift Date.now
  // by a constant, so time still passes. The game's own server clock is unaffected (the client works from the difference).
  const shift = pinned - Date.now();
  const hook = await page.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `const __awNow = Date.now.bind(Date); Date.now = () => __awNow() + (${shift}); try { if (${JSON.stringify(spec.city)} !== 'lagos') localStorage.setItem('joinallworld-life-v1', ${JSON.stringify(saved)}); else localStorage.removeItem('joinallworld-life-v1'); } catch (e) {}` });
  page.errors.length = 0;
  await page.send('Page.navigate', { url: `${options.base}${spec.path}${spec.path.includes('?') ? '&' : '?'}diagnostics=1${options.query ? `&${options.query}` : ''}` });
  const here = JSON.stringify(spec.location);
  const ready = await page.until(`window.__jaw && window.__jaw.venue && window.__jaw.venue.location === ${here} && window.__jaw.venue.diagnostics().renderCount > 3`, 60_000);
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier });
  if (!ready) throw new Error(`${spec.name}: the scene did not show "${spec.location}" within 60 s.`);
  // Pin the clock: every state the scene is given carries the same moment, so the light is the same every run.
  await page.eval(`(() => { const v = window.__jaw.venue, set = v.setState.bind(v); v.setState = (s) => set({ ...s, t: ${pinned} }); v.setState(window.__jaw.client.state); return true; })()`);
  // The camera's own "fit" button, so every run frames the place the same way whatever happened before.
  await page.eval('window.__jaw.venue.recentre()');
  // Settle: models stream in. Wait until the scene has stopped drawing for 1.5 s (at most 25 s).
  let last = -1, still = 0;
  for (let waited = 0; waited < 25_000 && still < 1500; waited += 250) {
    await sleep(250);
    const count = await page.eval<number>('window.__jaw.venue.diagnostics().renderCount');
    still = count === last ? still + 250 : 0; last = count;
  }
  if (spec.camera === 'street-pose') {
    const placed = await page.eval<string>(`(async () => {
      const streets = await import('/src/scene/street-life/street-scene.ts'), arrive = await import('/src/map3d/arrive-street.ts');
      let layout = streets.streetOf('neighbourhood');
      for (let waited = 0; !layout && waited < 15000; waited += 250) { await new Promise((done) => setTimeout(done, 250)); layout = streets.streetOf('neighbourhood'); }
      const pose = layout && arrive.poseInBounds(layout.pose, layout.bounds);
      if (!pose) return 'the street has no start pose (street life is off on this device?)';
      // The host's orbit is not reachable from the page (the world adapter does not pass motion() on), so the camera is placed the way a
      // first-person view does: a view whose render() sets the camera just before every draw.
      const eye = pose.eye, look = pose.look;
      return window.__jaw.venue.setView((source) => ({
        inputEnabled: false, azimuth: 0, dispose() {},
        render() {
          const at = source.read().current.group.position, camera = source.camera;
          camera.position.set(eye[0] + at.x, eye[1] + at.y, eye[2] + at.z);
          if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
          camera.lookAt(look[0] + at.x, look[1] + at.y, look[2] + at.z);
          camera.updateMatrixWorld();
        },
      })) ? 'ok' : 'the venue refused the view';
    })()`);
    if (placed !== 'ok') throw new Error(`${spec.name}: ${placed}`);
  }
  if (spec.camera) { last = -1; still = 0; for (let waited = 0; waited < 8000 && still < 1500; waited += 250) { await sleep(250); const count = await page.eval<number>('window.__jaw.venue.diagnostics().renderCount'); still = count === last ? still + 250 : 0; last = count; } }
  await page.eval(HIDE_DEV_CHROME);
  await sleep(300);
  mkdirSync(outDir, { recursive: true });
  const png = join(outDir, `${stem}.png`), scenePng = join(outDir, `${stem}-scene.png`);
  writeFileSync(png, await page.screenshot());
  const sceneUrl = await page.eval<string | null>(`(() => { const canvas = window.__jaw.venue.captureCanvas(); return canvas ? canvas.toDataURL('image/png') : null; })()`);
  let luminance: number | null = null;
  if (sceneUrl) {
    const bytes = Buffer.from(sceneUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    writeFileSync(scenePng, bytes);
    luminance = computeMetrics(decodePng(bytes)).luminance.mean;
  }
  // The dwell.
  const before = await page.eval<number>('window.__jaw.venue.diagnostics().renderCount');
  const gaps = await page.eval<number[]>(`new Promise((done) => {
    const v = window.__jaw.venue, gaps = [], begin = performance.now();
    v.wakeAmbient && v.wakeAmbient();
    let previous = begin;
    const tick = (now) => { gaps.push(now - previous); previous = now; v.update(); if (now - begin < ${options.dwellMs}) requestAnimationFrame(tick); else done(gaps); };
    requestAnimationFrame(tick);
  })`);
  const d = await page.eval<Record<string, unknown>>(`(() => { const x = window.__jaw.venue.diagnostics(); return { location: x.location, drawCalls: x.drawCalls, triangles: x.triangles, geometries: x.geometries, textures: x.textures, tier: x.tier, pixelRatio: x.pixelRatio, renderCount: x.renderCount }; })()`);
  const num = (value: unknown): number | null => typeof value === 'number' ? value : null;
  const { unexpected: errors, known } = classifyErrors(page.errors);
  const gl = await page.eval<{ name: string | null }>(`(() => { const c = window.__jaw.venue.captureCanvas(); const g = c && (c.getContext('webgl2') || c.getContext('webgl')); const x = g && g.getExtension('WEBGL_debug_renderer_info'); return { name: x ? String(g.getParameter(x.UNMASKED_RENDERER_WEBGL)) : null }; })()`);
  return {
    view: spec.name, ok: errors.length === 0, location: typeof d.location === 'string' ? d.location : null,
    clock: `${options.day} ${String(spec.clock.hour).padStart(2, '0')}:${String(spec.clock.minute).padStart(2, '0')} Lagos`,
    consoleErrors: errors, knownErrors: known.length, gpuName: gl.name, softwareRendered: gl.name === null ? null : /swiftshader|llvmpipe|software|basic render/i.test(gl.name), drawCalls: num(d.drawCalls), triangles: num(d.triangles), geometries: num(d.geometries), textures: num(d.textures),
    tier: typeof d.tier === 'string' ? d.tier : null, pixelRatio: num(d.pixelRatio), size: `${options.width}x${options.height}@${options.scale}x`, gpu: options.gpu, uncapped: options.uncapped,
    frames: summariseGaps(gaps.slice(2)), rendersInDwell: num(d.renderCount) === null ? null : (num(d.renderCount) as number) - before,
    png, scenePng: sceneUrl ? scenePng : '', sceneMeanLuminance: luminance,
  };
}

async function main(): Promise<void> {
  const options = parseShootArgs(process.argv.slice(2));
  const outDir = resolve(options.out);
  const results: ViewResult[] = [];
  const browser = await launchBrowser({ width: options.width, height: options.height, scale: options.scale, gpu: options.gpu, uncapped: options.uncapped });
  try {
    for (const name of options.views) {
      if (options.proveClock) {
        // The same view at noon and at 21:00: the scene's brightness must differ clearly, or the clock never reached the light.
        const pair: ViewResult[] = [];
        for (const clock of PROOF_CLOCKS) {
          const stem = `${name}-${String(clock.hour).padStart(2, '0')}${String(clock.minute).padStart(2, '0')}`;
          const result = await shootView(browser.page, options.base, { ...VIEWS[name], clock }, options, outDir, stem);
          writeFileSync(join(outDir, `${stem}.json`), `${JSON.stringify(result)}\n`);
          console.log(JSON.stringify(result));
          pair.push(result); results.push(result);
        }
        const verdict = proveClock(pair[0]!.sceneMeanLuminance ?? 0, pair[1]!.sceneMeanLuminance ?? 0);
        console.log(JSON.stringify({ proof: name, dayLuminance: pair[0]!.sceneMeanLuminance, nightLuminance: pair[1]!.sceneMeanLuminance, ...verdict }));
        if (!verdict.ok) process.exitCode = 1;
        continue;
      }
      const spec = options.clock ? { ...VIEWS[name], clock: options.clock } : VIEWS[name];
      const result = await shootView(browser.page, options.base, spec, options, outDir);
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(result)}\n`);
      console.log(JSON.stringify(result));
      results.push(result);
    }
  } finally {
    await browser.close();
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

// Run only when started from the command line, so a test can import the types.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
