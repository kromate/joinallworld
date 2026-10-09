/** Free simulated driving practice; the service owns all identity/state checks. */
import { createDrivingService, readDrivingQualificationEvidence } from '../living-world/driving-service.ts'
import { createQualificationService } from '../living-world/qualification-service.ts'
import { createBarberService } from '../living-world/barber-service.ts'
import { createStarterRentalService } from '../living-world/rental-service.ts'
import { createClerkService } from '../living-world/clerk-service.ts'
import { createJusticePracticeService } from '../living-world/justice-practice-service.ts'
import { createAssessmentService } from '../living-world/assessment-service.ts'
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts'

export default function livingWorldRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const driving = createDrivingService(ctx)
  const qualification = createQualificationService(ctx, readDrivingQualificationEvidence)
  const barber = createBarberService(ctx)
  const rental = createStarterRentalService(ctx)
  const clerk = createClerkService(ctx)
  const justice = createJusticePracticeService(ctx)
  const assessment = createAssessmentService(ctx)
  return {
    'GET /api/living-world/assessment': async request => ({ body: await assessment.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/assessment/start': async request => ({ body: await assessment.start(request, await request.json()), renew: true }),
    'POST /api/living-world/assessment/step': async request => ({ body: await assessment.step(request, await request.json()), renew: true }),
    'GET /api/living-world/justice-practice': async request => ({ body: await justice.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/justice-practice/start': async request => ({ body: await justice.start(request, await request.json()), renew: true }),
    'POST /api/living-world/justice-practice/step': async request => ({ body: await justice.step(request, await request.json()), renew: true }),
    'GET /api/living-world/clerk': async request => ({ body: await clerk.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/clerk/start': async request => ({ body: await clerk.start(request, await request.json()), renew: true }),
    'POST /api/living-world/clerk/step': async request => ({ body: await clerk.step(request, await request.json()), renew: true }),
    'POST /api/living-world/clerk/claim': async request => ({ body: await clerk.claim(request, await request.json()), renew: true }),
    'GET /api/living-world/rental': async request => ({ body: await rental.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/rental/claim': async request => ({ body: await rental.claim(request, await request.json()), renew: true }),
    'GET /api/living-world/barber': async request => ({ body: await barber.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/barber/start': async request => ({ body: await barber.start(request, await request.json()), renew: true }),
    'POST /api/living-world/barber/input': async request => ({ body: await barber.input(request, await request.json()), renew: true }),
    'POST /api/living-world/barber/pause': async request => ({ body: await barber.pause(request, await request.json()), renew: true }),
    'POST /api/living-world/barber/resume': async request => ({ body: await barber.resume(request, await request.json()), renew: true }),
    'POST /api/living-world/barber/claim': async request => ({ body: await barber.claim(request, await request.json()), renew: true }),
    'POST /api/living-world/barber/upgrade': async request => ({ body: await barber.upgrade(request, await request.json()), renew: true }),
    'GET /api/living-world/qualification': async request => ({ body: await qualification.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/qualification/claim': async request => ({ body: await qualification.claim(request, await request.json()), renew: true }),
    'GET /api/living-world/driving': async request => ({ body: await driving.current(request, request.query.get('city')), renew: true }),
    'POST /api/living-world/driving/start': async request => ({ body: await driving.start(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/restart': async request => ({ body: await driving.restart(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/input': async request => ({ body: await driving.input(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/resume': async request => ({ body: await driving.resume(request, await request.json()), renew: true }),
    'POST /api/living-world/driving/pause': async request => ({ body: await driving.pause(request, await request.json()), renew: true }),
  }
}
