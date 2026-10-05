// The panel registry: every panel is a Vue component declared with definePanel(), listed here by
// its static metadata (id, title, placement, group, badge) before its component has been fetched.
import type { Component } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { Panel, PanelMeta, PanelPlacement, VuePanel } from '../types/panel.ts'
import { PANEL_PLACEMENTS, RESERVED_PANEL_IDS } from '../types/panel.ts'

/**
 * Declare a Vue panel. The metadata is static — id, title, placement, group, badge — so the panel is
 * listed (in the Phone grid, the Sim tabs, the HUD slots) before its component has been fetched.
 *
 *   export default definePanel({ id: 'bank', title: 'Bank', placement: 'phone', order: 14, group: 'money',
 *     badge: billsDue, component: defineAsyncComponent(() => import('./BankApp.vue')) })
 */
export function definePanel(panel: PanelMeta & { component: Component }): VuePanel {
  return { ...panel, kind: 'vue' }
}

/**
 * One sorted list of the panels, validated: a known placement, a unique id that is not one of the
 * shell's own.
 */
export function buildRegistry(panels: readonly VuePanel[], state?: () => LifeState): Panel[] {
  const reserved: readonly string[] = RESERVED_PANEL_IDS
  const placements: readonly PanelPlacement[] = PANEL_PLACEMENTS
  const ids = new Set<string>()
  for (const panel of panels) {
    if (typeof panel.id !== 'string' || !panel.component || !placements.includes(panel.placement)) throw new Error(`Invalid panel: ${panel.id}`)
    if (ids.has(panel.id) || reserved.includes(panel.id)) throw new Error(`Duplicate or reserved panel id: ${panel.id}`)
    ids.add(panel.id)
  }
  return panels.map((panel, index) => ({ panel, index })).sort((a, b) => (a.panel.order ?? 100) - (b.panel.order ?? 100) || a.index - b.index).map(({ panel }) => state && panel.titleFor ? { ...panel, get title() { return panel.titleFor!(state()) } } : panel)
}
