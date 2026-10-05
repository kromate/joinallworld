<script setup lang="ts">
// The switches for the e-mails about a player's character (docs/COMEBACK-MAIL.md): one for "E-mail me about my character",
// one per kind, and "Pause all for 30 days". Drawn in Stay in touch for an address confirmed there and in Settings for an
// account holder: the same server record answers both, so the same switches are shown. The weekly summary is sent only to
// an address confirmed in Stay in touch, so an account's list does not offer it.
// A press says so until the server answers; the view is then read again.
import { computed, ref } from 'vue'
import type { ComebackView } from '../../../types/growth.ts'
import type { PrefKey } from '../../../game/comeback-prefs.ts'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { comebackRows, pausedWords } from './comebackModel.ts'
import { useGrowth } from './useGrowth.ts'

const props = defineProps<{ view: ComebackView }>()
const { game } = useApp()
const growth = useGrowth()
const busy = ref(false)
const rows = computed(() => comebackRows().filter((row) => row.key !== 'week' || props.view.source === 'contact'))
const paused = computed(() => pausedWords(props.view, Date.now()))
async function save(body: { on?: boolean; types?: Partial<Record<PrefKey, boolean>>; pause?: boolean }): Promise<void> {
  if (busy.value) return
  busy.value = true
  const result = await growth.call<{ ok: boolean; reason?: string }>('/api/growth/comeback', body)
  if (!result.ok) game.toast(('reason' in result && result.reason) || 'That could not be saved.', 'error')
  await growth.load({ force: true })
  busy.value = false
}
</script>

<template>
  <div class="cb" data-comeback>
    <label class="cb-check"><input type="checkbox" name="comeback-on" :checked="view.on" :disabled="busy" @change="save({ on: ($event.target as HTMLInputElement).checked })"><span>E-mail me about my character</span></label>
    <template v-if="view.on">
      <label v-for="row in rows" :key="row.key" class="cb-check"><input type="checkbox" :name="`comeback-${row.key}`" :checked="view.types[row.key]" :disabled="busy" @change="save({ types: { [row.key]: ($event.target as HTMLInputElement).checked } })"><span><b>{{ row.label }}</b><small>{{ row.hint }}</small></span></label>
      <p v-if="paused" class="cb-note">{{ paused }}</p>
      <BaseButton v-if="paused" :disabled="busy" @click="save({ pause: false })">Resume e-mails</BaseButton>
      <BaseButton v-else :disabled="busy" @click="save({ pause: true })">Pause all for 30 days</BaseButton>
    </template>
  </div>
</template>

<style scoped>
.cb { display: grid; gap: 2px; }
.cb-check { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.4; padding: 8px 0; min-height: var(--tap, 44px); box-sizing: border-box; cursor: pointer; }
.cb-check input { width: 22px; height: 22px; flex: none; margin: 1px 0 0; }
.cb-check input:focus-visible { outline: var(--focus); outline-offset: 2px; }
.cb-check span { display: grid; gap: 2px; min-width: 0; }
.cb-check small { font-size: 12px; line-height: 1.4; color: var(--c-muted); }
.cb-note { margin: 4px 0; font-size: 12px; color: var(--c-muted); }
.cb :deep(.base-button) { justify-self: start; margin-top: 6px; }
</style>
