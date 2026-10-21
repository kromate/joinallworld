<script setup lang="ts">
// Houses app: the player's own house first (MyHouse.vue, src/app/features/travel/) with its three everyday actions (walk in,
// arrange the furniture, invite friends), six more things to do with a home as tiles that say what they are, then the long
// sections folded with a one-line summary each: upgrades and the look, visitors, the rental ladder, passing the house on.
//
// Renting: the five house tiers, their weekly rent and move-in cost, and moving. Moving pays the landlord and the agent (three
// weeks of rent) with the 'property.house-move' action; furniture moves with the player and anything that does not fit goes
// to storage. Every disabled Move button says what is missing (view.property.houses[].blocked).
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { MOVE_IN_WEEKS } from '../../../game/content/housing.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { useAct } from '../kit/act.ts'
import MyHouse from '../travel/MyHouse.vue'
import { minutesToGo, offeredTiers } from '../travel/myHouseModel.ts'
import { hostRead, modelsMine, type ModelView } from '../spaces/spacesClient.ts'
// Who can come in, invitations and the house link: fetched with the Home tab, not with the first download.
const VisitHome = defineAsyncComponent(() => import('../visit/VisitHome.vue'))
// Passing property on (docs/LEGACY.md): fetched only when its section is opened.
const PassOn = defineAsyncComponent(() => import('../legacy/PassOn.vue'))
// Design with AI, the AI host, My 3D models and Walk in 3D (docs/SPACES.md, docs/SPACES-3D.md): fetched only when opened.
const DesignSheet = defineAsyncComponent(() => import('../spaces/DesignSheet.vue'))
const HostSheet = defineAsyncComponent(() => import('../spaces/HostSheet.vue'))
const ModelsSheet = defineAsyncComponent(() => import('../spaces/ModelsSheet.vue'))
const CopyHouseSheet = defineAsyncComponent(() => import('../spaces/CopyHouseSheet.vue'))
const copyOpen = ref(false)
const WorldScreen = defineAsyncComponent(() => import('../spaces/WorldScreen.vue'))
const designOpen = ref(false)
const hostOpen = ref(false)
const modelsOpen = ref(false)
const worldOpen = ref(false)
/** A model to put down as soon as the 3D screen opens: the one just uploaded, or one chosen from the list. */
const placing = ref<ModelView | null>(null)
const passOpen = ref(false)
const passToggled = (event: Event): void => { passOpen.value = (event.target as HTMLDetailsElement).open }
import HouseArt from './HouseArt.vue'
import CatalogueCard from '../../ui/CatalogueCard.vue'
import SettleNotice from '../start/SettleNotice.vue'
import BaseButton from '../../ui/BaseButton.vue'
import { housesRules, moveReason, nextHouse, rentLine, savedPercent, upgradeLine } from './homeModel.ts'
import type { HouseId } from '../../../types/life.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const cash = computed(() => game.state.value.cash)
const property = computed(() => view.value.property)
const estate = computed(() => view.value.estate)
const guest = computed(() => view.value.onboarding.guest)
/** A house of their own in this city: the actions and the upgrade fold are for it. A visitor or a guest sees the chooser instead. */
const hasHome = computed(() => Boolean(estate.value && estate.value.placed && !estate.value.settle))
/** A city with no rental flats offers none: the rent section is left out instead of showing an empty ladder. */
const rentals = computed(() => Object.keys(property.value?.houses ?? {}).length > 0)
const next = computed(() => (property.value ? nextHouse(property.value) : undefined))
const progress = computed(() => (next.value ? savedPercent(cash.value, next.value.moveIn) : 100))
const moveBlocked = computed(() => (!view.value.connected ? `${linkWords(view.value)?.short ?? ''} — moving needs the server` : guest.value ? 'Settle in before renting a home.' : ''))
/** Where a city is not Lagos, the first room of its own ladder is the one named. */
const smallest = computed(() => (game.state.value.estate.city === 'lagos' ? undefined : property.value?.houses[0]?.label.toLowerCase()))
const move = (id: HouseId): Promise<boolean> => act(`move:${id}`, () => command('property.house-move', { id }))

