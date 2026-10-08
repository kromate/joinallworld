<script setup lang="ts">
import { ref } from 'vue'
const model = defineModel<string>({ required: true })
const props = withDefaults(defineProps<{ id: string; label: string; name?: string; type?: 'text' | 'search' | 'email' | 'tel' | 'url'; placeholder?: string; help?: string; error?: string; disabled?: boolean; clearable?: boolean; autocomplete?: string }>(), { type: 'text', autocomplete: 'off', disabled: false, clearable: false })
const field = ref<HTMLInputElement | null>(null)
function clear(): void { model.value = ''; field.value?.focus() }
</script>
<template>
  <div class="app-field">
    <label :for="id">{{ label }}</label>
    <div class="app-field-control" :class="{ 'is-invalid': error, 'is-disabled': disabled }">
      <input :id="id" ref="field" v-model="model" class="app-field-input" :name="name ?? id" :type="type" :placeholder="placeholder" :autocomplete="autocomplete" :disabled="disabled" :aria-invalid="error ? true : undefined" :aria-describedby="error ? `${id}-error` : help ? `${id}-help` : undefined">
      <button v-if="clearable && model && !disabled" type="button" :aria-label="type === 'search' ? 'Clear search' : `Clear ${props.label.toLocaleLowerCase()}`" @click="clear">Clear</button>
    </div>
    <p v-if="error" :id="`${id}-error`" class="app-field-error" role="alert">{{ error }}</p>
    <p v-else-if="help" :id="`${id}-help`" class="app-field-help">{{ help }}</p>
  </div>
</template>
<style scoped>
.app-field { display: grid; gap: 7px; }
.app-field label { font-size: 14px; font-weight: 650; color: var(--c-ink); }
.app-field-control { display: flex; align-items: center; min-height: 48px; border: 1px solid #8996a6; border-radius: 10px; background: #fff; }
.app-field-control:focus-within { border-color: var(--c-blue); outline: 2px solid var(--c-blue); outline-offset: 2px; }
.app-field-input { display: block; flex: 1; min-width: 0; width: 100%; min-height: 46px; padding: 10px 14px; border: 0; border-radius: inherit; background: transparent; color: var(--c-ink); font: 400 16px/1.5 var(--font); outline: none; box-shadow: none; }
.app-field-input::placeholder { color: var(--c-faint); opacity: 1; }
.app-field-input::-webkit-search-cancel-button { display: none; }
.app-field-control button { min-height: 44px; padding: 0 12px; border: 0; background: none; color: var(--c-blue); font: 600 13px var(--font); cursor: pointer; }
.app-field-control.is-invalid { border-color: var(--c-red-dark); }
.app-field-control.is-disabled { background: var(--c-fill); }
.app-field-help,.app-field-error { margin: 0; font-size: 13px; line-height: 1.4; color: var(--c-muted); }
.app-field-error { color: var(--c-red-dark); }
</style>
