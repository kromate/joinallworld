// The Vue panels. Each takes the place of the existing panel with the same id (state/panels.ts);
// its component is fetched the first time it is opened, so the entry chunk carries only this
// metadata — the same split the existing lazy panel groups make.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../state/panels.ts'
import type { VuePanel } from '../types/panel.ts'
import { reportReplies } from '../legacy/modules.ts'
import { social } from '../legacy/social.ts'
import { billsDue } from './bank/bankModel.ts'
import { messagesBadge, notificationLines } from './messages/messagesModel.ts'
import { noticeMarks } from './messages/messagesState.ts'
import { CIVIC_APPS, CIVIC_HUD } from './civic/register.ts'
import { GROWTH_HUD_PANELS, GROWTH_PANELS } from './growth/register.ts'
import { TABLES_PANELS } from './tables/register.ts'
import { WORLD_PANELS } from './world/register.ts'

export const bank = definePanel({
  id: 'bank', title: 'Bank', icon: '🏦', placement: 'phone', order: 14, group: 'money',
  badge: billsDue,
  component: defineAsyncComponent(() => import('./bank/BankApp.vue')),
})

export const messages = definePanel({
  id: 'messages', title: 'Messages', icon: '✉️', placement: 'phone', order: 12, group: 'people',
  badge: (_state, view) => messagesBadge(social.me, view.connected, noticeMarks.fresh(view.cityId, view.social?.notices)),
  notifications: (_state, view) => notificationLines(social.me, { connected: view.connected, now: view.now, notices: view.social?.notices, seen: noticeMarks.seen(view.cityId) }),
  component: defineAsyncComponent(() => import('./messages/MessagesApp.vue')),
})

export const support = definePanel({
  id: 'support', title: 'Report a problem', short: 'Report', icon: '🛟', placement: 'phone', order: 96, group: 'city',
  badge: () => reportReplies(),
  component: defineAsyncComponent(() => import('./support/ReportApp.vue')),
})

export const NATIVE_PANELS: readonly VuePanel[] = [bank, messages, support, ...CIVIC_APPS, ...CIVIC_HUD, ...GROWTH_PANELS, ...GROWTH_HUD_PANELS, ...TABLES_PANELS, ...WORLD_PANELS]
