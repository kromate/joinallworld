<script setup lang="ts">
// Residence: ask for a hostel room for the semester, then sleep and keep food in the room.
import { computed } from 'vue'
import { money } from '../../ui/format.ts'
import CampusCard from './CampusCard.vue'
import CampusControl from './CampusControl.vue'
import CampusGo from './CampusGo.vue'
import { HOSTEL_HALLS, HOSTEL_STORAGE_ITEMS } from './campusContent.ts'
import { allocationOf, at, clampCount, first, storedLine, title } from './campusModel.ts'
import { choices, useCampus } from './useCampus.ts'

const { state, blocked, student, act, walkReason } = useCampus()
const allocation = computed(() => allocationOf(student.value))
const senate = computed(() => at(state.value, 'senate'))
const requestWhy = computed(() => first(blocked.value, !senate.value ? 'Go to Senate House to request a room.' : ''))

const roomSpot = computed(() => (allocation.value ? `${allocation.value.hall}-hall` : ''))
const inRoom = computed(() => at(state.value, roomSpot.value))
const roomWhy = computed(() => first(blocked.value, !inRoom.value ? `Go to ${title(roomSpot.value)} to use the room.` : ''))
const roomWalkWhy = computed(() => walkReason(roomSpot.value))
const storage = computed(() => student.value?.hostel?.storage ?? {})
const stored = computed(() => storedLine(storage.value))
const fee = computed(() => student.value?.betaRules?.hostelFee ?? 300)

function count(event: Event): void { choices.storageCount = clampCount((event.target as HTMLInputElement).value, 1) }
function store(direction: 'in' | 'out'): void {
  void act('unilag.hostel.store', { item: choices.storageItem, count: clampCount(choices.storageCount, 1), direction })
}
</script>

<template>
  <CampusCard v-if="!student?.term" icon="🏠" heading="Campus residence">
    <p>Register a semester before requesting an in-game hostel room. This does not represent a real UNILAG allocation.</p>
    <template #extra><button type="button" class="ui-button is-primary" @click="choices.tab = 'study'">Open Study</button></template>
  </CampusCard>

  <template v-else-if="allocation">
    <CampusCard icon="🛏️" :heading="`${title(allocation.hall)} Hall · room ${allocation.room}`">
      <p>This room is the active allocation for semester {{ allocation.semester }}, attempt {{ allocation.attempt }}.</p>
      <div class="campus-storage"><span v-for="item in stored" :key="item.id">{{ item.text }}</span><span v-if="!stored.length">Nothing stored</span></div>
      <template #extra>
        <CampusControl v-if="!inRoom && roomWalkWhy" label="Go to my room" :reason="roomWalkWhy" />
        <CampusGo v-else-if="!inRoom" :spot="roomSpot" label="Go to my room" />
        <CampusControl primary label="Sleep · energy +20" :reason="roomWhy" @press="act('unilag.hostel.sleep')" />
      </template>
    </CampusCard>
    <CampusCard icon="📦" heading="Room storage">
      <label class="campus-field">Item
        <select v-model="choices.storageItem">
          <option v-for="id in HOSTEL_STORAGE_ITEMS" :key="id" :value="id">{{ title(id) }} · bag {{ state.inventory?.[id] ?? 0 }} · room {{ storage[id] ?? 0 }}</option>
        </select>
      </label>
      <label class="campus-field">Count<input type="number" min="1" max="20" :value="choices.storageCount" @input="count"></label>
      <template #extra>
        <div class="campus-actions">
          <button type="button" class="ui-button is-primary" :disabled="Boolean(roomWhy)" :title="roomWhy || undefined" @click="store('in')">Store from bag</button>
          <button type="button" class="ui-button" :disabled="Boolean(roomWhy)" :title="roomWhy || undefined" @click="store('out')">Take to bag</button>
        </div>
        <small v-if="roomWhy" class="campus-why">{{ roomWhy }}</small>
      </template>
    </CampusCard>
  </template>

  <CampusCard v-else icon="🏠" heading="Request a hostel room">
    <p>Choose a hall for this semester. The simulated hostel fee is {{ money(fee) }}.</p>
    <label class="campus-field">Hall
      <select v-model="choices.hall"><option v-for="hall in HOSTEL_HALLS" :key="hall" :value="hall">{{ title(hall) }} Hall</option></select>
    </label>
    <template #extra>
      <CampusControl primary :label="`Allocate · ${money(fee)}`" :reason="requestWhy" @press="act('unilag.hostel.allocate', { hall: choices.hall })" />
      <CampusGo v-if="!senate" spot="senate" />
    </template>
  </CampusCard>
</template>
