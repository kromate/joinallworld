<script setup lang="ts">
// The home-city pin (docs/SMALLER-FEATURES.md): a player abroad picks a home city and sees its gist and its weather in a small card. The pin is kept with your character on the server (it follows you to other devices); this device keeps a copy. The two reads are the public ones everybody can make (GET /api/world/gist and /api/world/feed); the weather credit the feed asks
// for is shown with it. Fetched when the Gist app opens, never at first paint.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { cityCatalogueEntry, cityRules, loadCityContent, loadCityNetwork, playableCityIds } from '../../../game/cities/registry.ts'
import { agoText, readGist } from './gistModel.ts'
import type { GistLine } from './gistModel.ts'
import { homePin, savePin, syncHomePin } from './homePinStore.ts'
import { pinPaths, validZone, weatherCredit, weatherLine, weatherNow } from './homePinModel.ts'

const { game } = useApp()
const choices = ref<{ id: string; name: string }[]>([])
const picking = ref(false), failed = ref(false), busy = ref(false)
const lines = ref<GistLine[]>([]), weather = ref(''), credit = ref(''), now = ref(Date.now())
onMounted(async () => {
  void syncHomePin(game.fetchJson).then(() => read())
  try { await loadCityNetwork(); choices.value = playableCityIds().flatMap((id) => { const entry = cityCatalogueEntry(id); return entry ? [{ id, name: entry.countryName ? `${entry.name}, ${entry.countryName}` : entry.name }] : [] }).sort((a, b) => a.name.localeCompare(b.name)) } catch { /* no list: the pin keeps what it has */ }
  void read()
})
async function read(): Promise<void> {
  const pin = homePin.value
  if (!pin || !game.connected.value) return
  now.value = Date.now(); failed.value = false
  try {
    const [gist, feed] = await Promise.all([game.fetchJson(pinPaths(pin.city).gist), game.fetchJson(pinPaths(pin.city).feed)])
    if (homePin.value?.city !== pin.city) return
    lines.value = readGist(gist).slice(0, 3); weather.value = weatherLine(weatherNow(feed, now.value)); credit.value = weatherCredit(feed)
  } catch { failed.value = true }
}
async function choose(event: Event): Promise<void> {
  const id = (event.target as HTMLSelectElement).value
  const name = choices.value.find((item) => item.id === id)?.name.split(',')[0]
  if (!id || !name || busy.value) return
  busy.value = true
  try {
    // The city's rules say its time zone. Only functions other screens already use are imported here, so the engine chunk gains no export for this card.
    await loadCityContent(id)
    const zone = cityRules(id)?.timezone ?? ''
    await savePin(game.fetchJson, { city: id, name, tz: validZone(zone) ? zone : 'Africa/Lagos' }); picking.value = false; lines.value = []; weather.value = ''
    await read()
  } catch { failed.value = true } finally { busy.value = false }
}
watch(() => game.connected.value, (up) => { if (up) void read() })
const elsewhere = computed(() => homePin.value !== null && homePin.value.city !== game.view.value.cityId)
</script>

<template>
  <section class="home-pin" data-gist="home-pin" aria-label="Home city">
    <template v-if="homePin && !picking">
      <h3>{{ homePin.name }} <small>{{ elsewhere ? 'your home city' : 'home' }}</small></h3>
      <p v-if="weather" class="home-pin-weather" data-gist="home-weather">{{ weather }}</p>
      <ul v-if="lines.length" class="social-list" data-gist="home-gist">
        <li v-for="line in lines" :key="line.n" class="social-row"><div><strong>{{ line.text }}</strong><small>{{ agoText(line.at, now) }}</small></div></li>
      </ul>
      <p v-else-if="!failed" class="social-note">Nothing new from {{ homePin.name }} yet.</p>
      <p v-if="failed" class="ui-error" role="alert">{{ homePin.name }} could not be read. <button type="button" class="social-btn" @click="read()">Try again</button></p>
      <small v-if="credit" class="home-pin-credit">{{ credit }}</small>
      <button type="button" class="social-btn" @click="picking = true">Change home city</button>
    </template>
    <template v-else>
      <h3>Home city</h3>
      <p class="social-note">Far from home? Pin the city you come from to see its gist and weather here, and event times on your clock and its clock.</p>
      <label class="sr-only" for="home-pin-select">Choose your home city</label>
      <select id="home-pin-select" class="social-field" :disabled="busy || !choices.length" @change="choose">
        <option value="">{{ choices.length ? 'Choose a city' : 'Loading cities…' }}</option>
        <option v-for="item in choices" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button v-if="homePin" type="button" class="social-btn" @click="savePin(game.fetchJson, null); picking = false">Remove the pin</button>
    </template>
  </section>
</template>

<style scoped>
.home-pin { display: grid; gap: 8px; justify-items: start; margin: 0; padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.home-pin > * { margin: 0; max-width: 100%; }
.home-pin .social-field, .home-pin .social-list { width: 100%; }
.home-pin h3 { font-size: 16px; }
.home-pin h3 small { font-weight: 400; color: var(--c-muted); }
.home-pin-weather { margin: 0 0 6px; font-size: 14px; }
.home-pin-credit { display: block; font-size: 12px; color: var(--c-muted); }
</style>
