/** Free simulated driving practice; the service owns all identity/state checks. */
import { createDrivingService } from '../living-world/driving-service.ts'
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts'

export default function livingWorldRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const driving = createDrivingService(ctx)
  return {
    'GET /api/living-world/driving': async request => ({ body: await driving.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/driving/start': async request => ({ body: await driving.start(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/input': async request => ({ body: await driving.input(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/resume': async request => ({ body: await driving.resume(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/pause': async request => ({ body: await driving.pause(request, await request.json()), renew: true }),
  }
}
