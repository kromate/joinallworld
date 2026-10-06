// Load + in-world frame time on the Android emulator's Chrome (real Android Chrome, software GPU), over adb-forwarded CDP.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'https://joinallworld.com/'
const browser = await chromium.connectOverCDP('http://localhost:9333')
const ctx = browser.contexts()[0]
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
let bytes = 0
cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength })
const t0 = Date.now()
await page.goto(url, { waitUntil: 'commit', timeout: 120_000 })
await page.waitForSelector('#boot-title', { timeout: 120_000 })
const bootShown = Date.now() - t0
await page.waitForFunction(() => !document.querySelector('.boot-screen'), null, { timeout: 120_000, polling: 250 })
const ready = Date.now() - t0
const kBReady = Math.round(bytes / 1024)
await page.waitForTimeout(5000)
const sample = (ms) => page.evaluate((ms) => new Promise((done) => { const t = []; let last = performance.now(); const end = last + ms; const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); const q = (p) => Math.round(t[Math.min(t.length - 1, Math.floor(t.length * p))] * 10) / 10; done({ frames: t.length, median: q(0.5), p95: q(0.95), worst: q(1) }) } }; requestAnimationFrame(tick) }), ms)
const creator = await sample(4000)
await page.getByRole('button', { name: 'Play now' }).click({ timeout: 60_000 })
await page.waitForTimeout(15_000)
const world = await sample(5000)
const info = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c && (c.getContext('webgl2') || c.getContext('webgl')); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return { renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dpr: devicePixelRatio, w: innerWidth } })
await page.screenshot({ path: '/tmp/aw-measure/emu-world.png' })
console.log(JSON.stringify({ bootShownMs: bootShown, gameReadyMs: ready, kBAtReady: kBReady, kBTotal: Math.round(bytes / 1024), creatorFrames: creator, worldFrames: world, ...info, errors: errors.slice(0, 4) }))
await page.close()
await browser.close()
