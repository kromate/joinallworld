<script setup lang="ts">
// "You're playing as a guest · Sign up free to keep <Name>" with [Sign up free] [Log in] and a close button.
// A slim bar above the bottom navigation while someone plays as a guest on a server with accounts. It is shown by
// GuestBarSlot (hud/), which decides when; this file is fetched only then.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { openLogin, openSignup } from './accountOpen.ts'

const emit = defineEmits<{ dismiss: [] }>()
const { game, shell } = useApp()
const name = computed(() => game.state.value.name || 'your character')
</script>

<template>
  <section class="gbar" role="region" aria-label="Save your character" data-guest-bar>
    <p><span class="gbar-lead">You’re playing as a guest</span><span class="gbar-dot" aria-hidden="true"> · </span><span class="gbar-ask">Sign up free to keep <b>{{ name }}</b></span></p>
    <button type="button" class="gbar-signup" data-guest-signup @click="openSignup(shell, 'guestbar')">Sign up free</button>
    <button type="button" class="gbar-login" data-guest-login @click="openLogin(shell, 'guestbar')">Log in</button>
    <button type="button" class="gbar-x" data-guest-dismiss aria-label="Hide this for a week" title="Hide this for a week" @click="emit('dismiss')"><GameIcon name="close" :size="16" /></button>
  </section>
</template>

<style scoped>
.gbar { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 6px 6px 14px; border-radius: 22px; background: var(--c-surface); border: 1px solid #fff; box-shadow: var(--e-2); pointer-events: auto; font-size: var(--t-body); color: var(--c-ink-2); animation: gbar-in .28s ease-out both; }
.gbar p { flex: 1; min-width: 0; margin: 0; line-height: 1.3; }
.gbar-lead { font-weight: 700; color: var(--c-ink); }
.gbar-ask b { color: var(--c-green-dark); }
.gbar button { flex: none; border: 0; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.gbar button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.gbar-signup { min-height: 36px; padding: 0 14px; border-radius: var(--r-pill); background: var(--c-green-dark); color: #fff; font-weight: 700; font-size: var(--t-small); }
.gbar-signup:hover { background: #17573a; }
.gbar-login { min-height: 36px; padding: 0 10px; border-radius: var(--r-pill); background: none; color: var(--c-ink-2); font-weight: 600; font-size: var(--t-small); }
.gbar-login:hover { background: var(--c-fill); }
.gbar-x { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: none; color: var(--c-muted); }
.gbar-x:hover { background: var(--c-fill); color: var(--c-ink); }
@keyframes gbar-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 520px) {
  .gbar { padding-left: 12px; gap: 4px; }
  .gbar-lead, .gbar-dot { display: none; }
  .gbar-ask { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: 12px; }
  .gbar-signup { padding: 0 11px; }
  .gbar-login { padding: 0 6px; }
}
@media (prefers-reduced-motion: reduce) { .gbar { animation: none; } }
</style>
