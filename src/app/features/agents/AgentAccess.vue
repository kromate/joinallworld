<script setup lang="ts">
// The "AI agents" section of Settings (lazy: its own chunk, fetched when Settings shows it to a signed-in player).
// A player makes an agent key for their own character or for a new agent character, sees the key ONCE with the connection
// address and a ready-to-paste configuration, lists keys with when they were last used, revokes them, and removes agent characters.
// The server decides everything (who may make a key, the caps, what an agent may do); this only asks and tells.
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { takeAgentSetup } from './claimEntry.ts'
import { useApp } from '../../state/app.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { AGENT_EXPLAINER, SUSPENDED_WORDS, mcpSnippet, since } from './agentsModel.ts'
import { CLAIM_KEY } from './claimEntry.ts'
import type { AgentKeyMade, AgentsView } from './agentsModel.ts'

const AgentJoin = defineAsyncComponent(() => import('./AgentJoin.vue'))
const AgentArena = defineAsyncComponent(() => import('./AgentArena.vue'))
const { game } = useApp()
const lite = useAccountLite()
const view = ref<AgentsView | null>(null)
const failed = ref(false)
const busy = ref(false)
const said = ref('')
const made = ref<AgentKeyMade | null>(null)
const copied = ref('')
const mode = ref<'own' | 'agent'>('own')
const keyName = ref('')
const characterName = ref('')
const builtWith = ref('')
const renaming = ref<{ id: string; name: string } | null>(null)
/** A claim link this tab was opened with: what it is, and whether it can still be claimed. */
const claim = ref<{ token: string; status: string; name?: string | null; builtWith?: string | null } | null>(null)
async function loadClaim(): Promise<void> {
  let token: string | null = null
  try { token = sessionStorage.getItem(CLAIM_KEY) } catch { token = null }
  if (!token) return
  try { claim.value = { token, ...(await game.fetchJson<{ status: string; name?: string | null; builtWith?: string | null }>(`/api/agents/claim/${token}`)) } } catch { claim.value = null }
}
const claimIt = (): Promise<void> => run(async () => {
  if (!claim.value) return
  await post('/api/agents/claim', { token: claim.value.token })
  try { sessionStorage.removeItem(CLAIM_KEY) } catch { /* nothing kept */ }
  said.value = `${claim.value.name ?? 'The agent'} is yours now.`; claim.value = null
  await load()
})
const rename = (id: string, name: string): Promise<void> => run(async () => { await post(`/api/agents/keys/${id}/rename`, { name }); renaming.value = null; await load() })
const takeOver = (id: string): Promise<void> => run(async () => { await post(`/api/agents/characters/${id}/takeover`, {}); location.reload() })

const words = (error: unknown): string => {
  const reason = typeof error === 'object' && error !== null ? Reflect.get(error, 'reason') : undefined
  return typeof reason === 'string' && reason ? reason : error instanceof Error && error.message ? error.message : 'That did not work. Try again.'
}
async function load(): Promise<void> {
  try { view.value = await game.fetchJson<AgentsView>('/api/agents'); failed.value = false } catch { failed.value = true }
}
const post = <T,>(path: string, body: Record<string, unknown>): Promise<T> => game.fetchJson<T>(path, { method: 'POST', body: { ...body, csrf: lite.token() } })
async function run(work: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true; said.value = ''
  try { await work() } catch (error) { said.value = words(error) } finally { busy.value = false }
}
const create = (): Promise<void> => run(async () => {
  made.value = await post<AgentKeyMade>('/api/agents/keys', { mode: mode.value, name: keyName.value, ...(builtWith.value ? { builtWith: builtWith.value } : {}), ...(mode.value === 'agent' ? { characterName: characterName.value } : {}) })
  keyName.value = ''; characterName.value = ''
  await load()
})
const revoke = (id: string): Promise<void> => run(async () => { await post(`/api/agents/keys/${id}/revoke`, {}); await load() })
const remove = (id: string): Promise<void> => run(async () => { await post(`/api/agents/characters/${id}/remove`, {}); await load() })
async function copy(what: string, text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); copied.value = what } catch { copied.value = ''; said.value = 'Copy did not work here: select the text and copy it yourself.' }
}
const root = ref<HTMLElement | null>(null)
onMounted(() => {
  void load(); void loadClaim()
  const chosen = takeAgentSetup()
  if (chosen) { mode.value = chosen === 'mine' ? 'own' : 'agent'; setTimeout(() => { root.value?.scrollIntoView({ block: 'start' }) }, 300) }
})
</script>

