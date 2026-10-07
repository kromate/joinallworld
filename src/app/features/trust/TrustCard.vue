<script setup lang="ts">
// The account's trust badge in Settings (lazy: loaded with the account section). What other players see next to
// this account's links and listings: its tier, upheld complaints in the last 90 days, and whether listings are held.
// The phone and ID checks are offered as the server reports them: with no provider configured each says it is
// coming soon, and asking answers with the server's own sentence. What the account may post comes from the same
// rules every listing uses (src/game/trust/tiers.ts), each with its reason.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import type { PostKind } from '../../../game/trust/index.ts'
import type { TrustAnswer, TrustMe } from '../../../types/trust.ts'

const { game } = useApp()
const me = ref<TrustMe | null>(null)
const failed = ref(false)
const said = ref('')
const busy = ref(false)

const CHECKS = [{ kind: 'phone', label: 'Check my phone number' }, { kind: 'id', label: 'Check my ID' }] as const
const POSTS: { kind: PostKind; label: string }[] = [{ kind: 'stall', label: 'Run a stall' }, { kind: 'gig', label: 'Offer a gig' }, { kind: 'class', label: 'Teach a class' }, { kind: 'meetup', label: 'Host a meetup' }]

const complaints = computed(() => {
  const n = me.value?.complaints ?? 0
  return n ? `${n} upheld ${n === 1 ? 'complaint' : 'complaints'} in the last 90 days` : 'No upheld complaints'
})

async function load(): Promise<void> {
  try { me.value = await game.fetchJson<TrustMe>('/api/trust/me'); failed.value = false } catch { failed.value = true }
}
async function start(kind: 'phone' | 'id'): Promise<void> {
  if (busy.value) return
  busy.value = true
  try { const answer = await game.fetchJson<TrustAnswer>(`/api/trust/check/${kind}/start`, { method: 'POST', body: {} }); said.value = answer.reason ?? '' } catch (error) { said.value = error instanceof Error ? error.message : 'Try again later.' }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <div class="trust-card" data-trust-card>
    <h3 class="ui-section">Trust and safety</h3>
    <p v-if="failed" class="settings-note">Your badge could not be loaded. <button type="button" class="ui-button" @click="load">Try again</button></p>
    <template v-else-if="me">
      <div class="ui-rows">
        <div class="ui-row"><span class="ui-row-body"><b data-trust-tier>Your badge: {{ me.label }}</b><small>{{ complaints }}. Other players see this next to your links and listings, never your number or ID.</small></span></div>
        <button v-for="check in CHECKS" :key="check.kind" type="button" class="ui-row" :data-trust-check="check.kind" :disabled="busy" @click="start(check.kind)">
          <span class="ui-row-body"><b>{{ check.label }}</b><small>{{ me.checks[check.kind] === 'ready' ? 'Takes a minute' : 'Coming soon' }}</small></span>
        </button>
      </div>
      <p v-if="said" class="settings-note" role="status" data-trust-said>{{ said }}</p>
      <p v-if="me.held" class="ui-error" role="alert">Your listings are on hold while we review complaints. Use Report a problem to tell us your side.</p>
      <ul class="trust-can">
        <li v-for="post in POSTS" :key="post.kind" :data-trust-can="post.kind"><b>{{ post.label }}:</b> {{ me.can[post.kind] ? me.can[post.kind]!.reason : 'You can' }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.trust-can { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.5; }
</style>
<style scoped src="../../../ui/panels/settings.css"></style>
