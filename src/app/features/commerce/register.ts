import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'

export const COMMERCE_PANELS = [definePanel({
  id: 'commerce', title: 'My Store', placement: 'phone', group: 'money', order: 13, live: false, tint: '#9a4f25',
  component: defineAsyncComponent(() => import('./CommerceApp.vue')),
})]
