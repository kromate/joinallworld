// The in-game Phone's home screen, worked out from the panel registry. Pure: the same lists for
// existing panels and Vue panels, tested without a browser.
import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { LifeState } from '../../../types/life.ts'
import type { Panel, PanelView, PhoneGroup, PhoneNotification } from '../../types/panel.ts'

/** The four apps in the dock, in order. */
export const DOCK: readonly string[] = ['messages', 'jobs', 'bank', 'ride']
export const PAGES: readonly { label: string; groups: readonly (readonly [PhoneGroup, string])[] }[] = [
  { label: 'Life and money', groups: [['life', 'Life'], ['money', 'Money']] },
  { label: 'People and city', groups: [['people', 'People'], ['city', 'City']] },
]
export const SHADE_MAX = 14

/** An icon on the home screen: a panel, or one of the phone's own two entries. */
export interface PhoneApp { id: string; title: string; short?: string; group?: PhoneGroup; tint?: string; panel?: Panel; builtIn?: 'community' | 'help' }
const BUILT_INS: readonly PhoneApp[] = [
  { id: 'community', title: 'Community', group: 'city', builtIn: 'community' },
  { id: 'help', title: 'Help', group: 'life', builtIn: 'help' },
]

/** Every app the phone lists: Phone apps, and Sim tabs that are also apps (`phone: true`). */
export const listedApps = (panels: readonly Panel[]): PhoneApp[] => panels.filter((panel) => (panel.placement === 'phone' || panel.phone === true) && !panel.hidden?.())
  .map((panel) => ({ id: panel.id, title: panel.title, short: panel.short, group: panel.group, tint: panel.tint, panel }))

export interface PhonePage { label: string; groups: { id: PhoneGroup; label: string; apps: PhoneApp[] }[] }
/** The icon pages. An app with no group (or one this build does not know) still gets a place: with the first page's first group. */
export function phonePages(panels: readonly Panel[]): PhonePage[] {
  const apps = [...listedApps(panels), ...BUILT_INS].filter((app) => !DOCK.includes(app.id))
  const known = PAGES.flatMap((page) => page.groups.map(([id]) => id))
  return PAGES.map((page, index) => ({
    label: page.label,
    groups: page.groups.map(([id, label]) => ({
      id, label,
      apps: apps.filter((app) => app.group === id || (index === 0 && id === page.groups[0]?.[0] && !(app.group && known.includes(app.group)))),
    })).filter((group) => group.apps.length > 0),
  }))
}
export const dockApps = (panels: readonly Panel[]): PhoneApp[] => {
  const apps = listedApps(panels)
  return DOCK.map((id) => apps.find((app) => app.id === id) ?? panels.filter((panel) => panel.id === id).map((panel) => ({ id: panel.id, title: panel.title, short: panel.short, group: panel.group, tint: panel.tint, panel }))[0])
    .filter((app): app is PhoneApp => Boolean(app))
}

/** The red badge on an icon: a count ('99+' above 99) or a short word; '' for none. A badge that throws is no badge. */
export function badgeText(panel: Panel | undefined, state: LifeState, view: PanelView): string {
  let value: number | string | false | null | undefined = null
  try { value = panel?.badge?.(state, view) } catch (error) { console.error(`Badge of ${panel?.id} failed:`, error) }
  if (!value) return ''
  return typeof value === 'number' ? (value > 99 ? '99+' : String(Math.floor(value))) : String(value).slice(0, 3)
}

/** Every panel's notification lines, newest first. */
export function notificationsOf(panels: readonly Panel[], state: LifeState, view: PanelView): PhoneNotification[] {
  const lines: PhoneNotification[] = []
  for (const panel of panels) {
    if (typeof panel.notifications !== 'function') continue
    try { lines.push(...(panel.notifications(state, view) ?? [])) } catch (error) { console.error(`Notifications of ${panel.id} failed:`, error) }
  }
  return lines.filter((line) => line && line.text).sort((a, b) => (b.at || 0) - (a.at || 0))
}

/** The battery is the Sim's Energy. */
export function battery(energy: number | undefined): { level: number; tone: '' | 'is-mid' | 'is-low' } {
  const level = Math.max(0, Math.min(100, Math.round(energy ?? 0)))
  return { level, tone: level <= 15 ? 'is-low' : level <= 35 ? 'is-mid' : '' }
}

/**
 * Whether a sheet that holds per-identity state must be rebuilt when the identity or the city under it changes.
 * Going from a session (or a city) to a different one is a real switch: sign-in, sign-out, travel. The first session
 * given to a visitor who had none, and a city chosen while there was still no session, are the visitor's own
 * start (the character creator's Play) and leave an open sheet alone.
 */
export function scopeSwitched(before: { session: string | null; city: string }, after: { session: string | null; city: string }): boolean {
  if (before.session !== null && after.session !== before.session) return true
  return before.session !== null && after.city !== before.city
}
/** A number that changes exactly when `scopeSwitched` says so: the key of the sheet's body. */
export function useSheetScope(session: Ref<string | null>, city: Ref<string>): Ref<number> {
  const epoch = ref(0)
  watch([session, city], ([id, now], [wasId, was]) => { if (scopeSwitched({ session: wasId, city: was }, { session: id, city: now })) epoch.value += 1 })
  return epoch
}
