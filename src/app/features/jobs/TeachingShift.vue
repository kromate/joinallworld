<script setup lang="ts">
import { computed } from 'vue'
import { teachingStep } from '../../../game/living-world/teaching-practice.ts'
import type { TeachingPractice } from '../../../game/living-world/teaching-practice.ts'
import { teachingShiftAnswer, type TeachingStage } from './teachingShiftModel.ts'

const props = withDefaults(defineProps<{ generation: number; practice: TeachingPractice; disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{
  answer: [payload: { generation: number; revision: number; stage: TeachingStage; choice: string }]
  cancel: []
}>()

const stageLabel: Readonly<Record<TeachingStage, string>> = Object.freeze({
  diagnose: '1 · Notice the learner’s idea',
  explain: '2 · Explain with an example',
  check: '3 · Check understanding',
  complete: 'Practice complete',
})

const step = computed(() => {
  try {
    return props.practice.version === 1 ? teachingStep(props.practice) : null
  } catch {
    return null
  }
})

function answer(choice: string, revision: number, stage: TeachingStage): void {
  const payload = teachingShiftAnswer(props.generation, props.practice, revision, stage, choice, props.disabled)
  if (payload) emit('answer', payload)
}
</script>

<template>
  <section class="teaching-shift" aria-label="Fictional NPC teaching practice">
    <header class="teaching-shift__header">
      <p class="teaching-shift__eyebrow">Fictional NPC classroom practice</p>
      <h2>A short lesson in fractions</h2>
      <p>Help a learner understand equal parts. Choose a response at each step; the lesson will not advance on its own.</p>
    </header>

    <div class="teaching-shift__scene" aria-label="Classroom practice with a teacher and learner">
      <article class="teaching-shift__person teaching-shift__teacher">
        <span class="teaching-shift__avatar" aria-hidden="true">T</span>
        <div><strong>Teacher Eni</strong><small>Practice mentor</small></div>
        <p>“Listen for the learner’s thinking, then explain one clear idea.”</p>
      </article>
      <article class="teaching-shift__board" aria-label="Lesson board">
        <span>Today’s idea</span>
        <strong>1/3 &gt; 1/4</strong>
        <small>Equal-sized wholes</small>
      </article>
      <article class="teaching-shift__person teaching-shift__learner">
        <span class="teaching-shift__avatar teaching-shift__avatar--learner" aria-hidden="true">L</span>
        <div><strong>Learner Nneka</strong><small>Practice student</small></div>
        <p>“I chose one fourth because four is greater than three.”</p>
      </article>
    </div>

    <div v-if="step" class="teaching-shift__step" aria-live="polite">
      <p class="teaching-shift__stage">{{ stageLabel[practice.stage] }}</p>
      <h3>{{ step.title }}</h3>
      <p class="teaching-shift__prompt">{{ step.prompt }}</p>
      <ul v-if="step.learnerAnswers?.length" class="teaching-shift__answers" aria-label="Learner responses">
        <li v-for="(item, index) in step.learnerAnswers" :key="`${index}:${item}`">{{ item }}</li>
      </ul>
      <p v-if="step.feedback && practice.stage !== 'complete'" class="teaching-shift__feedback" role="status">{{ step.feedback }}</p>
      <div v-if="step.options.length" class="teaching-shift__choices" role="group" :aria-label="step.title">
        <button
          v-for="option in step.options"
          :key="option.id"
          type="button"
          class="teaching-shift__choice"
          :disabled="disabled || practice.stage === 'complete'"
          @click="answer(option.id, practice.revision, practice.stage)"
        >{{ option.label }}</button>
      </div>
      <p v-if="disabled" class="teaching-shift__offline" role="status">
        Your saved step stays visible. Reconnect or wait for this lesson to be ready; answers are not queued offline.
      </p>
      <p v-if="practice.stage === 'complete'" class="teaching-shift__complete" role="status">This practice lesson is complete.</p>
    </div>
    <p v-else class="teaching-shift__unavailable" role="status">This saved lesson is unavailable right now. Your progress is unchanged.</p>

    <button type="button" class="teaching-shift__cancel" :disabled="disabled" @click="emit('cancel')">Cancel practice</button>
  </section>
</template>

<style scoped>
.teaching-shift{display:grid;gap:16px;min-width:0;max-width:100%;box-sizing:border-box;color:var(--c-ink,#202521)}
.teaching-shift *{box-sizing:border-box;min-width:0}
.teaching-shift__header{display:grid;gap:7px}
.teaching-shift__header h2,.teaching-shift__step h3{margin:0;font-size:20px;line-height:1.25;overflow-wrap:anywhere}
.teaching-shift__header p,.teaching-shift__step p{margin:0;line-height:1.5;overflow-wrap:anywhere}
.teaching-shift__eyebrow,.teaching-shift__stage{font-size:12px;font-weight:700;color:var(--c-green-dark,#28563d)}
.teaching-shift__scene{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:10px;border:1px solid var(--c-line,#dfe5df);border-radius:14px;background:var(--c-fill,#f5f7f5)}
.teaching-shift__person,.teaching-shift__board{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:3px 10px;min-width:0;padding:11px;border-radius:11px;background:#fff}
.teaching-shift__avatar{grid-row:span 2;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#e7efe8;color:#27563c;font-weight:800}
.teaching-shift__avatar--learner{background:#f5eadc;color:#704a29}
.teaching-shift__person strong,.teaching-shift__board strong{font-size:14px;overflow-wrap:anywhere}
.teaching-shift__person small,.teaching-shift__board small{color:var(--c-muted,#626b64);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
.teaching-shift__person p{grid-column:1/-1;margin:5px 0 0;line-height:1.45;overflow-wrap:anywhere}
.teaching-shift__board{grid-template-columns:minmax(0,1fr);text-align:center;background:#fffdf5}
.teaching-shift__board span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--c-muted,#626b64)}
.teaching-shift__board strong{font-size:25px;line-height:1.2;color:#244d36}
.teaching-shift__step{display:grid;gap:9px;min-width:0;padding:14px;border:1px solid var(--c-line,#dfe5df);border-radius:14px;background:#fff}
.teaching-shift__choices{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:4px}
.teaching-shift__choice,.teaching-shift__cancel{min-height:48px;width:100%;padding:10px 13px;border:1px solid var(--c-line,#cbd4cc);border-radius:10px;background:#fff;color:inherit;font:600 14px/1.4 var(--font, sans-serif);text-align:left;overflow-wrap:anywhere;cursor:pointer}
.teaching-shift__choice:hover:not(:disabled){border-color:var(--c-green-dark,#28563d);background:#f4f8f4}
.teaching-shift__choice:focus-visible,.teaching-shift__cancel:focus-visible{outline:2px solid #22613d;outline-offset:2px}
.teaching-shift__choice:disabled{opacity:.55;cursor:not-allowed}
.teaching-shift__answers{display:grid;gap:5px;margin:0;padding-left:20px}
.teaching-shift__feedback,.teaching-shift__offline,.teaching-shift__complete,.teaching-shift__unavailable{padding:10px 12px;border-radius:9px;background:#f2f6f2;color:#304636}
.teaching-shift__offline{background:#fff6df;color:#654c18}
.teaching-shift__cancel{width:auto;justify-self:start;text-align:center}
@media(min-width:480px){.teaching-shift__scene{grid-template-columns:minmax(0,1fr) minmax(120px,.7fr) minmax(0,1fr);align-items:stretch}.teaching-shift__person{align-content:start}.teaching-shift__board{align-content:center}}
</style>
