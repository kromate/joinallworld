<script setup lang="ts">
// The game shell: the scene fills the screen and everything else floats over it — the top bar,
// the needs strip with the goal line and the HUD chips, the venue panel (or the nav panel in
// front: Buy, the Map), the bottom nav, toasts, and one dialog for the Phone, the Sim sheet and
// modal panels.
//
// Every screen is a Vue component (src/app/features). See docs/MIGRATION-VUE-TS.md.
import '../ui/tokens.css'
// The page layout and the styles of every existing panel. Converted components carry their own.
import '../ui/shell.css'
// The compact layout of a phone (and a phone on its side), after the page layout it adjusts.
import '../ui/compact.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from './state/app.ts'
import { heldActionFor, shortcutFor } from '../ui/keys.ts'
import { start as startSocial, wakeSocket } from './features/social/useSocial.ts'
import GameIcon from './ui/GameIcon.vue'
import ToastStack from './ui/ToastStack.vue'
import LinkBanner from './features/landing/LinkBanner.vue'
import UpdateBanner from './ui/UpdateBanner.vue'
import NoticeHost from './features/notice/NoticeHost.vue'
import { useGrowth } from './features/growth/useGrowth.ts'
import CoachTip from './features/hud/CoachTip.vue'
import HudBar from './features/hud/HudBar.vue'
import HudSidebar from './features/hud/HudSidebar.vue'
import GuestBarSlot from './features/hud/GuestBarSlot.vue'
import ConnectionNotice from './features/hud/ConnectionNotice.vue'
import TourTrigger from './features/tour/TourTrigger.vue'
import CompanionHook from './features/companion/CompanionHook.vue'
import VenuePanel from './features/venue/VenuePanel.vue'
import ActionProgress from './features/venue/ActionProgress.vue'
import BottomNav from './features/nav/BottomNav.vue'
import PanelHost from './features/phone/PanelHost.vue'
import SheetHost from './features/phone/SheetHost.vue'
import { startLandingHold } from './state/landingHold.ts'
import { createPageLifecycle } from './state/pageLifecycle.ts'
import CommunityHost from './features/community/CommunityHost.vue'
import CallsHost from './features/calls/CallsHost.vue'
import PingHost from './features/ping/PingHost.vue'
import ScenePane from './scene/ScenePane.vue'
import MapPane from './scene/MapPane.vue'

const { game, ready, shell, api, community, scene, command, connect, quickStart, startLife, switchCity, menu, landing, showMapLayer } = useApp()
const ui = shell.ui
const mode = game.mode
const navPanel = computed(() => (mode.value !== 'venue' ? shell.byId.get(mode.value) ?? null : null))
const sheetOpen = computed(() => Boolean(shell.sheet.value))
const root = ref<HTMLElement | null>(null)
const bottom = ref<HTMLElement | null>(null)
const nav = ref<InstanceType<typeof BottomNav> | null>(null)
/** What covers the top of the scene: the top bar, and on a phone the needs strip under it. */
const topCover = (): (Element | null)[] => [root.value?.querySelector('.hud-bar') ?? null, window.innerWidth <= 720 ? root.value?.querySelector('.life-quick') ?? null : null]

const hudRows = (): (Element | null)[] => (window.innerWidth <= 720 ? ['.life-quick', '.life-alerts', '.life-goal'].map((selector) => root.value?.querySelector(selector) ?? null) : [])

