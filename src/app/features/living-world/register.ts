/** Static metadata only: renderer, models and practice code load on first opening. */
import { phonePanel } from '../../state/panelFactories.ts'
import type { VuePanel } from '../../types/panel.ts'
import type { PracticePanelId } from './loadPracticePanel.ts'

const practicePanel = (id: PracticePanelId, title: string, icon: string, order: number): VuePanel => phonePanel(
  id,
  title,
  () => import('./loadPracticePanel.ts').then(({ loadPracticePanel }) => loadPracticePanel(id)),
  { icon, order, group: 'life', live: false },
)

export const drivingPractice = practicePanel('driving-practice', 'Driving school', '🚗', 34.5)
export const barberPractice = practicePanel('barber-practice', 'Barber practice', '✂️', 34.6)
export const LIVING_WORLD_PANELS: readonly VuePanel[] = [drivingPractice, barberPractice]
