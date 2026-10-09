<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Conversation, Message } from '../../../types/social.ts'
import { newClientId, openThread, perform, social } from '../social/useSocial.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { messageLength } from './messagesText.ts'

const props = defineProps<{ kind: 'edit' | 'delete' | 'forward'; item: Message; conversations: Conversation[]; disabled: boolean; max: number }>()
const emit = defineEmits<{ close: [] }>()
const draft = ref(props.item.body)
const destination = ref('')
const busy = ref(false)
const error = ref('')
const count = computed(() => messageLength(draft.value))
const invalidEdit = computed(() => props.kind === 'edit' && (count.value === 0 || count.value > props.max))
let clientId = newClientId()
watch([draft, destination], () => { clientId = newClientId(); error.value = '' })
const choices = computed(() => props.conversations.filter((conv) => conv.id !== props.item.conv))
const title = computed(() => props.kind === 'edit' ? 'Edit message' : props.kind === 'delete' ? 'Delete for everyone?' : 'Forward message')
async function submit(): Promise<void> {
  if (busy.value || props.disabled || invalidEdit.value) return
  busy.value = true
  error.value = ''
  const result = props.kind === 'forward'
    ? await perform('/api/social/messages', { conv: destination.value, body: '', clientId, forward: { conv: props.item.conv, seq: props.item.seq } }, 'Message forwarded')
    : await perform(`/api/social/conversations/${encodeURIComponent(props.item.conv)}/message`, { op: props.kind, seq: props.item.seq, version: props.item.version ?? 0, clientId, ...(props.kind === 'edit' ? { body: draft.value } : {}) })
  busy.value = false
  if (!result.ok) { error.value = result.reason; return }
  // Refresh even when the social socket is reconnecting; HTTP acknowledgement is authoritative.
  if (social.openConv === props.item.conv) await openThread(props.item.conv)
  emit('close')
}
</script>

<template>
  <form class="message-action" :aria-label="title" @submit.prevent="submit">
    <strong>{{ title }}</strong>
    <template v-if="kind === 'edit'">
      <label for="message-edit">Message</label>
      <textarea id="message-edit" v-model="draft" :maxlength="max * 2" :aria-invalid="count > max || undefined" aria-describedby="message-edit-count" :disabled="busy || disabled" rows="3" />
      <small id="message-edit-count">{{ count > max ? `Remove ${count - max} characters to save.` : `${count} / ${max} characters` }}</small>
      <small>Text messages can be edited for 15 minutes.</small>
    </template>
    <template v-else-if="kind === 'forward'">
      <p>{{ item.body }}</p>
      <label for="message-forward">Send to</label>
      <select id="message-forward" v-model="destination" :disabled="busy || disabled">
        <option disabled value="">Choose a chat</option>
        <option v-for="conv in choices" :key="conv.id" :value="conv.id">{{ conv.name }}</option>
      </select>
      <small v-if="!choices.length">Open another chat first to forward this message.</small>
      <small v-else>The copy is marked Forwarded. Deleting the original will not remove forwarded copies.</small>
    </template>
    <p v-else>This removes the message from this conversation for everyone. Copies or screenshots others already saved remain theirs.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div>
      <BaseButton small type="submit" :disabled="busy || disabled || invalidEdit || (kind === 'forward' && !destination)">{{ busy ? 'Saving…' : kind === 'delete' ? 'Delete for everyone' : kind === 'forward' ? 'Forward' : 'Save edit' }}</BaseButton>
      <BaseButton small :disabled="busy" @click="emit('close')">Cancel</BaseButton>
    </div>
  </form>
</template>

<style scoped>
.message-action { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--c-line); border-radius: 12px; background: var(--c-fill-2); }
.message-action p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 100px; overflow: auto; }
.message-action textarea, .message-action select { width: 100%; min-height: 44px; box-sizing: border-box; font: inherit; }
.message-action small { color: var(--c-ink-2); }
.message-action div { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
