<script setup lang="ts">
// One mission row: its mark, label and hint, a progress bar for a counted mission, and its
// controls (Collect, Go, Swap). The pressed control says so (`pending`) and cannot be pressed twice.
import { computed } from 'vue'
import type { MissionRow } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { missionAction, missionHint, missionIcon, missionPercent, showsProgress } from './missionsLines.ts'

const props = defineProps<{
  mission: MissionRow
  scope: 'daily' | 'weekly'
  rerollsLeft: number
  /** Why Collect cannot be pressed (not connected), or null. */
  why: string | null
  /** 'claim' or 'swap' while that control's request is on its way. */
  pending: 'claim' | 'swap' | null
}>()
const emit = defineEmits<{ claim: []; swap: []; go: [] }>()
const action = computed(() => missionAction(props.mission, props.scope, props.rerollsLeft))
</script>

<template>
  <li class="gr-item" :class="{ 'is-done': mission.done, 'is-claimed': mission.claimed }">
    <span aria-hidden="true"><GameIcon :name="missionIcon(mission)" :size="22" /></span>
    <div>
      <b>{{ mission.label }}</b>
      <small>{{ missionHint(mission, money) }}</small>
      <template v-if="showsProgress(mission)">
        <div class="gr-bar" role="progressbar" aria-valuemin="0" :aria-valuemax="mission.count" :aria-valuenow="mission.n" :aria-label="mission.label"><i :style="{ width: `${missionPercent(mission)}%` }" /></div>
        <small>{{ mission.n }} of {{ mission.count }}</small>
      </template>
    </div>
    <div class="gr-acts">
      <BaseChip v-if="action.kind === 'collected'" tone="good">Collected</BaseChip>
      <BaseButton v-else-if="action.kind === 'collect'" variant="primary" :disabled="Boolean(why) || pending !== null" :reason="why" @click="emit('claim')">{{ pending === 'claim' ? 'Collecting…' : `Collect ${money(mission.cash)}` }}</BaseButton>
      <template v-else>
        <BaseButton v-if="action.go" @click="emit('go')">Go</BaseButton>
        <button v-if="action.swap" type="button" class="gr-swap" :disabled="pending !== null" @click="emit('swap')">{{ pending === 'swap' ? 'Swapping…' : 'Swap' }}</button>
      </template>
    </div>
  </li>
</template>

<style scoped>
.gr-item { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 12px 14px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.gr-item.is-done { background: var(--c-green-soft); }
.gr-item.is-claimed { opacity: .62; }
.gr-item b { display: block; font-size: 14px; line-height: 1.25; }
.gr-item small { display: block; color: var(--c-muted); font-size: 12px; line-height: 1.35; }
.gr-item :deep(.game-icon) { color: var(--c-green); }
.gr-bar { height: 6px; border-radius: 99px; background: var(--c-fill-2, #e6e9ee); overflow: hidden; margin-top: 6px; }
.gr-bar i { display: block; height: 100%; background: var(--c-green); border-radius: 99px; }
.gr-acts { display: grid; gap: 6px; justify-items: end; }
.gr-acts :deep(.base-button) { min-height: var(--tap, 44px); white-space: nowrap; }
.gr-swap { background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; padding: 4px; min-height: var(--tap, 44px); cursor: pointer; }
.gr-swap:focus-visible { outline: var(--focus); outline-offset: 2px; }
.gr-swap:disabled { opacity: .6; cursor: default; }
</style>
