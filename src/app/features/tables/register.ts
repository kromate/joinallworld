// The Tables panels, declared with the static metadata of the existing ones (the lazy entry
// `tableApps` and src/ui/panels/tables-chip.js in src/ui/panels/index.js): they are listed before
// any of their code has loaded. The components are fetched on first use.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const TABLES_PANELS: readonly VuePanel[] = [
  definePanel({ id: 'tables', title: 'Tables', placement: 'phone', order: 43, group: 'city', tint: '#1f8a86', component: defineAsyncComponent(bodyLoader('tables/TablesApp')) }),
  definePanel({ id: 'tables-chip', title: 'Table here', icon: 'tables', placement: 'hud', order: 25, component: defineAsyncComponent(() => import('./TablesChip.vue')) }),
]
