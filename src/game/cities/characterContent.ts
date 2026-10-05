import { DREAMS, LOTTERY } from '../content/traits.ts'
import { contentFor } from './runtime.ts'
import type { DreamId, LotteryId } from '../../types/life.ts'
import type { DreamDefinition } from '../../types/content.ts'

export const dreamFor = (cityId: string, id: DreamId): DreamDefinition => ({
  ...DREAMS[id], ...contentFor(cityId).dreamWording?.[id],
})
export const dreamsFor = (cityId: string): DreamDefinition[] => Object.values(DREAMS).map(dream => dreamFor(cityId, dream.id))
export const lotteryBulletsFor = (cityId: string, id: LotteryId): string[] => [
  ...(contentFor(cityId).lotteryWording?.[id]?.bullets ?? LOTTERY[id].bullets),
]
