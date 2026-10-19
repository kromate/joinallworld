<script setup lang="ts">
// The online sheet, opened from the top bar's count: how many of those online are people and how many are AI agents, in the
// world and in this city, and the ways on: see who is here (People, where every AI agent carries its mark), see the AI agents online (and chat, call or go to
// them), and invite someone. When no other person is online the invite comes first. Its own chunk: fetched the first time the pill is pressed.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { cityName } from '../../../game/cities/registry.ts'
import BaseSheet from '../../ui/BaseSheet.vue'
import { shareInvite } from '../growth/shareInvite.ts'
import { onlineView, splitLine } from './onlinePillModel.ts'
import type { PulseNumbers } from './onlinePillModel.ts'

const props = defineProps<{ open: boolean; numbers: PulseNumbers; cityId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { game, shell } = useApp()

const view = computed(() => onlineView(props.numbers, props.cityId))
const city = computed(() => (props.cityId ? cityName(props.cityId) ?? null : null))
const people = (): void => { emit('close'); shell.open('people') }
const agents = (): void => { emit('close'); shell.open('ai-agents') }
const invite = (): void => { emit('close'); shareInvite('hud', () => game.toast('That could not be shared.', 'error')) }
</script>

<template>
  <BaseSheet :open="open" label="Who is online" class="online-sheet" @close="emit('close')">
    <template v-if="open">
      <h3 class="online-title">Online now</h3>
      <p class="online-split" data-online="world"><strong>{{ splitLine(view.people, view.agents) }}</strong> in Allworld</p>
      <p v-if="view.peopleHere !== null" class="online-split" data-online="here">{{ splitLine(view.peopleHere, view.agentsHere ?? 0) }} in {{ city ?? 'this city' }}</p>
      <p class="online-note">AI agents are characters played by AI. They always carry the AI mark.</p>
      <p v-if="view.alone" class="online-note">No other person is online right now. Bring a friend in.</p>
      <div class="online-actions" :class="{ 'is-alone': view.alone }">
        <button type="button" class="online-btn" :class="{ 'is-primary': !view.alone }" data-online="people" @click="people">See who's here</button>
        <button v-if="view.agents > 0" type="button" class="online-btn" data-online="agents" @click="agents">See AI agents</button>
        <button type="button" class="online-btn" :class="{ 'is-primary': view.alone }" data-online="invite" @click="invite">Invite a friend</button>
      </div>
    </template>
  </BaseSheet>
</template>

<style scoped>
.online-sheet { margin-top: auto; margin-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); white-space: normal; }
.online-title { margin: 0; padding: 16px 64px 6px 18px; font-size: 16px; }
.online-split { margin: 0; padding: 4px 18px; font-variant-numeric: tabular-nums; }
.online-note { margin: 0; padding: 6px 18px 0; color: var(--c-muted); font-size: var(--t-small); }
.online-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 18px 18px; }
.online-actions.is-alone { flex-direction: row-reverse; justify-content: flex-end; }
.online-btn { flex: 1 1 30%; min-height: var(--tap); border: 0; border-radius: var(--r-pill); background: var(--c-fill); color: var(--c-ink); font: 600 var(--t-body, 15px)/1.2 var(--font); cursor: pointer; }
.online-btn.is-primary { background: var(--c-green-dark); color: #fff; }
.online-btn:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
