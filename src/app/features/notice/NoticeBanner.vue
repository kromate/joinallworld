<script setup lang="ts">
// "Allworld is updating in about N minutes." A thin, calm line in the stack above the navigation: not a dialog, nothing is
// covered, and it can be dismissed. It is announced politely once per notice (the live countdown itself is not read out).
// After the update: "Allworld has been updated", with a one-tap "Call <name> again" when the update cut a call.
import { computed, ref, watch } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import { dismissNotice, noticeUi } from './noticeStore.ts'
import { noticeView } from './noticeModel.ts'
import { callActive, callStore } from '../calls/callState.ts'
import { requestCall } from '../calls/useCall.ts'
import { pingState } from '../ping/pingStore.ts'

const busy = computed(() => callActive(callStore.view) || pingState.sent.size > 0 || pingState.banner !== null)
const view = computed(() => noticeView(noticeUi, noticeUi.now, busy.value))
/** What a screen reader hears: set when a notice appears or its call line changes, so a ticking countdown is not read again. */
const spoken = ref('')
watch(() => (view.value.kind === 'updating' ? `${view.value.id}|${view.value.callLine ?? ''}` : view.value.kind), () => {
  const now = view.value
  spoken.value = now.kind === 'updating' ? `${now.text}${now.callLine ? ` ${now.callLine}` : ''}` : now.kind === 'updated' ? now.text : ''
}, { immediate: true })
const callAgain = async (): Promise<void> => {
  const peer = view.value.kind === 'updated' ? view.value.callAgain : null
  dismissNotice()
  if (peer) await requestCall(peer)
}
</script>

<template>
  <aside v-if="view.kind !== 'none'" class="notice-line" :class="{ 'is-updated': view.kind === 'updated' }" role="status" aria-live="polite" aria-atomic="true" aria-label="Update notice">
    <p class="sr-only">{{ spoken }}</p>
    <div class="notice-line-text" aria-hidden="true">
      <span>{{ view.text }}</span>
      <span v-if="view.kind === 'updating' && view.callLine" class="notice-line-calls">{{ view.callLine }}</span>
    </div>
    <BaseButton v-if="view.kind === 'updated' && view.callAgain" variant="primary" small @click="callAgain">Call {{ view.callAgain.name }} again</BaseButton>
    <button type="button" class="notice-line-close" aria-label="Dismiss" @click="dismissNotice">×</button>
  </aside>
</template>

<style scoped>
.notice-line { box-sizing: border-box; width: 100%; max-width: 460px; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; border-radius: 12px; background: #eef4fa; color: var(--c-ink); box-shadow: inset 0 0 0 1px #c9d9ea, var(--e-1, 0 2px 8px rgba(0, 0, 0, .12)); font: 500 13px/1.35 var(--font); pointer-events: auto; }
.notice-line.is-updated { background: #edf6ef; box-shadow: inset 0 0 0 1px #c3dccb, var(--e-1, 0 2px 8px rgba(0, 0, 0, .12)); }
.notice-line-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.notice-line-calls { color: var(--c-ink-2); font-size: 12px; }
.notice-line :deep(.base-button) { flex: none; min-height: 32px; }
.notice-line-close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--c-ink-2); font-size: 18px; line-height: 1; cursor: pointer; }
.notice-line-close:hover { background: #0000000f; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
