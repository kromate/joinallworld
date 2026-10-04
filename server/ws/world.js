/**
 * OWNER: world
 * No message types of its own: this module only tells the world service (server/world/service.js)
 * when a player's connection opens and closes, so "online now" per local government is a count the
 * server already holds — never a scan of residents.
 */
import { worldOf } from '../world/service.js';

export default function worldSocket(ctx) {
  const world = worldOf(ctx);
  return { messages: {}, open: (ws) => world.open(ws), close: (ws) => world.close(ws) };
}
