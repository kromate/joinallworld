<script setup lang="ts">
// The companion's row, pinned at the top of Messages. It is always labelled as an AI guide: not a person, and not the founder.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import CompanionFace from './CompanionFace.vue'
import { COMPANION_NAME, COMPANION_TAG } from './identity.ts'
import { createMemory } from './memory.ts'
import { companionUi } from './companionState.ts'

const { game, shell } = useApp()
const mem = computed(() => { void companionUi.tick; return createMemory(globalThis.localStorage ?? null, game.view.value.session?.id ?? '') })
const last = computed(() => mem.value.data.log[mem.value.data.log.length - 1] ?? null)
const unread = computed(() => mem.value.unread())
function open(): void { shell.close(); companionUi.open = true }
</script>

<template>
  <button class="cpin" type="button" data-companion-pin :aria-label="`${COMPANION_NAME}, ${COMPANION_TAG}. ${last ? last.text : 'Ask me anything about Allworld.'}${unread ? ` ${unread} unread` : ''}`" @click="open">
    <CompanionFace :size="44" />
    <span class="cpin-text"><b>{{ COMPANION_NAME }} <i>{{ COMPANION_TAG }}</i></b><small>{{ last ? last.text : 'Ask me anything about Allworld.' }}</small></span>
    <span v-if="unread" class="cpin-badge" aria-hidden="true">{{ unread }}</span>
  </button>
</template>

<style scoped>
.cpin { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 60px; margin: 0 0 8px; padding: 8px 12px; border: 1.5px solid var(--c-green); border-radius: var(--r-md); background: var(--c-green-soft); color: var(--c-ink); text-align: left; font-family: var(--font); cursor: pointer; }
.cpin:focus-visible { outline: var(--focus); outline-offset: 2px; }
.cpin-text { display: grid; min-width: 0; flex: 1; }
.cpin-text b { font-size: var(--t-lead); }
.cpin-text i { margin-left: 6px; padding: 1px 7px; border-radius: var(--r-pill); background: var(--c-green-dark); color: #fff; font-style: normal; font-size: var(--t-micro); }
.cpin-text small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-muted); font-size: var(--t-body); }
.cpin-badge { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: var(--c-badge); color: #fff; font-size: 12px; font-weight: 700; }
</style>
