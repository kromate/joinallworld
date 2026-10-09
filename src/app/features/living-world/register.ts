/** Static metadata only: renderer, models and practice code load on first opening. */
import { phonePanel } from '../../state/panelFactories.ts'
import type { VuePanel } from '../../types/panel.ts'

export const drivingPractice = phonePanel(
  'driving-practice', 'Driving school',
  () => import('./loadPracticePanel.ts').then(({ loadPracticePanel }) => loadPracticePanel('driving-practice')),
  { icon: '🚗', order: 34.5, group: 'life', live: false },
)
export const barberPractice = phonePanel(
  'barber-practice', 'Barber practice',
  () => import('./loadPracticePanel.ts').then(({ loadPracticePanel }) => loadPracticePanel('barber-practice')),
  { icon: '✂️', order: 34.6, group: 'life', live: false },
)
export const LIVING_WORLD_PANELS: readonly VuePanel[] = [drivingPractice, barberPractice]
