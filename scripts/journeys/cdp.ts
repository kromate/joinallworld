/**
 * A very small DevTools-protocol driver for the browser journeys: start one headless Chrome with a fresh profile, send
 * commands over its WebSocket, wait on real page conditions, tap visible controls and save screenshots.
 * No dependency beyond Node's own WebSocket client.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export interface Viewport { width: number; height: number; scale: number; mobile: boolean }
export interface Captured { method: string; url: string; body: string | null; status?: number; requestId: string }

const CHROME = process.env['CHROME_BIN'] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class Browser {
  child: ChildProcess;
  profile: string;
  ws!: WebSocket;
  private nextId = 0;
  private pending = new Map<number, (value: any) => void>();
  consoleErrors: string[] = [];
  requests: Captured[] = [];
  private byId = new Map<string, Captured>();
  viewport: Viewport = { width: 1280, height: 800, scale: 1, mobile: false };

  private constructor(child: ChildProcess, profile: string) { this.child = child; this.profile = profile; }

  /** Starts Chrome on a free port in the range with an empty profile and attaches to its one page. */
  static async launch(debugPort: number): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), 'journey-chrome-'));
    const child = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--disable-background-networking', 'about:blank',
    ], { stdio: 'ignore' });
    return Browser.attach(debugPort, child, profile);
  }

  /** Connects to the page of a Chrome already listening on the port. */
  static async attach(debugPort: number, child: ChildProcess, profile: string, targetId?: string): Promise<Browser> {
    const browser = new Browser(child, profile);
    let targets: any[] | undefined;
    for (let i = 0; i < 100 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json() as any[]; } catch { await sleep(150); }
    }
    const page = targets?.find((target) => target.type === 'page' && (!targetId || target.id === targetId));
    if (!page) { browser.close(); throw new Error('Chrome did not start a page'); }
    browser.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((done, fail) => { browser.ws.onopen = () => done(); browser.ws.onerror = () => fail(new Error('DevTools socket failed')); });
    browser.ws.onmessage = (event) => browser.onMessage(JSON.parse(String(event.data)));
    for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await browser.send(`${domain}.enable`);
    return browser;
  }

  private onMessage(message: any): void {
    if (message.id && this.pending.has(message.id)) { this.pending.get(message.id)!(message); this.pending.delete(message.id); return; }
    const p = message.params ?? {};
    switch (message.method) {
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error') this.consoleErrors.push(`console.error: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400)}`);
        break;
      case 'Runtime.exceptionThrown': this.consoleErrors.push(`exception: ${(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 400)}`); break;
      case 'Log.entryAdded': if (p.entry?.level === 'error') this.consoleErrors.push(`log: ${String(p.entry.text).slice(0, 300)} ${p.entry.url ?? ''}`); break;
      case 'Network.requestWillBeSent': {
        const entry: Captured = { method: p.request.method, url: p.request.url, body: p.request.postData ?? null, requestId: p.requestId };
        this.byId.set(p.requestId, entry); this.requests.push(entry); break;
      }
      case 'Network.responseReceived': { const entry = this.byId.get(p.requestId); if (entry) entry.status = p.response.status; break; }
      default: break;
    }
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.nextId;
    return new Promise((done, fail) => {
      this.pending.set(id, (message) => (message.error ? fail(new Error(`${method}: ${message.error.message}`)) : done(message.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression in the page (promises awaited) and returns its JSON value. */
  async eval<T = any>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result?.value as T;
  }

  async setViewport(viewport: Viewport): Promise<void> {
    this.viewport = viewport;
    await this.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile });
    await this.send('Emulation.setTouchEmulationEnabled', viewport.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }

  /** Slow-network and slow-CPU emulation: a simulation of a phone's conditions, not a phone. */
  async throttle(on: boolean): Promise<void> {
    await this.send('Network.emulateNetworkConditions', on
      ? { offline: false, latency: 150, downloadThroughput: Math.round(1.6e6 / 8), uploadThroughput: Math.round(750e3 / 8) }
      : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await this.send('Emulation.setCPUThrottlingRate', { rate: on ? 4 : 1 });
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete'`, 60000, 'the page to finish loading');
  }

  /** Polls a page expression until it is truthy. Fails with the stated reason. */
  async waitFor<T = any>(expression: string, timeoutMs: number, what: string): Promise<T> {
    const end = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < end) {
      try { const value = await this.eval<T>(expression); if (value) return value; last = value; } catch (error) { last = error; }
      await sleep(150);
    }
    throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what} (last: ${String(last).slice(0, 200)})`);
  }

  /** Centre of the first visible element matching the selector (and, optionally, text), scrolled into view. */
  async locate(selector: string, text?: string): Promise<{ x: number; y: number } | null> {
    return this.eval(`(() => {
      const wanted = ${JSON.stringify(text ?? null)}, norm = (s) => s.replace(/\\s+/g, ' ').trim();
      const ok = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled; };
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ok(e) && (wanted === null || norm(e.textContent || '').toLowerCase().includes(wanted.toLowerCase())));
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  }

  /** A real pointer (or touch, on a phone-sized viewport) press at a point. */
  async tapAt(x: number, y: number): Promise<void> {
    if (this.viewport.mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  }

  /** Waits for a visible matching control, then presses it. */
  async click(selector: string, text?: string, timeoutMs = 20000): Promise<void> {
    const what = `a visible control ${selector}${text ? ` containing "${text}"` : ''}`;
    const end = Date.now() + timeoutMs;
    for (;;) {
      const point = await this.locate(selector, text).catch(() => null);
      if (point) {
        // The control may be covered by something else (an overlay, a clipped panel): that is a finding, not a click to force.
        const top = await this.eval<boolean>(`(() => { const el = document.elementFromPoint(${point.x}, ${point.y}); return !!el && [...document.querySelectorAll(${JSON.stringify(selector)})].some((c) => c === el || c.contains(el)); })()`);
        if (top) { await this.tapAt(point.x, point.y); return; }
      }
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${point ? ' (it is present but covered by another element)' : ''}`);
      await sleep(200);
    }
  }

  /** A real key press (down and up) such as Escape. */
  async press(key: string, code: string, keyCode: number): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }

  async type(selector: string, value: string): Promise<void> {
    await this.click(selector);
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
    await this.send('Input.insertText', { text: value });
  }

  /** The body of a finished response the page received (by the request id kept in `requests`), or null. */
  async responseBody(requestId: string): Promise<string | null> {
    try { return (await this.send('Network.getResponseBody', { requestId })).body as string; } catch { return null; }
  }

  async screenshot(file: string): Promise<void> {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
  }

  /** Another isolated browser context (own cookies and storage) with one page, inside the same Chrome process: a second player. */
  static async second(debugPort: number, first: Browser): Promise<Browser> {
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
    const root = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((done, fail) => { root.onopen = () => done(); root.onerror = () => fail(new Error('browser socket failed')); });
    const ask = (method: string, params: object = {}) => new Promise<any>((done) => { const id = Math.floor(Math.random() * 1e9); const on = (event: MessageEvent) => { const m = JSON.parse(String(event.data)); if (m.id === id) { root.removeEventListener('message', on); done(m.result); } }; root.addEventListener('message', on); root.send(JSON.stringify({ id, method, params })); });
    const context = await ask('Target.createBrowserContext');
    const target = await ask('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
    root.close();
    const other = await Browser.attach(debugPort, first.child, first.profile, target.targetId);
    other.shared = true;
    return other;
  }
  shared = false;

  close(): void {
    if (this.shared) { try { this.ws?.close(); } catch { /* closed */ } return; }
    try { this.ws?.close(); } catch { /* closed */ }
    try { this.child.kill('SIGTERM'); } catch { /* gone */ }
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* removed */ }
  }
}
