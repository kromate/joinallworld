// The Allworld Market as a Vue panel. Static metadata only: the component, its model and everything it reads are
// fetched the first time the app is opened, so the entry chunk carries this file and nothing of the feature.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const market = definePanel({
  id: 'market', title: 'Market', placement: 'phone', order: 50.5, live: false, group: 'money', tint: '#7f1d1d',
  component: defineAsyncComponent(bodyLoader('market/MarketApp')),
})

export const MARKET_PANELS: readonly VuePanel[] = [market]
