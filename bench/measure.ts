// Baseline load measurement for Allworld under phone-like throttling (Chrome DevTools protocol).
import { chromium } from 'playwright-core'
const exe = '/Users/anthonyakpan/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const url = process.argv[2] || 'http://localhost:3911/'
const profiles = {
  'slow-3g': { latency: 2000, down: 400_000 / 8, up: 400_000 / 8 },
  'fast-3g': { latency: 562.5, down: 1_600_000 / 8, up: 750_000 / 8 },
  '4g': { latency: 150, down: 9_000_000 / 8, up: 1_500_000 / 8 },
}
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const only = (process.argv[3] || '').split(',').filter(Boolean)
for (const [name, net] of Object.entries(profiles).filter(([n]) => !only.length || only.includes(n))) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; TECNO KH7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  let bytes = 0, requests = 0
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; requests += 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'commit', timeout: 180_000 })
  await page.waitForSelector('#boot-title', { timeout: 180_000 })
  const bootShown = Date.now() - t0
  let ready = null
  try { await page.waitForFunction(() => !document.querySelector('.boot-screen'), null, { timeout: 180_000, polling: 250 }); ready = Date.now() - t0 } catch {}
  const bytesAtReady = bytes
  await page.waitForTimeout(8000)
  const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null)
  const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)
  const frame = await page.evaluate(() => new Promise((done) => { const t = []; let last = performance.now(); let n = 0; const tick = (now) => { t.push(now - last); last = now; if (++n < 60) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); done({ median: Math.round(t[30]), p95: Math.round(t[56]) }) } }; requestAnimationFrame(tick) }))
  await page.screenshot({ path: `/tmp/aw-measure/${new URL(url).hostname}-${name}.png` })
  console.log(JSON.stringify({ profile: name, cpu: '6x', fcpMs: fcp && Math.round(fcp), bootShownMs: bootShown, gameReadyMs: ready, kBAtReady: Math.round(bytesAtReady / 1024), kBAfter8s: Math.round(bytes / 1024), requests, heapMB: mem, rafFrameMs: frame, errors: errors.slice(0, 4) }))
  await ctx.close()
}
await browser.close()
