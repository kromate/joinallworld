// What the Career tab shows, worked out from view.career. Pure, so it is tested without a browser.
import type { CareerView } from '../../../types/view.ts'

export type PromotionLine =
  | { kind: 'starter' }
  | { kind: 'top' }
  | { kind: 'next'; text: string; checks: { met: boolean; text: string }[] }

/** What the promotion card says: the next rung and what it still needs, or why there is none. */
export function promotionLine(career: Pick<CareerView, 'isTrack' | 'next'>, cap: (id: string) => string): PromotionLine {
  if (!career.isTrack) return { kind: 'starter' }
  const next = career.next
  if (!next) return { kind: 'top' }
  return { kind: 'next', text: next.text, checks: [
    { met: next.performanceMet, text: 'Performance 100%' },
    { met: next.skillMet, text: `${cap(next.skill)} level ${next.skillLevel} (yours: ${next.have})` },
  ] }
}

/** The line under today's status: the next shift when the step only repeats what the status said. */
export const stepLine = (career: Pick<CareerView, 'step' | 'today' | 'nextShift'>): string =>
  career.step.kind === 'wait' && career.step.text === career.today.text ? career.nextShift ?? career.step.text : career.step.text

/** 0–100 for a bar. */
export const percent = (value: number | null | undefined): number => Math.max(0, Math.min(100, Number(value) || 0))
