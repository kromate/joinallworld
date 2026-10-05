<script setup lang="ts">
// Step 1, "Who are you?": a starting character from large cards, the body, a shuffle and a name. It
// changes nothing itself: the creator keeps the draft and the device.
import { computed } from 'vue'
import { APPEARANCE } from '../../../game/content/traits.ts'
import type { Look } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import AvatarFigure from './AvatarFigure.vue'
import { PRESETS } from './startBoundary.ts'

const props = defineProps<{ look: Look; preset: string | null; name: string; error: string }>()
const emit = defineEmits<{ preset: [id: string]; body: [id: string]; shuffle: []; dice: []; name: [value: string]; submit: [] }>()
const body = computed(() => props.look.body)
</script>

<template>
  <div class="cr-who">
    <fieldset class="cr-group">
      <legend>Start from a character</legend>
      <div class="cr-presets">
        <button v-for="item in PRESETS" :key="item.id" type="button" class="cr-preset" :data-qs-preset="item.id" :data-key="`preset:${item.id}`" :aria-pressed="preset === item.id" :aria-label="`${item.label} character`" @click="emit('preset', item.id)">
          <AvatarFigure :look="item.look" :size="54" label="" /><span>{{ item.label }}</span>
        </button>
      </div>
    </fieldset>
    <div class="cr-row">
      <div class="cr-seg" role="group" aria-label="Body">
        <button v-for="item in APPEARANCE.bodies" :key="item.id" type="button" :data-qs-body="item.id" :data-key="`body:${item.id}`" :aria-pressed="body === item.id" @click="emit('body', item.id)">{{ item.label }}</button>
      </div>
      <button type="button" class="cr-btn" data-qs="shuffle" data-key="shuffle" @click="emit('shuffle')"><GameIcon name="game" inline /> Surprise me</button>
    </div>
    <label class="cr-field">Your name
      <span class="cr-input">
        <input name="name" data-qs-name minlength="3" maxlength="24" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="next" :value="name" :aria-invalid="error ? 'true' : undefined" @input="emit('name', ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="emit('submit')">
        <button type="button" class="cr-icon" data-qs="dice" data-key="dice" aria-label="Suggest another name" title="Suggest another name" @click="emit('dice')"><GameIcon name="game" :size="22" /></button>
      </span>
    </label>
  </div>
</template>
