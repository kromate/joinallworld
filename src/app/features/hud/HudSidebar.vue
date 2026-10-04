<script setup lang="ts">
// The HUD column: the needs strip, More and Clean screen, then the HUD chips in their slots —
// alerts (something to act on now), the single goal line, and the tray behind More — and the More
// menu. The chips are panels with placement 'hud', of either kind: an existing panel through
// LegacyPanel, a Vue component as itself (HudChip.vue). A chip asks for attention by carrying the class `is-active`, which is
// counted into the badge on More.
//
// The column's layout still comes from the existing stylesheet (src/ui/shell.css, .life-sidebar
// and below): it moves into this component when the chips it lays out are converted.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { HudSlot, Panel } from '../../types/panel.ts'
import { useApp } from '../../state/app.ts'
import HudChip from './HudChip.vue'
import GameIcon from '../../ui/GameIcon.vue'
import NeedsStrip from './NeedsStrip.vue'
import { linkWording } from './hudModel.ts'

const { game, shell, menu, community } = useApp()
const ui = shell.ui
const view = game.view
const SLOTS: readonly HudSlot[] = ['alert', 'goal', 'hud']
const chips = shell.placed('hud')
/** Where a chip goes right now: a panel may decide per state (a knock at the door is an alert, an empty inbox is not). */
function slotOf(panel: Panel): HudSlot {
  void shell.legacyTick.value
  try { return (typeof panel.slot === 'function' ? panel.slot(game.state.value, shell.viewFor()) : panel.slot) ?? 'hud' } catch { return 'hud' }
}
const bySlot = computed(() => Object.fromEntries(SLOTS.map((slot) => [slot, chips.filter((panel) => slotOf(panel) === slot)])) as Record<HudSlot, Panel[]>)
/** A chip that rendered nothing takes no room. */
const empty = reactive<Record<string, boolean>>({})
const tray = ref<HTMLElement | null>(null)
const waiting = ref(0)
function onRendered(id: string, isEmpty: boolean): void {
  empty[id] = isEmpty
  void nextTick(() => { waiting.value = tray.value?.querySelectorAll('.is-active').length ?? 0 })
}
/** Vue chips draw into the tray themselves (a chip with nothing to say renders a comment), so the count is taken after any of them may have changed. */
function recount(): void { void nextTick(() => { waiting.value = tray.value?.querySelectorAll('.is-active').length ?? 0 }) }
watch([game.state, shell.legacyTick], recount, { flush: 'post' })
onMounted(recount)
const link = computed(() => linkWording(view.value))
const atHome = computed(() => game.state.value.location === 'home')

const root = ref<HTMLElement | null>(null)
/** A tap anywhere outside the column closes the tray. */
function onOutside(event: PointerEvent): void { if (ui.trayOpen && event.target instanceof Node && !root.value?.contains(event.target)) ui.trayOpen = false }
onMounted(() => document.addEventListener('pointerdown', onOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
function pick(id: string): void { ui.trayOpen = false; menu(id) }
</script>

<template>
  <aside ref="root" class="life-sidebar" aria-label="Needs, goal and more">
    <div class="life-quick">
      <NeedsStrip v-if="!ui.clean" />
      <button v-if="!ui.clean" class="life-round" type="button" :aria-expanded="ui.trayOpen" aria-controls="life-tray" :aria-label="`More: weather, messages, city and help${waiting ? `. ${waiting} waiting` : ''}`" title="More" @click="ui.trayOpen = !ui.trayOpen">
        <GameIcon name="menu" /><b v-if="waiting" class="life-badge">{{ waiting }}</b>
      </button>
      <button class="life-round" type="button" :aria-pressed="ui.clean" aria-label="Clean screen: hide the panels and show only the scene" :title="ui.clean ? 'Show the panels again (X)' : 'Clean screen (X)'" @click="ui.clean = !ui.clean; ui.trayOpen = false">
        <GameIcon :name="ui.clean ? 'eye-off' : 'eye'" />
      </button>
    </div>
    <template v-if="!ui.clean">
      <div class="life-alerts"><HudChip v-for="panel in bySlot.alert" v-show="!empty[panel.id]" :key="panel.id" :panel="panel" @rendered="onRendered(panel.id, $event)" /></div>
      <div class="life-goal"><HudChip v-for="panel in bySlot.goal" v-show="!empty[panel.id]" :key="panel.id" :panel="panel" @rendered="onRendered(panel.id, $event)" /></div>
      <div id="life-tray" class="life-tray">
        <div ref="tray" class="life-hud"><HudChip v-for="panel in bySlot.hud" v-show="!empty[panel.id]" :key="panel.id" :panel="panel" @rendered="onRendered(panel.id, $event)" /></div>
        <div class="life-menu">
          <p class="life-brand"><strong><span>Allworld</span></strong><small>{{ link ? link.menu : 'City beta' }}</small></p>
          <button type="button" @click="pick('city')"><span aria-hidden="true"><GameIcon name="globe" :size="19" /></span><span><b>{{ view.city?.name || 'City' }}</b><small>Switch city on the world map</small></span></button>
          <button type="button" @click="ui.trayOpen = false; community.toggle(true)"><span aria-hidden="true"><GameIcon name="community" :size="19" /></span><span><b>Community</b><small>{{ atHome ? 'Home is private — visit a venue to chat' : 'People, chat and voice at this venue' }}</small></span></button>
          <button type="button" @click="shell.open('help')"><span aria-hidden="true"><GameIcon name="help" :size="19" /></span><span><b>How to play</b><small>Tips and keyboard shortcuts</small></span></button>
          <p class="life-net" :class="{ 'is-error': view.net.error }" role="status">{{ view.net.text }}</p>
          <button v-if="link?.tone === 'off'" class="life-menu-retry" type="button" @click="pick('reconnect')">Try again</button>
        </div>
      </div>
    </template>
  </aside>
</template>
