<script setup lang="ts">
// Community: the events that are on, the faculty quiz, clubs, discoveries, the penalty shoot-out
// and the shared board.
import { computed } from 'vue'
import CampusBoard from './CampusBoard.vue'
import CampusCard from './CampusCard.vue'
import CampusControl from './CampusControl.vue'
import CampusGo from './CampusGo.vue'
import { CAMPUS_CLUBS, CAMPUS_DISCOVERIES } from './campusContent.ts'
import { at, clubReason, discoveryReason, onCampus, penaltyReason, quizReason, title } from './campusModel.ts'
import { useCampus } from './useCampus.ts'

const { state, connected, blocked, community, act } = useCampus()
const eligible = computed(() => community.value?.eligible === true)
const events = computed(() => community.value?.events ?? [])
const quiz = computed(() => community.value?.quiz ?? null)
const clubs = computed(() => (community.value?.clubs?.length ? community.value.clubs : CAMPUS_CLUBS.map((club) => ({ ...club, joined: false }))))
const found = computed(() => new Set((community.value?.discoveries ?? []).filter((item) => item.found).map((item) => item.id)))
const here = computed(() => (onCampus(state.value) && state.value.spot ? CAMPUS_DISCOVERIES[state.value.spot] ?? null : null))
const sports = computed(() => at(state.value, 'sports-centre'))
const union = computed(() => at(state.value, 'student-union'))
</script>

<template>
  <div v-if="events.length" class="campus-events"><span v-for="event in events" :key="event.id">{{ event.label }}</span></div>
  <p v-else class="campus-note">No timed campus event is running now.</p>

  <CampusCard v-if="quiz" icon="🧠" heading="Faculty quiz">
    <p><strong>{{ quiz.question.prompt }}</strong></p>
    <div class="campus-answers">
      <CampusControl v-for="option in quiz.question.options" :key="option.id" primary :label="option.label" :reason="connected ? '' : 'Reconnect to answer.'" @press="act('unilag.quiz.answer', { answer: option.id })" />
    </div>
  </CampusCard>
  <CampusCard v-else icon="🧠" heading="Faculty quiz night">
    <p>Quiz night runs Friday from 6:00 PM to 9:00 PM, Lagos time. The server chooses one question for your faculty.</p>
    <template #extra>
      <CampusControl primary label="Start quiz" :reason="quizReason(blocked, union, eligible)" @press="act('unilag.quiz.start')" />
      <CampusGo v-if="!union" spot="student-union" />
    </template>
  </CampusCard>

  <CampusCard icon="🧩" heading="Clubs">
    <div v-for="club in clubs" :key="club.id" class="campus-row">
      <div><strong>{{ club.label }}</strong><small>{{ title(club.spot) }}{{ club.joined ? ' · Joined' : '' }}</small></div>
      <CampusControl v-if="club.joined" label="Leave" :reason="clubReason(connected, eligible)" @press="act('unilag.club.leave', { id: club.id })" />
      <CampusControl v-else primary label="Join" :reason="clubReason(connected, eligible)" @press="act('unilag.club.join', { id: club.id })" />
    </div>
  </CampusCard>

  <CampusCard icon="🔎" heading="Campus trivia and discoveries">
    <p>{{ here ? `You found ${here.label}.` : 'Look for marked places at Senate, Library, Lagoon Front, Sports Centre and Student Union.' }}</p>
    <template #extra>
      <CampusControl primary label="Log this discovery" :reason="discoveryReason(blocked, eligible, here?.id ?? null, found)" @press="act('unilag.discovery')" />
    </template>
  </CampusCard>

  <CampusCard icon="⚽" heading="Penalty shoot-out">
    <p>Take five server-settled kicks once per Lagos day and add the score to the weekly board.</p>
    <template #extra>
      <CampusControl primary label="Take penalties" :reason="penaltyReason(blocked, eligible, sports)" @press="act('unilag.penalties')" />
      <CampusGo v-if="!sports" spot="sports-centre" />
    </template>
  </CampusCard>

  <CampusBoard />
</template>
