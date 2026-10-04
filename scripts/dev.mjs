import { once } from 'node:events';
import { createServer as createGameServer } from '../server/server.js';
import { createServer as createViteServer } from 'vite';

// Keep the API paired with this checkout: a frontend-only preview cannot save or travel.
let game, vite, stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await vite?.close();
  if (game?.listening) {
    for (const socket of game.wss.clients) socket.terminate();
    game.closeAllConnections();
    await new Promise(resolve => game.close(resolve));
    await game.store.close();
  }
}
try {
  game = await createGameServer();
  game.listen(0, '127.0.0.1');
  await once(game, 'listening');
  const target = `http://127.0.0.1:${game.address().port}`;
  vite = await createViteServer({ server: {
    host: '127.0.0.1', port: Number(process.env.DEV_PORT || 5173), strictPort: true,
    proxy: { '/api': { target }, '/socket': { target, ws: true } },
  } });
  await vite.listen();
  console.log('Game server connected. Open the local URL below to play.');
  vite.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) {
  console.error(`Could not start the local game: ${error.message}`);
  await close();
  process.exitCode = 1;
}
