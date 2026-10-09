<script setup lang="ts">
// Study: the academic record, applying and matriculating, registering a semester, the timetable
// with its lectures, assignments and tests, campus jobs and the programme options.
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { lagosTime } from '../../../game/clock.ts'
import { money } from '../../ui/format.ts'
import CampusCard from './CampusCard.vue'
import CampusControl from './CampusControl.vue'
import CampusGo from './CampusGo.vue'
import { CAMPUS_JOBS, PROGRAMMES } from './campusContent.ts'
import {
  BLANK_STUDENT, MATRICULATE_REASON, admissionOf, at, canChangeProgramme, cgpaOf, closeSemesterReason, courseControls, enrolmentStep, first, jobReason, nextSemester,
  programmeActive, recordLine, semesterFee, title,
} from './campusModel.ts'
import type { StudentLike } from './campusModel.ts'
import { choices, useCampus } from './useCampus.ts'

const { state, view, blocked, connected, student: viewed, act } = useCampus()
const CampusAssignment = defineAsyncComponent(() => import('./CampusAssignment.vue'))
const assignmentOpen = ref(false)
const assignmentContext = computed(() => JSON.stringify([view.value.session?.id, view.value.cityId,
  state.value.unilagStudent.programme, state.value.unilagStudent.term?.semester, state.value.unilagStudent.term?.startDay]))
watch(assignmentContext, () => { assignmentOpen.value = false }, { flush: 'sync' })
function openAssignment(courseId: string): void {
  if (courseId === 'cpe-101') assignmentOpen.value = true
  else void act('unilag.assignment', { course: courseId })
}
const student = computed<StudentLike>(() => viewed.value ?? BLANK_STUDENT)
const time = computed(() => lagosTime(view.value.now))
const senate = computed(() => at(state.value, 'senate'))
const step = computed(() => enrolmentStep(student.value))
const programmes = computed(() => Object.values(PROGRAMMES))

const admission = computed(() => admissionOf(state.value, connected.value, student.value, view.value.skills))
const next = computed(() => nextSemester(student.value))
const registerCourses = computed(() => PROGRAMMES[student.value.programme?.id ?? 'computer']?.semesters[next.value - 1]?.courses ?? [])
const fee = computed(() => semesterFee(student.value))

/** The timetable exists while a semester is running. */
const term = computed(() => (viewed.value?.term && viewed.value.courses?.length ? viewed.value : null))
const programmeSpot = computed(() => term.value?.programme?.spot ?? '')
const inClass = computed(() => at(state.value, programmeSpot.value))
const classBase = computed(() => first(blocked.value, !inClass.value ? `Go to ${title(programmeSpot.value)} for classes and assessments.` : ''))
const closing = computed(() => (term.value ? closeSemesterReason(blocked.value, term.value, time.value.day) : { reason: '', primary: false }))

const doneToday = computed(() => Boolean(student.value.lifetime?.campusJobDays?.includes(time.value.day)))
const rules = computed(() => student.value.betaRules)
const campusJobs = computed(() => Object.values(CAMPUS_JOBS))
const drop = computed(() => programmeActive(student.value))

const dropProgramme = async (): Promise<void> => { if ((await act('unilag.drop'))?.ok) choices.confirmDrop = false }
</script>

