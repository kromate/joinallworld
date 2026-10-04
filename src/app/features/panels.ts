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

export const jobs = definePanel({
  id: 'jobs', title: 'Jobs', placement: 'phone', order: 10, group: 'money',
  component: defineAsyncComponent(() => import('./jobs/JobsApp.vue')),
})

export const career = definePanel({
  id: 'career', title: 'Career', placement: 'sim-tab', order: 60, phone: true, group: 'money',
  component: defineAsyncComponent(() => import('./jobs/CareerTab.vue')),
})

export const statement = definePanel({
  id: 'statement', title: 'Statement', placement: 'phone', order: 15, group: 'money',
  component: defineAsyncComponent(() => import('./money/StatementApp.vue')),
})

export const invest = definePanel({
  id: 'invest', title: 'Invest', placement: 'phone', order: 50, group: 'money',
  component: defineAsyncComponent(() => import('./money/InvestApp.vue')),
})

export const houses = definePanel({
  id: 'houses', title: 'Houses', placement: 'phone', order: 30, group: 'life',
  component: defineAsyncComponent(() => import('./home/HousesApp.vue')),
})

export const cars = definePanel({
  id: 'cars', title: 'Cars', placement: 'phone', order: 34, group: 'life',
  component: defineAsyncComponent(() => import('./home/CarsApp.vue')),
})

export const groceries = definePanel({
  id: 'groceries', title: 'Groceries', placement: 'phone', order: 16, group: 'life',
  component: defineAsyncComponent(() => import('./home/GroceriesApp.vue')),
})

export const health = definePanel({
  id: 'health', title: 'Health', placement: 'phone', order: 22, group: 'life',
  /** Sick or run down: something to act on. */
  badge: (_state, view) => (view.health?.sick || view.health?.rundown ? 1 : 0),
  component: defineAsyncComponent(() => import('./life/HealthApp.vue')),
})

export const goals = definePanel({
  id: 'goals', title: 'Goals', placement: 'sim-tab', order: 30, phone: true, group: 'life',
  component: defineAsyncComponent(() => import('./life/GoalsTab.vue')),
})

export const NATIVE_PANELS: readonly VuePanel[] = [bank, messages, support, jobs, career, statement, invest, houses, cars, groceries, health, goals]