const upgradeSummary = computed(() => {
  const e = estate.value
  if (!e) return ''
  return e.upgrade ? `Builders at work on your ${e.upgrade.label} · about ${minutesToGo(e.upgrade.remaining)} to go` : upgradeLine(offeredTiers(e.tiers), money)
})
const rentSummary = computed(() => rentLine(guest.value, next.value, progress.value))

// The tiles' second lines say the state where it is cheap to know: the host chosen, the models uploaded.
const hostLine = ref('Greets guests when you are out')
const modelsLine = ref('Upload .glb files to place')
let gone = false
onMounted(async () => {
  if (!view.value.connected) return
  const [host, models] = await Promise.all([hostRead(game).catch(() => null), modelsMine(game).catch(() => null)])
  if (gone) return
  if (host?.ok && host.host.kind) hostLine.value = `${host.host.name ?? host.host.kind} · ${host.host.on ? 'on' : 'off'}`
  if (models?.ok && models.models.length) modelsLine.value = `${models.models.length} model${models.models.length === 1 ? '' : 's'} · place them in 3D`
})
onBeforeUnmount(() => { gone = true })

const tiles = computed(() => [
  { id: 'copy', title: 'Copy my real house', line: 'Photos in, your AI builds it, friends come over', icon: 'building', go: () => { copyOpen.value = true } },
  { id: 'design', title: 'Design with AI', line: 'Describe a room; it gets furnished', icon: 'pen', go: () => { designOpen.value = true } },
  { id: 'host', title: 'AI host', line: hostLine.value, icon: 'mic', go: () => { hostOpen.value = true } },
  { id: 'models', title: 'My 3D models', line: modelsLine.value, icon: 'box', go: () => { modelsOpen.value = true } },
  { id: 'land', title: 'Expand my land', line: 'Buy the plot next door', icon: 'tree', go: () => shell.open('land') },
  { id: 'stories', title: 'Story scenes', line: 'Film a scene at home', icon: 'film', go: () => shell.open('stories') },
  { id: 'street', title: 'My street', line: 'Neighbours and visits', icon: 'building', go: () => shell.open('neighbourhood') },
])

/** Walk in 3D, with a model to put down first when one was just uploaded or chosen. */
function walkIn(model: ModelView | null = null): void { placing.value = model; modelsOpen.value = false; designOpen.value = false; copyOpen.value = false; worldOpen.value = true }
const visitors = ref<HTMLDetailsElement | null>(null)
/** Invite: the Visitors fold opens on its first button. */
async function invite(): Promise<void> {
  if (!visitors.value) return
  visitors.value.open = true
  await nextTick()
  const button = visitors.value.querySelector<HTMLElement>('[data-visit="invite-open"]')
  button?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  button?.focus()
}
</script>

