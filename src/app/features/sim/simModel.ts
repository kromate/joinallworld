// What the Needs and Skills tabs show, worked out from the view. Pure, so it is tested without a browser.
import type { OnboardingView, SkillProgress } from '../../../types/view.ts'

export const SEGMENTS = 10

export type NeedLevel = 'high' | 'mid' | 'low'
/** How full a need is, as the bar colours it. */
export const needLevel = (value: number): NeedLevel => (value >= 60 ? 'high' : value >= 30 ? 'mid' : 'low')

/** What the feelings add to the mood, signed: '+4' or '−10'. */
export function feelingsTotal(feelings: readonly { value: number }[]): { total: number; text: string } {
  const total = feelings.reduce((sum, feeling) => sum + feeling.value, 0)
  return { total, text: `${total < 0 ? '−' : '+'}${Math.abs(total)}` }
}

export const signedFeeling = (value: number): string => `${value < 0 ? '−' : '+'}${Math.abs(value)}`

/** One skill: how much of each of the ten segments is filled, and the line under its name. */
export function skillRow(info: Pick<SkillProgress, 'level' | 'progress' | 'next'>): { segments: number[]; detail: string } {
  const segments = Array.from({ length: SEGMENTS }, (_, index) => (index < info.level ? 100 : index === info.level ? Math.round(info.progress * 100) : 0))
  return { segments, detail: info.next === null ? 'Maxed out' : `${Math.round(info.progress * 100)}% to level ${info.level + 1}` }
}

export type Mood = OnboardingView['mood']
