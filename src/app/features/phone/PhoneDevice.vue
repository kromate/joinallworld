<script setup lang="ts">
// The in-game Phone: the device, its home screen and the frame every app opens in.
//
// The shell decides WHICH sheet is open; this component draws it when that sheet belongs in the
// phone: the home screen, a panel opened as an app, and Help. An app is any panel — a Vue
// component or an existing HTML-string panel — and the home screen lists both from the same
// static metadata, so an app is on the grid before any of its code has been downloaded.
//
// Nothing runs while idle: the clock, the battery and the badges are recomputed only when a state
// arrives or the phone is opened. Opening, paging and closing the phone draw no scene frame.
//
// The device's look (bezel, wallpaper, pages, dock) still comes from src/ui/phone/phone.css, and
// existing apps are styled against its class names; it moves into this file when they are converted.
import '../../../ui/phone/phone.css'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { glyphFor } from '../../../ui/phone/icons.ts'
import { checkReports } from '../../../ui/phone/reports.ts'
import { getWallpaper } from '../../../ui/phone/wallpapers.ts'
import { tintOf } from '../../../ui/phone/icons-more.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HelpBody from '../help/HelpBody.vue'
import PanelHost from './PanelHost.vue'
import { PAGES, SHADE_MAX, badgeText, battery, dockApps, notificationsOf, phonePages } from './phoneModel.ts'
import type { PhoneApp } from './phoneModel.ts'

