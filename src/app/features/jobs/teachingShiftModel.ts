import { teachingStep } from '../../../game/living-world/teaching-practice.ts'
import type { TeachingPractice } from '../../../game/living-world/teaching-practice.ts'

export type TeachingStage = TeachingPractice['stage']

export interface TeachingShiftAnswer {
  readonly generation: number
  readonly revision: number
  readonly stage: TeachingStage
  readonly choice: string
}

/** Build the narrow answer envelope only for a choice in the exact displayed step. */
export function teachingShiftAnswer(
  generation: number,
  practice: TeachingPractice,
  expectedRevision: number,
  expectedStage: TeachingStage,
  selectedChoice: unknown,
  disabled = false,
): TeachingShiftAnswer | null {
  try {
    if (disabled || !Number.isSafeInteger(generation) || generation < 1
      || practice.version !== 1 || practice.stage === 'complete'
      || !Number.isSafeInteger(practice.revision) || practice.revision < 1
      || expectedRevision !== practice.revision || expectedStage !== practice.stage
      || typeof selectedChoice !== 'string') return null

    const current = teachingStep(practice)
    if (!current || !current.options.some(option => option.id === selectedChoice)) return null
    return Object.freeze({ generation, revision: practice.revision, stage: practice.stage, choice: selectedChoice })
  } catch {
    return null
  }
}
