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
import { social } from './useSocial.ts'
import { knocksWaiting, requestsWaiting } from './socialModel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const people = definePanel({
  id: 'people', title: 'People', placement: 'sim-tab', order: 50, phone: true, group: 'people',
  badge: () => requestsWaiting(social.me),
  component: defineAsyncComponent(bodyLoader('social/PeopleApp')),
})

export const person = definePanel({
  id: 'person', title: 'Person', placement: 'modal',
  component: defineAsyncComponent(bodyLoader('social/PersonApp')),
})

export const contacts = definePanel({
  id: 'contacts', title: 'Contacts', placement: 'phone', order: 20, group: 'people',
  component: defineAsyncComponent(bodyLoader('social/ContactsApp')),
})

export const family = definePanel({
  id: 'family', title: 'Family', placement: 'phone', order: 36, group: 'people',
  component: defineAsyncComponent(bodyLoader('social/FamilyApp')),
})

export const invite = definePanel({
  id: 'invite', title: 'Invite', placement: 'phone', order: 38, group: 'people',
  badge: () => knocksWaiting(social.me),
  component: defineAsyncComponent(bodyLoader('social/InviteApp')),
})

/** Spread into NATIVE_PANELS (src/app/features/panels.ts). Messages is registered there already. */
export const SOCIAL_PANELS: readonly VuePanel[] = [people, person, contacts, family, invite]
