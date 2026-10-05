<script setup lang="ts">
// The account's place in the top bar, on a server where accounts are configured (nothing at all otherwise):
//   not signed in   "Sign up" (filled) and "Log in" (quiet), always there, after the online pill. A phone keeps
//                   "Sign up" and leaves "Log in" to the sheet's own "I already have an account" and to Settings.
//   signed in       a chip with the first letter of the character's name and the name; it opens the account sheet
//                   (who is signed in, the devices, sign out).
// This is the only part of sign-in in the first download; the sheet is fetched when it opens.
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { openAccount, openLogin, openSignup } from '../account/accountOpen.ts'
import { signupShown } from '../account/shownOnce.ts'
import { useAccountLite } from '../account/useAccountLite.ts'

const { game, shell } = useApp()
const account = useAccountLite()
const state = account.state
const connected = game.connected
const show = computed(() => state.loaded && state.enabled && connected.value)
const signedIn = computed(() => show.value && state.account !== null)
const guest = computed(() => show.value && state.account === null)
const name = computed(() => state.character?.name || game.state.value.name || 'You')
const initial = computed(() => Array.from(name.value.trim())[0]?.toUpperCase() ?? '?')

// Load once the page is connected: the answer depends on the session cookie.
watch(connected, (on) => { if (on) void account.load() }, { immediate: true })
watch(guest, (now) => { if (now) signupShown('hud') }, { immediate: true })
</script>

<template>
  <span v-if="guest" class="acct-auth" data-account-hud>
    <button type="button" class="acct-signup" data-tour="signup" data-account-signup @click="openSignup(shell, 'hud', state.guest)">Sign up</button>
    <button type="button" class="acct-login" data-account-login @click="openLogin(shell, 'hud')">Log in</button>
  </span>
  <button v-else-if="signedIn" type="button" class="acct-chip" data-account-chip :aria-label="`Your account: ${name}`" title="Your account" @click="openAccount(shell)">
    <i aria-hidden="true">{{ initial }}</i><span>{{ name }}</span>
  </button>
</template>

<style scoped>
.acct-auth { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.acct-signup, .acct-login, .acct-chip { border: 0; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; white-space: nowrap; }
.acct-signup:focus-visible, .acct-login:focus-visible, .acct-chip:focus-visible { outline: var(--focus); outline-offset: 2px; }
.acct-signup { position: relative; min-height: 32px; padding: 0 14px; border-radius: var(--r-pill); background: var(--c-green-dark); color: #fff; font-weight: 700; font-size: var(--t-small); box-shadow: inset 0 1px 0 #ffffff40; }
.acct-signup::after { content: ''; position: absolute; inset: -6px -2px; }
.acct-signup:hover { background: #17573a; }
.acct-login { min-height: 32px; padding: 0 10px; border-radius: var(--r-pill); background: none; color: var(--c-ink-2); font-weight: 600; font-size: var(--t-small); }
.acct-login:hover { background: var(--c-fill); }
.acct-chip { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; max-width: 190px; padding: 0 12px 0 4px; border-radius: var(--r-pill); background: var(--c-fill); color: var(--c-ink); font-weight: 600; font-size: var(--t-small); }
.acct-chip:hover { background: var(--c-green-soft); }
.acct-chip i { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--c-green-dark); color: #fff; font-style: normal; font-weight: 700; font-size: 13px; }
.acct-chip span { overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 720px) {
  .acct-login { display: none; }
  .acct-signup { min-height: 30px; padding: 0 11px; }
  .acct-chip { padding: 0 4px; max-width: none; }
  .acct-chip span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
</style>