// ---- keys ----------------------------------------------------------------------------------
// The same map as the existing shell (src/ui/keys.ts). Walking and the scene camera belong to the
// scene host: in the venue view with no sheet open the movement keys are forwarded as 'jaw:key'.
function onKey(event: KeyboardEvent): void {
  const target = event.target instanceof Element ? event.target : null
  const typing = target?.matches('input, textarea, select, [contenteditable]') ?? false
  if (typing && event.key !== 'Escape') return
  if (event.altKey && event.shiftKey && event.code === 'KeyA') { void import('./features/admin/adminProbe.ts').then((m) => m.adminKey((id) => shell.open(id))); return }
  const shortcut = shortcutFor(event)
  if (!shortcut) return
  const [verb = '', arg = ''] = shortcut.run.split(':')
  const lock = shell.lockOf()
  if (lock) { if (verb === 'close') { event.preventDefault(); game.toast(lock.reason) } return } // nothing but the required panel responds
  const open = sheetOpen.value
  if (verb === 'key') {
    if (event.key === 'Enter' && target?.matches('button, a, summary')) return
    shell.panelKeys(`key:${arg}`) || shell.panelKeys(arg)
    // In the venue view the arrows walk the avatar; they must not also scroll the spot rail.
    if (mode.value === 'venue' && !open && arg.startsWith('move-')) event.preventDefault()
    window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: arg, mode: open ? 'sheet' : mode.value, jog: event.shiftKey } }))
    return
  }
  if (verb === 'walk' || verb === 'look') {
    if (mode.value === 'venue' && !open) { if (arg !== 'jog') event.preventDefault(); window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: `${verb}-${arg}`, mode: mode.value, jog: event.shiftKey } })) }
    return
  }
  // Esc with a sheet open: SheetHost decides what it closes (a chat goes back to its list, an app to the home screen).
  if (open && verb === 'close') { event.preventDefault(); shell.escape.run?.(); return }
  if (open && verb !== 'open' && verb !== 'help') return
  if (verb === 'close') {
    if (shell.panelKeys('cancel')) { event.preventDefault(); return }
    if (mode.value !== 'venue') shell.close()
    else if (ui.trayOpen) ui.trayOpen = false
    else if (ui.clean) ui.clean = false
    else if (ui.expanded) ui.expanded = false
  } else if (verb === 'help') window.dispatchEvent(new CustomEvent('jaw:shortcuts', { detail: { from: 'key' } }))
  else if (verb === 'clean') { ui.clean = !ui.clean; ui.trayOpen = false }
  else if (verb === 'world') showMapLayer('world', { level: 0 })
  else if (verb === 'nav') nav.value?.navigate(arg, null)
  else if (verb === 'toggle') { if (mode.value === 'venue') { ui.clean = false; ui.expanded = !ui.expanded } }
  else if (verb === 'spot') {
    const spot = game.view.value.activities.spots[Number(arg) - 1]
    if (spot && mode.value === 'venue' && !game.state.value.activeAction) { ui.expanded = true; void command('spot', { id: spot.id }) }
  } else if (verb === 'open') {
    const now = shell.sheet.value
    const isOpen = now?.kind === arg || (now?.kind === 'panel' && now.id === arg) || (now?.kind === 'sim' && now.tab === arg) || mode.value === arg
    if (isOpen) shell.close(); else shell.open(arg)
  }
}
/** A movement or camera key was released: always forwarded, so a key can never stay "held" in the scene. */
function onKeyUp(event: KeyboardEvent): void { const action = heldActionFor(event); if (action) window.dispatchEvent(new CustomEvent('jaw:key-up', { detail: { action } })) }
/** The avatar walked up to a spot in the scene. Selecting it is still the server's `spot` action. */
function onSceneSpot(event: Event): void {
  const { id, open } = (event as CustomEvent<{ id?: string; open?: boolean }>).detail ?? {}
  const state = game.state.value, view = game.view.value
  if (!id || !view.connected || mode.value !== 'venue' || sheetOpen.value || state.activeAction || !view.activities.spots.some((spot) => spot.id === id)) return
  if (id === state.spot) { if (open) ui.expanded = true; return }
  if (open) ui.expanded = true
  void command('spot', { id })
}
// The same window events the existing panels send (the landing screen, the session panel, the world map).
const onStartLife = (event: Event): void => startLife((event as CustomEvent<{ name?: string | null }>).detail?.name ?? null)
// Play on the landing screen: the session is opened and the look it kept on the device is confirmed (state/app.ts).
const onQuickStart = (event: Event): void => { const detail = (event as CustomEvent<{ name?: string | null; city?: string }>).detail; void quickStart(detail?.name ?? null, detail?.city) }
const onReconnect = (): void => menu('reconnect')
const onSwitchCity = (event: Event): void => { const city = (event as CustomEvent<{ city?: string }>).detail?.city; if (city) void switchCity(city) }
// The device got its network back: try the connection once, by itself (an event, not a timer).
const onOnline = (): void => { if (!game.connected.value && (game.link.value === 'offline' || game.link.value === 'unreachable')) void connect() }
const lifecycle = createPageLifecycle(game, community)
const onPageHide = (): void => lifecycle.onPageHide()
// Restored from the back/forward cache: the socket was closed on pagehide, so bring the community back (voice stays off).
const onPageShow = (event: Event): void => lifecycle.onPageShow(event as PageTransitionEvent)
// In front again (the tab was hidden, the phone was locked): the life is read before anything else, and a socket that
// was lost meanwhile is opened now, so this device is not left showing what another one has since changed.
const onVisibility = (): void => { if (document.hidden) game.stop(); else { wakeSocket(); void game.wake() } }

