/** Static metadata only: renderer, models and practice code load on first opening. */
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'

export const drivingPractice = definePanel({
  id: 'driving-practice', title: 'Driving school', icon: '🚗', placement: 'phone', order: 34.5,
  group: 'life', live: false,
  component: defineAsyncComponent(() => import('./DrivingApp.vue')),
})
export const LIVING_WORLD_PANELS: readonly VuePanel[] = [drivingPractice]
