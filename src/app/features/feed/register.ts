// The feed's phone apps (docs/FEED.md): Feed, My profile, Crews, Plans and Work. Only light modules here: each component is fetched the
// first time it opens. The Feed's badge is its inbox (feedBadge.ts, fed by the social socket).
import { phonePanel } from '../../state/panelFactories.ts'
import type { VuePanel } from '../../types/panel.ts'
import { feedUnseen } from './feedBadge.ts'
import { bodyLoader } from '../../state/panelBody.ts'

export const feed = phonePanel('feed', 'Feed', bodyLoader('feed/FeedApp'), { icon: 'megaphone', order: 11.4, group: 'people', badge: () => feedUnseen.value })
export const me = phonePanel('me', 'My profile', bodyLoader('feed/MeApp'), { icon: 'people', order: 11.45, group: 'people' })
export const crews = phonePanel('crews', 'Communities', bodyLoader('feed/CrewsApp'), { icon: 'people', order: 11.7, group: 'people' })
export const plans = phonePanel('plans', 'Plans', bodyLoader('feed/PlansApp'), { icon: 'sparkles', order: 11.8, group: 'people' })
export const work = phonePanel('work', 'Work', bodyLoader('feed/WorkApp'), { icon: 'goals', order: 10.5, group: 'money' })

/** Allworld for Business (docs/PROMOTE.md): the city's businesses, free listing, cheap boosts. */
export const promote = phonePanel('promote', 'Businesses', bodyLoader('promote/BusinessesApp'), { icon: 'shop', order: 13.4, group: 'money' })

/** Earn (docs/EARN.md): real money through Bachs, paid by buyers directly, and the creator pool. */
export const earn = phonePanel('earn', 'Earn', bodyLoader('earn/EarnApp'), { icon: 'wallet', order: 10.4, group: 'money' })

export const FEED_PANELS: readonly VuePanel[] = [feed, me, crews, plans, work, promote, earn]
