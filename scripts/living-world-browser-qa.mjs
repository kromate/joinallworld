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
import { DEFAULT_LOOK } from '../src/game/content/traits.ts'

const LIMIT_MS = 120_000
const PAGE_WAIT_MS = 12_000
const CHROME = process.env.CHROME
const OUTPUT = resolve(process.env.LW_QA_OUTPUT_DIR || `${tmpdir()}/living-world-teaching-qa-${process.pid}`)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {JsonRecord & {request?: {url?: string; method?: string}; response?: {url?: string; status?: number}; requestId?: string; errorReason?: string; url?: string; frame?: {id?: string; loaderId?: string}; frameId?: string; name?: string; loaderId?: string}} DevToolsEvent */
/** @typedef {JsonRecord & {data?: string; body?: string; base64Encoded?: boolean; product?: string; browserContextId?: string; targetId?: string; sessionId?: string; frameTree?: {frame?: {id?: string; loaderId?: string}}; errorText?: string; loaderId?: string; exceptionDetails?: object; result?: {value?: unknown}}} DevToolsResult */
/** @typedef {{resolve: (value: DevToolsResult) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; method: string}} PendingCommand */
/** @typedef {(event: DevToolsEvent, sessionId?: string) => void} DevToolsListener */
/** @typedef {{x: number; y: number; width: number; height: number}} BrowserPoint */
/** @typedef {{width: number; scrollWidth: number; buttons: Array<{width: number; height: number}>}} ViewportObservation */
/** @typedef {{found: boolean; textMatches: boolean; readable: boolean; pointerReady: boolean; cueOverlaps: boolean; scrollable: boolean; scrollTop: number; scrollHeight: number; clientHeight: number; top: number; bottom: number; clipTop: number; clipBottom: number; pointX: number; pointY: number; inputX: number; inputY: number; width: number; height: number}} TargetObservation */
/** @typedef {{observed: boolean; visible: boolean; overlapsQuestion: boolean; overlapsContext: boolean}} CueObservation */
/** @typedef {{contextTargets: number; choicesReached: number; cancelReached: boolean; nativeScrolls: number; focusRetained: boolean; moreCue: 'observed' | 'notObserved'; cueOverlapsQuestion: boolean; cueOverlapsContext: boolean}} ScrollAcceptanceObservation */
/** @typedef {{cash: number; stage?: string; retry?: boolean; noTeaching?: boolean}} RenderExpectation */
/** @typedef {{page: BrowserPage; contextId: string; targetId: string}} BrowserPageContext */
/** @typedef {{readyState: string; localRoot: boolean; appRoot: boolean; lesson: boolean; lessonChoiceCount: number; progressStatus: boolean; activityLoadFailure: boolean; balance: boolean; characterCreator: boolean; quickStart: boolean; sessionStart: boolean; connectionAlert: boolean; scene: boolean; knownText: Record<string, boolean>}} FailureDomObservation */
/** @typedef {FailureDomObservation & {runtimeExceptions: number}} FailureObservation */
/** @typedef {{stage: string; revision: number; feedback?: string | null}} TeachingObservation */
/** @typedef {{label: string; prompt: string; choices: [string, string, string]}} TeachingStageFixture */
/** @typedef {{teaching?: TeachingObservation}} ActiveActionObservation */
/** @typedef {{cash: number; location?: string; spot?: string; onboarding?: {required: boolean; done: boolean}; activeAction?: ActiveActionObservation | null; ledger: Array<{amount: number}>}} LifeStateObservation */
/** @typedef {{state: LifeStateObservation}} LifeResponse */
/** @typedef {Awaited<ReturnType<typeof fixture>>} Fixture */

/** @param {unknown} value @returns {value is JsonRecord} */
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** @param {unknown} value @returns {DevToolsEvent} */
function readDevToolsEvent(value) {
  if (!isRecord(value)) return {}
  const request = isRecord(value.request) ? {
    ...(typeof value.request.url === 'string' ? { url: value.request.url } : {}),
    ...(typeof value.request.method === 'string' ? { method: value.request.method } : {}),
  } : undefined
  const response = isRecord(value.response) ? {
    ...(typeof value.response.url === 'string' ? { url: value.response.url } : {}),
    ...(typeof value.response.status === 'number' ? { status: value.response.status } : {}),
  } : undefined
  const frame = isRecord(value.frame) ? {
    ...(typeof value.frame.id === 'string' ? { id: value.frame.id } : {}),
    ...(typeof value.frame.loaderId === 'string' ? { loaderId: value.frame.loaderId } : {}),
  } : undefined
  return {
    ...(request ? { request } : {}),
    ...(response ? { response } : {}),
    ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {}),
    ...(typeof value.errorReason === 'string' ? { errorReason: value.errorReason } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(frame ? { frame } : {}),
    ...(typeof value.frameId === 'string' ? { frameId: value.frameId } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.loaderId === 'string' ? { loaderId: value.loaderId } : {}),
  }
}