const { game, shell, api, community } = useApp()
const state = game.state
const lagos = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', ...options })
const TIME = lagos({ hour: '2-digit', minute: '2-digit', hour12: false })
const DATE = lagos({ weekday: 'long', day: 'numeric', month: 'long' })
const STAMP = lagos({ weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

/** The view the badges read. Existing panels keep state Vue cannot see, so their refresh() is followed too. */
const view = computed(() => { void shell.legacyTick.value; return shell.viewFor() })
const now = computed(() => new Date(view.value.now))
const power = computed(() => battery(state.value.needs?.energy))
const pages = computed(() => phonePages(shell.panels))
const dock = dockApps(shell.panels)
const badges = computed(() => { const current = view.value; return Object.fromEntries(shell.panels.map((panel) => [panel.id, badgeText(panel, state.value, current)])) as Record<string, string> })
const notes = computed(() => notificationsOf(shell.panels, state.value, view.value))
const freshNotes = computed(() => notes.value.filter((line) => line.fresh).length)

// ---- which view: home, the notification shade, or an app ------------------------------------
const sheet = shell.sheet
const app = computed<{ id: string; title: string; help: boolean } | null>(() => {
  const open = sheet.value
  if (open?.kind === 'help') return { id: 'help', title: 'Help', help: true }
  if (open?.kind !== 'panel') return null
  const panel = shell.byId.get(open.id)
  return panel ? { id: panel.id, title: panel.title, help: false } : null
})
const appPanel = computed(() => (app.value && !app.value.help ? shell.byId.get(app.value.id) ?? null : null))
const appParams = computed(() => (sheet.value?.kind === 'panel' ? sheet.value.params : null))
const tint = computed(() => (app.value ? tintOf(appPanel.value ?? { id: app.value.id }) : undefined))
const shade = ref(false)
const wide = ref(false)
const page = ref(0)
const lastApp = ref<string | null>(null)

const device = ref<HTMLElement | null>(null)
const pagesBox = ref<HTMLElement | null>(null)
const appBody = ref<HTMLElement | null>(null)
function goPage(next: number): void {
  page.value = Math.max(0, Math.min(PAGES.length - 1, next))
  const target = pagesBox.value?.children[page.value]
  if (target instanceof HTMLElement) pagesBox.value?.scrollTo({ left: target.offsetLeft, behavior: 'auto' })
}
/** The page in view after a swipe: only the dots change. Fires on user scrolling, never on a timer. */
function onScroll(): void {
  const box = pagesBox.value
  if (box) page.value = Math.max(0, Math.min(PAGES.length - 1, Math.round(box.scrollLeft / (box.clientWidth || 1))))
}

/** Keyboard focus follows the view: the back button in an app, the app's own icon back on the home screen. */
function focusView(): void {
  const root = device.value
  if (!root) return
  if (app.value) { root.querySelector<HTMLElement>('.ph-back')?.focus({ preventScroll: true }); return }
  const wanted = lastApp.value
  const icon = (wanted ? root.querySelector<HTMLElement>(`.ph-home [data-ph-app="${CSS.escape(wanted)}"]`) : null) ?? root.querySelector<HTMLElement>('.ph-dock .ph-appbtn') ?? root.querySelector<HTMLElement>('.ph-appbtn')
  const owner = icon?.closest<HTMLElement>('[data-ph-page]')
  if (owner) goPage(Number(owner.dataset.phPage))
  icon?.focus({ preventScroll: true })
  // The home screen may still be on its way back in (it is not focusable until its transition
  // starts): if the focus did not land, it is tried once more on the next frame. One frame, not a loop.
  if (icon && document.activeElement !== icon) requestAnimationFrame(() => { if (!app.value && !shade.value) icon.focus({ preventScroll: true }) })
}
watch(() => app.value?.id ?? '', (id) => {
  if (id) { lastApp.value = id; shade.value = false }
  void nextTick(() => { if (id && appBody.value) appBody.value.scrollTop = 0; focusView() })
})
onMounted(() => {
  void import('../admin/adminProbe.ts').then((m) => m.probeAdmin())
  // Opening the phone is the moment to look for a moderator's reply to a report (at most once a minute).
  checkReports(api)
  void nextTick(focusView)
})
function setShade(next: boolean): void {
  shade.value = next
  void nextTick(() => device.value?.querySelector<HTMLElement>(next ? '.ph-shade button' : '.ph-notifs button')?.focus())
}

function openApp(item: PhoneApp): void {
  if (item.builtIn === 'community') { shell.closeSheet(); community.toggle(true); return }
  shell.open(item.id)
}
function openNote(line: { app: string; open?: string; params?: unknown }): void { shell.open(line.open || line.app, line.params) }

/** Arrow keys on the home screen move between icons by where they are on screen; past the edge of a page, turn it. */
function moveFocus(direction: 'left' | 'right' | 'up' | 'down'): void {
  const root = device.value, box = pagesBox.value
  if (!root || !box) return
  const current = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.ph-appbtn') : null
  const pool = [...(box.children[page.value]?.querySelectorAll<HTMLElement>('.ph-appbtn') ?? []), ...root.querySelectorAll<HTMLElement>('.ph-dock .ph-appbtn')]
  if (!current || !pool.includes(current)) { pool[0]?.focus(); return }
  const from = current.getBoundingClientRect()
  const [dx, dy] = ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const)[direction]
  let best: HTMLElement | null = null, bestScore = Infinity
  for (const node of pool) {
    if (node === current) continue
    const rect = node.getBoundingClientRect()
    const along = (rect.left - from.left) * dx + (rect.top - from.top) * dy
    const across = Math.abs((rect.left - from.left) * dy) + Math.abs((rect.top - from.top) * dx)
    // Left/right stay in the row; up/down prefer the same column.
    if (along < 8 || (dx && across > from.height / 2)) continue
    const score = along + across * 3
    if (score < bestScore) { best = node; bestScore = score }
  }
  if (best) { best.focus(); return }
  if (dx && !current.hasAttribute('data-ph-dock')) {
    const next = page.value + dx
    if (next < 0 || next >= PAGES.length) return
    goPage(next)
    // Arrive on the row nearest to the one just left.
    let target: HTMLElement | null = null, gap = Infinity
    for (const node of box.children[next]?.querySelectorAll<HTMLElement>('.ph-appbtn') ?? []) {
      const distance = Math.abs(node.getBoundingClientRect().top - from.top)
      if (distance < gap || (distance === gap && dx < 0)) { target = node; gap = distance }
    }
    target?.focus({ preventScroll: true })
  }
}
function onKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const arrow = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowLeft']
  if (!arrow) return
  // Arrows belong to the phone while it is open: on the home screen they move between icons, in
  // an app they scroll or move the caret as usual. They never reach the scene behind.
  event.stopPropagation()
  if (app.value || shade.value || (event.target instanceof Element && event.target.matches('input, textarea, select'))) return
  event.preventDefault()
  moveFocus(arrow)
}

