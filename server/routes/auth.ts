/**
 * OWNER: accounts
 * Account endpoints (sign up, log in, log out, continue, new life) under /api/auth/.
 *
 * INERT BY DESIGN: this module is registered but exposes no endpoint, and the foundation
 * changes nothing about authentication. Device sessions (public/secret ID split, sliding
 * renewal, archived expired lives) remain the only identity until an accounts design has
 * been reviewed. Do not add a working endpoint here without that review.
 *
 * Placeholder: registered by routes/index.js, returns no handlers yet. The handler contract
 * (request, response, ctx, storage rules, how to test) is at the top of routes/index.js.
 */
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

export default function authRoutes(_ctx: RouteContext): Record<RouteKey, RouteHandler> {
  return {};
}
