<script setup lang="ts">
// Campus: the Phone app for the University of Lagos (src/campus/unilag). Overview, Study, Residence
// and Community. The game stays on the server: every button sends one action (or walks to a
// landmark) and the answer, not the press, changes what is shown. Lagos only: in another city the
// shared board says so and the way in is one trip away.
import '../../../ui/controls.css'
import './campus.css'
import { computed, onMounted, watch } from 'vue'
import CampusCommunity from './CampusCommunity.vue'
import CampusOverview from './CampusOverview.vue'
import CampusResidence from './CampusResidence.vue'
import CampusStudy from './CampusStudy.vue'
import { TABS, onCampus, title } from './campusModel.ts'
import { choices, loadShared, useCampus } from './useCampus.ts'

defineProps<{ params?: unknown }>()
const { game, state, view, student, go } = useCampus()
const here = computed(() => onCampus(state.value))
const place = computed(() => (here.value ? title(state.value.spot || 'campus') : view.value.city?.name || 'the city'))

// The programme the student studies is the one the forms start from; taken over once per change.
watch(() => student.value?.programme?.id ?? '', (id) => {
  if (id && choices.studentProgramme !== id) { choices.studentProgramme = id; choices.programme = id as typeof choices.programme }
  else if (!id) choices.studentProgramme = ''
}, { immediate: true })

// The shared board is read when the app opens and again as the life changes (at most every 20 seconds).
onMounted(() => loadShared(game))
watch([() => game.state.value, () => view.value.connected, () => view.value.cityId], () => loadShared(game))
</script>

<template>
  <div class="campus-app">
    <section class="campus-hero">
      <div>
        <span class="campus-kicker">University of Lagos · Akoka</span>
        <h3>{{ here ? `You are at ${place}` : 'Campus is one trip away' }}</h3>
        <p>{{ student?.programme ? `${student.programme.label} · ${title(student.status)}` : 'Explore as a visitor, or apply for the compressed campus programme.' }}</p>
      </div>
      <span v-if="here" class="campus-live">On campus</span>
      <button v-else type="button" class="ui-button is-primary" @click="go('main-gate')">Travel to UNILAG</button>
    </section>
    <nav class="campus-tabs" aria-label="Campus sections">
      <button v-for="[id, label] in TABS" :key="id" type="button" :aria-current="choices.tab === id ? 'page' : 'false'" @click="choices.tab = id">{{ label }}</button>
    </nav>
    <section class="campus-body" :data-campus-section="choices.tab">
      <CampusStudy v-if="choices.tab === 'study'" />
      <CampusResidence v-else-if="choices.tab === 'residence'" />
      <CampusCommunity v-else-if="choices.tab === 'community'" />
      <CampusOverview v-else />
    </section>
  </div>
</template>
