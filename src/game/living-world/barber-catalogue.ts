/** OWNER: living-world. Immutable NPC mannequin practice content; no real player look is read or written. */
import type { BarberPracticePlan } from './barber.ts'
import type { Look } from '../../types/life.ts'

export type BarberLessonId = 'basic' | 'advanced'
export interface BarberLesson {
  readonly id: BarberLessonId
  readonly label: string
  readonly payout: 80 | 120
  readonly requiredTool: 'comb' | 'clippers'
  readonly resultStyleId: 'man-low-cut-v1' | 'man-fade-v1'
  readonly look: Look
  readonly plan: BarberPracticePlan
}

const mannequin = (hair: Look['hair']): Look => Object.freeze({
  body: 'man', hair, outfit: 'casual', fabric: 'plain', skin: 'skin-4',
  hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy',
})
const bounds = (minX: number, minY: number, maxX: number, maxY: number) => Object.freeze({ minX, minY, maxX, maxY })
const objective = (id: string, tool: 'comb' | 'clippers' | 'brush', region: 'front' | 'left' | 'right', target: ReturnType<typeof bounds>) =>
  Object.freeze({ id, tool, region, target, coverageRequired: 0.14 })

const basicLook = mannequin('low-cut'), advancedLook = mannequin('fade')
const plan = (id: BarberLessonId, styleId: BarberLesson['resultStyleId'], steps: BarberPracticePlan['objectives']): BarberPracticePlan =>
  Object.freeze({ id: `npc-barber-${id}`, version: 1, catalogueVersion: 'npc-barber-v1', styleId, body: 'man', objectives: Object.freeze(steps) })

const lessons: Readonly<Record<BarberLessonId, BarberLesson>> = Object.freeze({
  basic: Object.freeze({
    id: 'basic', label: 'Mannequin basics', payout: 80, requiredTool: 'comb', resultStyleId: 'man-low-cut-v1', look: basicLook,
    plan: plan('basic', 'man-low-cut-v1', [
      objective('basic-comb-front', 'comb', 'front', bounds(0.2, 0.3, 0.62, 0.52)),
      objective('basic-clippers-left', 'clippers', 'left', bounds(0.22, 0.58, 0.62, 0.8)),
      objective('basic-brush-right', 'brush', 'right', bounds(0.38, 0.36, 0.78, 0.58)),
    ]),
  }),
  advanced: Object.freeze({
    id: 'advanced', label: 'Mannequin fade', payout: 120, requiredTool: 'clippers', resultStyleId: 'man-fade-v1', look: advancedLook,
    plan: plan('advanced', 'man-fade-v1', [
      objective('advanced-comb-front', 'comb', 'front', bounds(0.2, 0.3, 0.62, 0.52)),
      objective('advanced-clippers-left', 'clippers', 'left', bounds(0.22, 0.58, 0.62, 0.8)),
      objective('advanced-brush-right', 'brush', 'right', bounds(0.38, 0.36, 0.78, 0.58)),
    ]),
  }),
})

export const BARBER_CATALOGUE_VERSION = 'npc-barber-v1'
export const BARBER_STARTER_TOOL_COST = 120
export function barberLesson(id: unknown): BarberLesson | null {
  return id === 'basic' || id === 'advanced' ? lessons[id] : null
}