<template>
  <CampusCard icon="📄" heading="Academic record">
    <dl class="campus-stats">
      <div><dt>Student ID</dt><dd>{{ student.studentId || 'Not issued' }}</dd></div>
      <div><dt>CGPA</dt><dd>{{ cgpaOf(student) }}</dd></div>
      <div><dt>Status</dt><dd>{{ title(student.status || 'none') }}</dd></div>
    </dl>
    <ul v-if="student.records?.length" class="campus-records">
      <li v-for="record in student.records" :key="`${record.semester}:${record.attempt}`">
        <div><strong>{{ recordLine(record).head }}</strong><small>{{ recordLine(record).sub }}</small></div><b>{{ recordLine(record).gpa }}</b>
      </li>
    </ul>
    <p v-else class="campus-note">No completed semester record yet.</p>
  </CampusCard>

  <CampusCard v-if="step === 'apply'" icon="📝" heading="Apply for admission">
    <p>This is a compressed in-game programme. The application fee is {{ money(student.betaRules?.admissionFee ?? 200) }}. Admission requires Coding level 1 or Charisma level 1.</p>
    <ul class="campus-checks">
      <li :class="{ 'is-met': admission.skillMet }">{{ admission.skillMet ? '✓' : '○' }} Coding {{ admission.coding }} · Charisma {{ admission.charisma }}</li>
      <li :class="{ 'is-met': admission.place }">{{ admission.place ? '✓' : '○' }} Apply at Senate House</li>
    </ul>
    <label class="campus-field">Programme
      <select v-model="choices.programme"><option v-for="programme in programmes" :key="programme.id" :value="programme.id">{{ programme.label }}</option></select>
    </label>
    <template #extra>
      <CampusControl primary :label="`Apply · ${money(admission.fee)}`" :reason="admission.reason" @press="act('unilag.apply', { programme: choices.programme })" />
      <CampusGo v-if="!admission.place" spot="senate" />
    </template>
  </CampusCard>

  <CampusCard v-else-if="step === 'matriculate'" icon="🎓" heading="Complete matriculation">
    <p>You are admitted to {{ student.programme?.label || 'your programme' }}. Matriculation issues your Allworld student ID.</p>
    <template #extra>
      <CampusControl primary label="Matriculate" :reason="first(blocked, !senate ? MATRICULATE_REASON : '')" @press="act('unilag.matriculate')" />
      <CampusGo v-if="!senate" spot="senate" />
    </template>
  </CampusCard>

  <CampusCard v-else-if="step === 'register'" icon="📚" :heading="`Register semester ${next}`">
    <p>Registration includes every course below and costs {{ money(fee) }} in tuition and levy.</p>
    <ul class="campus-course-list"><li v-for="course in registerCourses" :key="course.id"><span>{{ course.id }}</span>{{ course.title }}</li></ul>
    <template #extra>
      <CampusControl primary :label="`Register all · ${money(fee)}`" :reason="blocked" @press="act('unilag.register-semester', { courses: registerCourses.map((course) => course.id) })" />
    </template>
  </CampusCard>

  <template v-if="term && viewed?.term">
    <section class="campus-section-head">
      <div><h3>Semester {{ viewed.term.semester }} timetable</h3><p>Classes are held at {{ title(programmeSpot) }}. Official lectures add attendance; night classes add study only.</p></div>
      <CampusGo v-if="!inClass" :spot="programmeSpot" label="Go to class" />
    </section>
    <article v-for="course in term.courses" :key="course.id" class="campus-course">
      <header>
        <div><strong>{{ course.id }} · {{ course.title }}</strong><small>{{ courseControls(course, classBase, time.minuteOfDay).slotLabel }} · {{ course.credits }} credits</small></div>
        <span>{{ course.attendance }}/7 days</span>
      </header>
      <div class="campus-course-progress">
        <span>Study {{ course.study }}</span><span>Assignment {{ course.assignment === null ? '—' : `${course.assignment}/30` }}</span><span>Test {{ course.test === null ? '—' : `${course.test}/50` }}</span>
      </div>
      <div class="campus-actions">
        <CampusControl :primary="courseControls(course, classBase, time.minuteOfDay).attend.primary" :label="courseControls(course, classBase, time.minuteOfDay).attend.label" :reason="courseControls(course, classBase, time.minuteOfDay).attend.reason" @press="act('unilag.lecture', { course: course.id })" />
        <CampusControl :label="course.id === 'cpe-101' ? 'Open logic lab' : 'Assignment'" :reason="course.id === 'cpe-101' ? (connected ? '' : 'Reconnect to read the saved lab.') : courseControls(course, classBase, time.minuteOfDay).assignment.reason" @press="openAssignment(course.id)" />
        <CampusControl label="Test" :reason="courseControls(course, classBase, time.minuteOfDay).test.reason" @press="act('unilag.test', { course: course.id })" />
      </div>
      <CampusAssignment v-if="course.id === 'cpe-101' && assignmentOpen" @close="assignmentOpen = false" />
    </article>
    <div class="campus-actions">
      <CampusControl v-if="term.status === 'deferred'" primary label="Resume semester" :reason="blocked" @press="act('unilag.resume')" />
      <CampusControl v-else label="Defer semester" :reason="blocked" @press="act('unilag.defer')" />
      <CampusControl label="Close semester" :primary="closing.primary" :reason="closing.reason" @press="act('unilag.close-semester')" />
    </div>
  </template>

  <CampusCard icon="💼" heading="Scholarship and campus jobs">
    <p>A passed semester with a GPA of {{ Number(rules?.scholarshipCgpa ?? 4).toFixed(2) }} pays the one-time {{ money(rules?.scholarshipAward ?? 200) }} scholarship. One campus job can be completed per day.</p>
    <div v-for="job in campusJobs" :key="job.id" class="campus-row">
      <div><strong>{{ job.label }}</strong><small>{{ title(job.spot) }} · {{ money(job.pay) }}</small></div>
      <CampusControl v-if="at(state, job.spot)" primary label="Start job" :reason="jobReason(blocked, student, doneToday, true, job.spot)" @press="act('unilag.job', { id: job.id })" />
      <CampusGo v-else :spot="job.spot" />
    </div>
  </CampusCard>

  <CampusCard v-if="canChangeProgramme(student) || drop" icon="⚙️" heading="Programme options">
    <div class="campus-form-row">
      <template v-if="canChangeProgramme(student)">
        <label class="campus-field">Change programme
          <select v-model="choices.programme"><option v-for="programme in programmes" :key="programme.id" :value="programme.id">{{ programme.label }}</option></select>
        </label>
        <CampusControl label="Change programme" :reason="blocked" @press="act('unilag.change-programme', { programme: choices.programme })" />
      </template>
    </div>
    <template v-if="drop">
      <div v-if="choices.confirmDrop" class="campus-confirm">
        <p>Drop {{ student.programme?.label || 'this programme' }}? Your student ID, active term, records and room allocation will be removed. Paid fees are not refunded.</p>
        <button type="button" class="ui-button campus-danger" @click="dropProgramme">Yes, drop programme</button>
        <button type="button" class="ui-button" @click="choices.confirmDrop = false">Keep studying</button>
      </div>
      <button v-else type="button" class="ui-button campus-danger-link" @click="choices.confirmDrop = true">Drop programme</button>
    </template>
  </CampusCard>
</template>
