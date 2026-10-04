import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer as createGameServer } from '../server/server.js';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';

/** What this script uses of the game server's HTTP server (server/server.js is untyped). */
interface GameServer extends Server {
  wss: { clients: Iterable<{ terminate(): void }> };
  store: { close(): Promise<void> };
}

// Keep the API paired with this checkout: a frontend-only preview cannot save or travel.
let game: GameServer | undefined, vite: ViteDevServer | undefined, stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  if (game?.listening) {
    for (const socket of game.wss.clients) socket.terminate();
    game.closeAllConnections();
    const running = game;
    await new Promise<void>(resolve => running.close(() => resolve()));
    await game.store.close();
  }
}
try {
  game = await createGameServer() as unknown as GameServer;
  const started = game;
  started.listen(0, '127.0.0.1');
  await once(started, 'listening');
  const target = `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  vite = await createViteServer({ server: {
    host: '127.0.0.1', port: Number(process.env.DEV_PORT || 5173), strictPort: true,
    proxy: { '/api': { target }, '/socket': { target, ws: true } },
  } });
  await vite.listen();
  console.log('Game server connected. Open the local URL below to play.');
  vite.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) {
  console.error(`Could not start the local game: ${error instanceof Error ? error.message : String(error)}`);
  await close();
  process.exitCode = 1;
}