/** @param {unknown} value @returns {DevToolsResult} */
function readDevToolsResult(value) {
  if (!isRecord(value)) return {}
  /** @type {DevToolsResult['frameTree']} */
  let frameTree
  if (isRecord(value.frameTree) && isRecord(value.frameTree.frame)) {
    frameTree = { frame: {
      ...(typeof value.frameTree.frame.id === 'string' ? { id: value.frameTree.frame.id } : {}),
      ...(typeof value.frameTree.frame.loaderId === 'string' ? { loaderId: value.frameTree.frame.loaderId } : {}),
    } }
  }
  const result = isRecord(value.result) && Object.hasOwn(value.result, 'value') ? { value: value.result.value } : undefined
  return {
    ...(typeof value.data === 'string' ? { data: value.data } : {}),
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    ...(typeof value.base64Encoded === 'boolean' ? { base64Encoded: value.base64Encoded } : {}),
    ...(typeof value.product === 'string' ? { product: value.product } : {}),
    ...(typeof value.browserContextId === 'string' ? { browserContextId: value.browserContextId } : {}),
    ...(typeof value.targetId === 'string' ? { targetId: value.targetId } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(frameTree ? { frameTree } : {}),
    ...(typeof value.errorText === 'string' ? { errorText: value.errorText } : {}),
    ...(typeof value.loaderId === 'string' ? { loaderId: value.loaderId } : {}),
    ...(isRecord(value.exceptionDetails) ? { exceptionDetails: value.exceptionDetails } : {}),
    ...(result ? { result } : {}),
  }
}

/** @param {unknown} value @returns {value is FailureDomObservation} */
function isFailureDomObservation(value) {
  if (!isRecord(value) || !isRecord(value.knownText)) return false
  const booleanKeys = ['localRoot', 'appRoot', 'lesson', 'progressStatus', 'activityLoadFailure', 'balance', 'characterCreator', 'quickStart', 'sessionStart', 'connectionAlert', 'scene']
  return typeof value.readyState === 'string' && typeof value.lessonChoiceCount === 'number'
    && booleanKeys.every(key => typeof value[key] === 'boolean')
    && Object.values(value.knownText).every((item) => typeof item === 'boolean')
}

/** @param {unknown} value @returns {value is TargetObservation} */
function isTargetObservation(value) {
  if (!isRecord(value)) return false
  const booleans = ['found', 'textMatches', 'readable', 'pointerReady', 'cueOverlaps', 'scrollable']
  const numbers = ['scrollTop', 'scrollHeight', 'clientHeight', 'top', 'bottom', 'clipTop', 'clipBottom', 'pointX', 'pointY', 'inputX', 'inputY', 'width', 'height']
  return booleans.every(key => typeof value[key] === 'boolean')
    && numbers.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
}

/** @param {unknown} value @returns {value is CueObservation} */
function isCueObservation(value) {
  return isRecord(value) && typeof value.observed === 'boolean' && typeof value.visible === 'boolean'
    && typeof value.overlapsQuestion === 'boolean' && typeof value.overlapsContext === 'boolean'
}

/** @param {unknown} value @returns {value is ViewportObservation} */
function isViewportObservation(value) {
  return isRecord(value) && typeof value.width === 'number' && Number.isFinite(value.width)
    && typeof value.scrollWidth === 'number' && Number.isFinite(value.scrollWidth)
    && Array.isArray(value.buttons) && value.buttons.every((button) => isRecord(button)
      && typeof button.width === 'number' && Number.isFinite(button.width)
      && typeof button.height === 'number' && Number.isFinite(button.height))
}

/** @param {unknown} value @returns {value is LifeResponse} */
function isLifeResponse(value) {
  if (!isRecord(value) || !isRecord(value.state) || typeof value.state.cash !== 'number' || !Array.isArray(value.state.ledger)
    || !value.state.ledger.every((row) => isRecord(row) && typeof row.amount === 'number')) return false
  const state = value.state
  if (state.onboarding !== undefined && (!isRecord(state.onboarding) || typeof state.onboarding.required !== 'boolean' || typeof state.onboarding.done !== 'boolean')) return false
  if (state.activeAction !== undefined && state.activeAction !== null) {
    if (!isRecord(state.activeAction)) return false
    const teaching = state.activeAction.teaching
      if (teaching !== undefined && (!isRecord(teaching) || typeof teaching.stage !== 'string' || typeof teaching.revision !== 'number'
      || (teaching.feedback !== undefined && teaching.feedback !== null && typeof teaching.feedback !== 'string'))) return false
  }
  return (state.location === undefined || typeof state.location === 'string')
    && (state.spot === undefined || typeof state.spot === 'string')
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

/** @param {unknown} value */
async function writeReceipt(value) {
  const text = `${JSON.stringify(value)}\n`
  requireCondition(Buffer.byteLength(text) <= 8192, 'bounded QA receipt exceeded its size limit')
  const temporary = resolve(OUTPUT, `receipt-${process.pid}.tmp`)
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, resolve(OUTPUT, 'receipt.json'))
}

/** @param {string} cookie */
function parseCookie(cookie) {
  const split = cookie.indexOf('=')
  requireCondition(split > 0, 'fixture session cookie shape was unsupported')
  return { name: cookie.slice(0, split), value: cookie.slice(split + 1) }
}

/** @param {string} value @param {string} origin */
function isFixtureOrigin(value, origin) {
  try {
    const candidate = new URL(value)
    if (candidate.protocol === 'ws:') candidate.protocol = 'http:'
    else if (candidate.protocol === 'wss:') candidate.protocol = 'https:'
    return candidate.origin === origin
  } catch { return false }
}

class DevTools {
  /** @param {string} url */
  constructor(url) {
    this.socket = new WebSocket(url, { maxPayload: 8 * 1024 * 1024 })
    this.nextId = 0
    /** @type {Map<number, PendingCommand>} */
    this.pending = new Map()
    /** @type {Map<string, Set<DevToolsListener>>} */
    this.listeners = new Map()
    this.socket.on('message', raw => {
      /** @type {unknown} */
      let decoded
      try { decoded = JSON.parse(raw.toString()) } catch { return }
      if (!isRecord(decoded)) return
      const packet = {
        ...(typeof decoded.id === 'number' ? { id: decoded.id } : {}),
        ...(typeof decoded.method === 'string' ? { method: decoded.method } : {}),
        ...(typeof decoded.sessionId === 'string' ? { sessionId: decoded.sessionId } : {}),
        params: readDevToolsEvent(decoded.params),
        result: readDevToolsResult(decoded.result),
        ...(isRecord(decoded.error) ? { error: decoded.error } : {}),
      }
      const pending = packet.id ? this.pending.get(packet.id) : undefined
      if (packet.id && pending) {
        this.pending.delete(packet.id)
        clearTimeout(pending.timer)
        if (packet.error) pending.reject(new Error(`DevTools command failed: ${pending.method}`))
        else pending.resolve(packet.result || {})
        return
      }
      if (typeof packet.method !== 'string') return
      for (const listener of this.listeners.get(packet.method) || []) listener(packet.params || {}, packet.sessionId)
    })
    this.socket.on('error', () => {})
  }

  async open() { await once(this.socket, 'open') }

  /** @param {string} method @param {Record<string, unknown>} [params] @param {string} [sessionId] @returns {Promise<DevToolsResult>} */
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

  /** @param {string} method @param {DevToolsListener} listener */
  on(method, listener) {
    const set = this.listeners.get(method) || new Set()
    set.add(listener)
    this.listeners.set(method, set)
    return () => set.delete(listener)
  }

  close() { this.socket.close() }
}

class BrowserPage {
  /** @param {DevTools} devtools @param {string} sessionId @param {string} origin */
  constructor(devtools, sessionId, origin) {
    this.devtools = devtools
    this.sessionId = sessionId
    this.origin = origin
    /** @type {(() => void) | null} */
    this.unlisten = null
    /** @type {(() => void) | null} */
    this.unlistenNetwork = null
    /** @type {(() => void) | null} */
    this.unlistenSocket = null
    /** @type {(() => void) | null} */
    this.unlistenException = null
    this.exceptionCount = 0
    /** @type {Map<string, {sequence: number; status200: boolean}>} */
    this.pendingLifeReads = new Map()
    this.startedLifeReads = 0
    /** @type {Map<number, {cash: number; stage: string | null; revision: number | null}>} */
    this.successfulLifeReads = new Map()
    this.nativeScrolls = 0
    /** @type {Map<string, number>} */
    this.targetScrolls = new Map()
    this.cueSeen = false
    this.cueQuestionOverlap = false
    this.cueContextOverlap = false
    /** @type {(() => void) | null} */
    this.unlistenLife = null
    /** @type {(() => void) | null} */
    this.unlistenLifeResponse = null
    /** @type {(() => void) | null} */
    this.unlistenLifeFailure = null
  }

  /** @param {string} cookie @param {boolean} mobile @param {() => void} noteExternalRequest */
  async initialize(cookie, mobile, noteExternalRequest) {
    const sessionId = this.sessionId
    /** @param {string} method @param {Record<string, unknown>} [params] */
    const send = (method, params = {}) => this.devtools.send(method, params, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    this.unlistenException = this.devtools.on('Runtime.exceptionThrown', (_event, eventSession) => {
      if (eventSession === sessionId) this.exceptionCount = Math.min(20, this.exceptionCount + 1)
    })
    await send('Network.enable')
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    this.unlisten = this.devtools.on('Fetch.requestPaused', (event, eventSession) => {
      if (eventSession !== sessionId) return
      const sameOrigin = typeof event.request?.url === 'string' && isFixtureOrigin(event.request.url, this.origin)
      if (!sameOrigin) noteExternalRequest()
      void send(sameOrigin ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        sameOrigin ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    })
    this.unlistenNetwork = this.devtools.on('Network.requestWillBeSent', (event, eventSession) => {
      if (eventSession !== sessionId) return
      if (typeof event.request?.url !== 'string' || !isFixtureOrigin(event.request.url, this.origin)) {
        noteExternalRequest()
        return
      }
      if (typeof event.requestId !== 'string') return
      try {
        const url = new URL(event.request.url)
        if (event.request.method === 'GET' && url.pathname === '/api/life' && url.searchParams.get('city') === 'lagos') {
          this.startedLifeReads += 1
          this.pendingLifeReads.set(event.requestId, { sequence: this.startedLifeReads, status200: false })
        }
      } catch { /* a malformed URL never becomes a counted refresh */ }
    })
    this.unlistenLifeResponse = this.devtools.on('Network.responseReceived', (event, eventSession) => {
      if (eventSession !== sessionId || typeof event.requestId !== 'string') return
      const pending = this.pendingLifeReads.get(event.requestId)
      if (!pending || event.response?.status !== 200 || typeof event.response.url !== 'string') return
      try {
        const url = new URL(event.response.url)
        if (url.pathname === '/api/life' && url.searchParams.get('city') === 'lagos') pending.status200 = true
      } catch { /* unsupported response URL cannot prove a successful life read */ }
    })
    this.unlistenLife = this.devtools.on('Network.loadingFinished', (event, eventSession) => {
      if (eventSession !== sessionId) return
      if (typeof event.requestId !== 'string') return
      const requestId = event.requestId
      const pending = this.pendingLifeReads.get(requestId)
      if (!pending) return
      this.pendingLifeReads.delete(requestId)
      if (!pending.status200) return
      void (async () => {
        try {
          const body = await this.devtools.send('Network.getResponseBody', { requestId }, sessionId)
          const source = body.base64Encoded ? Buffer.from(body.body || '', 'base64').toString('utf8') : body.body
          if (typeof source !== 'string' || Buffer.byteLength(source) > 64 * 1024) return
          const decoded = JSON.parse(source)
          if (!isLifeResponse(decoded)) return
          const teaching = decoded.state.activeAction?.teaching
          this.successfulLifeReads.set(pending.sequence, {
            cash: decoded.state.cash,
            stage: teaching?.stage || null,
            revision: teaching?.revision ?? null,
          })
          while (this.successfulLifeReads.size > 16) {
            const oldest = this.successfulLifeReads.keys().next().value
            if (oldest === undefined) break
            this.successfulLifeReads.delete(oldest)
          }
        } catch { /* response bodies are optional diagnostics, never test assertions */ }
      })()
    })
    this.unlistenLifeFailure = this.devtools.on('Network.loadingFailed', (event, eventSession) => {
      if (eventSession !== sessionId) return
      if (typeof event.requestId === 'string') this.pendingLifeReads.delete(event.requestId)
    })
    this.unlistenSocket = this.devtools.on('Network.webSocketCreated', event => {
      if (typeof event.url !== 'string' || !isFixtureOrigin(event.url, this.origin)) noteExternalRequest()
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

  /** @param {string} url */
  async navigate(url) {
    requireCondition(new URL(url).origin === this.origin, 'refusing navigation outside the disposable fixture origin')
    await this.waitForDocument(() => this.devtools.send('Page.navigate', { url }, this.sessionId))
  }

  async reload() {
    await this.waitForDocument(() => this.devtools.send('Page.reload', { ignoreCache: true }, this.sessionId))
  }

  /** @param {() => Promise<DevToolsResult>} startNavigation */
  async waitForDocument(startNavigation) {
    /** @param {string} method @param {Record<string, unknown>} [params] */
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
      const frame = event.frame
      if (frame && frame.id === rootFrame.id && frame.loaderId && frame.loaderId !== priorLoader) nextLoader = frame.loaderId
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

  /** @param {string} expression @returns {Promise<unknown>} */
  async evaluate(expression) {
    const result = await this.devtools.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: false,
    }, this.sessionId)
    if (result.exceptionDetails) throw new Error('Rendered browser assertion could not be evaluated')
    return result.result?.value
  }

  /** @param {string} expression @param {string} message @param {number} [timeout] */
  async wait(expression, message, timeout = PAGE_WAIT_MS) {
    const stop = Date.now() + timeout
    while (Date.now() < stop) {
      if (await this.evaluate(expression)) return
      await delay(100)
    }
    throw new Error(message)
  }

  /** @param {string} label */
  async waitChoice(label) {
    const encoded = JSON.stringify(label)
    await this.wait(`[...document.querySelectorAll('.teaching-shift__choice')].some(node => node.textContent.trim() === ${encoded})`, 'expected next teaching choice did not render')
  }

  /** @param {number} afterStarted @param {{cash: number; stage: string; revision: number}} expected @returns {Promise<number>} */
  async waitForLifeRead(afterStarted, expected) {
    const deadline = Date.now() + PAGE_WAIT_MS
    while (Date.now() < deadline) {
      for (const [sequence, state] of this.successfulLifeReads) {
        if (sequence > afterStarted && state.cash === expected.cash && state.stage === expected.stage && state.revision === expected.revision) return sequence
      }
      await delay(25)
    }
    throw new Error('a successful same-session life refresh with unchanged server state was not observed after focus')
  }

  /** @returns {number} */
  lifeReadCount() { return this.startedLifeReads }

  /** @param {string} selector @param {string | null} expectedText @param {string | null} choiceLabel @returns {Promise<TargetObservation>} */
  async inspectTarget(selector, expectedText = null, choiceLabel = null) {
    const value = await this.evaluate(`(() => {
      const lesson=document.querySelector('.teaching-shift');
      if (!lesson) return null;
      const selector=${JSON.stringify(selector)}, expected=${JSON.stringify(expectedText)}, choice=${JSON.stringify(choiceLabel)};
      const node=selector === '.teaching-shift__choice'
        ? [...lesson.querySelectorAll(selector)].find(item => item.textContent.trim() === choice)
        : lesson.querySelector(selector);
      if (!node) return {found:false,textMatches:false,readable:false,pointerReady:false,cueOverlaps:false,scrollable:false,scrollTop:0,scrollHeight:0,clientHeight:0,top:0,bottom:0,clipTop:0,clipBottom:0,pointX:0,pointY:0,inputX:0,inputY:0,width:0,height:0};
      let scroller=null;
      for(let item=lesson.parentElement;item && item!==document.documentElement;item=item.parentElement){
        const style=getComputedStyle(item);
        if((style.overflowY==='auto'||style.overflowY==='scroll')&&item.clientHeight>0){scroller=item;break;}
      }
      const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
      const clip={...viewport};
      for(let item=node;item && item!==document.documentElement;item=item.parentElement){
        const style=getComputedStyle(item);
        if(style.overflowX==='hidden'||style.overflowX==='clip'||style.overflowX==='auto'||style.overflowX==='scroll'){
          const r=item.getBoundingClientRect();clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);
        }
        if(style.overflowY==='hidden'||style.overflowY==='clip'||style.overflowY==='auto'||style.overflowY==='scroll'){
          const r=item.getBoundingClientRect();clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);
        }
      }
      const r=node.getBoundingClientRect(), style=getComputedStyle(node);
      const text=node.textContent.trim();
      const textMatches=expected===null?text.length>0:text===expected;
      const visibleTextRects=(()=>{const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].filter(rr=>rr.width>0&&rr.height>0);})();
      const textHitTest=visibleTextRects.length>0&&visibleTextRects.every(rr=>{
        if(rr.left<clip.left-1||rr.right>clip.right+1||rr.top<clip.top-1||rr.bottom>clip.bottom+1)return false;
        const hit=document.elementFromPoint(rr.left+rr.width/2,rr.top+rr.height/2);return Boolean(hit&&(hit===node||node.contains(hit)));
      });
      const readable=textMatches&&r.width>0&&r.height>0&&r.left>=clip.left-1&&r.right<=clip.right+1&&r.top>=clip.top-1&&r.bottom<=clip.bottom+1
        &&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0
        &&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1&&textHitTest;
      const visible={left:Math.max(r.left,clip.left),right:Math.min(r.right,clip.right),top:Math.max(r.top,clip.top),bottom:Math.min(r.bottom,clip.bottom)};
      const cues=[...document.querySelectorAll('.attn-cue')];
      const cueOverlaps=cues.some(cue=>{const cr=cue.getBoundingClientRect(),cs=getComputedStyle(cue);return visible.right>visible.left&&visible.bottom>visible.top&&cr.width>0&&cr.height>0&&cs.display!=='none'&&cs.visibility==='visible'&&Number(cs.opacity)>0.05&&cr.left<visible.right&&cr.right>visible.left&&cr.top<visible.bottom&&cr.bottom>visible.top;});
      const pointX=r.left+r.width/2,pointY=r.top+r.height/2,topNode=document.elementFromPoint(pointX,pointY);
      const pointerReady=selector==='.teaching-shift__choice'||selector==='.teaching-shift__cancel'
        ? readable&&!cueOverlaps&&r.width>=44&&r.height>=44&&Boolean(topNode&&(topNode===node||node.contains(topNode)))
        : readable&&!cueOverlaps;
      const sr=scroller?.getBoundingClientRect();
      const pointScrollX=sr?Math.max(clip.left+8,Math.min(clip.right-8,sr.left+18)):0;
      const pointScrollY=sr?Math.max(clip.top+8,Math.min(clip.bottom-8,clip.bottom-18)):0;
      return {found:true,textMatches,readable,pointerReady,cueOverlaps,scrollable:Boolean(scroller&&scroller.scrollHeight>scroller.clientHeight+1),
        scrollTop:scroller?.scrollTop??0,scrollHeight:scroller?.scrollHeight??0,clientHeight:scroller?.clientHeight??0,
        top:r.top,bottom:r.bottom,clipTop:clip.top,clipBottom:clip.bottom,pointX:pointScrollX,pointY:pointScrollY,inputX:pointX,inputY:pointY,width:r.width,height:r.height};
    })()`)
    requireCondition(isTargetObservation(value), 'rendered lesson target observation had an unsupported shape')
    return value
  }

  /** Scroll only with native input. Each target gets at most twelve gestures; the viewport gets at most ninety-six. */
  /** @param {string} targetKey @param {TargetObservation} state @param {number} deltaY @param {boolean} mobile */
  async scrollNative(targetKey, state, deltaY, mobile) {
    const targetCount = this.targetScrolls.get(targetKey) || 0
    if (!state.scrollable || targetCount >= 12 || this.nativeScrolls >= 96) throw new Error('lesson target remained unreachable within the bounded native scroll limit')
    const amount = Math.max(-360, Math.min(360, deltaY))
    if (!amount || !Number.isFinite(state.pointX) || !Number.isFinite(state.pointY)) throw new Error('lesson has no usable native scroll point')
    if (mobile) {
      const distance=Math.min(260,Math.max(80,Math.abs(amount))), direction=amount>0?-1:1;
      const margin=Math.min(24,Math.max(8,(state.clipBottom-state.clipTop)/8));
      const startY=amount>0?state.clipBottom-margin:state.clipTop+margin;
      const endY=Math.max(state.clipTop+margin,Math.min(state.clipBottom-margin,startY+direction*distance));
      if (Math.abs(endY-startY)<Math.min(48,distance/2)) throw new Error('native touch scroll has insufficient room inside the lesson scroller')
      await this.devtools.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:state.pointX,y:startY,id:1}]},this.sessionId)
      for (let part=1;part<=4;part++) {
        const y=startY+(endY-startY)*part/4
        await this.devtools.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:state.pointX,y,id:1}]},this.sessionId)
      }
      await this.devtools.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},this.sessionId)
    } else {
      await this.devtools.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:state.pointX,y:state.pointY,deltaX:0,deltaY:amount},this.sessionId)
    }
    this.nativeScrolls += 1
    this.targetScrolls.set(targetKey, targetCount + 1)
    await this.renderedFrame()
  }

  /** @param {string} selector @param {string | null} expectedText @param {boolean} mobile @param {string | null} [choiceLabel] */
  async ensureReadable(selector, expectedText, mobile, choiceLabel = null) {
    const targetKey=`${selector}:${choiceLabel ?? expectedText ?? ''}`
    let previousScrollTop=null
    for (let step=0;step<=12;step++) {
      await this.cueObservation()
      const state=await this.inspectTarget(selector,expectedText,choiceLabel)
      requireCondition(state.found&&state.textMatches, 'expected fixed teaching content did not match')
      if (state.cueOverlaps) throw new Error('visible attention cue overlaps a required teaching target')
      const ready=(selector==='.teaching-shift__choice'||selector==='.teaching-shift__cancel')?state.pointerReady:state.readable
      if (ready) return state
      if (previousScrollTop !== null && Math.abs(state.scrollTop-previousScrollTop)<1) throw new Error('native lesson scroll made no progress toward a required target')
      if (!state.scrollable) throw new Error('required teaching target cannot be reached in the visible lesson scroller')
      const below=state.bottom>state.clipBottom+1, above=state.top<state.clipTop-1
      if (!below&&!above) throw new Error('required teaching target is clipped without a native scroll direction')
      const delta=below?Math.max(90,Math.min(360,state.bottom-state.clipBottom+36)):-Math.max(90,Math.min(360,state.clipTop-state.top+36))
      previousScrollTop=state.scrollTop
      await this.scrollNative(targetKey,state,delta,mobile)
    }
    throw new Error('required teaching target exceeded the bounded native scroll steps')
  }

  /** @param {string} stageText @param {string} prompt @param {string} choice @param {boolean} mobile */
  async prepareChoice(stageText, prompt, choice, mobile) {
    const before=await this.inspectTarget('.teaching-shift__stage',stageText)
    requireCondition(before.found&&before.textMatches, 'expected teaching stage changed before answer')
    await this.ensureReadable('.teaching-shift__stage',stageText,mobile)
    requireCondition((await this.inspectTarget('.teaching-shift__stage',stageText)).textMatches, 'teaching stage changed while reading its title')
    await this.ensureReadable('.teaching-shift__prompt',prompt,mobile)
    requireCondition((await this.inspectTarget('.teaching-shift__stage',stageText)).textMatches, 'teaching stage changed while reading its prompt')
    const selected=await this.ensureReadable('.teaching-shift__choice',choice,mobile,choice)
    requireCondition((await this.inspectTarget('.teaching-shift__stage',stageText)).textMatches, 'teaching stage changed before the selected answer became ready')
    return selected
  }

  /** @param {string} label @returns {Promise<TargetObservation>} */
  async focusChoice(label) {
    const encoded = JSON.stringify(label)
    for (let index=0;index<180;index++) {
      const state=await this.inspectTarget('.teaching-shift__choice',null,label)
      const focus=await this.evaluate(`(() => {const n=document.activeElement;return Boolean(n&&n.matches('.teaching-shift__choice')&&n.textContent.trim()===${encoded});})()`)
      if (focus) {
        if (state.cueOverlaps) throw new Error('visible attention cue overlaps the focused teaching choice')
        requireCondition(state.pointerReady,'focused teaching choice is not readable and unobscured')
        return state
      }
      await this.devtools.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9},this.sessionId)
      await this.devtools.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9},this.sessionId)
    }
    throw new Error('native Tab could not focus the requested teaching choice')
  }

  async renderedFrame() {
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  }

  /** @param {string} label @param {number} scrollTop @returns {Promise<boolean>} */
  async focusedChoiceAndScroll(label, scrollTop) {
    const state=await this.inspectTarget('.teaching-shift__choice',null,label)
    const focus=await this.evaluate(`(() => {const n=document.activeElement;return Boolean(n&&n.matches('.teaching-shift__choice')&&n.textContent.trim()===${JSON.stringify(label)});})()`)
    return Boolean(focus&&state.pointerReady&&Math.abs(state.scrollTop-scrollTop)<=1)
  }

  /** @returns {Promise<CueObservation>} */
  async cueObservation() {
    const value=await this.evaluate(`(() => {
      const lesson=document.querySelector('.teaching-shift'), cues=[...document.querySelectorAll('.attn-cue')];
      const cue=cues.find(node=>/^More(?:\\s|→|$)/u.test(node.textContent.trim()));
      if(!cue||!lesson)return {observed:false,visible:false,overlapsQuestion:false,overlapsContext:false};
      const style=getComputedStyle(cue);
      const visibleBounds=(node)=>{if(!node)return null;const b=node.getBoundingClientRect();let l=Math.max(0,b.left),t=Math.max(0,b.top),right=Math.min(innerWidth,b.right),bottom=Math.min(innerHeight,b.bottom);
        for(let item=node.parentElement;item&&item!==document.documentElement;item=item.parentElement){const cs=getComputedStyle(item),ir=item.getBoundingClientRect();if(['hidden','clip','auto','scroll'].includes(cs.overflowX)){l=Math.max(l,ir.left);right=Math.min(right,ir.right);}if(['hidden','clip','auto','scroll'].includes(cs.overflowY)){t=Math.max(t,ir.top);bottom=Math.min(bottom,ir.bottom);}}
        return right>l&&bottom>t?{left:l,right,top:t,bottom}:null;};
      const cueBounds=visibleBounds(cue);
      const visible=Boolean(cueBounds&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0.05);
      const overlaps=(node)=>{const b=visibleBounds(node);return Boolean(b&&cueBounds&&visible&&cueBounds.left<b.right&&cueBounds.right>b.left&&cueBounds.top<b.bottom&&cueBounds.bottom>b.top);};
      return {observed:visible,visible,overlapsQuestion:overlaps(lesson.querySelector('.teaching-shift__prompt')),
        overlapsContext:['.teaching-shift__header','.teaching-shift__scene'].some(selector=>overlaps(lesson.querySelector(selector)))};
    })()`)
    requireCondition(isCueObservation(value), 'attention cue observation had an unsupported shape')
    this.cueSeen ||= value.observed
    this.cueQuestionOverlap ||= value.overlapsQuestion
    this.cueContextOverlap ||= value.overlapsContext
    requireCondition(!value.overlapsQuestion && !value.overlapsContext, 'visible More cue overlaps clipped question or classroom context')
    return value
  }

  /** @param {RenderExpectation} expectation @param {string} message */
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
      const visible=(node) => {
        if (!node) return false;
        const r=node.getBoundingClientRect(), s=getComputedStyle(node);
        if (r.width <= 0 || r.height <= 0 || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) <= 0
          || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return false;
        const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return Boolean(top && (top === node || node.contains(top)));
      };
      const choices=lesson ? [...lesson.querySelectorAll('.teaching-shift__choice')] : [];
      const controlsReady=!lesson || choices.length === 3;
      return Boolean(wallet && wallet.textContent.trim() === ${expectedCash} && visible(wallet) && controlsReady${requireNoTeaching}${requireStage}${requireRetry});
    })()`, message)
  }

  /** @param {string} name */
  async screenshot(name) {
    const result = await this.devtools.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    }, this.sessionId)
    const bytes = Buffer.from(result.data || '', 'base64')
    requireCondition(bytes.length > 1000 && bytes.length <= 2_000_000, 'screenshot size was outside the bounded range')
    await writeFile(resolve(OUTPUT, name), bytes)
  }

  /** @returns {Promise<FailureObservation>} */
  async failureObservation() {
    const dom = await this.evaluate(`(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)].some((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const text = document.body?.innerText ?? '';
      return {
        readyState: ['loading','interactive','complete'].includes(document.readyState) ? document.readyState : 'unknown',
        localRoot: location.origin === ${JSON.stringify(this.origin)} && location.pathname === '/',
        appRoot: visible('#life-overlay'),
        lesson: visible('.teaching-shift'),
        lessonChoiceCount: Math.min(3, document.querySelectorAll('.teaching-shift__choice').length),
        progressStatus: visible('[role="status"]'),
        activityLoadFailure: visible('.life-progress-load-error'),
        balance: visible('.hud-cash'),
        characterCreator: visible('.cr-panel'),
        quickStart: visible('[data-key="play-now"], [data-qs="play"]'),
        sessionStart: visible('[data-session-new]'),
        connectionAlert: visible('[role="alert"]'),
        scene: visible('canvas'),
        knownText: {
          playNow: text.includes('Play now'),
          chooseLook: text.includes('Choose your look and tap Play to start.'),
          connectionUnavailable: text.includes('Connection unavailable'),
          activityLoading: text.includes('Loading current activity…'),
          activityLoadFailure: text.includes('Activity controls could not load.'),
          teaching: text.includes('Notice the learner’s idea') || text.includes('Notice the learner\\u2019s idea'),
        },
      };
    })()`)
    requireCondition(isFailureDomObservation(dom), 'browser failure observation had an unsupported shape')
    return { ...dom, runtimeExceptions: this.exceptionCount }
  }

  /** @param {string} label @returns {Promise<BrowserPoint>} */
  async rect(label) {
    const state=await this.inspectTarget('.teaching-shift__choice',null,label)
    requireCondition(state.readable&&state.pointerReady&&!state.cueOverlaps&&state.width>=44&&state.height>=44,
      'expected rendered lesson choice was not visible, unobscured, and at least 44px')
    return { x: state.inputX, y: state.inputY, width: state.width, height: state.height }
  }

  /** @param {string} label */
  async click(label) {
    const point = await this.rect(label)
    /** @param {string} method @param {Record<string, unknown>} params */
    const send = (method, params) => this.devtools.send(method, params, this.sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }

  /** @param {string} label */
  async touch(label) {
    const point = await this.rect(label)
    /** @param {string} method @param {Record<string, unknown>} params */
    const send = (method, params) => this.devtools.send(method, params, this.sessionId)
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  /** @param {string} label */
  async key(label) {
    const encoded = JSON.stringify(label)
    /** @param {string} type @param {string} key @param {string} code @param {number} vk */
    const send = (type, key, code, vk) => this.devtools.send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      ...(key === 'Enter' && type === 'char' ? { text: '\r', unmodifiedText: '\r' } : {}),
    }, this.sessionId)
    let focused = false
    for (let index = 0; index < 180; index++) {
      if (await this.evaluate(`(() => {
        const node=document.activeElement;
        if (!node?.matches('.teaching-shift__choice') || node.textContent.trim() !== ${encoded}) return false;
        const r=node.getBoundingClientRect(), s=getComputedStyle(node), clip=node.closest('[data-slot="progress"]')?.getBoundingClientRect();
        if (!clip || r.width < 44 || r.height < 44 || r.left < clip.left-1 || r.right > clip.right+1 || r.top < clip.top-1 || r.bottom > clip.bottom+1
          || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight
          || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) <= 0) return false;
        const cue=[...document.querySelectorAll('.attn-cue')].some(c=>{const cr=c.getBoundingClientRect(),cs=getComputedStyle(c);return cr.width>0&&cr.height>0&&cs.visibility==='visible'&&Number(cs.opacity)>0.05&&cr.left<r.right&&cr.right>r.left&&cr.top<r.bottom&&cr.bottom>r.top;});
        const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return !cue&&Boolean(top&&(top===node||node.contains(top)));
      })()`)) {
        focused = true
        break
      }
      await send('keyDown', 'Tab', 'Tab', 9)
      await send('keyUp', 'Tab', 'Tab', 9)
    }
    requireCondition(focused, 'keyboard could not reach the requested lesson control')
    await send('keyDown', 'Enter', 'Enter', 13)
    await send('char', 'Enter', 'Enter', 13)
    await send('keyUp', 'Enter', 'Enter', 13)
  }

  async viewport() {
    const value = await this.evaluate(`(() => {
      const root=document.documentElement;
      const buttons=[...document.querySelectorAll('.teaching-shift__choice')].map(b=>{const r=b.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}});
      return {width:root.clientWidth,scrollWidth:root.scrollWidth,buttons};
    })()`)
    requireCondition(isViewportObservation(value), 'browser viewport observation had an unsupported shape')
    return value
  }

  dispose() {
    this.unlisten?.()
    this.unlistenNetwork?.()
    this.unlistenLife?.()
    this.unlistenLifeResponse?.()
    this.unlistenLifeFailure?.()
    this.unlistenSocket?.()
    this.unlistenException?.()
    this.unlisten = null
  }
}

/** @param {Fixture} f @param {string} cookie @returns {Promise<LifeResponse>} */
async function life(f, cookie) {
  const response = await f.request('/api/life?city=lagos', undefined, cookie)
  requireCondition(response.status === 200, 'fixture life read failed')
  const value = await response.json()
  requireCondition(isLifeResponse(value), 'fixture life response had an unsupported shape')
  return value
}

/** @param {Fixture} f @param {string} name */
async function setupTeacher(f, name) {
  const created = await f.request('/api/session', { name, onboarding: true })
  requireCondition(created.status === 200, 'fixture could not create an ordinary onboarding session')
  const cookie = created.headers.get('set-cookie')
  if (typeof cookie !== 'string') throw new Error('onboarding session did not issue its fixture cookie')
  const sessionAnswer = await created.json()
  if (!isRecord(sessionAnswer) || !isRecord(sessionAnswer.session) || typeof sessionAnswer.session.id !== 'string') {
    throw new Error('onboarding response did not identify the fixture session')
  }
  const sessionCookie = cookie.split(';', 1)[0]
  const separator = sessionCookie?.indexOf('=') ?? -1
  if (!sessionCookie || separator <= 0 || separator === sessionCookie.length - 1) {
    throw new Error('onboarding session cookie had an unsupported shape')
  }
  const device = { id: sessionAnswer.session.id, cookie: sessionCookie }
  const before = await life(f, device.cookie)
  requireCondition(before.state?.onboarding?.required === true && before.state?.onboarding?.done === false,
    'fixture teacher did not begin in the authored character-creation flow')
  requireCondition(before.state?.location === 'park', 'new Lagos fixture teacher did not arrive at Freedom Park')
  for (const action of [
    { type: 'onboarding.look', payload: { look: DEFAULT_LOOK } },
    { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } },
    { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } },
    { type: 'onboarding.lottery', payload: {} },
    { type: 'onboarding.home', payload: { lga: 'ikeja', via: 'manual', stay: true } },
    { type: 'apply-job', payload: { id: 'teaching' } },
    { type: 'spot', payload: { id: 'work' } },
    { type: 'activity', payload: { id: 'teaching-shift' } },
  ]) {
    const outcome = await f.action(device.cookie, action)
    requireCondition(outcome.ok === true, `authored onboarding or teaching setup was refused (${action.type})`)
  }
  const current = await life(f, device.cookie)
  requireCondition(current.state?.onboarding?.required === false && current.state?.onboarding?.done === true,
    'fixture teacher did not finish the authored character-creation flow')
  requireCondition(current.state?.location === 'park' && current.state?.spot === 'work',
    'fixture teacher did not remain at the Freedom Park workplace')
  const teaching = current.state.activeAction?.teaching
  if (!teaching || teaching.stage !== 'diagnose') throw new Error('server did not create the authored teaching session')
  return { device, starting: current.state, teaching }
}

/** @param {import('node:test').TestContext} t @param {string} chromePath */
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
      if (typeof child.pid === 'number') {
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal) } catch {}
      }
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
      const port = lines[0], browserPath = lines[1]
      if (typeof port === 'string' && typeof browserPath === 'string' && lines.length >= 2 && /^\d+$/.test(port)) {
        const browser = new DevTools(`ws://127.0.0.1:${port}${browserPath}`)
        await browser.open()
        t.after(() => browser.close())
        const version = await browser.send('Browser.getVersion')
        return {
          browser,
          version: String(version.product || 'unknown').slice(0, 80),
          /** @param {string} origin @param {string} cookie @param {boolean} mobile @param {(page: BrowserPage) => Promise<void> | void} [onInitialFailure] @returns {Promise<BrowserPageContext>} */
          async page(origin, cookie, mobile, onInitialFailure) {
            const context = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
            const contextId = context.browserContextId
            requireCondition(typeof contextId === 'string' && contextId.length > 0, 'DevTools did not return an isolated browser context identity')
            active.add(contextId)
            const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId })
            const targetId = target.targetId
            requireCondition(typeof targetId === 'string' && targetId.length > 0, 'DevTools did not return the isolated page identity')
            const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true })
            const sessionId = attached.sessionId
            requireCondition(typeof sessionId === 'string' && sessionId.length > 0, 'DevTools did not return the isolated page session')
            const page = new BrowserPage(browser, sessionId, origin)
            try {
              await page.initialize(cookie, mobile, () => { externalRequests += 1 })
              await page.navigate(`${origin}/`)
            } catch (error) {
              await onInitialFailure?.(page)
              throw error
            }
            return { page, contextId, targetId }
          },
          /** @param {BrowserPageContext} page */
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

