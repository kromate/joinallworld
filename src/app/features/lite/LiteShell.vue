<script setup lang="ts">
// LITE (src/app/state/lite.ts): the whole social product with no 3D world. Five tabs over the same panels the phone uses: the Feed, Here
// (the place your character is in: its activities, or the Square or a room you stand in), Chats, People and Me. Calls, voice in a room,
// pings, notices and the phone itself work as they do beside the scene. "Step into the 3D world" is offered where the browser can draw it.
import './lite.css'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { useApp } from '../../state/app.ts'
import { canDraw3d, stepInto3d } from '../../state/liteSwitch.ts'
import { social } from '../social/useSocial.ts'
import { feedUnseen } from '../feed/feedBadge.ts'
import { FEEDBACK_URL } from '../feedback/board.ts'
import { placeNow } from '../places/placeState.ts'
// The shell's own components, handed over by App.vue, which already holds them: importing them here would split them out of the startup.
const props = defineProps<{ host: Component; venue: Component; place: Component; why: 'chosen' | 'no-3d' | null }>()

type Tab = 'feed' | 'here' | 'messages' | 'people' | 'me'
const { shell } = useApp()
const tab = ref<Tab>('feed')
const TABS: { id: Tab; label: string; panel: string | null }[] = [
  { id: 'feed', label: 'Feed', panel: 'feed' }, { id: 'here', label: 'Here', panel: null }, { id: 'messages', label: 'Chats', panel: 'messages' },
  { id: 'people', label: 'People', panel: 'people' }, { id: 'me', label: 'Me', panel: 'me' },
]
const panel = computed(() => { const id = TABS.find((t) => t.id === tab.value)?.panel; return id ? shell.byId.get(id) ?? null : null })
const can3d = canDraw3d()
const badge = (id: Tab): number => (id === 'feed' ? feedUnseen.value : id === 'people' ? social.me?.requests.in.length ?? 0 : 0)
const more = (): void => { shell.open('phone') }

// The floating strips (goal, first minute, notices) live in the bottom stack of the overlay, outside this shell. Measure that stack and the
// tab bar and keep them in CSS variables (lite.css): the stack docks right above the tab bar and the page ends above the stack, so it never
// covers what you are reading.
const tabsEl = ref<HTMLElement | null>(null)
let timer = 0
const setVar = (name: string, px: number): void => { const style = document.body.style; const value = `${px}px`; if (style.getPropertyValue(name) !== value) style.setProperty(name, value) }
function measure(): void {
  setVar('--lite-tabs', tabsEl.value?.offsetHeight ?? 54)
  const stack = document.querySelector<HTMLElement>('.life-bottom')
  const height = stack ? Math.ceil(stack.getBoundingClientRect().height) : 0
  setVar('--lite-dock', height > 0 ? height + 16 : 0)
}
onMounted(() => { measure(); timer = window.setInterval(measure, 400); window.addEventListener('resize', measure) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('resize', measure); document.body.style.removeProperty('--lite-tabs'); document.body.style.removeProperty('--lite-dock') })
</script>

<template>
  <div class="lite-shell" data-lite="shell">
    <header class="lite-top">
      <b class="lite-brand">Allworld</b>
      <span class="lite-grow" />
      <a class="lite-chip" :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer" data-feedback>Feedback</a>
      <button type="button" class="lite-chip" @click="more">All apps</button>
      <button v-if="can3d" type="button" class="lite-chip is-world" @click="stepInto3d"><span class="lite-long">Step into the 3D world</span><span class="lite-short" aria-hidden="true">3D world</span></button>
    </header>
    <p v-if="props.why === 'no-3d'" class="lite-note">This browser cannot show the 3D world, so you are on Allworld Lite. Everything social works here.</p>
    <main class="lite-main">
      <component :is="props.host" v-if="panel" :key="panel.id" :panel="panel" />
      <template v-else-if="tab === 'here'"><component :is="props.place" v-if="placeNow" /><component :is="props.venue" v-else /></template>
    </main>
    <nav ref="tabsEl" class="lite-tabs" aria-label="Allworld Lite">
      <button v-for="t in TABS" :key="t.id" type="button" :class="{ 'is-on': tab === t.id }" :aria-current="tab === t.id ? 'page' : undefined" @click="tab = t.id">
        {{ t.label }}<span v-if="badge(t.id)" class="lite-dot">{{ badge(t.id) }}</span>
      </button>
    </nav>
  </div>
</template>
