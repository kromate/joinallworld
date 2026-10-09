<script setup lang="ts">
// Call one of the family. The button says why when it cannot be pressed, and while the call is
// being placed it cannot be pressed twice. A successful call closes the sheet (the player
// watches the call on the scene). Shared by Contacts and Family.
import '../../../ui/panels/social.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import type { FamilyId } from '../../../types/life.ts'
import { useAct } from '../kit/act.ts'
import { callReason } from './socialWords.ts'

const props = defineProps<{ member: { id: FamilyId; name: string }; disabled?: boolean; disabledReason?: string | null }>()
const { game } = useApp()
const { act, pending } = useAct()
const reason = computed(() => callReason({
  connected: game.view.value.connected,
  cannot: linkWords(game.view.value)?.cannot('call') ?? 'Not connected.',
  calling: game.view.value.social.calling,
  memberId: props.member.id,
  busy: Boolean(game.state.value.activeAction),
}) ?? props.disabledReason ?? (pending.value !== null ? 'Call request in progress.' : null))
const call = (): Promise<boolean> => act(`call:${props.member.id}`, () => game.command('social.call', { id: props.member.id }), { close: true })
</script>

<template>
<span class="family-call-control">
  <button type="button" class="social-btn is-primary" :disabled="disabled || Boolean(reason) || pending !== null" :title="reason ?? undefined" :aria-label="`Call ${member.name}${reason ? `. ${reason}` : ''}`" @click="call">{{ pending !== null ? 'Calling…' : 'Call' }}</button>
  <small v-if="reason" class="social-why family-call-reason" role="status">{{ reason }}</small>
</span>
</template>

<style scoped>
.family-call-control{display:grid;justify-items:start;gap:4px;min-width:0;max-width:100%}
.family-call-reason{max-width:220px;white-space:normal;overflow-wrap:anywhere}
</style>
