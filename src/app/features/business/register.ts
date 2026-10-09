// The Business app as a Vue panel. Static metadata only: the component, its model and everything it reads are
// fetched the first time the app is opened, so the entry chunk carries this file and nothing of the feature.
// The badge reads the last answer the page was given (the shared cache of server answers): no request is made for it.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { civicBadgeStore } from '../civic/civicBadges.ts'

export const business = definePanel({
  id: 'business', title: 'Business', placement: 'phone', order: 13, live: false, group: 'money', tint: '#b4541a',
  badge: (_state, view) => ((civicBadgeStore.value?.cache.get(`business:mine:${view.cityId}`)?.data as { mine?: { alert?: string } | null } | null)?.mine?.alert ? 1 : 0),
  component: defineAsyncComponent(() => import('./BusinessApp.vue')),
})

export const BUSINESS_PANELS: readonly VuePanel[] = [business]
