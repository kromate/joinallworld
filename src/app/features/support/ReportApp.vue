<script setup lang="ts">
// Report a problem — from inside the game, with no other account.
//
// A short form (what kind of problem, what happened) filed with POST /api/support/reports; the
// server answers with a receipt number. Every receipt this device has filed is listed below with
// its status and any note from a moderator (GET /api/support/reports).
//
// The fields are bound to the draft, so a state update from the server never touches what is
// being typed, and nothing has to save and restore the caret. A message for the player moves the
// keyboard to the right place: an error to the text field, a receipt to the notice itself.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { formatClock } from '../../../game/clock.ts'
import { linkWords } from '../../../ui/link.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import EmptyState from '../../ui/EmptyState.vue'
import HeroCard from '../../ui/HeroCard.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import { CATEGORY_LABELS, DEFAULT_LIMITS, STATUS_LABELS, SENT_WITH_RULES, statusTone, textProblem } from './supportModel.ts'
import { useSupport } from './useSupport.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()

const support = useSupport()
const { draft, list, sending, notice } = support
const canReport = computed(() => game.connected.value || (game.link.value === 'recovery' && game.session.value !== null))
const offline = computed(() => !canReport.value)
const offlineWhy = computed(() => linkWords(game.view.value)?.why ?? 'Not connected.')
const limit = computed(() => list.value?.limits.text ?? DEFAULT_LIMITS.text)
const reports = computed(() => list.value?.reports ?? [])
const textField = ref<HTMLTextAreaElement | null>(null)
const noticeLine = ref<HTMLElement | null>(null)

// A category handed over by another screen ("Something here looks wrong") is applied once per opening.
watch(() => props.params, (params) => { support.preset((params as { category?: unknown } | null | undefined)?.category) }, { immediate: true })
onMounted(() => { if (!list.value) void support.load() })

async function send(): Promise<void> {
  // Too little text is said in the notice and the field only: no toast, as in the existing panel.
  const tooShort = textProblem(draft.text.trim()) !== null
  const receipt = await support.submit()
  if (!tooShort) {
    if (receipt) game.toast(`Report ${support.lastReceipt.value} received.`, 'good')
    else if (notice.value) game.toast(notice.value.text, 'error')
  }
  await nextTick()
  if (receipt) noticeLine.value?.focus(); else textField.value?.focus()
}
</script>


<template>
  <div class="report">
    <HeroCard label="Report a problem" figure="Tell us what went wrong" class="report-hero">
      You get a receipt number at once. No e-mail needed.
    </HeroCard>

    <form class="report-form" novalidate @submit.prevent="send">
      <label>What kind of problem?
        <select v-model="draft.category" name="category" :disabled="offline">
          <option v-for="(label, id) in CATEGORY_LABELS" :key="id" :value="id">{{ label }}</option>
        </select>
      </label>
      <label>What happened?
        <textarea ref="textField" v-model="draft.text" name="text" rows="5" :maxlength="limit" placeholder="What you did, what you expected, what you saw instead." :disabled="offline" :aria-invalid="notice?.kind === 'error' ? 'true' : undefined" aria-describedby="report-sent-with report-notice" />
      </label>
      <div id="report-sent-with" class="report-fine">Your recent actions and wallet lines are attached automatically. Your device’s secret never is.</div>
      <HowItWorks id="support-sent" label="What is sent, and what happens next" :rules="SENT_WITH_RULES" />
      <div class="report-send">
        <BaseButton variant="primary" block type="submit" :disabled="offline || sending">{{ sending ? 'Sending…' : 'Send report' }}</BaseButton>
        <small v-if="offline">{{ offlineWhy }} A report cannot be sent right now. What you typed is kept.</small>
      </div>
      <div id="report-notice" ref="noticeLine" tabindex="-1" :role="notice?.kind === 'error' ? 'alert' : 'status'" :class="notice ? `report-${notice.kind}` : undefined">{{ notice?.text }}</div>
    </form>

    <SectionTitle>Your reports</SectionTitle>
    <SkeletonRows v-if="!list" :rows="2" label="Loading your reports" />
    <template v-else>
      <ul v-if="reports.length" class="report-list">
        <li v-for="report in reports" :key="report.id">
          <div class="report-head"><strong>{{ report.id }}</strong><BaseChip :tone="statusTone(report.status)">{{ STATUS_LABELS[report.status] ?? report.status }}</BaseChip></div>
          <div class="report-text">{{ report.text }}</div>
          <small>{{ CATEGORY_LABELS[report.category] ?? report.category }} · filed {{ formatClock(report.at) }}<template v-if="report.updatedAt > report.at"> · updated {{ formatClock(report.updatedAt) }}</template></small>
          <div v-if="report.note" class="report-reply"><b>Moderator:</b> {{ report.note }}</div>
        </li>
      </ul>
      <EmptyState v-if="list.failed" compact icon="cloud-off" title="Your reports did not load" text="They are kept on the server. Check your connection and try again.">
        <BaseButton small :disabled="offline" @click="support.reload()">Try again</BaseButton>
      </EmptyState>
      <EmptyState v-else-if="!reports.length" compact icon="support" title="Nothing reported yet" text="A report you send appears here with its receipt number, its status and any reply from a moderator." />
    </template>
  </div>
</template>

<style scoped>
.report-hero { --hero: var(--app-tint, #dc5a0c); }
.report-hero :deep(strong) { font-size: 20px; }
.report-form { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-3) var(--s-4) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.report-form label { display: flex; flex-direction: column; gap: 5px; margin: 0; font-size: 13px; font-weight: 600; }
.report-form select, .report-form textarea { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); background: #fff; color: var(--c-ink); font: 400 14px var(--font); }
.report-form select:focus-visible, .report-form textarea:focus-visible { outline: var(--focus); outline-offset: 2px; }
.report-form textarea { resize: vertical; }
.report-form textarea[aria-invalid='true'] { border-color: var(--c-red); }
.report-fine { font-size: 12px; line-height: 1.45; color: var(--c-muted); }
.report-send { display: grid; gap: 4px; }
.report-send :deep(.is-primary) { background: var(--app-tint, var(--c-green-dark)); }
.report-send small { color: var(--c-red); font-size: 12px; }
.report-good, .report-error { padding: 9px 12px; border-radius: var(--r-sm); font-size: 13px; font-weight: 600; line-height: 1.4; }
.report-good { background: var(--c-green-soft); color: var(--c-green-dark); }
.report-error { background: var(--c-red-soft); color: var(--c-red-dark); }
.report-good:focus, .report-error:focus { outline: none; }
.report-list { list-style: none; margin: 0; padding: 0; }
.report-list li { margin: 0 0 var(--s-2); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.report-head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); font-size: 13px; }
.report-head strong { font-family: ui-monospace, monospace; font-size: 12px; }
.report-text { margin: 6px 0 4px; font-size: var(--t-body); line-height: 1.45; overflow-wrap: anywhere; }
.report-list small { color: var(--c-muted); font-size: 12px; }
.report-reply { margin-top: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--c-blue-soft); font-size: var(--t-body); line-height: 1.45; }
</style>
