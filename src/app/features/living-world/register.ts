/** Static metadata only: renderer, models and practice code load on first opening. */
import type { Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import type { PracticePanelId } from './loadPracticePanel.ts'
import { bodyLoader } from '../../state/panelBody.ts'
import { phonePanel } from '../../state/panelFactories.ts'
// One lazy gateway keeps both practice apps discoverable without loading either app from startup.
const practiceGateway: Component = defineAsyncComponent(bodyLoader('living-world/PracticeGateway'))
const practicePanel = (id: PracticePanelId, title: string, icon: string, order: number) => definePanel({
  id, title, icon, placement: 'phone' as const, order, group: 'life' as const, live: false,
  component: practiceGateway,
})

export const drivingPractice = practicePanel('driving-practice', 'Driving school', '🚗', 34.5)
export const barberPractice = practicePanel('barber-practice', 'Barber practice', '✂️', 34.6)
export const clerkPractice = practicePanel('clerk-practice', 'Clerk practice', '📋', 34.7)
export const justicePractice = practicePanel('justice-practice', 'Justice practice', '⚖️', 34.8)
// Drive a danfo: a job at the motor park (docs/DANFO.md). The app and the road load when it is opened.
export const danfoDriver = phonePanel('danfo', 'Drive a danfo', bodyLoader('danfo/DanfoApp'), { short: 'Danfo', icon: '🚌', order: 10.2, group: 'money' })
// Local mini-games (docs/MINI-GAMES.md): each app and its drawing code load only when it is opened.
export const marketHaggle = phonePanel('haggle', 'Market haggle', bodyLoader('minigames/HaggleApp'), { short: 'Haggle', icon: '🤝', order: 10.3, group: 'money' })
export const skitStudio = phonePanel('skit', 'Skit studio', bodyLoader('minigames/SkitApp'), { short: 'Skits', icon: '🎬', order: 10.4, group: 'people' })
export const seasonsApp = phonePanel('seasons', 'NYSC and JAMB', bodyLoader('minigames/SeasonsApp'), { short: 'Seasons', icon: '🎓', order: 10.5, group: 'life' })
export const LIVING_WORLD_PANELS: readonly VuePanel[] = [drivingPractice, barberPractice, clerkPractice, justicePractice, danfoDriver, marketHaggle, skitStudio, seasonsApp]
