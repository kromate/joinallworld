<script setup lang="ts">
// "How it works": the one disclosure every app uses for its longer rules. An app shows one short
// line of what matters now and folds the rest away. Costs and deadlines never go in here: they
// stay on the card itself.
//
// A native <details>, so it is a real control for keyboard and screen reader. Which ones are open
// is kept by id for the page, so one stays open when its app is left and come back to.
import { computed } from 'vue'
import { openHows } from './howState.ts'

const props = withDefaults(defineProps<{
  /** Unique across the game: 'bank-rent'. */
  id: string
  /** The rules, one plain sentence each. Blank ones are dropped. */
  rules: readonly (string | null | undefined)[]
  label?: string
  /** It sits on the page itself rather than inside a white card. */
  page?: boolean
}>(), { label: 'How it works', page: false })
const lines = computed(() => props.rules.map((line) => String(line ?? '').trim()).filter(Boolean))
function onToggle(event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  if (open) openHows.add(props.id); else openHows.delete(props.id)
}
</script>

<template>
  <details v-if="lines.length" class="how" :class="{ 'is-page': page }" :open="openHows.has(id)" @toggle="onToggle">
    <summary>{{ label }}</summary>
    <ul class="how-body"><li v-for="line in lines" :key="line">{{ line }}</li></ul>
  </details>
</template>

<style scoped>
.how { margin: 2px 0 -6px; font-size: 12px; line-height: 1.5; color: var(--c-muted); }
.how > summary { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); margin: 0 -10px; padding: 0 10px; border-radius: var(--r-pill); font: 600 12px var(--font); color: var(--c-ink-2); cursor: pointer; list-style: none; -webkit-tap-highlight-color: transparent; }
.how > summary::-webkit-details-marker { display: none; }
.how > summary::before { content: 'i'; display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px currentColor; font: 700 11px/1 ui-serif, Georgia, serif; opacity: .8; }
.how > summary::after { content: ''; width: 6px; height: 6px; margin: -3px 2px 0 1px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); opacity: .7; }
.how[open] > summary::after { margin-top: 3px; transform: rotate(225deg); }
.how > summary:hover { background: var(--c-fill); }
.how > summary:focus-visible { outline: var(--focus); outline-offset: 1px; }
.how-body { max-width: 68ch; margin: 0 0 var(--s-2); padding: 10px 12px 10px 28px; border-radius: var(--r-sm); background: var(--c-fill); }
.how-body li + li { margin-top: 3px; }
.how.is-page { margin: 0 2px 2px; }
.how.is-page > .how-body { background: #fff; box-shadow: var(--e-1), var(--ring); }
</style>
