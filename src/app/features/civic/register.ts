// The civic panels as Vue panels. Static metadata only (the same as the existing lazy group in
// src/ui/panels/index.js and the two chips' own files); each component is fetched the first time
// it is opened, so the entry chunk carries only this file, the model and the small cache that
// the Governor badge reads. Nothing here imports the application (useApp), a component or a
// heavy dependency.
//
// The two HUD chips are listed apart: src/app/features/hud/HudSidebar.vue draws only existing
// panels as chips today, so a Vue chip registered before it is taught to draw one would vanish
// from the HUD. Register CIVIC_PANELS once it does (or CIVIC_APPS alone until then).
import { defineAsyncComponent } from 'vue'
import { civicTitle, civicOffice } from '../../../game/cities/terminology.ts'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { civicNews } from './civicCore.ts'

export const governor = definePanel({
  id: 'governor', title: 'Chairman', titleFor: state => civicTitle(state.estate.city), placement: 'phone', order: 40, live: false, group: 'city',
  badge: (state, view) => civicNews(view, state),
  component: defineAsyncComponent(() => import('./GovernorApp.vue')),
})
export const stateHouse = definePanel({
  id: 'state-house', title: 'State House', titleFor: state => civicOffice(state.estate.city), placement: 'modal',
  component: defineAsyncComponent(() => import('./StateHouseSheet.vue')),
})
export const neighbours = definePanel({
  id: 'neighbours', title: 'Neighbours', placement: 'phone', order: 42, group: 'city',
  component: defineAsyncComponent(() => import('./NeighboursApp.vue')),
})
export const ads = definePanel({
  id: 'ads', title: 'Billboards', placement: 'phone', order: 44, live: false, group: 'city',
  component: defineAsyncComponent(() => import('./AdsApp.vue')),
})
export const huntSheet = definePanel({
  id: 'hunt-sheet', title: 'Gem hunt', placement: 'phone', order: 45, group: 'city',
  /** All gems found and the prize not collected yet. */
  badge: (_state, view) => (view.civic?.hunt?.canClaim ? 1 : 0),
  component: defineAsyncComponent(() => import('./HuntSheet.vue')),
})
export const radio = definePanel({
  id: 'radio', title: 'Radio', placement: 'phone', order: 46, live: false, group: 'city',
  component: defineAsyncComponent(() => import('./RadioApp.vue')),
})
export const richlist = definePanel({
  id: 'richlist', title: 'Rich List', placement: 'phone', order: 48, group: 'money',
  component: defineAsyncComponent(() => import('./RichListApp.vue')),
})

/** HUD chips (placement 'hud'). */
export const huntChip = definePanel({
  id: 'hunt', title: 'Daily hunt', icon: 'hunt', placement: 'hud', order: 20,
  component: defineAsyncComponent(() => import('./HuntChip.vue')),
})
export const radioBanner = definePanel({
  id: 'radio-banner', title: 'Club radio', icon: 'radio', placement: 'hud', order: 30,
  component: defineAsyncComponent(() => import('./RadioBanner.vue')),
})

export const CIVIC_APPS: readonly VuePanel[] = [governor, stateHouse, neighbours, ads, huntSheet, radio, richlist]
export const CIVIC_HUD: readonly VuePanel[] = [huntChip, radioBanner]
export const CIVIC_PANELS: readonly VuePanel[] = [...CIVIC_APPS, ...CIVIC_HUD]
