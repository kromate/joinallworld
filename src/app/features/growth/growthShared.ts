// The one growth store of the page, held where the panel registry can look at it without
// importing the store (which imports the application, which imports the registry). Set by
// useGrowth(); read by badges, which are drawn from data already loaded and never create it.
import { shallowRef } from 'vue'
import type { Growth } from './growthStore.ts'

export const sharedGrowth = shallowRef<Growth | null>(null)
