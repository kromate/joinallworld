// The growth panels as Vue panels: Missions, Events, Bring a friend, Stay in touch and the share
// sheet. The static metadata is exactly what the lazy group in src/ui/panels/index.js gives each
// id (plus the badge and notifications the adopted panel adds once its group has loaded); each
// component is fetched the first time it is opened. Only light modules are imported here.
//
// GROWTH_HUD_PANELS are the two HUD chips (away, social-inbox). They are Vue components too, but
// HudSidebar.vue lists only existing panels today (`!isVuePanel`), so registering them before it
// renders Vue chips would make them vanish from the HUD: add them to NATIVE_PANELS together with
// that change.
import { defineAsyncComponent } from 'vue'
import { definePanel } from '../../state/panels.ts'
import type { VuePanel } from '../../types/panel.ts'
import { social } from '../social/useSocial.ts'
import { notificationLines } from '../messages/messagesModel.ts'
import { noticeMarks } from '../messages/messageBadges.ts'
import { awayCardFor, awayWanted, inboxSlot } from './awayModel.ts'
import { upcomingEvents } from './rulesBoundary.ts'
import { eventsBadge, eventsNotifications } from './eventsModel.ts'
import { sharedGrowth } from './growthShared.ts'
import { missionsBadge, missionsNotifications } from './missionsModel.ts'
import { referBadge } from './referModel.ts'
import { bodyLoader } from '../../state/panelBody.ts'

/** App-icon colours for the growth apps (their glyphs arrive with the Phone). */
const TINTS = Object.freeze({ missions: '#256b45', events: '#b23a2e', refer: '#2b5fa8', touch: '#6a3fa0' })

export const missions = definePanel({
  id: 'missions', title: 'Missions', placement: 'phone', order: 11, group: 'life', tint: TINTS.missions,
  badge: (_state, view) => missionsBadge(view),
  notifications: (_state, view) => missionsNotifications(view),
  component: defineAsyncComponent(bodyLoader('growth/MissionsApp')),
})

export const events = definePanel({
  id: 'events', title: 'Events', placement: 'phone', order: 41, group: 'city', tint: TINTS.events,
  badge: (_state, view) => eventsBadge(view),
  notifications: (_state, view) => eventsNotifications(view, view.connected ? upcomingEvents(view.now, 7, view.cityId) : []),
  component: defineAsyncComponent(bodyLoader('growth/EventsApp')),
})

export const refer = definePanel({
  id: 'refer', title: 'Bring a friend', short: 'Friends', placement: 'phone', order: 39, group: 'people', tint: TINTS.refer,
  badge: () => referBadge(sharedGrowth.value?.state.hello?.referral),
  component: defineAsyncComponent(bodyLoader('growth/ReferApp')),
})

export const touch = definePanel({
  id: 'touch', title: 'Stay in touch', short: 'In touch', placement: 'phone', order: 94, group: 'life', tint: TINTS.touch, live: false,
  component: defineAsyncComponent(bodyLoader('growth/TouchApp')),
})

export const shareSheet = definePanel({
  id: 'share-sheet', title: 'Share', icon: 'people', placement: 'modal', live: false,
  component: defineAsyncComponent(bodyLoader('growth/ShareSheet')),
})

export const GROWTH_PANELS: readonly VuePanel[] = [missions, events, refer, touch, shareSheet]

// ---- HUD chips -------------------------------------------------------------------------------

export const away = definePanel({
  id: 'away', title: 'While you were away', icon: 'bell', placement: 'hud', order: 5,
  /** An alert while there is a card to show, else the tray. */
  slot: (_state, view) => {
    const growth = sharedGrowth.value
    if (!growth || !awayWanted(view)) return 'hud'
    const lines = notificationLines(social.me, { connected: view.connected, now: view.now, notices: view.social?.notices, seen: noticeMarks.seen(view.cityId) })
    return awayCardFor(view, growth.state.hello, growth.awayDismissed.value, lines) ? 'alert' : 'hud'
  },
  component: defineAsyncComponent(() => import('./AwayChip.vue')),
})

export const inbox = definePanel({
  id: 'social-inbox', title: 'Inbox', icon: 'messages', placement: 'hud', order: 30,
  /** Someone at the door cannot wait in the tray: a knock is shown as an alert. */
  slot: (_state, view) => inboxSlot(view.connected, social.me),
  component: defineAsyncComponent(() => import('./InboxChip.vue')),
})

export const GROWTH_HUD_PANELS: readonly VuePanel[] = [away, inbox]
