// The Getting around panels, declared with the static metadata of the existing ones (the lazy
// `map` group in src/ui/panels/index.js, ride, city and roadside-chip): they are listed before any
// of their code has loaded. The components are fetched on first use.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const TRAVEL_PANELS: readonly VuePanel[] = [
  definePanel({ id: 'map', title: 'Map', placement: 'nav', component: defineAsyncComponent(bodyLoader('travel/MapApp')) }),
  definePanel({ id: 'roadside', title: 'On the road', placement: 'modal', component: defineAsyncComponent(bodyLoader('travel/RoadsideModal')) }),
  definePanel({
    id: 'ride', title: 'Ride', placement: 'phone', order: 18, group: 'life',
    /** A roadside choice is waiting: something to answer. */
    badge: (_state, view) => (view.travel?.event ? 1 : 0),
    component: defineAsyncComponent(bodyLoader('travel/RideApp')),
  }),
  definePanel({ id: 'city', title: 'City', placement: 'modal', component: defineAsyncComponent(bodyLoader('travel/CityPanel')) }),
  definePanel({ id: 'visiting', title: 'Home', placement: 'modal', component: defineAsyncComponent(bodyLoader('travel/VisitorHome')) }),
  definePanel({ id: 'roadside-chip', title: 'On the road', placement: 'hud', slot: 'alert', order: 5, component: defineAsyncComponent(() => import('./RoadsideChip.vue')) }),
]
