<script setup lang="ts">
// Daily gem hunt: the chip in the HUD stack; its sheet is HuntSheet.vue.
//
// The chip label reads ("Daily gem hunt · N found · next
// prize ₦3,000"). N is the server's own count of gems found in this city; until it has loaded, no
// number is shown. The chip also carries the real presence counter, raises a toast when one more
// gem was found, and is where civic notices (a new Governor, an announcement) surface as toasts.
// No timer runs here: the city counters are re-checked (at most once a minute) when the state
// changes, which is the check-in that keeps the directory and the rich list current.
// Renders nothing while there is no hunt in the life, so the HUD gives it no room.
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { PulseResponse } from '../../../types/civic.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { huntSeen } from './civicDrafts.ts'
import { gemToast, huntChipLines, noticeToast, pulseKey, pulsePath, radioKey, unseenNotices } from './civicModel.ts'
import { onlineView } from '../hud/onlinePillModel.ts'
import { usePulse } from '../hud/usePulse.ts'
import { useCivic, useLoaded } from './useCivic.ts'

const { game, shell, api } = useApp()
const civic = useCivic()
const view = game.view
const hunt = computed(() => view.value.civic?.hunt ?? null)
const { item } = useLoaded<PulseResponse>({
  key: () => pulseKey(view.value.cityId), path: () => pulsePath(view.value.cityId), maxAge: 60000, live: true,
  after(done) {
    const cityId = view.value.cityId
    if (done.data?.radio) civic.put(radioKey(cityId, done.data.radio.venue), done.data.radio)
    if (done.data && !done.error) for (const notice of unseenNotices(done.data.notices, globalThis.localStorage, cityId).slice(0, 2).reverse()) game.toast(noticeToast(notice))
  },
})
// The header pill's number for this city: the same one, as fresh as the pill.
const pill = usePulse((path) => api.fetchJson(path)).state
const online = computed(() => (pill.numbers ? onlineView(pill.numbers, view.value.cityId).here : null))
const lines = computed(() => (hunt.value ? huntChipLines(hunt.value, item.value.data, online.value) : null))

// One more gem since the chip last looked: one toast. The first look only sets the baseline.
watch(hunt, (now) => {
  if (!now) return
  const key = `${view.value.cityId}:${now.day}`
  const said = gemToast(huntSeen.last, key, now)
  if (said) game.toast(said, 'good')
  huntSeen.last = { key, found: now.found }
}, { immediate: true })
</script>

<template>
  <button v-if="hunt && lines" class="life-job civic-chip" :class="{ 'is-active': hunt.canClaim }" type="button" :aria-label="`Daily gem hunt, ${hunt.found} of ${hunt.total} found today`" @click="shell.open('hunt-sheet')">
    <span aria-hidden="true"><GameIcon inline name="hunt" /></span>
    <div><strong>{{ hunt.canClaim ? 'Claim your gem prize' : 'Daily gem hunt' }}</strong><small>{{ lines.first }}</small><small>{{ lines.second }}</small></div>
  </button>
</template>

<style scoped>
:global(.life-ui) .civic-chip { width: 100%; max-width: 100%; }
.civic-chip > div { min-width: 0; }
.civic-chip strong, .civic-chip small { white-space: normal; overflow-wrap: anywhere; }
</style>