const listeners: [EventTarget, string, EventListener][] = [
  [window, 'keydown', onKey as EventListener], [window, 'keyup', onKeyUp as EventListener], [window, 'jaw:scene-spot', onSceneSpot],
  [window, 'jaw:start-life', onStartLife], [window, 'jaw:quick-start', onQuickStart], [window, 'jaw:reconnect', onReconnect], [window, 'jaw:switch-city', onSwitchCity],
  [window, 'online', onOnline], [window, 'pagehide', onPageHide], [window, 'pageshow', onPageShow], [document, 'visibilitychange', onVisibility],
]
onMounted(() => {
  startLandingHold()
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener)
  // The social client reads who is here for the scene's crowd; it starts once connected (see state/app.ts).
  startSocial(api)
  void connect()
  if (new URLSearchParams(location.search).has('venue')) scene.mapsWanted.value = true
})
onBeforeUnmount(() => { for (const [target, type, listener] of listeners) target.removeEventListener(type, listener) })
// Connected (or connected again): the social client opens its socket and reads the overview.
// The social client also waits for a life that is not still held by character creation (its connected() says so), so a quick start that
// confirms the look a moment after connecting must start it again; otherwise the new player is not findable until a reload.
watch(() => game.connected.value && game.view.value.onboarding?.required !== true, (ready) => { if (ready) startSocial(api) })
// Where the page's share link came from, once the landing knows (growth.state.landing).
watch(landing.landed, (landed) => { if (landed) useGrowth().state.landing = landed })
watch(mode, (now) => document.body.classList.toggle('map-open', now === 'map'), { immediate: true })
</script>

<template>
  <ScenePane :top="topCover" :rows="hudRows" :bottom="() => bottom" :hidden="mode === 'map'" />
  <MapPane />
  <div id="life-overlay" ref="root" class="life-ui" :class="{ 'has-coach': ui.coaching, 'is-resuming': !ready, 'is-guest': Boolean(game.view.value.onboarding?.guest), 'is-clean': ui.clean, 'is-tray-open': ui.trayOpen, 'is-expanded': ui.expanded && mode === 'venue' }" :data-mode="mode">
    <p class="life-wordmark" aria-label="Allworld"><i aria-hidden="true"><GameIcon name="globe" :size="19" /></i><span><b>Allworld</b></span></p>
    <HudBar />
    <ConnectionNotice />
    <HudSidebar />
    <div ref="bottom" class="life-bottom">
      <div data-slot="notice"><NoticeHost /></div>
      <div data-slot="coach"><CoachTip /></div>
      <div data-slot="progress"><ActionProgress /></div>
      <div data-slot="main">
        <section v-if="navPanel" class="life-sheet" :aria-label="navPanel.title"><PanelHost :key="navPanel.id" :panel="navPanel" :params="shell.modeParams.value" /></section>
        <VenuePanel v-else />
      </div>
      <div data-slot="guest"><GuestBarSlot /></div>
      <BottomNav ref="nav" />
    </div>
  </div>
  <SheetHost />
  <TourTrigger />
  <CompanionHook />
  <CommunityHost />
  <CallsHost :host="sheetOpen ? '#life-dialog' : 'body'" />
  <PingHost :host="sheetOpen ? '#life-dialog' : 'body'" />
  <LinkBanner :banner="landing.banner.value" :host="sheetOpen ? '#life-dialog' : 'body'" @knock="landing.knock" @close="landing.dismiss" />
  <UpdateBanner />
  <ToastStack :host="sheetOpen ? '#life-dialog' : 'body'" />
</template>