defineExpose({
  /** Esc / the back gesture: shade → app → home → closed. True when the phone used it. */
  back(): boolean {
    if (shade.value) { setShade(false); return true }
    shell.phoneBack()
    return true
  },
})
</script>

<template>
  <div class="ph-stage" @click.self="shell.close()" @keydown="onKeydown">
    <button class="ph-close" type="button" aria-label="Close the phone" @click="shell.close()"><GameIcon bare name="close" /><span>Close</span></button>
    <div ref="device" class="ph" :class="{ 'is-shade': shade, 'is-wide': wide && Boolean(app) }" :data-view="app ? 'app' : 'home'" :data-wall="getWallpaper()" role="group" aria-label="Phone" :style="tint ? { '--app-tint': tint } : undefined">
      <div class="ph-screen">
        <div class="ph-wallpaper" aria-hidden="true" />
        <header class="ph-status">
          <button class="ph-status-btn" type="button" :aria-label="`Notifications. Nigerian time ${TIME.format(now)}`" @click="setShade(!shade)">{{ TIME.format(now) }}</button>
          <span class="ph-sys">
            <span class="ph-signal" :class="{ 'is-off': !view.connected }" role="img" :aria-label="view.connected ? 'Connected to the game server' : 'No connection to the game server'"><i /><i /><i /><i /></span><b>{{ view.connected ? '4G' : 'No service' }}</b>
            <span class="ph-batt" :class="power.tone" role="img" :aria-label="`Battery: your Sim’s Energy is ${power.level}%`" :style="{ '--level': `${power.level}%` }"><i /></span><b>{{ power.level }}%</b>
          </span>
        </header>
        <div class="ph-island" aria-hidden="true" />

        <section class="ph-home" aria-label="Home screen" :inert="Boolean(app) || shade">
          <div class="ph-clock"><b>{{ TIME.format(now) }}</b><span>{{ DATE.format(now) }} · {{ view.city?.name || 'Lagos' }}</span></div>
          <div class="ph-notifs">
            <template v-if="notes[0]">
              <button class="ph-note is-compact" :class="{ 'is-fresh': notes[0].fresh }" type="button" @click="openNote(notes[0])">
                <span class="ph-icon" :style="{ '--tint': tintOf(shell.byId.get(notes[0].app) ?? { id: notes[0].app }) }"><GameIcon bare :name="glyphFor(notes[0].app)" /></span>
                <span><small>{{ shell.byId.get(notes[0].app)?.title ?? 'Update' }}<template v-if="notes[0].at"> · {{ STAMP.format(new Date(notes[0].at)) }}</template><template v-if="notes[0].fresh"> · New</template></small><b>{{ notes[0].text }}</b></span>
              </button>
              <button v-if="notes.length > 1" class="ph-more" type="button" :aria-expanded="shade" :aria-label="`Show all ${notes.length} notifications`" @click="setShade(!shade)"><GameIcon bare name="bell" /><span><template v-if="freshNotes > 1">{{ freshNotes }} new · </template>{{ notes.length - 1 }} more</span></button>
            </template>
          </div>
          <div ref="pagesBox" class="ph-pages" data-tour="phone-apps" @scroll.passive="onScroll">
            <section v-for="(item, index) in pages" :key="item.label" class="ph-page" :data-ph-page="index" :aria-label="item.label">
              <template v-for="group in item.groups" :key="group.id">
                <h3 class="ph-group">{{ group.label }}</h3>
                <div class="ph-grid">
                  <button v-for="entry in group.apps" :key="entry.id" class="ph-appbtn" :class="{ 'is-running': lastApp === entry.id }" type="button" :data-ph-app="entry.id" :aria-label="`${entry.title}${badges[entry.id] ? `, ${badges[entry.id]} new` : ''}`" @click="openApp(entry)">
                    <span class="ph-icon" :style="{ '--tint': tintOf(entry) }"><GameIcon bare :name="glyphFor(entry.id)" /></span><b v-if="badges[entry.id]" class="ph-badge" aria-hidden="true">{{ badges[entry.id] }}</b><span class="ph-label">{{ entry.short || entry.title }}</span>
                  </button>
                </div>
              </template>
            </section>
          </div>
          <div class="ph-dots" role="group" aria-label="Home screen pages">
            <button v-for="(item, index) in pages" :key="item.label" type="button" :aria-label="`Page ${index + 1} of ${pages.length}: ${item.label}`" :aria-current="index === page ? 'true' : undefined" @click="goPage(index)" />
          </div>
          <div class="ph-dock" data-tour="phone-dock" role="group" aria-label="Dock">
            <button v-for="entry in dock" :key="entry.id" class="ph-appbtn" :class="{ 'is-running': lastApp === entry.id }" type="button" data-ph-dock :data-ph-app="entry.id" :aria-label="`${entry.title}${badges[entry.id] ? `, ${badges[entry.id]} new` : ''}`" @click="openApp(entry)">
              <span class="ph-icon" :style="{ '--tint': tintOf(entry) }"><GameIcon bare :name="glyphFor(entry.id)" /></span><b v-if="badges[entry.id]" class="ph-badge" aria-hidden="true">{{ badges[entry.id] }}</b><span class="ph-label">{{ entry.short || entry.title }}</span>
            </button>
          </div>
        </section>

        <section class="ph-shade" aria-label="Notifications" :inert="!shade">
          <header><h2>Notifications</h2><button class="ph-shade-close" type="button" aria-label="Close notifications" @click="setShade(false)"><GameIcon bare name="close" /></button></header>
          <div class="ph-shade-list">
            <button v-for="line in notes.slice(0, SHADE_MAX)" :key="line.id" class="ph-note" :class="{ 'is-fresh': line.fresh }" type="button" @click="openNote(line)">
              <span class="ph-icon" :style="{ '--tint': tintOf(shell.byId.get(line.app) ?? { id: line.app }) }"><GameIcon bare :name="glyphFor(line.app)" /></span>
              <span><small>{{ shell.byId.get(line.app)?.title ?? 'Update' }}<template v-if="line.at"> · {{ STAMP.format(new Date(line.at)) }}</template><template v-if="line.fresh"> · New</template></small><b>{{ line.text }}</b></span>
            </button>
            <div v-if="!notes.length" class="ph-shade-empty"><GameIcon bare name="bell" /><p><b>No notifications</b>Rent and loan notices, messages, knocks at your door and city news land here.</p></div>
          </div>
          <button v-if="notes.length" class="ph-shade-all" type="button" @click="shell.open('messages', { tab: 'updates' })">Open all Updates</button>
        </section>

        <section class="ph-app" :aria-label="app?.title" :inert="!app">
          <header class="ph-appbar">
            <template v-if="app">
              <button class="ph-back" type="button" aria-label="Back to the home screen" @click="shell.open('phone')"><GameIcon bare name="back" /></button>
              <span class="ph-bar-icon" aria-hidden="true"><GameIcon bare :name="glyphFor(app.id)" /></span>
              <h2>{{ app.title }}</h2>
              <button class="ph-wide" type="button" :aria-pressed="wide" :aria-label="wide ? 'Make the phone narrower' : 'Make the phone wider'" :title="wide ? 'Narrower' : 'Wider'" @click="wide = !wide"><GameIcon bare :name="wide ? 'shrink' : 'expand'" /></button>
            </template>
          </header>
          <div ref="appBody" class="ph-appbody sheet-body">
            <HelpBody v-if="app?.help" />
            <PanelHost v-else-if="appPanel" :key="appPanel.id" :panel="appPanel" :params="appParams" />
          </div>
        </section>
        <button class="ph-homebar" type="button" aria-label="Home screen" tabindex="-1" @click="shell.open('phone')" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A Vue app that wants the whole app area (a chat: its own header, a scrolling thread, a pinned composer) marks its root `panel-fill`. */
.ph-appbody:has(> :deep(.panel-fill)) { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.ph-appbody > :deep(.panel-fill) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
