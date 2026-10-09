/** Static metadata only: renderer, models and practice code load on first opening. */
import type { Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import type { PracticePanelId } from './loadPracticePanel.ts'
// One lazy gateway keeps both practice apps discoverable without loading either app from startup.
const practiceGateway: Component = defineAsyncComponent(() => import('./PracticeGateway.vue'))
const practicePanel = (id: PracticePanelId, title: string, icon: string, order: number) => definePanel({
  id, title, icon, placement: 'phone' as const, order, group: 'life' as const, live: false,
  component: practiceGateway,
})

export const drivingPractice = practicePanel('driving-practice', 'Driving school', '🚗', 34.5)
export const barberPractice = practicePanel('barber-practice', 'Barber practice', '✂️', 34.6)
export const clerkPractice = practicePanel('clerk-practice', 'Clerk practice', '📋', 34.7)
export const LIVING_WORLD_PANELS: readonly VuePanel[] = [drivingPractice, barberPractice, clerkPractice]
