// The Campus panel, declared with the static metadata of the existing one (the lazy entry
// `campusApps` in src/ui/panels/index.js): it is listed before any of its code has loaded. The
// component is fetched on first use. Lagos only: it says so itself in another city.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'

export const CAMPUS_PANELS: readonly VuePanel[] = [
  definePanel({ id: 'campus', title: 'Campus', placement: 'phone', order: 47, group: 'city', tint: '#8f2434', live: true, component: defineAsyncComponent(() => import('./CampusApp.vue')) }),
]
