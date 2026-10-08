// The Vue panels. Each takes the place of the existing panel with the same id (state/panels.ts);
// its component is fetched the first time it is opened, so the entry chunk carries only this
// metadata — the same split the existing lazy panel groups make.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../state/panels.ts'
import type { VuePanel } from '../types/panel.ts'
import { reportReplies } from '../../ui/phone/reports.ts'
import { social } from './social/useSocial.ts'
import { billsDue } from './bank/bankModel.ts'
import { messagesBadge, notificationLines } from './messages/messagesModel.ts'
import { noticeMarks } from './messages/messagesState.ts'
import { scene as homeScene } from './home/homeState.ts'
import { CIVIC_APPS, CIVIC_HUD } from './civic/register.ts'
import { GROWTH_HUD_PANELS, GROWTH_PANELS } from './growth/register.ts'
import { CAMPUS_PANELS } from './campus/register.ts'
import { TABLES_PANELS } from './tables/register.ts'
import { GAMES_PANELS } from './games/register.ts'
import { WORLD_PANELS } from './world/register.ts'
import { SOCIAL_PANELS } from './social/register.ts'
import { START_PANELS } from './start/register.ts'
import { TRAVEL_PANELS } from './travel/register.ts'
import { ACCOUNT_PANELS } from './account/register.ts'
import { COMMERCE_PANELS } from './commerce/register.ts'
import { BUSINESS_PANELS } from './business/register.ts'
import { POLITICS_PANELS } from './politics/register.ts'
import { ADMIN_PANELS } from './admin/register.ts'

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

export const landPanel = definePanel({
  id: 'land', title: 'My land', icon: 'home', placement: 'phone', order: 30.5, group: 'life',
  component: defineAsyncComponent(() => import('./neighbourhood/LandPanel.vue')),
})

export const neighbourhoodPanel = definePanel({
  id: 'neighbourhood', title: 'My street', icon: 'home', placement: 'phone', order: 31, group: 'life',
  component: defineAsyncComponent(() => import('./neighbourhood/NeighbourhoodPanel.vue')),
})

export const stories = definePanel({
  id: 'stories', title: 'Story scenes', icon: 'sparkles', placement: 'phone', order: 53, group: 'life',
  component: defineAsyncComponent(() => import('./stories/StoriesApp.vue')),
})
export const storyChip = definePanel({
  id: 'story-chip', title: 'Story scene', placement: 'hud', order: 22,
  component: defineAsyncComponent(() => import('./stories/StoryChip.vue')),
})

export const captureChip = definePanel({
  id: 'capture-chip', title: 'Recording', placement: 'hud', slot: 'alert', order: 3,
  component: defineAsyncComponent(() => import('./capture/CaptureChip.vue')),
})

export const capture = definePanel({
  id: 'capture', title: 'Capture', icon: 'camera', placement: 'phone', order: 54, group: 'life',
  component: defineAsyncComponent(() => import('./capture/CaptureApp.vue')),
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

export const profile = definePanel({
  id: 'profile', title: 'Profile', placement: 'sim-tab', order: 10, live: false,
  component: defineAsyncComponent(() => import('./sim/ProfileTab.vue')),
})

export const needs = definePanel({
  id: 'needs', title: 'Needs', placement: 'sim-tab', order: 20,
  component: defineAsyncComponent(() => import('./sim/NeedsTab.vue')),
})

export const skills = definePanel({
  id: 'skills', title: 'Skills', placement: 'sim-tab', order: 40,
  component: defineAsyncComponent(() => import('./sim/SkillsTab.vue')),
})

export const settings = definePanel({
  id: 'settings', title: 'Settings', placement: 'sim-tab', order: 70, phone: true, group: 'life',
  component: defineAsyncComponent(() => import('./sim/SettingsTab.vue')),
})

export const boutique = definePanel({
  id: 'boutique', title: 'Boutique', placement: 'phone', order: 32, group: 'life',
  component: defineAsyncComponent(() => import('./life/BoutiqueApp.vue')),
})

export const healthChip = definePanel({
  id: 'health-chip', title: 'Health', placement: 'hud', slot: 'alert', order: 6,
  component: defineAsyncComponent(() => import('./life/HealthChip.vue')),
})

export const weatherChip = definePanel({
  id: 'weather-chip', title: 'Weather', placement: 'hud', order: 6,
  component: defineAsyncComponent(() => import('./life/WeatherChip.vue')),
})

export const goalChip = definePanel({
  id: 'goal-chip', title: 'Current goal', icon: 'goals', placement: 'hud', slot: 'goal', order: 10,
  component: defineAsyncComponent(() => import('./life/GoalChip.vue')),
})

export const homeChip = definePanel({
  id: 'home-chip', title: 'Home', icon: 'home', placement: 'hud', order: 20,
  /** A room that could not be drawn is something to act on (Try again); otherwise the chip is information for the tray. */
  slot: () => (homeScene.status === 'error' ? 'alert' : 'hud'),
  component: defineAsyncComponent(() => import('./home/HomeChip.vue')),
})

export const buy = definePanel({
  id: 'buy', title: 'Buy', placement: 'nav',
  /** Buy is only available at home; elsewhere the nav button is disabled with this reason. */
  enabled: (state) => social.me?.visiting ? 'Leave the visit before rearranging your furniture' : state.stories?.running ? 'End your scene before rearranging furniture' : state.location === 'home' || 'Go home to buy furniture',
  component: defineAsyncComponent(() => import('./home/BuyMode.vue')),
})

export const NATIVE_PANELS: readonly VuePanel[] = [captureChip, landPanel, stories, storyChip, neighbourhoodPanel, capture, bank, messages, support, jobs, career, statement, invest, houses, cars, groceries, health, goals, profile, needs, skills, settings, boutique, healthChip, weatherChip, goalChip, homeChip, buy, ...CIVIC_APPS, ...CIVIC_HUD, ...GROWTH_PANELS, ...GROWTH_HUD_PANELS, ...TABLES_PANELS, ...GAMES_PANELS, ...CAMPUS_PANELS, ...WORLD_PANELS, ...SOCIAL_PANELS, ...START_PANELS, ...TRAVEL_PANELS, ...ACCOUNT_PANELS, ...BUSINESS_PANELS, ...COMMERCE_PANELS, ...POLITICS_PANELS, ...ADMIN_PANELS]
