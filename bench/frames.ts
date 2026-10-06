// Frame-time baseline inside the world: guest "Play now", then sample requestAnimationFrame while the camera/avatar idles and while walking.
import { chromium } from 'playwright-core'
const exe = '/Users/anthonyakpan/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const url = process.argv[2] || 'http://localhost:3911/'
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
const cdp = await ctx.newCDPSession(page)
await page.goto(url)
await page.getByRole('button', { name: 'Play now' }).click({ timeout: 60_000 })
await page.waitForTimeout(12_000)
await page.screenshot({ path: '/tmp/aw-measure/world.png' })
const sample = (ms) => page.evaluate((ms) => new Promise((done) => { const t = []; let last = performance.now(); const end = last + ms; const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); const q = (p) => Math.round(t[Math.min(t.length - 1, Math.floor(t.length * p))] * 10) / 10; done({ frames: t.length, median: q(0.5), p95: q(0.95), worst: q(1) }) } }; requestAnimationFrame(tick) }), ms)
const gl = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c && (c.getContext('webgl2') || c.getContext('webgl')); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return { canvases: document.querySelectorAll('canvas').length, renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null } })
const results = { gl }
for (const rate of [1, 4, 6]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  results[`idle_cpu${rate}x`] = await sample(4000)
  const box = await page.locator('canvas').first().boundingBox()
  if (box) { await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.35) }
  results[`tapwalk_cpu${rate}x`] = await sample(4000)
}
results.heapMB = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)
results.errors = errors.slice(0, 5)
console.log(JSON.stringify(results, null, 1))
await page.screenshot({ path: '/tmp/aw-measure/world-after.png' })
await browser.close()
