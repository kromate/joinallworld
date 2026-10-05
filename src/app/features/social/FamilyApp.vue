<script setup lang="ts">
// Family (an original beta feature): your household and a daily check-in call to each of them.
// Everything here is original and labelled beta.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed } from 'vue'
import BaseChip from '../../ui/BaseChip.vue'
import CallButton from './CallButton.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { callNote } from './socialWords.ts'
import { useSocialScreen } from './useSocialScreen.ts'

defineProps<{ params?: unknown }>()
const { game, view, cannot } = useSocialScreen()
const social = computed(() => view.value.social)
const called = computed(() => social.value.family.filter((member) => member.calledToday).length)
const note = computed(() => callNote({ connected: view.value.connected, cannot: cannot('call'), busy: Boolean(game.state.value.activeAction) }))
</script>

<template>
  <div class="family">
    <section class="ui-hero family-hero">
      <small>Your people back home <span class="social-beta">Beta</span></small>
      <strong>{{ called }} of {{ social.family.length }} checked in today</strong>
      <p>Streak: {{ social.streak }} day{{ social.streak === 1 ? '' : 's' }} · each first call of the day gives +{{ social.familyCall.social }} Social and +{{ social.familyCall.mood }} mood for a few hours</p>
    </section>
    <div class="social-list">
      <div v-for="member in social.family" :key="member.id" class="social-row">
        <span class="social-avatar is-big" aria-hidden="true"><PlayerAvatar :name="member.name" :seed="member.id" /></span>
        <div><strong>{{ member.name }}<template v-if="member.calledToday"> <BaseChip tone="good">Checked in</BaseChip></template></strong><small>{{ member.relation }} · {{ member.line }}</small></div>
        <span class="social-actions"><CallButton :member="member" /></span>
      </div>
    </div>
    <p v-if="note" class="ui-why">{{ note }}</p>
    <p class="ui-note">A call takes {{ social.familyCall.duration }} seconds and works anywhere. Calling again the same day is only a quick hello.</p>
    <p class="preview-note">Original beta feature and values. The family here is the same for every player for now.</p>
  </div>
</template>