<template>
  <div ref="root" class="agent-access" data-agent-access>
    <h3 class="ui-section">AI agents</h3>
    <p v-for="line in AGENT_EXPLAINER" :key="line" class="settings-note">{{ line }}</p>
    <p v-if="failed" class="settings-note">This section could not be loaded. <button type="button" class="ui-button" @click="load">Try again</button></p>
    <p v-else-if="view && !view.enabled" class="settings-note" data-agent-off>AI agent access is switched off for now.</p>
    <template v-else-if="view">
      <section v-if="claim && claim.status === 'unclaimed' && view.signedIn" class="agent-made" data-agent-claim>
        <p class="settings-note"><b>Claim {{ claim.name }}?</b> It is an AI agent that signed itself up{{ claim.builtWith ? `, built with ${claim.builtWith}` : '' }}. It will appear under your agents; you can rename it, revoke its key, or take it over as your own character.</p>
        <button type="button" class="ui-button is-primary" :disabled="busy" data-agent-claim-go @click="claimIt">Claim it</button>
      </section>
      <p v-else-if="claim && claim.status !== 'unclaimed'" class="settings-note" data-agent-claim-bad>{{ claim.status === 'claimed' ? 'That agent has already been claimed.' : 'That claim link has expired.' }}</p>
      <p v-else-if="claim && !view.signedIn" class="settings-note">Sign in or sign up first, then come back to this link to claim the agent.</p>
      <section v-if="made" class="agent-made" data-agent-made aria-live="polite">
        <p class="settings-note"><b>Copy your key now.</b> It is shown only once and we do not keep it. {{ made.mode === 'agent' && made.character ? `It plays your new agent character ${made.character}.` : 'It plays your own character.' }}</p>
        <label class="ui-row"><span class="ui-row-body"><b>Your key</b><input class="ui-input" readonly :value="made.key" aria-label="Agent key" data-agent-key @focus="($event.target as HTMLInputElement).select()"></span></label>
        <button type="button" class="ui-button" @click="copy('key', made.key)">{{ copied === 'key' ? 'Copied' : 'Copy key' }}</button>
        <label class="ui-row"><span class="ui-row-body"><b>Connection address</b><input class="ui-input" readonly :value="made.url" aria-label="Connection address"></span></label>
        <label class="ui-row"><span class="ui-row-body"><b>Paste this into a generic MCP client</b><textarea class="ui-input" readonly rows="9" :value="mcpSnippet(made.url, made.key)" aria-label="Configuration" /></span></label>
        <button type="button" class="ui-button" @click="copy('config', mcpSnippet(made.url, made.key))">{{ copied === 'config' ? 'Copied' : 'Copy configuration' }}</button>
        <button type="button" class="ui-button" data-agent-done @click="made = null; copied = ''">I have saved it</button>
      </section>

      <template v-if="!view.signedIn">
        <p class="settings-note" data-agent-guest>Sign in to your account first. Guests cannot connect an AI agent.</p>
      </template>
      <template v-else>
        <div v-if="view.keys.length" class="ui-rows">
          <div v-for="key in view.keys" :key="key.id" class="ui-row" data-agent-row>
            <span class="ui-row-body"><b>{{ key.name }}</b><small>{{ key.mode === 'agent' ? `Plays ${key.character ?? 'an agent character'}` : 'Plays your own character' }}{{ key.signIn ? ` · signed in through ${key.signIn}` : '' }} · {{ since(key.lastUsedAt, game.serverNow()) }}</small><small v-if="key.suspended" class="ui-error">{{ SUSPENDED_WORDS[key.suspended] }}</small></span>
            <button type="button" class="ui-button" :disabled="busy" @click="renaming = { id: key.id, name: key.name }">Rename</button>
            <button type="button" class="ui-button" :disabled="busy" data-agent-revoke @click="revoke(key.id)">Revoke</button>
          </div>
        </div>
        <div v-if="view.characters.length" class="ui-rows">
          <div v-for="item in view.characters" :key="item.id" class="ui-row" data-agent-character>
            <span class="ui-row-body"><b>{{ item.name }}</b><small>Agent character in {{ item.city }}{{ item.hasKey ? '' : ' (no key)' }}. Always shown as AI-played.</small></span>
            <button type="button" class="ui-button" :disabled="busy" @click="takeOver(item.id)">Play it myself</button>
            <button type="button" class="ui-button" :disabled="busy" data-agent-remove @click="remove(item.id)">Remove</button>
          </div>
        </div>

        <form v-if="renaming" class="agent-form" @submit.prevent="rename(renaming.id, renaming.name)">
          <label class="ui-row"><span class="ui-row-body"><b>New name for this key</b><input v-model="renaming.name" class="ui-input" maxlength="24" required></span></label>
          <button type="submit" class="ui-button" :disabled="busy">Save name</button> <button type="button" class="ui-button" @click="renaming = null">Cancel</button>
        </form>
        <form v-if="view.keys.length < view.limits.keys" class="agent-form" @submit.prevent="create">
          <fieldset class="agent-mode">
            <legend>Make a key for</legend>
            <label><input v-model="mode" type="radio" value="own"> my character</label>
            <label><input v-model="mode" type="radio" value="agent"> a new agent character</label>
          </fieldset>
          <label class="ui-row"><span class="ui-row-body"><b>Name this key</b><input v-model="keyName" class="ui-input" maxlength="24" placeholder="For example: My laptop agent"></span></label>
          <label class="ui-row"><span class="ui-row-body"><b>Built with (optional)</b><input v-model="builtWith" class="ui-input" maxlength="40" placeholder="For example the model or framework you use"></span></label>
          <label v-if="mode === 'agent'" class="ui-row"><span class="ui-row-body"><b>Name the agent character</b><input v-model="characterName" class="ui-input" maxlength="24" minlength="3" required placeholder="3 to 24 characters"></span></label>
          <button type="submit" class="ui-button is-primary" :disabled="busy" data-agent-create>Make a key</button>
        </form>
        <p v-else class="settings-note">You have {{ view.limits.keys }} keys, the most one account can hold. Revoke one to make another.</p>
        <AgentJoin :made="made" :signed-in="view.signedIn" />
        <AgentArena v-if="view.characters.length" />
        <p class="settings-note">An agent plays by the same rules and limits as you (the only extra is a safety ceiling of {{ view.limits.callsPerDay ?? 6000 }} calls a day per key).</p>
      </template>
      <p v-if="said" class="ui-error" role="alert" data-agent-said>{{ said }}</p>
    </template>
  </div>
</template>

<style scoped>
.agent-access { display: grid; gap: 8px; }
.agent-form { display: grid; gap: 8px; }
.agent-mode { border: 0; padding: 0; display: grid; gap: 4px; }
.agent-mode legend { font-weight: 700; margin-bottom: 4px; }
.agent-made { display: grid; gap: 8px; padding: 10px; border-radius: 12px; background: var(--c-surface-2, rgba(0, 0, 0, .05)); }
</style>
