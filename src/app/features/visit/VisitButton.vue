<script setup lang="ts">
// Visit home: the one button that takes a friend into your home, or into theirs. It says Visit home (walk in), Knock (they
// answer) or Come in (they invited you), and a plain reason when it cannot be pressed. It only asks: the server checks the
// door again (server/social/visit.ts). `compact` is the small button of a list row or a chat's header and shows only when it
// can be pressed; the card's button is always there and says why.
import '../../../ui/controls.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { social } from '../social/useSocial.ts'
import { visitButton } from '../../../game/visit.ts'
import { visitHome, visitState } from './visitStore.ts'

const props = defineProps<{ id: string; name: string; compact?: boolean }>()
const { game, shell } = useApp()
const friend = computed(() => social.me?.friends.find((item) => item.id === props.id))
const invited = computed(() => (social.me?.invites ?? []).some((item) => item.from.id === props.id))
const view = computed(() => visitButton({
  name: props.name, how: friend.value?.visit, home: friend.value?.status === 'online' && friend.value.venue === 'home', online: friend.value?.status === 'online',
  full: false, invited: invited.value,
}))
const show = computed(() => (friend.value !== undefined || invited.value) && (!props.compact || view.value.kind !== 'off'))
const busy = computed(() => visitState.busy === `enter:${props.id}`)
const press = (): Promise<boolean> => visitHome({ toast: (text, tone) => game.toast(text, tone), open: (id, params) => shell.open(id, params) }, props.id, props.name)
</script>

<template>
  <template v-if="show">
    <button type="button" class="ui-button" :class="compact ? 'is-small' : 'is-primary is-block visit-button'" data-visit="enter" :disabled="view.kind === 'off' || busy" :title="view.reason ?? undefined" :aria-label="`${view.label} at ${name}’s home${view.reason ? `. ${view.reason}` : ''}`" @click="press"><GameIcon v-if="!compact" name="home" inline /> {{ busy ? 'Going in…' : view.label }}</button>
    <span v-if="!compact && view.reason" class="visit-why" data-visit="why">{{ view.reason }}</span>
  </template>
</template>

<style scoped>
.visit-button { margin-top: 8px; }
.visit-why { display: block; margin: 4px 2px 0; font-size: 12px; line-height: 1.4; color: var(--c-muted); }
</style>
