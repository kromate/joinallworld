<script setup lang="ts">
// Mounted once in App.vue (in the stack above the navigation) and tiny on purpose: the banner and everything behind it
// (noticeStore.ts: the clock, the check of the host's build) are fetched when the first update notice arrives.
import { defineAsyncComponent, ref } from 'vue'
import { onCallFrame } from '../social/useSocial.ts'

const wanted = ref(false), announced = ref(false)
onCallFrame((frame) => {
  if (frame.type === 'announce') announced.value = true
  else if (frame.type === 'notice') wanted.value = true
  else return
  void import('./noticeFrames.ts').then((frames) => frames.receive(frame))
})
const NoticeBanner = defineAsyncComponent(() => import('./NoticeBanner.vue'))
const AnnounceBanner = defineAsyncComponent(() => import('../announce/AnnounceBanner.vue'))
</script>

<template>
  <NoticeBanner v-if="wanted" />
  <AnnounceBanner v-if="announced" />
</template>

<style>
/* The stack above the navigation spans both columns of the landscape phone layout, as the coach, progress and guest slots do. */
.life-bottom > [data-slot=notice] { grid-column: 1 / -1; }
</style>
