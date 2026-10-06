// The Admin app as a Vue panel: static metadata only. It is listed on the Phone only after the server has said this session is an admin
// (adminGate.ts), and the app is fetched the first time it is opened, so an ordinary player never downloads it.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { ADMIN_PANEL, adminGate } from './adminGate.ts'

export const admin = definePanel({
  id: ADMIN_PANEL, title: 'Admin', placement: 'phone', order: 98, live: false, group: 'city', fullscreen: true, tint: '#3b3f4a',
  hidden: () => !adminGate.admin,
  component: defineAsyncComponent(() => import('./AdminApp.vue')),
})
export const ADMIN_PANELS: readonly VuePanel[] = [admin]
