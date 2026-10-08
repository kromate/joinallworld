/** OWNER: living-world. Server-only fixed wallet operations for the mannequin apprenticeship. */
import { LEFT_OUT, PLAYS } from '../profile.ts'
import { canCredit, credit, debit } from './wallet.ts'
import { repayFromEarnings } from '../relief.ts'
import { barberLesson, BARBER_STARTER_TOOL_COST, type BarberLessonId } from '../living-world/barber-catalogue.ts'
import { fail, ok } from '../util.ts'
import type { LifeState } from '../../types/life.ts'
import type { SystemDefinition, TypedActionHandler } from '../../types/registry.ts'

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}

/** The accompanying db.livingWorld.barber terminal row and ctx.once receipt own the once-only rule. */
const serverAction: TypedActionHandler<'living-world.server'> = (state, payload, ctx) => {
  if (payload.op === 'barber-reward') {
    if (!exactKeys(payload, ['op', 'lessonId']) || (payload.lessonId !== 'basic' && payload.lessonId !== 'advanced')) return fail(state, 'invalid_barber_action')
    const lessonId = payload.lessonId as BarberLessonId, lesson = barberLesson(lessonId)!
    if (!canCredit(state, lesson.payout)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.')
    if (!credit(state, lesson.payout, `Barber apprenticeship: ${lesson.label.toLowerCase()}`, ctx)) return fail(state, 'balance_limit')
    // Only debt repayment follows a cash reward here; work-earned allowances are reserved for later policy review.
    repayFromEarnings(state, lesson.payout, ctx)
    return ok(state, 'barber_rewarded')
  }
  if (payload.op === 'barber-tool') {
    if (!exactKeys(payload, ['op'])) return fail(state, 'invalid_barber_action')
    if (state.cash < BARBER_STARTER_TOOL_COST) return fail(state, 'insufficient_funds')
    return debit(state, BARBER_STARTER_TOOL_COST, 'Barber apprenticeship: clipper upgrade', ctx)
      ? ok(state, 'barber_tool_upgraded') : fail(state, 'insufficient_funds')
  }
  return fail(state, 'invalid_barber_action')
}

const play = PLAYS ? {
  actions: { 'living-world.server': { serverOnly: true as const, run: serverAction, refusal: 'Barber apprenticeship changes are confirmed by the server. Nothing was changed.' } },
} : LEFT_OUT

export default {
  id: 'livingWorld',
  stateKeys: [],
  sanitize(_input: Record<string, unknown>, _state: LifeState): void {},
  ...play,
} satisfies SystemDefinition<'livingWorld'>
