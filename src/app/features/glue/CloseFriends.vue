<script setup lang="ts">
// Close friends (docs/SOCIAL-GLUE.md), a fold of People: pick close friends among your friends, and choose whether they see where you are
// in the game ("Tunde is in the Square now"). Off until you turn it on; turning it off stops it at once. Above it, the close friends who
// share with you and where they are now. Places in the game only: the page never asks for, and the server never has, a real position.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import { GLUE } from '../../../glue/model.ts'
import { glue, loadClose, setClose } from './glueStore.ts'

const { shell } = useApp()
const open = ref(false), busy = ref(false), problem = ref<string | null>(null), pick = ref('')
onMounted(() => { void loadClose() })
watch(() => glue.rev.close, () => { void loadClose() })
const view = computed(() => glue.close)
async function change(body: Record<string, unknown>): Promise<void> { busy.value = true; problem.value = await setClose(body); busy.value = false; pick.value = '' }
</script>

<template>
  <section class="glue-close" data-glue="close" aria-label="Close friends">
    <div v-for="line in glue.now" :key="line.id" class="social-row">
      <PlayerAvatar :name="line.name" :seed="line.id" status="online" />
      <div><strong>{{ line.line }}</strong><small>Close friend</small></div>
      <span class="social-actions"><button type="button" class="social-btn" @click="shell.open('messages', { to: line.id, name: line.name })">Chat</button></span>
    </div>
    <button type="button" class="social-btn is-wide" :aria-expanded="open" @click="open = !open">Close friends{{ view ? ` · ${view.list.length}` : '' }} · {{ view?.on ? 'they see where you are' : 'sharing off' }}</button>
    <div v-if="open && view" class="feed-card feed-form">
      <label class="feed-row"><input type="checkbox" :checked="view.on" :disabled="busy" data-glue="close-switch" @change="change({ on: ($event.target as HTMLInputElement).checked })"> Let my close friends see where I am in the game</label>
      <p class="social-note">They see the place in Allworld you are at (a venue, the Square, your city), never where you are in real life. Nobody else sees it. Off stops it at once.</p>
      <div v-for="p in view.list" :key="p.id" class="social-row">
        <PlayerAvatar :name="p.name" :seed="p.id" /><div><strong>{{ p.name }}</strong></div>
        <span class="social-actions"><button type="button" class="social-btn" :disabled="busy" @click="change({ remove: p.id })">Remove</button></span>
      </div>
      <p v-if="!view.list.length" class="social-note">No close friends yet.</p>
      <label v-if="view.friends.length && view.list.length < GLUE.close.max" class="feed-row">Add
        <select v-model="pick" :disabled="busy" @change="pick && change({ add: pick })"><option value="">Choose a friend</option><option v-for="f in view.friends" :key="f.id" :value="f.id">{{ f.name }}</option></select>
      </label>
      <p v-if="problem" class="social-note" role="alert">{{ problem }}</p>
    </div>
  </section>
</template>
