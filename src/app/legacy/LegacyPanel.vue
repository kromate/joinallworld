<script setup lang="ts">
// Hosts one existing HTML-string panel ({ render, bind, keys }) inside the Vue shell.
//
// It keeps the existing shell's promises to a panel: render(state, view, api) is called when the
// state changes and the DOM is written only when the string differs; bind(root, api, params) runs
// after each write; a `live: false` panel (a form) is redrawn only when it asks (api.refresh) or
// when it is opened with new params; a lazy panel shows a skeleton while its group is fetched and
// a retry when the fetch failed. A panel that throws shows one line instead of taking the shell
// down. The markup is the panel's own, escaped by the panel as before: nothing here adds to it.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LegacyPanel } from '../types/panel.ts'
import { useApp } from '../state/app.ts'

const props = withDefaults(defineProps<{
  panel: LegacyPanel
  params?: unknown
  /** The element that carries data-panel. HUD chips use a div; a sheet body uses a section. */
  tag?: string
}>(), { params: undefined, tag: 'div' })
const emit = defineEmits<{
  /** After the panel's markup was written. `empty` is true when the panel rendered nothing (a hidden HUD chip). */
  rendered: [empty: boolean]
}>()

const { game, shell, legacy, onDeclarativeClick } = useApp()
const root = ref<HTMLElement | null>(null)
let written: string | null = null
let drawn = false

const SKELETON = '<div class="ui-skeleton" role="status" aria-label="Loading"><i class="is-hero"></i><i></i><i></i><i></i></div>'
const FAILED = '<div class="ui-empty"><span aria-hidden="true">📡</span><h3>This screen did not load</h3><p>Check your connection and try again.</p><button class="ui-button is-primary" data-retry-panel>Try again</button></div>'

function fetchPanel(panel: LegacyPanel): string {
  if (panel.failed) return FAILED
  panel.load?.().then(() => legacy.api.refresh(), (error: unknown) => { console.error(`Panel ${panel.id} failed to load:`, error); panel.failed = true; legacy.api.refresh() })
  return SKELETON
}

function draw(force: boolean): void {
  const target = root.value, panel = props.panel
  if (!target) return
  if (panel.live === false && !panel.pending && drawn && !force) return
  let html: string
  if (panel.pending) html = fetchPanel(panel)
  else {
    try { html = panel.render(game.state.value, shell.viewFor(props.params), legacy.api) ?? '' }
    catch (error) { console.error(`Panel ${panel.id} failed to render:`, error); html = '<p class="ui-error">This screen could not be shown.</p>' }
  }
  drawn = !panel.pending
  if (html === written) return
  written = html
  target.innerHTML = html
  if (!panel.pending) {
    try { panel.bind?.(target, legacy.api, props.params ?? null) } catch (error) { console.error(`Panel ${panel.id} failed to bind:`, error) }
  }
  emit('rendered', html === '')
}

function onClick(event: Event): void {
  const retry = event.target instanceof Element ? event.target.closest('[data-retry-panel]') : null
  if (retry) { props.panel.failed = false; legacy.api.refresh(); return }
  void onDeclarativeClick(event)
}

let unmount: (() => void) | null = null
onMounted(() => { unmount = legacy.mount(draw); draw(true) })
onBeforeUnmount(() => { unmount?.(); unmount = null })
// A new state or view: redraw live panels. After Vue's own DOM updates, so a panel measures the page it is in.
watch([game.state, game.view], () => draw(false), { flush: 'post' })
// Opened with other params, or another panel in the same place: a fresh draw, forms included.
watch(() => [props.panel, props.params] as const, () => { written = null; drawn = false; draw(true) }, { flush: 'post' })

defineExpose({
  /** The panel's own key hook: 'key:*' shortcuts while it is showing, and 'cancel' for Esc. */
  keys(action: string): boolean { return props.panel.keys?.(action, legacy.api) === true },
})
</script>

<template>
  <component :is="tag" ref="root" :data-panel="panel.id" @click="onClick" />
</template>
