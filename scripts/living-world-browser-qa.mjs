import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import test from 'node:test'
import { fixture } from '../server/test-fixture.ts'
import { money } from '../src/app/ui/format.ts'

const LIMIT_MS = 120_000
const PAGE_WAIT_MS = 12_000
const CHROME = process.env.CHROME
const OUTPUT = resolve(process.env.LW_QA_OUTPUT_DIR || `${tmpdir()}/living-world-teaching-qa-${process.pid}`)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function requireCondition(value, message) {
  if (!value) throw new Error(message)
}

async function writeReceipt(value) {
  const text = `${JSON.stringify(value)}\n`
  requireCondition(Buffer.byteLength(text) <= 8192, 'bounded QA receipt exceeded its size limit')
  const temporary = resolve(OUTPUT, `receipt-${process.pid}.tmp`)
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, resolve(OUTPUT, 'receipt.json'))
}

function parseCookie(cookie) {
  const split = cookie.indexOf('=')
  requireCondition(split > 0, 'fixture session cookie shape was unsupported')
  return { name: cookie.slice(0, split), value: cookie.slice(split + 1) }
}

function isFixtureOrigin(value, origin) {
  try {
    const candidate = new URL(value)
    if (candidate.protocol === 'ws:') candidate.protocol = 'http:'
    else if (candidate.protocol === 'wss:') candidate.protocol = 'https:'
    return candidate.origin === origin
  } catch { return false }
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url, { maxPayload: 8 * 1024 * 1024 })
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.socket.on('message', raw => {
      let packet
      try { packet = JSON.parse(raw.toString()) } catch { return }
      if (packet.id && this.pending.has(packet.id)) {
        const pending = this.pending.get(packet.id)
        this.pending.delete(packet.id)
        clearTimeout(pending.timer)
        if (packet.error) pending.reject(new Error(`DevTools command failed: ${pending.method}`))
        else pending.resolve(packet.result || {})
        return
      }
      for (const listener of this.listeners.get(packet.method) || []) listener(packet.params || {}, packet.sessionId)
    })
    this.socket.on('error', () => {})
  }

  async open() { await once(this.socket, 'open') }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`DevTools command timed out: ${method}`))
      }, 5000)
      this.pending.set(id, { resolve: resolvePromise, reject, timer, method })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(method, listener) {
    const set = this.listeners.get(method) || new Set()
    set.add(listener)
    this.listeners.set(method, set)
    return () => set.delete(listener)
  }

  close() { this.socket.close() }
}

class BrowserPage {
  constructor(devtools, sessionId, origin) {
    this.devtools = devtools
    this.sessionId = sessionId
    this.origin = origin
    this.unlisten = null
  }

