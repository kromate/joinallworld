/** Free simulated driving practice; the service owns all identity/state checks. */
import { createDrivingService, readDrivingQualificationEvidence } from '../living-world/driving-service.ts'
import { createQualificationService } from '../living-world/qualification-service.ts'
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts'

export default function livingWorldRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const driving = createDrivingService(ctx)
  const qualification = createQualificationService(ctx, readDrivingQualificationEvidence)
  return {
    'GET /api/living-world/qualification': async request => ({ body: await qualification.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/qualification/claim': async request => ({ body: await qualification.claim(request, await request.json()), renew: true }),
    'GET /api/living-world/driving': async request => ({ body: await driving.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/driving/start': async request => ({ body: await driving.start(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/input': async request => ({ body: await driving.input(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/resume': async request => ({ body: await driving.resume(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/pause': async request => ({ body: await driving.pause(request, await request.json()), renew: true }),
  }
}
