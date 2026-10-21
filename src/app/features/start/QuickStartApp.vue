<script setup lang="ts">
// THE FIRST SCREEN — the session gate of a new device ('quick-start', role 'session-gate'). A visitor with no life sees the entry page
// (EntryPage.vue: the world behind a compact card, Play now, Sign up, Log in, "Make my character first"); the full-screen character
// creator (CreatorApp.vue, its code fetched only when it is needed) is one tap away, and is shown straight away when the screen is
// reopened with a refusal, for a short address, for a character that was being edited, or while a Play is on its way.
// Play now sends 'jaw:quick-start' { name, look } (App.vue), which opens the session and confirms the look with the
// 'onboarding.quick-start' action — exactly once: the action id is kept on the device until the server has answered
// (src/quick-start/entry.ts). The name and character are kept on the device as they are edited (startBoundary.ts).
// params: { reason: 'new', problem?: { reason, name }, creator?: true } — or none, when the shell opened it because
// the life is still held for its look.
import { computed, defineAsyncComponent } from 'vue'
import { cr } from './creatorState.ts'
import EntryPage from './EntryPage.vue'
import { entryShown } from './entryModel.ts'
import { loadCreatorApp } from './loadCreator.ts'
import { isPathAddress } from './pathAddress.ts'
import { problemOf } from './quickStartModel.ts'
import { qs } from './quickStartState.ts'
import { quickDraft } from './startBoundary.ts'

const CreatorApp = defineAsyncComponent(loadCreatorApp)
// The creator is the first screen (a short address, a refusal, an edited character): its preview is asked for at once, as the landing always did.
const warmPreview = (): void => { void import('./lookPreview.ts').then((module) => module.warmLookPreview()).catch(() => undefined) }
const props = defineProps<{ params?: unknown }>()
const wantsCreator = (params: unknown): boolean => Boolean(params && typeof params === 'object' && (params as { creator?: unknown }).creator === true)
const entry = computed(() => {
  const draft = quickDraft()
  return entryShown({
    problem: problemOf(props.params) !== null || wantsCreator(props.params) || qs.creator,
    pathAddress: typeof location !== 'undefined' && isPathAddress(location.pathname),
    editing: draft.nameEdited || draft.shuffles > 0,
    sending: cr.settling || cr.played,
  })
})
if (!entry.value) warmPreview()
/** "Make my character first": the creator's code has arrived (EntryPage.vue waits for it), and it replaces the entry page. */
const toCreator = (): void => { qs.creator = true }
</script>

<template>
  <EntryPage v-if="entry" @creator="toCreator" />
  <CreatorApp v-else mode="new" :params="params" />
</template>
