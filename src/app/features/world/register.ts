// The world's Vue panels: static metadata only, exactly as the lazy group in
// src/ui/panels/index.js lists them (worldPanels), so they are listed before any component code
// has been fetched. Each component is fetched the first time it is opened.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { cityUnit } from '../../../game/cities/terminology.ts'

export const lga = definePanel({
  id: 'lga', title: 'Local government', titleFor: state => { const unit = cityUnit(state.estate.city); return unit.charAt(0).toUpperCase() + unit.slice(1) }, placement: 'modal', live: false,
  component: defineAsyncComponent(() => import('./WorldLgaPanel.vue')),
})
export const houseCard = definePanel({
  id: 'house-card', title: 'House', placement: 'modal',
  component: defineAsyncComponent(() => import('./HouseCard.vue')),
})

export const WORLD_PANELS: readonly VuePanel[] = [lga, houseCard]
