<script setup lang="ts">
// A password field with an eye button that shows or hides what was typed.
//   - the button is a real button (reachable by Tab, pressed with Space or Enter), `aria-pressed` says whether the text
//     is showing, and its name says what pressing it does ("Show password" / "Hide password");
//   - the field keeps its `autocomplete` value (current-password / new-password) and its name, so a password manager
//     still recognises it; the type changes between "password" and "text" and nothing else does;
//   - `hide()` puts it back to hidden: the sheet calls it when the form is sent.
import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  label: string
  autocomplete: 'current-password' | 'new-password'
  minlength?: number
  maxlength?: number
  /** A sentence about this field, shown under it (an error, in plain words). */
  error?: string
  /** A hint under the field while there is no error. */
  hint?: string
  id: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const shown = ref(false)
const type = computed(() => (shown.value ? 'text' : 'password'))
const described = computed(() => (props.error ? `${props.id}-error` : props.hint ? `${props.id}-hint` : undefined))
defineExpose({ hide(): void { shown.value = false } })
</script>

<template>
  <div class="pw" :class="{ 'has-error': Boolean(error) }">
    <label :for="id">{{ label }}</label>
    <div class="pw-box">
      <input :id="id" :value="modelValue" :type="type" name="password" :autocomplete="autocomplete" :minlength="minlength" :maxlength="maxlength" required autocapitalize="none" spellcheck="false" :aria-invalid="error ? 'true' : undefined" :aria-describedby="described" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
      <button type="button" class="pw-eye" data-account-eye :aria-pressed="shown" :aria-label="shown ? 'Hide password' : 'Show password'" :title="shown ? 'Hide password' : 'Show password'" @click="shown = !shown">
        <svg v-if="!shown" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5.6 19 2 12 2 12a18 18 0 0 1 5.1-5.9M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2" /><path d="M2 2l20 20" /></svg>
      </button>
    </div>
    <p v-if="error" :id="`${id}-error`" class="pw-note is-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-hint`" class="pw-note">{{ hint }}</p>
  </div>
</template>

<style scoped>
.pw { display: grid; gap: 4px; }
.pw label { font-size: 13px; font-weight: 600; color: var(--c-ink-2); }
.pw-box { position: relative; display: flex; }
.pw-box input { width: 100%; padding-right: 48px !important; }
.pw-eye { position: absolute; top: 50%; right: 4px; display: grid; place-items: center; width: 40px; height: 40px; transform: translateY(-50%); border: 0; border-radius: var(--r-sm); background: none; color: var(--c-muted); cursor: pointer; }
.pw-eye:hover { color: var(--c-ink); background: var(--c-fill); }
.pw-eye:focus-visible { outline: var(--focus); outline-offset: 0; }
.pw-eye[aria-pressed='true'] { color: var(--c-green-dark); }
.pw.has-error .pw-box input { border-color: var(--c-red-dark) !important; }
.pw-note { margin: 0; font-size: 12px; line-height: 1.4; color: var(--c-muted); }
.pw-note.is-error { color: var(--c-red-dark); font-weight: 600; }
</style>
