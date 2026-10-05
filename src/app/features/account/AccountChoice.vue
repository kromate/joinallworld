<script setup lang="ts">
// The merge choice. A device that already had a played life signed in to an account that already
// had a character: the account's character is in play and this device's life has been set aside —
// both are kept. This screen says so and asks which one to play. Choosing swaps them; nothing is
// ever deleted here, and the other one stays in the account's set-aside list (Settings).
import { computed } from 'vue'
import { useAccount } from './useAccount.ts'

const account = useAccount()
const state = account.state
const active = computed(() => state.result?.character?.name || 'your saved character')
const aside = computed(() => state.result?.parked ?? null)
</script>

<template>
  <div class="account-choice" data-account-choice>
    <div class="session-card"><h3>Two characters, one to play</h3><p>This account already has a character, and this device had one of its own. Both are kept. Choose which one to play now.</p></div>
    <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
    <div class="account-pair" role="group" aria-label="Which character to play">
      <section class="account-card">
        <small>From your account · in play now</small>
        <b>{{ active }}</b>
        <button type="button" class="ui-button is-primary is-block" data-account-keep :disabled="state.busy" @click="account.choose(null)">Keep playing {{ active }}</button>
      </section>
      <section v-if="aside" class="account-card">
        <small>From this device · set aside</small>
        <b>{{ aside.name }}</b>
        <button type="button" class="ui-button is-block" data-account-switch :disabled="state.busy" @click="account.choose(aside.id)">Play {{ aside.name }} instead</button>
      </section>
    </div>
    <p class="session-note">Nothing is deleted. The character you do not pick stays set aside in your account, and you can switch back any time in Settings.</p>
  </div>
</template>

<style scoped>
.account-pair { display: grid; gap: var(--s-2); }
.account-card { display: grid; gap: 6px; padding: 14px 16px; border-radius: var(--r-md); background: var(--c-fill); }
.account-card small { font-size: 12px; color: var(--c-muted); }
.account-card b { font-size: var(--t-title); }
</style>
