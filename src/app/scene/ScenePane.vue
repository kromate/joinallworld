<script setup lang="ts">
// The venue scene: hosts the existing Three.js scene host (src/venue-world.ts) through its own
// API. The host owns the canvas, the camera and the name tags; this component owns nothing but
// the element it draws into and the moment it is created and disposed.
//
// NO RENDER LOOP WHILE IDLE. The host draws on demand, and this pane never asks for a frame of its
// own accord: it forwards a new server state, the player's look and the crowd from the store
// (state/app.ts does that, once per accepted state), and tells the host how much of the canvas the
// HUD covers when — and only when — a HUD element changed size. A Vue re-render alone calls
// nothing on the host. `?diagnostics` shows the host's frame count; it stays flat while the game
// is idle.
//
// Three.js and every scene module are fetched after the HUD is on screen. A device that cannot
// draw the scene still gets the whole game.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../state/app.ts'
import { loadSceneWorld } from './loaders.ts'
import { telemetry } from '../../telemetry/index.ts'

const props = defineProps<{
  /** Elements whose bottom edge marks how far the HUD covers the top of the scene. */
  top: () => (Element | null)[]
  /** The element whose top edge marks how far the HUD covers the bottom. */
  bottom: () => Element | null
  /** On a phone: the HUD rows under the top bar. Empty on a wide screen. */
  rows: () => (Element | null)[]
  hidden: boolean
}>()
const { game, shell, scene, showPlayer, showCrowd, showGoal, reportPlace, onMove, commitSpot, goTo } = useApp()
const container = ref<HTMLElement | null>(null)
const failed = ref(false)
const waiting = ref(true)
let observer: ResizeObserver | null = null
let disposed = false

/** Tell the scene how much of the screen the HUD covers, so it draws itself in the free part. The host redraws only if the snapped values changed. */
function layout(): void {
  const venue = scene.venue.value, box = container.value
  if (!venue || !box || game.mode.value === 'map') return
  const page = box.getBoundingClientRect()
  const covered = Math.max(page.top, ...props.top().map((node) => node?.getBoundingClientRect().bottom ?? page.top))
  const stack = props.bottom()?.getBoundingClientRect()
  // On a phone the rows under the top bar (needs, alerts, the goal line) are the HUD's: the scene's one-time hint sits under the last of them.
  const rows = Math.max(0, ...props.rows().map((node) => { const row = node?.getBoundingClientRect(); return row?.height ? row.bottom : 0 }))
  venue.setInsets({ top: covered - page.top, bottom: stack?.height ? page.bottom - stack.top : 0, hint: rows ? rows - page.top : 0 })
}
const onResize = (): void => { if (game.mode.value !== 'map') scene.venue.value?.resize() }

onMounted(() => {
  // After the first paint: the scene starts downloading with the HUD already on screen and usable.
  setTimeout(async () => {
    try {
      const createVenueWorld = await loadSceneWorld()
      if (disposed || !container.value) return
      const venue = createVenueWorld(container.value, { location: game.state.value.location, onTag(tag) {
        // A name tag opens that person's card: a regular (npc:<id>) or a real player (public id).
        if (tag.kind === 'goal') void goTo(game.state.value.location, tag.id.replace(/^goal:/, ''))
        // A game table in the venue (walked up to, or tapped): the Tables app opens on that table — sit, watch or invite.
        else if (tag.kind === 'table') shell.open('tables', { table: tag.id.replace(/^table:/, '') })
        else if (tag.kind === 'npc') shell.open('person', { npc: tag.id.replace(/^npc:/, '') })
        else if (tag.kind === 'player') shell.open('person', { player: tag.id })
      },
      // The avatar moved: that is where the player stands in the room (presence, and so proximity voice).
      onMove,
      // The campus: its host walks the avatar to a landmark and then asks for the game's ordinary `spot` action; its shuttle runs on server time.
      commitSpot: ({ id }: { id: string }) => commitSpot(id), now: () => game.serverNow(),
      onHost: () => { layout(); reportPlace() } })
      scene.venue.value = venue
      waiting.value = false
      venue.setState(game.state.value)
      showPlayer(); showCrowd(); showGoal()
      venue.resize()
      layout()
      // The first frame is in the canvas: bring it up with the same short fade as an arrival, over the calm backdrop — never a flash.
      container.value.classList.add('is-arriving')
      reportPlace()
      telemetry.sceneReady(true, container.value.querySelector('canvas'))
      // Three.js is here now, so the map's own code is a small download: fetch it ahead, so a first trip shows without a wait.
      // (Nothing is built or drawn until the Map opens.)
      void import('../../map3d/index.ts').catch(() => undefined)
      // The HUD changed size (activities opened, Clean screen, a trip): re-centre the scene. An observer, not a timer.
      observer = new ResizeObserver(layout)
      for (const node of [...props.top(), ...props.rows(), props.bottom()]) if (node) observer.observe(node)
    } catch (error) {
      console.error('The scene could not be started:', error)
      telemetry.chunkFailed('scene', error); telemetry.sceneReady(false)
      failed.value = true
    }
  }, 0)
  window.addEventListener('resize', onResize)
})
// The venue comes up after a trip with a short fade rather than a cut: one CSS animation, restarted by hand.
watch(scene.arrivals, () => {
  const box = container.value
  if (!box) return
  box.classList.remove('is-arriving'); void box.offsetWidth; box.classList.add('is-arriving')
}, { flush: 'post' })
// Back from the map: the canvas was hidden, so measure again.
watch(() => props.hidden, (hidden) => { if (!hidden) { onResize(); layout() } }, { flush: 'post' })
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('resize', onResize)
  observer?.disconnect()
  scene.venue.value?.dispose()
  scene.venue.value = null
})
defineExpose({ layout })
</script>

<template>
  <div id="venue-scene" ref="container"  class="life-scene" :hidden="hidden">
    <p v-if="waiting" class="scene-wait" role="status">{{ failed ? 'The 3D scene could not be drawn on this device. Everything else still works.' : 'Drawing the scene…' }}</p>
  </div>
</template>