<template>
  <p v-if="!property" class="ui-error">Houses could not be loaded. Close this app and open it again.</p>
  <div v-else class="houses-app">
    <DesignSheet v-if="designOpen" target="home" @close="designOpen = false" @walk="walkIn()" />
    <HostSheet v-if="hostOpen" @close="hostOpen = false" @saved="(line: string) => { hostLine = line }" />
    <CopyHouseSheet v-if="copyOpen" @close="copyOpen = false" @walk="walkIn()" />
    <ModelsSheet v-if="modelsOpen" @close="modelsOpen = false" @place="walkIn" />
    <WorldScreen v-if="worldOpen" :where="{ target: 'home' }" :place="placing" @close="worldOpen = false; placing = null" />

    <section class="ui-card houses-home" data-houses="home">
      <MyHouse part="hero" />
      <div v-if="hasHome" class="houses-acts" role="group" aria-label="Your house">
        <button type="button" class="houses-act is-primary" data-houses="walk" @click="walkIn()"><GameIcon name="walk" /><span>Walk in</span></button>
        <button type="button" class="houses-act" data-houses="arrange" @click="shell.open('buy')"><GameIcon name="sofa" /><span>Arrange</span></button>
        <button type="button" class="houses-act" data-houses="invite" @click="invite"><GameIcon name="invite" /><span>Invite</span></button>
      </div>
    </section>

    <h3 class="ui-section">More for your home</h3>
    <div class="houses-tiles">
      <button v-for="tile in tiles" :key="tile.id" type="button" class="houses-tile" :data-houses="tile.id" @click="tile.go()">
        <i aria-hidden="true"><GameIcon :name="tile.icon" /></i>
        <b>{{ tile.title }}</b>
        <small>{{ tile.line }}</small>
      </button>
    </div>

    <details v-if="hasHome" class="ui-details houses-fold" data-houses="upgrade">
      <summary><span><b>Upgrade &amp; look</b><small>{{ upgradeSummary }}</small></span></summary>
      <MyHouse part="upgrade" />
    </details>
    <details ref="visitors" class="ui-details houses-fold" data-houses="visitors">
      <summary><span><b>Visitors</b><small>Invite friends, share a link, the door</small></span></summary>
      <VisitHome />
    </details>
    <details v-if="rentals" class="ui-details houses-fold" data-houses="rent">
      <summary><span><b>Homes to rent</b><small>{{ rentSummary }}</small></span></summary>
      <section class="ui-hero houses-rent-hero">
        <small>{{ guest ? 'Browse homes' : next ? 'Next step up' : 'Top of the ladder' }}</small>
        <strong>{{ guest ? 'A place of your own' : next ? `${next.label}, ${next.district}` : 'The grandest house in the city' }}</strong>
        <SettleNotice v-if="guest" hint message="Settle in for your free starter house. You can move to a rental afterwards." />
        <template v-else-if="next">
          <div class="houses-progress" role="meter" aria-label="Saved towards the move" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress"><i :style="{ width: `${progress}%` }" /></div>
          <p>{{ next.affordable ? 'You can afford the move.' : `${money(next.moveIn - cash)} to go · you have ${money(cash)}` }}</p>
        </template>
        <p v-else>You live here already.</p>
      </section>
      <p class="ui-note houses-note">Moving in costs {{ MOVE_IN_WEEKS }} weeks of rent up front. Rent is then due every Saturday.</p>
      <HowItWorks id="houses-rules" page label="How moving works" :rules="housesRules(MOVE_IN_WEEKS, smallest)" />
      <div class="houses-list">
        <CatalogueCard v-for="(house, tier) in property.houses" :key="house.id" :title="house.label" :subtitle="house.district" :selected="house.current && !guest">
          <template #media><HouseArt :tier="tier" :grid="house.grid" /></template>
          <template #status><span v-if="house.current && !guest" class="ui-chip is-good">Your home</span><span v-else-if="house.tag" class="ui-chip">{{ house.tag }}</span></template>
          <p class="houses-description">{{ house.description }}</p>
          <dl class="houses-specs"><div><dt>Move-in cost</dt><dd>{{ money(house.moveIn) }}</dd></div><div><dt>Weekly rent</dt><dd>{{ money(house.rent) }}</dd></div><div><dt>Room size</dt><dd>{{ house.grid }} × {{ house.grid }}</dd></div></dl>
          <template v-if="!house.current || guest" #actions><BaseButton variant="primary" :reason="moveBlocked || moveReason(house, '')" :disabled="pending !== null" @click="move(house.id)">{{ pending === `move:${house.id}` ? 'Moving…' : `Move in for ${money(house.moveIn)}` }}</BaseButton></template>
          <template v-if="(!house.current || guest) && (moveBlocked || moveReason(house, ''))" #note><p class="ui-why">{{ moveBlocked || moveReason(house, '') }}</p></template>
        </CatalogueCard>
      </div>
    </details>
    <details class="ui-details houses-fold" data-legacy="section" data-houses="pass" @toggle="passToggled">
      <summary><span><b>Pass on</b><small>Who gets the house</small></span></summary>
      <PassOn v-if="passOpen" />
    </details>
  </div>
</template>

<style scoped src="../../../ui/panels/houses.css"></style>
