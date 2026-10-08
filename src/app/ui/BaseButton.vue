<script setup lang="ts">
// The game's button. A disabled button that has a reason shows it as its tooltip and its
// accessible description, so "why can't I press this" is always answered.
withDefaults(defineProps<{
  variant?: 'default' | 'primary' | 'danger' | 'selected'
  block?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  /** Why the button is disabled. */
  reason?: string | null
}>(), { variant: 'default', block: false, small: false, type: 'button', disabled: false, reason: null })
</script>

<template>
  <button class="base-button" :class="[`is-${variant}`, { 'is-block': block, 'is-small': small }]" :type="type" :disabled="disabled || Boolean(reason)" :title="reason ?? undefined">
    <slot />
  </button>
</template>

<style scoped>
.base-button { border: 0; background: var(--c-fill); color: var(--c-ink); border-radius: var(--r-sm); padding: 10px 18px; min-height: var(--tap); font: 650 14px var(--font); cursor: pointer; transition: filter var(--ease), background var(--ease); }
.base-button:hover:enabled { filter: brightness(.96); }
.base-button:active:enabled { filter: brightness(.9); }
.base-button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.base-button.is-primary { background: var(--button-primary, var(--c-green-dark)); color: var(--button-primary-ink, #fff); }
.base-button.is-selected { background: var(--button-selected, #e6edf9); color: var(--button-selected-ink, #193d7a); box-shadow: inset 0 0 0 1px currentColor; }
.base-button.is-danger { background: var(--c-red-soft); color: var(--c-red-dark); }
.base-button.is-block { display: block; width: 100%; }
.base-button.is-small { padding: 8px 14px; font-size: 13px; }
.base-button:disabled { cursor: not-allowed; opacity: .6; }
</style>
