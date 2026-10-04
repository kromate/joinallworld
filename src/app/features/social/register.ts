// The social panels as Vue panels: People (a Sim tab that is also a Phone app), the person card,
// Contacts, Family and Invite. The static metadata is exactly what the lazy group in
// src/ui/panels/index.js gives each id, with the badges of People and Invite; each component is
// fetched the first time it is opened. Only light modules are imported here.
//
// Messages is registered in src/app/features/panels.ts and the Inbox chip in
// features/growth/register.ts (GROWTH_HUD_PANELS), as before.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { social } from '../../legacy/social.ts'
import { knocksWaiting, requestsWaiting } from './socialModel.ts'

export const people = definePanel({
  id: 'people', title: 'People', placement: 'sim-tab', order: 50, phone: true, group: 'people',
  badge: () => requestsWaiting(social.me),
  component: defineAsyncComponent(() => import('./PeopleApp.vue')),
})

export const person = definePanel({
  id: 'person', title: 'Person', placement: 'modal',
  component: defineAsyncComponent(() => import('./PersonApp.vue')),
})

export const contacts = definePanel({
  id: 'contacts', title: 'Contacts', placement: 'phone', order: 20, group: 'people',
  component: defineAsyncComponent(() => import('./ContactsApp.vue')),
})

export const family = definePanel({
  id: 'family', title: 'Family', placement: 'phone', order: 36, group: 'people',
  component: defineAsyncComponent(() => import('./FamilyApp.vue')),
})

export const invite = definePanel({
  id: 'invite', title: 'Invite', placement: 'phone', order: 38, group: 'people',
  badge: () => knocksWaiting(social.me),
  component: defineAsyncComponent(() => import('./InviteApp.vue')),
})

/** Spread into NATIVE_PANELS (src/app/features/panels.ts). Messages is registered there already. */
export const SOCIAL_PANELS: readonly VuePanel[] = [people, person, contacts, family, invite]
