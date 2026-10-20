<script setup lang="ts">
// The admin address's page. It asks the server who this browser is (the account routes) and shows one of: the sign-in, a plain "staff only"
// page for someone who is signed in but is not an admin, or the admin screens. No game, no scene, no sound, no companion is loaded here.
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { createAccount } from '../app/features/account/accountStore.ts'
import { setAdminTransport } from '../app/features/admin/transport.ts'
import { admin } from '../app/features/admin/useAdmin.ts'
import type { AdminMe } from '../types/admin.ts'
import AdminSignIn from './AdminSignIn.vue'
import { STAFF_ONLY, gameUrlOf, phaseOf } from './phase.ts'
import type { Phase } from './phase.ts'
import { fetchJson, transport } from './transport.ts'
import './host.css'

const AdminShell = defineAsyncComponent(() => import('../app/features/admin/AdminShell.vue'))
setAdminTransport(transport)
const account = createAccount({ fetchJson, loadProvider: () => import('../app/features/account/identityProvider.ts'), origin: () => location.origin, forgetLife() { /* no life is kept here */ }, reload: () => location.reload() })
const phase = ref<Phase>('loading')
const gameUrl = gameUrlOf(location)

async function start(): Promise<void> {
  phase.value = 'loading'
  try { await account.load(true) } catch { phase.value = 'down'; return }
  const here = { enabled: account.state.enabled, signedIn: Boolean(account.state.account) }
  phase.value = phaseOf(here, null)
  if (phase.value !== 'loading') return
  try { admin.me = await fetchJson<AdminMe>('/api/admin/me'); phase.value = phaseOf(here, 'ok') } catch (error) { phase.value = phaseOf(here, (error as { status?: number }).status === 404 ? 'refused' : 'failed') }
}
onMounted(() => { void start() })
// A sign-in that went through: the cookie is new, so the page starts again and asks again. (Two characters to choose from: the account's own is kept.)
watch(() => account.state.step, (step) => { if (step === 'done') location.reload(); else if (step === 'choice') void account.choose(null) })
</script>

<template>
  <div v-if="phase === 'loading'" class="ah-center" role="status"><p class="ah-lead">Checking who you are…</p></div>
  <AdminShell v-else-if="phase === 'ready'" mode="page" :account="account" :game-url="gameUrl" />
  <main v-else-if="phase === 'denied'" class="ah-center">
    <section class="ah-card" aria-labelledby="ah-denied">
      <h1 id="ah-denied">{{ STAFF_ONLY }}</h1>
      <p class="ah-lead">The account you are signed in with does not have admin rights.</p>
      <a class="ah-primary" :href="gameUrl">Go to the game</a>
      <button type="button" class="ah-link" @click="account.signOut()">Sign out of this address</button>
    </section>
  </main>
  <main v-else-if="phase === 'off'" class="ah-center"><section class="ah-card"><h1>Sign-in is not set up</h1><p class="ah-lead">Accounts are not configured on this server, so there is nobody to sign in.</p><a class="ah-primary" :href="gameUrl">Go to the game</a></section></main>
  <main v-else-if="phase === 'down'" class="ah-center"><section class="ah-card"><h1>The server did not answer</h1><p class="ah-lead">Check the connection and try again.</p><button type="button" class="ah-primary" @click="start">Try again</button></section></main>
  <AdminSignIn v-else :account="account" />
</template>