  async initialize(cookie, mobile, noteExternalRequest) {
    const sessionId = this.sessionId
    const send = (method, params = {}) => this.devtools.send(method, params, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.enable')
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    this.unlisten = this.devtools.on('Fetch.requestPaused', (event, eventSession) => {
      if (eventSession !== sessionId) return
      const sameOrigin = isFixtureOrigin(event.request.url, this.origin)
      if (!sameOrigin) noteExternalRequest()
      void send(sameOrigin ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        sameOrigin ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    })
    this.unlistenNetwork = this.devtools.on('Network.requestWillBeSent', event => {
      if (!isFixtureOrigin(event.request.url, this.origin)) noteExternalRequest()
    })
    this.unlistenSocket = this.devtools.on('Network.webSocketCreated', event => {
      if (!isFixtureOrigin(event.url, this.origin)) noteExternalRequest()
    })
    await send('Network.setCookie', {
      ...parseCookie(cookie), url: this.origin, path: '/', httpOnly: true, sameSite: 'Lax', secure: false,
    })
    if (mobile) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
        screenWidth: 390, screenHeight: 844, screenOrientation: { angle: 0, type: 'portraitPrimary' },
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    } else {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: false })
    }
  }

  async navigate(url) {
    requireCondition(new URL(url).origin === this.origin, 'refusing navigation outside the disposable fixture origin')
    await this.waitForDocument(() => this.devtools.send('Page.navigate', { url }, this.sessionId))
  }

  async reload() {
    await this.waitForDocument(() => this.devtools.send('Page.reload', { ignoreCache: true }, this.sessionId))
  }

  async waitForDocument(startNavigation) {
    const send = (method, params = {}) => this.devtools.send(method, params, this.sessionId)
    await send('Page.setLifecycleEventsEnabled', { enabled: true })
    const tree = await send('Page.getFrameTree')
    const rootFrame = tree.frameTree?.frame
    requireCondition(rootFrame?.id, 'main browser frame has no identity')
    const priorLoader = typeof rootFrame.loaderId === 'string' ? rootFrame.loaderId : ''
    const seenLoaded = new Set()
    let nextLoader = null
    const removeFrame = this.devtools.on('Page.frameNavigated', (event, eventSession) => {
      if (eventSession !== this.sessionId) return
      if (event.frame?.id === rootFrame.id && event.frame.loaderId && event.frame.loaderId !== priorLoader) nextLoader = event.frame.loaderId
    })
    const removeLifecycle = this.devtools.on('Page.lifecycleEvent', (event, eventSession) => {
      if (eventSession !== this.sessionId) return
      if (event.frameId === rootFrame.id && event.name === 'load' && event.loaderId) seenLoaded.add(event.loaderId)
    })
    try {
      const result = await startNavigation()
      if (result.errorText) throw new Error('browser document navigation was refused')
      if (result.loaderId && result.loaderId !== priorLoader) nextLoader = result.loaderId
      const deadline = Date.now() + PAGE_WAIT_MS
      while (Date.now() < deadline) {
        if (nextLoader && seenLoaded.has(nextLoader)) return
        await delay(25)
      }
      throw new Error('new browser document did not reach its load event')
    } finally {
      removeFrame()
      removeLifecycle()
    }
  }

  async evaluate(expression) {
    const result = await this.devtools.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: false,
    }, this.sessionId)
    if (result.exceptionDetails) throw new Error('Rendered browser assertion could not be evaluated')
    return result.result?.value
  }

  async wait(expression, message, timeout = PAGE_WAIT_MS) {
    const stop = Date.now() + timeout
    while (Date.now() < stop) {
      if (await this.evaluate(expression)) return
      await delay(100)
    }
    throw new Error(message)
  }

  async waitChoice(label) {
    const encoded = JSON.stringify(label)
    await this.wait(`[...document.querySelectorAll('.teaching-shift__choice')].some(node => node.textContent.trim() === ${encoded})`, 'expected next teaching choice did not render')
  }

  async waitRendered({ cash, stage, retry = false, noTeaching = false }, message) {
    const expectedCash = JSON.stringify(money(cash))
    const expectedStage = stage === undefined ? 'null' : JSON.stringify(stage)
    const requireNoTeaching = noTeaching ? ' && !lesson' : ''
    const requireStage = stage === undefined ? '' : ` && lesson?.querySelector('.teaching-shift__stage')?.textContent.trim() === ${expectedStage}`
    const requireRetry = retry ? " && lesson?.querySelector('.teaching-shift__feedback')?.textContent.includes('Try again:')" : ''
    await this.wait(`(() => {
      const wallet=document.querySelector('.hud-cash');
      const lesson=document.querySelector('.teaching-shift');
      const rect=wallet?.getBoundingClientRect();
      return Boolean(wallet && wallet.textContent.trim() === ${expectedCash} && rect?.width > 0 && rect?.height > 0${requireNoTeaching}${requireStage}${requireRetry});
    })()`, message)
  }

  async screenshot(name) {
    const result = await this.devtools.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    }, this.sessionId)
    const bytes = Buffer.from(result.data || '', 'base64')
    requireCondition(bytes.length > 1000 && bytes.length <= 2_000_000, 'screenshot size was outside the bounded range')
    await writeFile(resolve(OUTPUT, name), bytes)
  }

  async rect(label) {
    const encoded = JSON.stringify(label)
    const value = await this.evaluate(`(() => {
      const button = [...document.querySelectorAll('.teaching-shift__choice')].find(node => node.textContent.trim() === ${encoded});
      if (!button || button.disabled) return null;
      const r = button.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};
    })()`)
    requireCondition(value && Number.isFinite(value.x) && Number.isFinite(value.y), 'expected rendered lesson choice was not available')
    return value
  }

  async click(label) {
    const point = await this.rect(label)
    const send = (method, params) => this.devtools.send(method, params, this.sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }

  async touch(label) {
    const point = await this.rect(label)
    const send = (method, params) => this.devtools.send(method, params, this.sessionId)
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  async key(label) {
    const encoded = JSON.stringify(label)
    const send = (type, key, code, vk) => this.devtools.send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      ...(key === 'Enter' && type === 'char' ? { text: '\r', unmodifiedText: '\r' } : {}),
    }, this.sessionId)
    let focused = false
    for (let index = 0; index < 180; index++) {
      if (await this.evaluate(`document.activeElement?.matches('.teaching-shift__choice') && document.activeElement.textContent.trim() === ${encoded}`)) {
        focused = true
        break
      }
      await send('keyDown', 'Tab', 'Tab', 9)
      await send('keyUp', 'Tab', 'Tab', 9)
    }
    requireCondition(focused, 'keyboard could not reach the requested lesson control')
    await send('keyDown', 'Enter', 'Enter', 13)
    await send('keyUp', 'Enter', 'Enter', 13)
  }

  async viewport() {
    return await this.evaluate(`(() => {
      const root=document.documentElement;
      const buttons=[...document.querySelectorAll('.teaching-shift__choice')].map(b=>{const r=b.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}});
      return {width:root.clientWidth,scrollWidth:root.scrollWidth,buttons};
    })()`)
  }

  dispose() {
    this.unlisten?.()
    this.unlistenNetwork?.()
    this.unlistenSocket?.()
    this.unlisten = null
  }
}

