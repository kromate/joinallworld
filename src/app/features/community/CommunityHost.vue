<script setup lang="ts">
// The floating Community aside: opened by the `data-community` buttons (store.toggle), closed by its
// own button. Drop it into App.vue once. It shows the panel when the controller is running, and what
// went wrong (with the two ways out) while the community code did not load or did not start.
// Hidden while closed; the store keeps it closed at home.
import { defineAsyncComponent } from 'vue'
import { useCommunity } from './communityStore.ts'
import type { CommunityStore } from './communityStore.ts'
// The panel is drawn only once the community code has loaded (long after the first paint), so its own code is fetched with it.
const CommunityPanel = defineAsyncComponent(() => import('./CommunityPanel.vue'))

const props = defineProps<{ store?: CommunityStore }>()
const store = props.store ?? useCommunity()
</script>

<template>
  <aside v-if="store.open.value" id="community-panel" aria-label="Community">
    <button id="community-close" type="button" aria-label="Close community" @click="store.close()">×</button>
    <div id="community-content">
      <section v-if="store.recovery.value" data-community-recovery aria-label="Community unavailable">
        <h2>{{ store.recovery.value.heading }}</h2>
        <p>{{ store.recovery.value.lead }}</p>
        <p role="status">{{ store.recovery.value.next }}</p>
        <p>
          <button type="button" class="ui-button is-primary" data-community-reload @click="store.reload()">Reload and retry</button>
          <button type="button" class="ui-button" data-community-retry :disabled="store.recovery.value.waiting" @click="store.retry()">Try again</button>
        </p>
      </section>
      <CommunityPanel v-else-if="store.state.value" :store="store" />
      <p v-else role="status">Community is loading…</p>
    </div>
  </aside>
</template>
