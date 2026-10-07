<script setup lang="ts">
// "You are leaving Allworld": the only way a link in chat opens. Loaded lazily, the first time a link is tapped.
// It names the site and the full address, shows the sender's trust badge (tier, upheld complaints in the last
// 90 days, whether their listings are held), repeats the safety line, and lets the player report the sender.
// Continue opens the address in a new tab with no opener and no referrer; Go back closes the sheet.
// Everything the sender typed is shown as text by Vue's interpolation, never as markup.
import { computed, ref, watch } from 'vue'
import BaseSheet from '../../ui/BaseSheet.vue'
import { useApp } from '../../state/app.ts'
import { SAFETY_LINE, TRUST_REPORT_REASONS, TRUST_REPORT_WORDS } from '../../../game/trust/index.ts'
import type { OutboundLink, TrustBadge, TrustReportReason } from '../../../game/trust/index.ts'
import type { TrustAnswer } from '../../../types/trust.ts'

const props = defineProps<{ link: OutboundLink | null; authorId?: string; authorName: string }>()
const emit = defineEmits<{ close: [] }>()
const { game } = useApp()

const badge = ref<TrustBadge | null>(null)
const failed = ref(false)
const reporting = ref(false)
const reason = ref<TrustReportReason | ''>('')
const note = ref('')
const answer = ref('')
const busy = ref(false)

watch(() => [props.link, props.authorId] as const, async ([link, id]) => {
  badge.value = null; failed.value = false; reporting.value = false; reason.value = ''; note.value = ''; answer.value = ''
  if (!link || !id) return
  try { badge.value = (await game.fetchJson<{ badge: TrustBadge }>(`/api/trust/profile/${encodeURIComponent(id)}`)).badge } catch { failed.value = true }
}, { immediate: true })

const complaints = computed(() => {
  const n = badge.value?.complaints ?? 0
  return n ? `${n} upheld ${n === 1 ? 'complaint' : 'complaints'} in the last 90 days` : 'No upheld complaints in the last 90 days'
})

function go(): void {
  if (!props.link) return
  window.open(props.link.url, '_blank', 'noopener,noreferrer')
  emit('close')
}
async function report(): Promise<void> {
  if (!props.authorId || !reason.value || busy.value) return
  busy.value = true
  try {
    const sent = await game.fetchJson<TrustAnswer>('/api/trust/report', { method: 'POST', body: { about: props.authorId, reason: reason.value, ...(note.value.trim() ? { note: note.value.trim() } : {}) } })
    answer.value = sent.ok ? 'Thank you. We will look at it. They are not told who reported them.' : (sent.reason ?? 'That report was not sent.')
    if (sent.ok) reporting.value = false
  } catch (error) { answer.value = error instanceof Error ? error.message : 'That report was not sent. Try again.' }
  finally { busy.value = false }
}
</script>

<template>
  <BaseSheet :open="link !== null" label="You are leaving Allworld" @close="emit('close')">
    <div v-if="link" class="trust-leave" data-trust-leave>
      <h2>You are leaving Allworld</h2>
      <p>This opens <b>{{ link.site }}</b> in a new tab:</p>
      <p class="trust-url" data-trust-url>{{ link.url }}</p>
      <div class="trust-seller">
        <p><b>{{ authorName || 'Someone' }}</b> shared this link.</p>
        <template v-if="badge">
          <p data-trust-badge><span class="trust-tier" :class="`is-${badge.tier}`">{{ badge.label }}</span> · {{ complaints }}</p>
          <p v-if="badge.held" class="ui-error">Their listings are on hold while we review complaints.</p>
        </template>
        <p v-else-if="failed" class="trust-muted">We could not load what we know about them.</p>
      </div>
      <p class="trust-safety" data-trust-safety>{{ SAFETY_LINE }}</p>
      <p class="trust-muted">Allworld does not hold your money for trades outside the game. Nobody here needs a fee before you can get a job or a class.</p>

      <form v-if="reporting" class="trust-report" data-trust-report @submit.prevent="report">
        <fieldset>
          <legend>Why are you reporting {{ authorName || 'them' }}?</legend>
          <label v-for="item in TRUST_REPORT_REASONS" :key="item"><input v-model="reason" type="radio" name="trust-reason" :value="item"> {{ TRUST_REPORT_WORDS[item] }}</label>
        </fieldset>
        <label class="trust-note">Anything else? (optional)<textarea v-model="note" maxlength="300" rows="2" /></label>
        <button class="ui-button is-block is-danger" :disabled="!reason || busy">{{ busy ? 'Sending…' : 'Send report' }}</button>
      </form>
      <p v-if="answer" role="status" data-trust-answer>{{ answer }}</p>

      <div class="trust-actions">
        <button type="button" class="ui-button is-block is-primary" data-trust-continue @click="go">Continue to {{ link.site }}</button>
        <button type="button" class="ui-button is-block" data-trust-back @click="emit('close')">Go back</button>
        <button v-if="authorId && !reporting" type="button" class="ui-button is-block" data-trust-report-open @click="reporting = true">Report {{ authorName || 'this person' }}</button>
      </div>
    </div>
  </BaseSheet>
</template>

<style scoped>
.trust-leave { display: grid; gap: 10px; font-size: 14px; line-height: 1.45; }
.trust-leave h2 { margin: 0; font-size: 18px; }
.trust-leave p { margin: 0; }
.trust-url { font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; background: var(--c-fill, #eef1ef); padding: 6px 8px; border-radius: 6px; }
.trust-seller { display: grid; gap: 4px; }
.trust-tier { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--c-fill, #eef1ef); }
.trust-tier.is-phone, .trust-tier.is-id, .trust-tier.is-business { background: #dff3e4; color: #135c2a; }
.trust-safety { font-weight: 600; }
.trust-muted { color: var(--c-faint, #6b737c); font-size: 13px; }
.trust-report { display: grid; gap: 8px; }
.trust-report fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; }
.trust-report legend { font-weight: 600; margin-bottom: 4px; }
.trust-note { display: grid; gap: 4px; font-size: 13px; }
.trust-actions { display: grid; gap: 8px; }
</style>