test('rendered teaching practice survives interruption and settles one wage on desktop and 390px touch', { timeout: LIMIT_MS }, async (/** @type {import('node:test').TestContext} */ t) => {
  let sha = 'unavailable'
  let expectedSha = process.env.LW_QA_SOURCE_SHA || 'missing'
  /** @type {{ok: boolean; buildId: string} | null} */
  let healthReceipt = null
  let browserVersion = 'unreported'
  let phase = 'preflight'
  /** @type {Record<string, ViewportObservation>} */
  const measurements = {}
  /** @type {string[]} */
  const screenshots = []
  /** @type {Record<string, ScrollAcceptanceObservation>} */
  const scrollObservations = {}
  /** @type {FailureObservation | {runtimeExceptions: number} | null} */
  let failureObservation = null
  let failureScreenshotWritten = false
  /** @param {BrowserPage} page */
  const captureFailure = async (page) => {
    const key = phase.startsWith('mobile') ? 'mobile390' : 'desktop'
    if (scrollObservations[key]) {
      scrollObservations[key].nativeScrolls = page.nativeScrolls
      scrollObservations[key].moreCue = page.cueSeen ? 'observed' : 'notObserved'
      scrollObservations[key].cueOverlapsQuestion = page.cueQuestionOverlap
      scrollObservations[key].cueOverlapsContext = page.cueContextOverlap
    }
    if (failureObservation) return
    failureObservation = await page.failureObservation().catch(() => ({ runtimeExceptions: page.exceptionCount }))
    if (failureScreenshotWritten) return
    failureScreenshotWritten = true
    const safePhase = /^[a-z0-9-]{1,48}$/.test(phase) ? phase : 'unknown'
    const name = `failure-${safePhase}.png`
    try {
      await page.screenshot(name)
      if (!screenshots.includes(name)) screenshots.push(name)
    } catch { /* static receipt diagnostics remain useful without a capture */ }
  }
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
  const f = await fixture(t, { distDir: resolve(root, 'dist'), sessionTtlMs: 30 * 60_000, buildId: `joinallworld-${sha}`, interactiveTeachingStarts: true })
  const healthResponse = await fetch(`${f.base}/api/health`)
  requireCondition(healthResponse.status === 200, 'fixture health endpoint failed')
  const healthBody = await healthResponse.json()
  requireCondition(isRecord(healthBody) && typeof healthBody.ok === 'boolean'
    && (healthBody.build === undefined || typeof healthBody.build === 'string'), 'fixture health response had an unsupported shape')
  const health = healthBody
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
  /** @type {Array<[string, string]>} */
  const classroomTargets = [
    ['.teaching-shift__eyebrow', 'Fictional NPC classroom practice'],
    ['.teaching-shift__header h2', 'A short lesson in fractions'],
    ['.teaching-shift__header > p:last-child', 'Help a learner understand equal parts. Choose a response at each step; the lesson will not advance on its own.'],
    ['.teaching-shift__teacher strong', 'Teacher Eni'],
    ['.teaching-shift__teacher small', 'Practice mentor'],
    ['.teaching-shift__teacher p', '“Listen for the learner’s thinking, then explain one clear idea.”'],
    ['.teaching-shift__board span', 'Today’s idea'],
    ['.teaching-shift__board strong', '1/3 > 1/4'],
    ['.teaching-shift__board small', 'Equal-sized wholes'],
    ['.teaching-shift__learner strong', 'Learner Nneka'],
    ['.teaching-shift__learner small', 'Practice student'],
    ['.teaching-shift__learner p', '“I chose one fourth because four is greater than three.”'],
  ]
  /** @type {[TeachingStageFixture, TeachingStageFixture, TeachingStageFixture]} */
  const stages = [
    { label: '1 · Notice the learner’s idea', prompt: 'Nneka says 1/4 is larger than 1/3 because four is greater than three. What misunderstanding should you address?', choices: ['They think a larger denominator makes the fraction larger.', 'They think the numerator is the number of equal parts in the whole.', 'They assume both fractions use differently sized wholes.'] },
    { label: '2 · Explain with an example', prompt: 'Choose a way to show Nneka why 1/3 is larger than 1/4 when both fractions use equal-sized wholes.', choices: ['Show equal-sized wholes split into thirds and fourths; one third is the larger piece.', 'Use a larger whole for the fourth so its shaded piece looks larger.', 'Ask them to memorize that the larger denominator wins.'] },
    { label: '3 · Check understanding', prompt: 'Check the idea with a fresh comparison: which piece is larger, 1/5 or 1/6, when the wholes are equal?', choices: ['One fifth is larger than one sixth when the wholes are equal.', 'One sixth is larger because six is greater than five.', 'They are the same size because both numerators are one.'] },
  ]
  /** @param {BrowserPage} page @param {boolean} mobile @param {ScrollAcceptanceObservation} report */
  async function inspectClassroom(page, mobile, report) {
    for (const [selector, text] of classroomTargets) {
      await page.ensureReadable(selector, text, mobile)
      report.contextTargets += 1
    }
  }
  /** @param {BrowserPage} page @param {typeof stages[number]} stage @param {boolean} mobile @param {ScrollAcceptanceObservation} report */
  async function inspectStageControls(page, stage, mobile, report) {
    for (const choice of stage.choices) {
      await page.ensureReadable('.teaching-shift__choice', choice, mobile, choice)
      report.choicesReached += 1
    }
    await page.ensureReadable('.teaching-shift__cancel', 'Cancel practice', mobile)
    report.cancelReached = true
  }
  /** @param {BrowserPage} page @param {typeof stages[number]} stage @param {string} choice @param {boolean} mobile */
  async function prepareAnswer(page, stage, choice, mobile) {
    return page.prepareChoice(stage.label, stage.prompt, choice, mobile)
  }
  phase = 'chrome-startup'
  const browser = await startBrowser(t, CHROME)
  browserVersion = browser.version
  phase = 'desktop-render'
  const appPage = await browser.page(f.base, desktopTeacher.device.cookie, false, captureFailure)
  try {
    await appPage.page.wait("document.querySelector('.teaching-shift') !== null", 'the rendered Teaching controls did not appear')
    scrollObservations.desktop = { contextTargets: 0, choicesReached: 0, cancelReached: false, nativeScrolls: 0, focusRetained: false, moreCue: 'notObserved', cueOverlapsQuestion: false, cueOverlapsContext: false }
    await appPage.page.cueObservation()
    await appPage.page.waitRendered({ cash: desktopCash, stage: stages[0].label }, 'desktop app hydration did not show the active lesson and server balance')
    await appPage.page.screenshot('teaching-desktop-before.png')
    screenshots.push('teaching-desktop-before.png')
    const desktopView = await appPage.page.viewport()
    requireCondition(desktopView.width >= 1000 && desktopView.scrollWidth <= desktopView.width + 1, 'desktop teaching renderer overflowed its viewport')
    await inspectClassroom(appPage.page, false, scrollObservations.desktop)
    await inspectStageControls(appPage.page, stages[0], false, scrollObservations.desktop)
    const wrongDesktopChoice = stages[0].choices[1]
    requireCondition(typeof wrongDesktopChoice === 'string', 'authored wrong-answer fixture was missing')
    await prepareAnswer(appPage.page, stages[0], wrongDesktopChoice, false)
    const focusBeforePoll = await appPage.page.focusChoice(wrongDesktopChoice)
    const readsBeforePoll = appPage.page.lifeReadCount()
    await appPage.page.waitForLifeRead(readsBeforePoll, { cash: desktopCash, stage: 'diagnose', revision: desktopTeacher.teaching.revision })
    await appPage.page.renderedFrame()
    scrollObservations.desktop.focusRetained = await appPage.page.focusedChoiceAndScroll(wrongDesktopChoice, focusBeforePoll.scrollTop)
    requireCondition(focusBeforePoll.scrollTop > 0, 'focus/scroll preservation needs an actual nonzero native scroll offset')
    requireCondition(scrollObservations.desktop.focusRetained, 'unchanged server refresh moved the focused teaching choice or its scroll position')

    phase = 'desktop-wrong-choice'
    await appPage.page.click(wrongDesktopChoice)
    await appPage.page.wait("document.querySelector('.teaching-shift__feedback')?.textContent.includes('Try again:')", 'wrong desktop choice did not render retry feedback')
    await appPage.page.ensureReadable('.teaching-shift__feedback', 'Try again: keep the whole the same size and explain what the denominator counts.', false)
    let serverState = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(serverState.activeAction?.teaching?.stage === 'diagnose'
      && serverState.activeAction.teaching.feedback === 'retry'
      && serverState.activeAction.teaching.revision === desktopTeacher.teaching.revision + 1,
    'wrong rendered choice advanced or failed to retain retry feedback')
    requireCondition(serverState.cash === desktopCash, 'wrong teaching choice changed the wage balance')
    f.advance(120_000)
    serverState = (await life(f, desktopTeacher.device.cookie)).state
    requireCondition(serverState.activeAction?.teaching?.stage === 'diagnose' && serverState.cash === desktopCash,
      'elapsed server time advanced or paid the input-driven lesson')

    phase = 'desktop-reload-retry'
    await appPage.page.reload()
    await appPage.page.waitRendered({ cash: desktopCash, stage: stages[0].label, retry: true }, 'desktop reload did not hydrate the same retry lesson and balance')
    await appPage.page.ensureReadable('.teaching-shift__feedback', 'Try again: keep the whole the same size and explain what the denominator counts.', false)
    await prepareAnswer(appPage.page, stages[0], stages[0].choices[0], false)
    await appPage.page.screenshot('teaching-desktop-reloaded.png')
    screenshots.push('teaching-desktop-reloaded.png')

    const desktopChoices = [stages[0].choices[0], stages[1].choices[0], stages[2].choices[0]]
    phase = 'desktop-complete'
    for (const [index, choice] of desktopChoices.entries()) {
      const stage = stages[index]
      if (!stage || typeof choice !== 'string') throw new Error('authored desktop lesson stage was missing')
      await inspectStageControls(appPage.page, stage, false, scrollObservations.desktop)
      await prepareAnswer(appPage.page, stage, choice, false)
      if (index === 0) await appPage.page.key(choice)
      else await appPage.page.click(choice)
      const next = desktopChoices[index + 1]
      if (next) await appPage.page.waitChoice(next)
    }
    scrollObservations.desktop.nativeScrolls = appPage.page.nativeScrolls
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
  } catch (error) {
    await captureFailure(appPage.page)
    throw error
  } finally {
    await browser.closePage(appPage)
  }

  const unchangedMobile = (await life(f, mobileTeacher.device.cookie)).state
  requireCondition(unchangedMobile.cash === mobileBefore.cash
    && unchangedMobile.activeAction?.teaching?.revision === mobileBefore.activeAction?.teaching?.revision
    && unchangedMobile.activeAction?.teaching?.stage === 'diagnose', 'desktop actor changed the independent mobile teacher')

  phase = 'mobile-render'
  const mobilePage = await browser.page(f.base, mobileTeacher.device.cookie, true, captureFailure)
  try {
    await mobilePage.page.waitRendered({ cash: mobileBefore.cash, stage: stages[0].label }, 'mobile app hydration did not show the active lesson and server balance')
    scrollObservations.mobile390 = { contextTargets: 0, choicesReached: 0, cancelReached: false, nativeScrolls: 0, focusRetained: false, moreCue: 'notObserved', cueOverlapsQuestion: false, cueOverlapsContext: false }
    await mobilePage.page.cueObservation()
    await mobilePage.page.screenshot('teaching-mobile-before.png')
    screenshots.push('teaching-mobile-before.png')
    const mobileView = await mobilePage.page.viewport()
    requireCondition(mobileView.width === 390 && mobileView.scrollWidth <= mobileView.width + 1, '390px teaching renderer has horizontal overflow')
    requireCondition(mobileView.buttons.length === 3 && mobileView.buttons.every(button => button.width >= 44 && button.height >= 44),
      '390px teaching controls did not retain usable touch targets')
    measurements.mobile390 = mobileView
    await inspectClassroom(mobilePage.page, true, scrollObservations.mobile390)
    await inspectStageControls(mobilePage.page, stages[0], true, scrollObservations.mobile390)

    phase = 'mobile-progress'
    await prepareAnswer(mobilePage.page, stages[0], stages[0].choices[0], true)
    await mobilePage.page.touch(stages[0].choices[0])
    await mobilePage.page.waitChoice(stages[1].choices[0])
    await inspectStageControls(mobilePage.page, stages[1], true, scrollObservations.mobile390)
    await prepareAnswer(mobilePage.page, stages[1], stages[1].choices[0], true)
    await mobilePage.page.touch(stages[1].choices[0])
    await mobilePage.page.waitChoice(stages[2].choices[0])
    let mobileState = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(mobileState.activeAction?.teaching?.stage === 'check' && mobileState.cash === mobileBefore.cash,
      'mobile touch sequence did not preserve the expected unpaid check stage')
    await inspectStageControls(mobilePage.page, stages[2], true, scrollObservations.mobile390)
    phase = 'mobile-reload-check'
    await mobilePage.page.reload()
    await mobilePage.page.waitRendered({ cash: mobileBefore.cash, stage: stages[2].label }, 'mobile reload did not hydrate the active check stage and balance')
    phase = 'mobile-complete'
    await prepareAnswer(mobilePage.page, stages[2], stages[2].choices[0], true)
    await mobilePage.page.touch(stages[2].choices[0])
    await mobilePage.page.wait("!document.querySelector('.teaching-shift')", 'last mobile answer did not complete the rendered lesson')
    mobileState = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(mobileState.activeAction === null && mobileState.cash === mobileBefore.cash + 3000,
      'mobile completion did not settle exactly one wage')
    requireCondition(mobileState.ledger.filter(row => row.amount === 3000).length === 1, 'mobile wage ledger was not once-only')
    await mobilePage.page.waitRendered({ cash: mobileState.cash, noTeaching: true }, 'mobile HUD did not render the settled balance with no active lesson')
    await mobilePage.page.screenshot('teaching-mobile-after.png')
    screenshots.push('teaching-mobile-after.png')
    scrollObservations.mobile390.nativeScrolls = mobilePage.page.nativeScrolls
    phase = 'mobile-terminal-reload'
    await mobilePage.page.reload()
    await mobilePage.page.waitRendered({ cash: mobileState.cash, noTeaching: true }, 'completed mobile reload did not hydrate the terminal state and current balance')
    const afterReload = (await life(f, mobileTeacher.device.cookie)).state
    requireCondition(afterReload.activeAction === null && afterReload.cash === mobileState.cash
      && afterReload.ledger.filter(row => row.amount === 3000).length === 1, 'mobile completed reload duplicated the wage')
  } catch (error) {
    await captureFailure(mobilePage.page)
    throw error
  } finally {
    await browser.closePage(mobilePage)
    await browser.close()
  }

  scrollObservations.desktop.moreCue = appPage.page.cueSeen ? 'observed' : 'notObserved'
  scrollObservations.desktop.cueOverlapsQuestion = appPage.page.cueQuestionOverlap
  scrollObservations.desktop.cueOverlapsContext = appPage.page.cueContextOverlap
  scrollObservations.mobile390.moreCue = mobilePage.page.cueSeen ? 'observed' : 'notObserved'
  scrollObservations.mobile390.cueOverlapsQuestion = mobilePage.page.cueQuestionOverlap
  scrollObservations.mobile390.cueOverlapsContext = mobilePage.page.cueContextOverlap

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
    scrollObservations,
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
      node: process.version, platform: process.platform, viewportObservations: measurements, scrollObservations,
      screenshots, failureCode: phase, failureObservation,
      qualification: 'no acceptance claim; inspect the test failure and bounded artifacts',
    }).catch(() => {})
    throw new Error(`Teaching browser QA failed during ${phase}; see receipt.json`)
  }
})
