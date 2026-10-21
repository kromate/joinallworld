// The Politics app as a Vue panel. Static metadata only: the component, its model and everything it reads are fetched the
// first time the app is opened, so the entry chunk carries this file and nothing of the feature.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const politics = definePanel({
  id: 'politics', title: 'Politics', placement: 'phone', order: 41, live: false, group: 'city', tint: '#1f5f4a',
  component: defineAsyncComponent(bodyLoader('politics/PoliticsApp')),
})

/** The card on the home screen: fetched with the HUD, so the player can see there is a government. */
export const politicsChip = definePanel({
  id: 'politics-chip', title: 'Politics', icon: 'governor', placement: 'hud', order: 25,
  component: defineAsyncComponent(() => import('./PoliticsChip.vue')),
})

export const POLITICS_PANELS: readonly VuePanel[] = [politics, politicsChip]