async function life(f, cookie) {
  const response = await f.request('/api/life?city=lagos', undefined, cookie)
  requireCondition(response.status === 200, 'fixture life read failed')
  return await response.json()
}

async function setupTeacher(f, name) {
  const device = await f.device(name)
  for (const action of [
    { type: 'apply-job', payload: { id: 'teaching' } },
    { type: 'spot', payload: { id: 'work' } },
    { type: 'activity', payload: { id: 'teaching-shift' } },
  ]) {
    const outcome = await f.action(device.cookie, action)
    requireCondition(outcome.ok === true, 'authored teaching activity setup was refused')
  }
  const current = await life(f, device.cookie)
  requireCondition(current.state?.activeAction?.teaching?.stage === 'diagnose', 'server did not create the authored teaching session')
  return { device, starting: current.state }
}

async function startBrowser(t, chromePath) {
  const profile = await mkdtemp(`${tmpdir()}/living-world-teaching-chrome-`)
  const child = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--metrics-recording-only', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { detached: process.platform !== 'win32', stdio: 'ignore' })
  child.on('error', () => {})
  let closed = false
  const cleanup = async () => {
    if (closed) return
    closed = true
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal) } catch {}
      await Promise.race([once(child, 'exit').catch(() => {}), delay(signal === 'SIGTERM' ? 1500 : 500)])
      if (child.exitCode !== null || child.signalCode !== null) break
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
  t.after(cleanup)
  const active = new Set()
  let externalRequests = 0
  const marker = resolve(profile, 'DevToolsActivePort')
  const markerEnd = Date.now() + 10_000
  while (Date.now() < markerEnd) {
    try {
      const lines = (await readFile(marker, 'utf8')).trim().split('\n')
      if (lines.length >= 2 && /^\d+$/.test(lines[0])) {
        const browser = new DevTools(`ws://127.0.0.1:${lines[0]}${lines[1]}`)
        await browser.open()
        t.after(() => browser.close())
        const version = await browser.send('Browser.getVersion')
        return {
          browser,
          version: String(version.product || 'unknown').slice(0, 80),
          async page(origin, cookie, mobile) {
            const context = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
            active.add(context.browserContextId)
            const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId })
            const attached = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
            const page = new BrowserPage(browser, attached.sessionId, origin)
            await page.initialize(cookie, mobile, () => { externalRequests += 1 })
            await page.navigate(`${origin}/`)
            await page.wait("document.querySelector('.teaching-shift') !== null", 'the rendered Teaching controls did not appear')
            return { page, contextId: context.browserContextId, targetId: target.targetId }
          },
          async closePage(page) {
            page.page.dispose()
            await browser.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {})
            await browser.send('Target.disposeBrowserContext', { browserContextId: page.contextId }).catch(() => {})
            active.delete(page.contextId)
          },
          async close() {
            for (const browserContextId of active) await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
            browser.close()
            await cleanup()
          },
          externalRequests: () => externalRequests,
        }
      }
    } catch (error) {
      if (Date.now() + 200 < markerEnd) await delay(100)
      else throw error
    }
    if (child.exitCode !== null) throw new Error('The requested Chrome executable exited during startup')
    await delay(100)
  }
  await cleanup()
  throw new Error('Chrome DevTools did not become ready within the startup limit')
}

