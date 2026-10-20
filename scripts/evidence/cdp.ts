// Shared by shoot.ts and walk.ts: start a headless Chromium of our own, talk to it over the DevTools protocol, and make sure it is
// gone afterwards (the process is stopped and its temporary profile folder is deleted).
//
// Nothing here knows about the game. It needs only `ws`, which the repository already has.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

/** Where the headless browser may live on this machine, best first. `AW_CHROME` names one explicitly. */
export function chromeCandidates(home = homedir(), env: Record<string, string | undefined> = process.env): string[] {
  const found: string[] = [];
  if (env.AW_CHROME) found.push(env.AW_CHROME);
  const tools = join(home, '.t3', 'tools', 'chrome-headless-shell', 'mac-arm64');
  if (existsSync(tools)) for (const version of readdirSync(tools).sort().reverse()) found.push(join(tools, version, 'chrome-headless-shell'));
  const cache = join(home, 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    for (const folder of readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const arch of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-linux']) found.push(join(cache, folder, arch, 'chrome-headless-shell'));
    }
  }
  return found;
}

export function findChrome(): string {
  const hit = chromeCandidates().find((path) => existsSync(path));
  if (!hit) throw new Error('No headless Chromium found. Set AW_CHROME to the chrome-headless-shell binary.');
  return hit;
}

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface Reply { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }

/** One page of the browser. Console errors and uncaught exceptions are collected in `errors`. */
export class Page {
  readonly errors: string[] = [];
  private nextId = 0;
  private readonly waiting = new Map<number, { done: (value: unknown) => void; fail: (error: Error) => void }>();
  private readonly listeners = new Map<string, ((params: unknown) => void)[]>();
  private readonly socket: WebSocket;
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as Reply;
      if (typeof message.id === 'number') {
        const entry = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (!entry) return;
        if (message.error) entry.fail(new Error(message.error.message ?? 'DevTools error'));
        else entry.done(message.result);
      } else if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
    this.on('Runtime.consoleAPICalled', (params) => {
      const call = params as { type?: string; args?: { value?: unknown; description?: string }[] };
      if (call.type === 'error') this.errors.push((call.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 300));
    });
    this.on('Runtime.exceptionThrown', (params) => {
      const thrown = params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
      this.errors.push(`uncaught: ${thrown.exceptionDetails?.exception?.description ?? thrown.exceptionDetails?.text ?? 'exception'}`.slice(0, 300));
    });
    this.on('Log.entryAdded', (params) => {
      const entry = (params as { entry?: { level?: string; text?: string; url?: string } }).entry;
      if (entry?.level === 'error') this.errors.push(`${entry.text ?? 'log error'}${entry.url ? ` (${entry.url})` : ''}`.slice(0, 300));
    });
  }
  static async attach(url: string): Promise<Page> {
    const socket = new WebSocket(url);
    await new Promise<void>((done, fail) => { socket.once('open', () => done()); socket.once('error', fail); });
    const page = new Page(socket);
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable'); await page.send('Network.enable');
    return page;
  }
  on(method: string, listener: (params: unknown) => void): void { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((done, fail) => {
      this.waiting.set(id, { done: done as (value: unknown) => void, fail });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Run an expression in the page and return its value (promises are awaited). */
  async eval<T = unknown>(expression: string): Promise<T> {
    const reply = await this.send<{ result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(`page error: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'exception'}`.slice(0, 400));
    return reply.result?.value as T;
  }
  /** Poll an expression until it is truthy; false after `ms`. */
  async until(expression: string, ms: number, every = 250): Promise<boolean> {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
      try { if (await this.eval<unknown>(expression)) return true; } catch { /* the page may be loading */ }
      await sleep(every);
    }
    return false;
  }
  async screenshot(): Promise<Buffer> {
    const reply = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(reply.data, 'base64');
  }
  close(): void { try { this.socket.close(); } catch { /* already closed */ } }
}

/** `uncapped`: do not hold frames to the screen's refresh rate, so frame gaps show how long a frame takes rather than the 16.7 ms of a 60 Hz screen. */
export interface BrowserOptions { width: number; height: number; scale: number; gpu?: 'swiftshader' | 'metal'; uncapped?: boolean }

/** A running browser: a page, and `close()` which stops the process and deletes the profile folder. */
export interface Browser { page: Page; profile: string; close(): Promise<void> }

export async function launchBrowser(options: BrowserOptions): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'aw-evidence-'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const gl = options.gpu === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
  const child: ChildProcess = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...gl, ...(options.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []), '--hide-scrollbars', '--mute-audio', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const cleanup = async (): Promise<void> => {
    page?.close();
    if (child.exitCode === null) {
      const gone = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill();
      await Promise.race([gone, sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(profile, { recursive: true, force: true });
  };
  let page: Page | undefined;
  try {
    let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
    for (let attempt = 0; attempt < 80 && !targets.length; attempt++) {
      try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json() as typeof targets).filter((target) => target.type === 'page'); } catch { await sleep(150); }
    }
    const first = targets[0];
    if (!first) throw new Error('The browser did not start.');
    page = await Page.attach(first.webSocketDebuggerUrl);
    await page.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.scale, mobile: false });
    return { page, profile, close: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Open a local game session over HTTP and return its cookie value. Open mode settles the life with a house. */
export async function openSession(base: string, name = 'Evidence'): Promise<string> {
  const reply = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name }) });
  if (!reply.ok) throw new Error(`The game answered ${reply.status} to a new session. Is this an npm run dev:open server?`);
  const cookie = /sid=([^;]+)/.exec(reply.headers.get('set-cookie') ?? '')?.[1];
  if (!cookie) throw new Error('The game gave no session cookie.');
  return cookie;
}

/** Put the session cookie in the browser (it is HTTP-only, so the page cannot do it). */
export async function setCookie(page: Page, base: string, sid: string): Promise<void> {
  await page.send('Network.setCookie', { name: 'sid', value: sid, domain: new URL(base).hostname, path: '/', httpOnly: true });
}

/** One game action over HTTP, as a player's page would send it. */
export async function act(base: string, sid: string, type: string, payload: Record<string, unknown> = {}, cityId = 'lagos'): Promise<{ ok: boolean; code?: string; reason?: string }> {
  const reply = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: `sid=${sid}` }, body: JSON.stringify({ actionId: `${Date.now()}:${crypto.randomUUID()}`, cityId, type, payload }) });
  return await reply.json() as { ok: boolean; code?: string; reason?: string };
}
