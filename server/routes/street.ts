import { streetOf } from '../street/authority.ts'
import type { RouteHandler, RouteKey } from '../types.ts'
import type { StreetContext } from '../street/types.ts'

export default function streetRoutes(ctx: StreetContext): Record<RouteKey, RouteHandler> {
  const street = streetOf(ctx)
  const coordinate = (value: string | null): number => { const number = value === null ? NaN : Number(value); if (!Number.isInteger(number) || Math.abs(number) > 1000000) throw ctx.fail(400, 'invalid_street_tile'); return number }
  return {
    'GET /api/street/me': async request => ({ body: await street.me(request) }),
    'POST /api/street/begin': async request => ({ body: await street.begin(request, await request.json()) }),
    'GET /api/street/tile': async request => ({ body: await street.tile(request, coordinate(request.query.get('x')), coordinate(request.query.get('z'))) }),
    'POST /api/street/move': async request => ({ body: await street.move(request, await request.json()) }),
    'POST /api/street/enter': async request => ({ body: await street.enter(request, await request.json()) }),
    'POST /api/street/exit': async request => ({ body: await street.exit(request, await request.json()) }),
  }
}
