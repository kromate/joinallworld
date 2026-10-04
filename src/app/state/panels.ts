// The panel registry of the new shell. It holds both kinds of panel behind one contract:
//   - every existing HTML-string panel (src/ui/panels/index.js), shown through LegacyPanel.vue
//   - Vue panels registered with definePanel()
// A Vue panel with the id of an existing panel takes its place, in the same position, so panels
// convert one at a time and nothing that lists panels (the Phone grid, the Sim tabs, the HUD
// slots) changes. `?legacy=bank,messages` (or `?legacy=all`) keeps the named existing panels in
// place of their Vue versions: the switch used to compare the two side by side.
import type { Component } from 'vue'
import type { Panel, PanelMeta, PanelPlacement, VuePanel } from '../types/panel.ts'
import { PANEL_PLACEMENTS, RESERVED_PANEL_IDS, isVuePanel } from '../types/panel.ts'

/**
 * Declare a Vue panel. The metadata is static — id, title, placement, group, badge — exactly as
 * for an existing panel, so it is listed before its component has been fetched.
 *
 *   export default definePanel({ id: 'bank', title: 'Bank', placement: 'phone', order: 14, group: 'money',
 *     badge: billsDue, component: defineAsyncComponent(() => import('./BankApp.vue')) })
 */
export function definePanel(panel: PanelMeta & { component: Component }): VuePanel {
  return { ...panel, kind: 'vue' }
}

/** Which existing panels stay in place of their Vue versions: from `?legacy=`. */
export function legacyChoice(search: string): { all: boolean; ids: Set<string> } {
  const value = new URLSearchParams(search).get('legacy')
  if (value === null) return { all: false, ids: new Set() }
  const ids = new Set(value.split(',').map((id) => id.trim()).filter(Boolean))
  return { all: ids.size === 0 || ids.has('all'), ids }
}

/**
 * One sorted list from the existing panels and the Vue panels. Validated the way the existing
 * registry validates (src/ui/panels/index.js buildPanels): a known placement, a unique id that is
 * not one of the shell's own.
 */
export function buildRegistry(legacy: readonly Panel[], native: readonly VuePanel[], keepLegacy: { all: boolean; ids: Set<string> } = { all: false, ids: new Set() }): Panel[] {
  const reserved: readonly string[] = RESERVED_PANEL_IDS
  const placements: readonly PanelPlacement[] = PANEL_PLACEMENTS
  const merged: Panel[] = [...legacy]
  for (const panel of native) {
    if (keepLegacy.all || keepLegacy.ids.has(panel.id)) continue
    const at = merged.findIndex((item) => item.id === panel.id)
    if (at >= 0) merged[at] = panel
    else merged.push(panel)
  }
  const ids = new Set<string>()
  for (const panel of merged) {
    const drawable = isVuePanel(panel) ? Boolean(panel.component) : typeof panel.render === 'function'
    if (typeof panel.id !== 'string' || !drawable || !placements.includes(panel.placement)) throw new Error(`Invalid panel: ${panel.id}`)
    if (ids.has(panel.id) || reserved.includes(panel.id)) throw new Error(`Duplicate or reserved panel id: ${panel.id}`)
    ids.add(panel.id)
  }
  return merged.map((panel, index) => ({ panel, index })).sort((a, b) => (a.panel.order ?? 100) - (b.panel.order ?? 100) || a.index - b.index).map((entry) => entry.panel)
}
