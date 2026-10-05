// npm run dev — the whole game on this machine: the API and WebSocket on a free loopback port, and Vite in front of them.
//
//   npm run dev                              http://127.0.0.1:5173/
//   npm run dev -- --port 5180               another port (or set DEV_PORT)
//   npm run dev -- --env .env                read settings from a file first (see .env.example); nothing is read otherwise
//
// The page reloads itself when its sources change (Vite). The game server is a second process, restarted whenever a file
// it loads changes (anything server/server.ts imports, the rules and city data under src/ included), so the page and the
// server never run different rules.
import { once } from 'node:events';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What this script uses of the game server's HTTP server. */
interface GameServer extends Server {
  wss: { clients: Iterable<{ terminate(): void }> };
  store: { close(): Promise<void> };
}

const DEFAULT_PORT = 5173;
const self = fileURLToPath(import.meta.url), root = resolve(dirname(self), '..');
/** The value after `--name` or in `--name=value`. */
function option(name: string): string | undefined {
  const args = process.argv.slice(2), at = args.indexOf(`--${name}`);
  if (at >= 0) return args[at + 1] ?? '';
  return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The second process: only the game server, on the loopback port the launcher chose. It stops when told to, or with the launcher. */
async function serveGame(port: number): Promise<void> {
  const { createServer } = await import('../server/server.ts');
  const game = await createServer() as unknown as GameServer;
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    for (const socket of game.wss.clients) socket.terminate();
    game.closeAllConnections();
    game.close(() => { void game.store.close().finally(() => process.exit(0)); });
  };
  process.on('message', (message) => { if (message === 'stop') stop(); });
  process.on('disconnect', stop);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
  game.listen(port, '127.0.0.1');
  await once(game, 'listening');
  process.send?.('ready');
}

/** Every file the game server loads: server/server.ts and what it imports, followed through relative imports (static and lazy). */
function serverSources(): Set<string> {
  const seen = new Set<string>(), queue = [resolve(root, 'server/server.ts')];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(resolve(dirname(file), match[1] ?? ''));
  }
  return seen;
}

async function freePort(): Promise<number> {
  const probe = createNetServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function launch(): Promise<void> {
  let port = DEFAULT_PORT, child: ChildProcess | undefined, stopping = false, busy = false;
  /** Start the game server process; resolves once it answers, rejects if it stops first. */
  const startGame = (gamePort: number): Promise<void> => new Promise((done, fail) => {
    const started = child = fork(self, ['--game-port', String(gamePort)], { execArgv: process.execArgv });
    started.once('message', () => done());
    let ready = false;
    started.once('message', () => { ready = true; });
    started.once('exit', (code) => {
      if (child === started) child = undefined;
      if (ready && !stopping && !busy) console.error('The game server stopped on its own. Save one of its files to start it again, or restart npm run dev.');
      fail(new Error(`it stopped with exit code ${code ?? 'none'} (the reason is printed above)`));
    });
  });
  const stopGame = async (): Promise<void> => {
    const running = child;
    if (!running || running.exitCode !== null) return;
    const gone = once(running, 'exit');
    if (running.connected) running.send('stop'); else running.kill();
    const timer = setTimeout(() => running.kill('SIGKILL'), 5000);
    await gone;
    clearTimeout(timer);
  };
  try {
    const envFile = option('env');
    if (envFile !== undefined) {
      if (!existsSync(envFile)) throw new Error(`the settings file ${envFile || '(no name given)'} does not exist. Copy .env.example to .env and fill in what you need.`);
      // Node's own parser: the file is never run by a shell, and a variable already set in the environment wins.
      process.loadEnvFile(envFile);
    }
    const wanted = option('port') ?? process.env.DEV_PORT ?? String(DEFAULT_PORT);
    port = Number(wanted);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`"${wanted}" is not a port number. Use one between 1024 and 65535, for example: npm run dev -- --port ${DEFAULT_PORT + 1}`);
    const gamePort = await freePort(), target = `http://127.0.0.1:${gamePort}`;
    await startGame(gamePort);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: {
      host: '127.0.0.1', port, strictPort: true,
      proxy: { '/api': { target }, '/socket': { target, ws: true } },
    } });
    await vite.listen();
    console.log(`\nAllworld is running at http://127.0.0.1:${port}/ (game, API and WebSocket).\nSaved edits show at once: the page reloads, and the game server restarts when its code or the rules change. Press Ctrl+C to stop.\n`);

    // Restart the game server when one of its files changes. One restart at a time; changes during one are picked up after it.
    let sources = serverSources(), timer: NodeJS.Timeout | undefined, again = false, changed = '';
    const restart = async (): Promise<void> => {
      if (stopping) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        await stopGame();
        await startGame(gamePort);
        sources = serverSources();
        console.log(`Game server restarted (${changed} changed).`);
      } catch (error) {
        if (!stopping) console.error(`The game server did not start: ${messageOf(error)}. Fix the file and save it again.`);
      }
      busy = false;
      if (again) { again = false; void restart(); }
    };
    vite.watcher.on('all', (_event, file) => {
      const path = resolve(root, file);
      if (!sources.has(path)) return;
      changed = relative(root, path).split('\\').join('/');
      clearTimeout(timer);
      timer = setTimeout(() => { void restart(); }, 150);
    });
    const close = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      await vite.close();
      await stopGame();
      process.exit(0);
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close(); });
  } catch (error) {
    stopping = true;
    const message = messageOf(error);
    if (/already in use|EADDRINUSE/.test(message)) {
      console.error(`Could not start the local game: port ${port} is already in use, probably by another copy of this command or another dev server.\nStop that one, or pick another port: npm run dev -- --port ${port + 1}`);
    } else console.error(`Could not start the local game: ${message}`);
    await stopGame();
    process.exit(1);
  }
}

const gamePort = option('game-port');
if (gamePort !== undefined) await serveGame(Number(gamePort));
else await launch();