test('rendered teaching practice survives interruption and settles one wage on desktop and 390px touch', { timeout: LIMIT_MS }, async t => {
  let sha = 'unavailable'
  let expectedSha = process.env.LW_QA_SOURCE_SHA || 'missing'
  let healthReceipt = null
  let browserVersion = 'unreported'
  let phase = 'preflight'
  const measurements = {}
  const screenshots = []
  try {
  requireCondition(Boolean(process.env.LW_QA_OUTPUT_DIR), 'set LW_QA_OUTPUT_DIR to a disposable artifact directory')
  const relativeOutput = resolve(OUTPUT).startsWith(`${root}/`) || resolve(OUTPUT) === root
  requireCondition(!relativeOutput, 'LW_QA_OUTPUT_DIR must be outside the source checkout')
  await mkdir(OUTPUT, { recursive: true })
  requireCondition(typeof CHROME === 'string' && CHROME.length > 0, 'set CHROME to the installed Chrome/Chromium executable')
  const chromeStat = await stat(CHROME).catch(() => null)
  requireCondition(Boolean(chromeStat?.isFile()), 'CHROME must name an existing executable file')
  await stat(resolve(root, 'dist/index.html')).catch(() => { throw new Error('build dist/ before running browser QA') })
  sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  requireCondition(/^[0-9a-f]{40}$/i.test(expectedSha) && expectedSha === sha, 'checkout SHA did not match required LW_QA_SOURCE_SHA')

  phase = 'fixture-startup'
  const f = await fixture(t, { distDir: resolve(root, 'dist'), sessionTtlMs: 30 * 60_000, buildId: `joinallworld-${sha}` })
  const healthResponse = await fetch(`${f.base}/api/health`)
  requireCondition(healthResponse.status === 200, 'fixture health endpoint failed')
  const health = await healthResponse.json()
  requireCondition(health.ok === true, 'fixture health response was not ready')
  const expectedBuildId = `joinallworld-${sha}`.slice(0, 40)
  requireCondition(health.build === expectedBuildId, 'fixture build identity did not match the exact source SHA')
  healthReceipt = { ok: true, buildId: typeof health.build === 'string' ? health.build.slice(0, 80) : 'unreported' }
  const rootResponse = await fetch(`${f.base}/`)
  requireCondition(rootResponse.status === 200 && (rootResponse.headers.get('content-type') || '').includes('text/html'), 'fixture did not serve the built app shell')

  phase = 'teacher-setup'
  const desktopTeacher = await setupTeacher(f, 'QA Desktop Teacher')
  const mobileTeacher = await setupTeacher(f, 'QA Touch Teacher')
  const desktopCash = desktopTeacher.starting.cash
  const mobileBefore = (await life(f, mobileTeacher.device.cookie)).state
  phase = 'chrome-startup'
  const browser = await startBrowser(t, CHROME)
  browserVersion = browser.version
  phase = 'desktop-render'
  const appPage = await browser.page(f.base, desktopTeacher.device.cookie, false)
  try {
    await appPage.page.waitRendered({ cash: desktopCash, stage: '1 · Notice the learner’s idea' }, 'desktop app hydration did not show the active lesson and server balance')
    await appPage.page.screenshot('teaching-desktop-before.png')
    screenshots.push('teaching-desktop-before.png')
    const desktopView = await appPage.page.viewport()
    requireCondition(desktopView.width >= 1000 && desktopView.scrollWidth <= desktopView.width + 1, 'desktop teaching renderer overflowed its viewport')

    phase = 'desktop-wrong-choice'
    await appPage.page.click('They think the numerator is the number of equal parts in the whole.')
    await appPage.page.wait("document.querySelector('.teaching-shift__feedback')?.textContent.includes('Try again:')", 'wrong desktop choice did not render retry feedback')
    let serverState = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(serverState.activeAction?.teaching?.stage === 'diagnose'
      && serverState.activeAction.teaching.feedback === 'retry'
      && serverState.activeAction.teaching.revision === desktopTeacher.starting.activeAction.teaching.revision + 1,
    'wrong rendered choice advanced or failed to retain retry feedback')
    requireCondition(serverState.cash === desktopCash, 'wrong teaching choice changed the wage balance')
    f.advance(120_000)
    serverState = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(serverState.activeAction?.teaching?.stage === 'diagnose' && serverState.cash === desktopCash,
      'elapsed server time advanced or paid the input-driven lesson')

    phase = 'desktop-reload-retry'
    await appPage.page.reload()
    await appPage.page.waitRendered({ cash: desktopCash, stage: '1 · Notice the learner’s idea', retry: true }, 'desktop reload did not hydrate the same retry lesson and balance')
    await appPage.page.screenshot('teaching-desktop-reloaded.png')
    screenshots.push('teaching-desktop-reloaded.png')

    const desktopChoices = [
      'They think a larger denominator makes the fraction larger.',
      'Show equal-sized wholes split into thirds and fourths; one third is the larger piece.',
      'One fifth is larger than one sixth when the wholes are equal.',
    ]
    phase = 'desktop-complete'
    for (const [index, choice] of desktopChoices.entries()) {
      if (index === 0) await appPage.page.key(choice)
      else await appPage.page.click(choice)
      const next = desktopChoices[index + 1]
      if (next) await appPage.page.waitChoice(next)
    }
    await appPage.page.wait("!document.querySelector('.teaching-shift')", 'last desktop answer did not complete the rendered lesson')
    const completedDesktop = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(completedDesktop.activeAction === null, 'desktop controls did not complete the authored lesson')
    requireCondition(completedDesktop.cash === desktopCash + 3000, 'desktop completion did not settle exactly one authored wage')
    requireCondition(completedDesktop.ledger.filter(row => row.amount === 3000).length === 1, 'desktop completion did not retain exactly one wage ledger row')
    await appPage.page.waitRendered({ cash: completedDesktop.cash, noTeaching: true }, 'desktop HUD did not render the settled balance with no active lesson')
    await appPage.page.screenshot('teaching-desktop-after.png')
    screenshots.push('teaching-desktop-after.png')
    phase = 'desktop-terminal-reload'
    await appPage.page.reload()
    await appPage.page.waitRendered({ cash: completedDesktop.cash, noTeaching: true }, 'completed desktop reload did not hydrate the terminal state and current balance')
    const reloadedDesktop = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(reloadedDesktop.activeAction === null && reloadedDesktop.cash === completedDesktop.cash
      && reloadedDesktop.ledger.filter(row => row.amount === 3000).length === 1,
    'completed desktop reload duplicated or lost the terminal wage')
    measurements.desktop = desktopView
  } finally {
    await browser.closePage(appPage)
  }

  const unchangedMobile = (await life(f, mobileTeacher.device.cookie)).state
  requireCondition(unchangedMobile.cash === mobileBefore.cash
    && unchangedMobile.activeAction?.teaching?.revision === mobileBefore.activeAction?.teaching?.revision
    && unchangedMobile.activeAction?.teaching?.stage === 'diagnose', 'desktop actor changed the independent mobile teacher')

  phase = 'mobile-render'
  const mobilePage = await browser.page(f.base, mobileTeacher.device.cookie, true)
  try {
    await mobilePage.page.waitRendered({ cash: mobileBefore.cash, stage: '1 · Notice the learner’s idea' }, 'mobile app hydration did not show the active lesson and server balance')
    await mobilePage.page.screenshot('teaching-mobile-before.png')
    screenshots.push('teaching-mobile-before.png')
    const mobileView = await mobilePage.page.viewport()
    requireCondition(mobileView.width === 390 && mobileView.scrollWidth <= mobileView.width + 1, '390px teaching renderer has horizontal overflow')
    requireCondition(mobileView.buttons.length === 3 && mobileView.buttons.every(button => button.width >= 44 && button.height >= 44),
      '390px teaching controls did not retain usable touch targets')
    measurements.mobile390 = mobileView

    phase = 'mobile-progress'
    await mobilePage.page.touch('They think a larger denominator makes the fraction larger.')
    await mobilePage.page.waitChoice('Show equal-sized wholes split into thirds and fourths; one third is the larger piece.')
    await mobilePage.page.touch('Show equal-sized wholes split into thirds and fourths; one third is the larger piece.')
    await mobilePage.page.waitChoice('One fifth is larger than one sixth when the wholes are equal.')
    let mobileState = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(mobileState.activeAction?.teaching?.stage === 'check' && mobileState.cash === mobileBefore.cash,
      'mobile touch sequence did not preserve the expected unpaid check stage')
    phase = 'mobile-reload-check'
    await mobilePage.page.reload()
    await mobilePage.page.waitRendered({ cash: mobileBefore.cash, stage: '3 · Check understanding' }, 'mobile reload did not hydrate the active check stage and balance')
    phase = 'mobile-complete'
    await mobilePage.page.touch('One fifth is larger than one sixth when the wholes are equal.')
    await mobilePage.page.wait("!document.querySelector('.teaching-shift')", 'last mobile answer did not complete the rendered lesson')
    mobileState = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(mobileState.activeAction === null && mobileState.cash === mobileBefore.cash + 3000,
      'mobile completion did not settle exactly one wage')
    requireCondition(mobileState.ledger.filter(row => row.amount === 3000).length === 1, 'mobile wage ledger was not once-only')
    await mobilePage.page.waitRendered({ cash: mobileState.cash, noTeaching: true }, 'mobile HUD did not render the settled balance with no active lesson')
    await mobilePage.page.screenshot('teaching-mobile-after.png')
    screenshots.push('teaching-mobile-after.png')
    phase = 'mobile-terminal-reload'
    await mobilePage.page.reload()
    await mobilePage.page.waitRendered({ cash: mobileState.cash, noTeaching: true }, 'completed mobile reload did not hydrate the terminal state and current balance')
    const afterReload = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(afterReload.activeAction === null && afterReload.cash === mobileState.cash
      && afterReload.ledger.filter(row => row.amount === 3000).length === 1, 'mobile completed reload duplicated the wage')
  } finally {
    await browser.closePage(mobilePage)
    await browser.close()
  }

  phase = 'external-origin-check'
  requireCondition(browser.externalRequests() === 0, 'browser attempted an external-origin request; all such requests are blocked and this QA run refuses it')

  const report = {
    result: 'passed',
    scope: 'disposable local Node HTTP fixture; rendered teaching practice only',
    sourceSha: sha,
    health: healthReceipt,
    browser: browserVersion,
    node: process.version,
    platform: process.platform,
    viewportObservations: measurements,
    screenshots,
    qualification: 'headless Chromium desktop and 390px touch emulation; not a physical-device or whole-journey result',
  }
  phase = 'receipt-write'
  await writeReceipt(report)
  process.stdout.write(`${JSON.stringify(report)}\n`)
  } catch {
    await mkdir(OUTPUT, { recursive: true }).catch(() => {})
    await writeReceipt({
      result: 'failed', scope: 'disposable local Node HTTP fixture; rendered teaching practice only',
      sourceSha: sha, expectedSha, health: healthReceipt, browser: browserVersion,
      node: process.version, platform: process.platform, viewportObservations: measurements,
      screenshots, failureCode: phase,
      qualification: 'no acceptance claim; inspect the test failure and bounded artifacts',
    }).catch(() => {})
    throw new Error(`Teaching browser QA failed during ${phase}; see receipt.json`)
  }
})
