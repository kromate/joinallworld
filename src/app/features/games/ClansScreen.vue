<script setup lang="ts">
// Clans and ladders, inside the Games app (a lazy chunk of it): your clan (members, invite link, clan chat and room, the week's war,
// the room your clan holds in a venue), or start or join one; your ladders (friends, your city, your weekly group, your clan, your
// country, everyone); and this week's city league. Everything is decided by the server (server/clans/, docs/CLANS.md).
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { useGrowth } from '../growth/useGrowth.ts'
import { ROLE_WORDS, boardRows, codeFromText, inviteLine, inviteLinkPath, lastWarLine, leagueShareLine, tierColour, warLine } from './clansModel.ts'
import type { ClanBoard, ClanView } from '../../../types/clans.ts'

const props = defineProps<{ code?: string }>()
const emit = defineEmits<{ back: [] }>()
const { game, shell } = useApp()
const growth = useGrowth()
type Tab = 'clan' | 'ladders' | 'league'
const tab = ref<Tab>('clan')
const busy = ref(false)
const said = ref('')

// ---- my clan ---------------------------------------------------------------------------------------------------------------------
const mine = ref<{ clan: ClanView | null; colours: { id: string; name: string; hex: string }[]; cap: number; homeCity: string; homeCityName?: string; canCreate: boolean } | null>(null)
const clan = computed(() => mine.value?.clan ?? null)
const name = ref(''), colour = ref(''), code = ref(props.code ?? ''), preview = ref<ClanView | null>(null)
async function load(): Promise<void> {
  const r = await growth.call<{ ok: boolean; clan: ClanView | null; colours: { id: string; name: string; hex: string }[]; cap: number; homeCity: string; canCreate: boolean }>('/api/clans/me')
  if (r.ok && 'colours' in r) { mine.value = r; colour.value ||= r.colours[0]?.id ?? '' }
  else said.value = 'reason' in r && typeof r.reason === 'string' ? r.reason : 'Clans could not be opened. Check your connection.'
  if (props.code && !clan.value) void look()
}
/** Run one clan call; its answer replaces the clan shown. */
async function act(path: string, body: Record<string, unknown> = {}, done?: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true; said.value = ''
  try {
    const r = await growth.call<{ ok: boolean; clan?: ClanView | null; reason?: string; amount?: number }>(path, body)
    if (!r.ok) { said.value = 'reason' in r && typeof r.reason === 'string' ? r.reason : 'That did not work. Try again.'; return false }
    if (mine.value && 'clan' in r && r.clan !== undefined) mine.value = { ...mine.value, clan: r.clan }
    if (done) game.toast(done, 'good')
    return true
  } finally { busy.value = false }
}
const create = (): Promise<boolean> => act('/api/clans/create', { name: name.value, colour: colour.value, clientId: `${Date.now()}:${crypto.randomUUID()}` }, 'Your clan is ready. Share the invite.')
async function look(): Promise<void> {
  const c = codeFromText(code.value)
  preview.value = null
  if (!c) { said.value = 'A clan code is six letters, or paste the invite link.'; return }
  const r = await growth.call<{ ok: boolean; clan?: ClanView; reason?: string }>(`/api/clans/preview?code=${c}`)
  if (r.ok && 'clan' in r && r.clan) preview.value = r.clan
  else said.value = 'reason' in r && typeof r.reason === 'string' ? r.reason : 'No clan has that code.'
}
const join = (): Promise<boolean> => act('/api/clans/join', { code: codeFromText(code.value) ?? '' }, 'You joined the clan.')
async function invite(): Promise<void> {
  const c = clan.value
  if (!c?.code) return
  const { shareAddress } = await import('../paths/share.ts')
  await shareAddress(inviteLinkPath(c.code), inviteLine(c.name), (text, kind) => { game.toast(text, kind) })
}
const chat = (): void => { if (clan.value?.room) shell.open('messages', { conv: clan.value.room }) }
const leave = (): void => { if (confirm('Leave the clan? You can join again with the code.')) void act('/api/clans/leave', {}, 'You left the clan.') }
const role = (id: string, r: 'deputy' | 'member' | 'leader'): void => { if (r !== 'leader' || confirm('Hand the clan over? You will be a deputy.')) void act('/api/clans/role', { id, role: r }) }
const kick = (id: string, who: string): void => { if (confirm(`Remove ${who} from the clan? They cannot rejoin until tomorrow.`)) void act('/api/clans/kick', { id }) }
const newCode = (): Promise<boolean> => act('/api/clans/code', {}, 'A new code. The old one no longer works.')
const claim = (): Promise<boolean> => act('/api/clans/prize', {}, 'The prize is in your wallet.')
/** The leader stands in a venue and makes it the clan's room there; or gives the room up. */
const here = computed(() => { const s = game.state.value; return typeof s.location === 'string' && s.location !== 'home' ? { venue: s.location, city: s.estate?.city ?? game.view.value.cityId } : null })
const holdHere = (): void => { const h = here.value; if (h) void act('/api/clans/venue', { city: h.city, venue: h.venue }, 'This is your clan’s room now: members are seated together here.') }
const giveUp = (): void => { void act('/api/clans/venue', { venue: null }) }
const war = computed(() => warLine(clan.value?.war, clan.value?.size ?? 0))
const last = computed(() => lastWarLine(clan.value?.last))

// ---- ladders and the league -----------------------------------------------------------------------------------------------------
const period = ref<'week' | 'season'>('week')
const ladders = ref<{ me: { rank: string; pts: number; tier: number; week: number; season: number; cityName: string } | null; boards: ClanBoard[] } | null>(null)
async function loadLadders(): Promise<void> {
  const r = await growth.call<{ ok: boolean; me: never; boards: ClanBoard[] }>(`/api/clans/boards?period=${period.value}`)
  if (r.ok && 'boards' in r) ladders.value = { me: r.me, boards: r.boards }
}
const league = ref<{ week: number; cities: { id: string; name: string; score: number; players: number; mine?: 1 }[]; countries: { id: string; name: string; score: number }[]; lastWinner: { name: string } | null; home: { id: string; name: string } | null } | null>(null)
async function loadLeague(): Promise<void> {
  const r = await growth.call<{ ok: boolean; week: number; cities: never[]; countries: never[]; lastWinner: null; home: null }>('/api/clans/league')
  if (r.ok && 'cities' in r) league.value = r
}
async function shareLeague(): Promise<void> {
  const l = league.value, home = l?.home
  if (!l || !home) return
  const place = l.cities.findIndex((c) => c.id === home.id) + 1
  const { shareAddress } = await import('../paths/share.ts')
  await shareAddress('/games', leagueShareLine(home.name, place || l.cities.length + 1, l.week), (text, kind) => { game.toast(text, kind) })
}
function show(next: Tab): void { tab.value = next; said.value = ''; if (next === 'ladders') void loadLadders(); else if (next === 'league') void loadLeague() }
onMounted(() => { void load() })
</script>

<template>
  <section class="cl" data-testid="clans">
    <header class="cl-head">
      <button type="button" class="cl-back" @click="emit('back')">&lsaquo; Games</button>
      <div class="cl-tabs" role="tablist" aria-label="Clans">
        <button v-for="t in (['clan', 'ladders', 'league'] as const)" :key="t" type="button" role="tab" :aria-selected="tab === t" :class="{ on: tab === t }" @click="show(t)">{{ t === 'clan' ? 'My clan' : t === 'ladders' ? 'Ladders' : 'City league' }}</button>
      </div>
    </header>
    <p v-if="said" class="cl-said" role="status">{{ said }}</p>

    <template v-if="tab === 'clan'">
      <p v-if="!mine" class="cl-note">Loading…</p>
      <template v-else-if="clan">
        <div class="cl-card cl-banner" :style="{ borderColor: clan.hex }">
          <span class="cl-swatch" :style="{ background: clan.hex }" aria-hidden="true" />
          <div><h3>{{ clan.name }}</h3><p>{{ clan.cityName }} · {{ clan.size }} of {{ clan.cap }} people · {{ ROLE_WORDS[clan.role ?? 'member'] }}</p></div>
        </div>
        <div class="cl-row">
          <BaseButton variant="primary" @click="invite">Share invite</BaseButton>
          <BaseButton @click="chat">Clan chat</BaseButton>
        </div>
        <p class="cl-note">Code <b class="cl-code">{{ clan.code }}</b> · anyone with the link or code can join. <button v-if="clan.role !== 'member'" type="button" class="cl-link" @click="newCode">New code</button></p>

        <SectionTitle>This week’s clan war</SectionTitle>
        <div class="cl-card">
          <p>{{ war }}</p>
          <p v-if="last" class="cl-note">{{ last }}</p>
          <BaseButton v-if="clan.last?.prize" variant="primary" block :disabled="busy" @click="claim">Claim your prize: ₦{{ clan.last.prize.toLocaleString('en-NG') }}</BaseButton>
          <p class="cl-note">Points come from counted matches in Fight, Race, Football and the table games. The best 80% of members count, so nobody has to play every day.</p>
        </div>

        <SectionTitle>Clan room</SectionTitle>
        <div class="cl-card">
          <p v-if="clan.venue">Your clan holds a room at <b>{{ clan.venue.venueName }}, {{ clan.venue.cityName }}</b>. Members there are seated together under your name; the place stays open to everyone.</p>
          <p v-else-if="clan.size < (clan.venueMin ?? 10)">With {{ clan.venueMin ?? 10 }} people your clan can hold a room in a venue. You have {{ clan.size }}.</p>
          <p v-else>Your clan can hold a room in a venue.</p>
          <template v-if="clan.role === 'leader' && clan.size >= (clan.venueMin ?? 10)">
            <BaseButton v-if="here" block :disabled="busy" @click="holdHere">Make this place our clan room</BaseButton>
            <p v-else class="cl-note">Go to the venue you want, then come back here.</p>
            <button v-if="clan.venue" type="button" class="cl-link" @click="giveUp">Give the room up</button>
          </template>
        </div>

        <SectionTitle>People</SectionTitle>
        <ul class="cl-list">
          <li v-for="m in clan.members" :key="m.id">
            <span class="cl-name">{{ m.name }}<b v-if="m.ai" class="cl-ai" title="An AI plays this character">AI</b></span>
            <span class="cl-role">{{ ROLE_WORDS[m.role] }} · {{ m.pts }} pts</span>
            <span v-if="clan.role === 'leader' && m.role !== 'leader'" class="cl-acts">
              <button v-if="m.role === 'member' && !m.ai" type="button" @click="role(m.id, 'deputy')">Deputy</button>
              <button v-else-if="m.role === 'deputy'" type="button" @click="role(m.id, 'member')">Member</button>
              <button v-if="!m.ai" type="button" @click="role(m.id, 'leader')">Lead</button>
              <button type="button" @click="kick(m.id, m.name)">Remove</button>
            </span>
          </li>
        </ul>
        <BaseButton block @click="leave">Leave the clan</BaseButton>
      </template>
      <template v-else>
        <div class="cl-card">
          <h3>Join a clan</h3>
          <div class="cl-row"><input v-model="code" class="cl-input" placeholder="Code or invite link" aria-label="Clan code or link" autocapitalize="characters" @keydown.enter="look"><BaseButton @click="look">Find</BaseButton></div>
          <div v-if="preview" class="cl-preview" :style="{ borderColor: preview.hex }">
            <p><b>{{ preview.name }}</b> · {{ preview.cityName }} · {{ preview.size }} of {{ preview.cap }} · led by {{ preview.leader }}</p>
            <BaseButton variant="primary" block :disabled="busy" @click="join">Join {{ preview.name }}</BaseButton>
          </div>
        </div>
        <div v-if="mine.canCreate" class="cl-card">
          <h3>Start a clan</h3>
          <input v-model="name" class="cl-input" maxlength="20" placeholder="A name, like Eko Lions" aria-label="Clan name">
          <div class="cl-colours" role="radiogroup" aria-label="Clan colour">
            <button v-for="c in mine.colours" :key="c.id" type="button" role="radio" :aria-checked="colour === c.id" :aria-label="c.name" :title="c.name" :class="{ on: colour === c.id }" :style="{ background: c.hex }" @click="colour = c.id" />
          </div>
          <p class="cl-note">Up to {{ mine.cap }} people. Your clan plays for {{ mine.homeCityName ?? mine.homeCity }}; anyone, anywhere can join.</p>
          <BaseButton variant="primary" block :disabled="busy || name.trim().length < 3" @click="create">Start the clan</BaseButton>
        </div>
        <p v-else class="cl-note">An AI-played character can join a clan but not start one.</p>
      </template>
    </template>

    <template v-else-if="tab === 'ladders'">
      <div class="cl-row cl-period"><button type="button" :class="{ on: period === 'week' }" @click="period = 'week'; loadLadders()">This week</button><button type="button" :class="{ on: period === 'season' }" @click="period = 'season'; loadLadders()">Season</button></div>
      <p v-if="!ladders" class="cl-note">Loading…</p>
      <template v-else>
        <div v-if="ladders.me" class="cl-card cl-me" :style="{ borderColor: tierColour(ladders.me.tier) }">
          <h3>{{ ladders.me.rank }}</h3><p>{{ ladders.me.pts }} points · season {{ ladders.me.season }} · playing for {{ ladders.me.cityName }}</p>
        </div>
        <p v-else class="cl-note">Play a match against a person (Fight, Race, Football or a table game) to get on the ladders. A win is +30, a loss −12, and your best 10 matches a day count.</p>
        <div v-for="b in ladders.boards" :key="b.k" class="cl-card">
          <h4>{{ b.t }} <span class="cl-note">· {{ b.n }}</span></h4>
          <ol class="cl-board">
            <li v-for="r in boardRows(b.r)" :key="r.rank + r.name" :class="{ me: r.me }"><span class="cl-rank">{{ r.rank }}</span><span class="cl-dot" :style="{ background: tierColour(r.tier) }" aria-hidden="true" /><span class="cl-name">{{ r.me ? 'You' : r.name }}<b v-if="r.ai" class="cl-ai">AI</b></span><span class="cl-score">{{ r.score }}</span></li>
          </ol>
        </div>
      </template>
    </template>

    <template v-else>
      <p v-if="!league" class="cl-note">Loading…</p>
      <template v-else>
        <div class="cl-card">
          <h3>This week: cities</h3>
          <p v-if="league.lastWinner" class="cl-note">Last week: {{ league.lastWinner.name }} took it.</p>
          <ol class="cl-board">
            <li v-for="(c, i) in league.cities" :key="c.id" :class="{ me: c.mine }"><span class="cl-rank">{{ i + 1 }}</span><span /><span class="cl-name">{{ c.name }}</span><span class="cl-note">{{ c.players }}</span><span class="cl-score">{{ c.score }}</span></li>
          </ol>
          <p v-if="!league.cities.length" class="cl-note">No city has points yet this week. Every counted match adds to your city’s score: its best 20 players count.</p>
          <BaseButton v-if="league.home" block @click="shareLeague">Share {{ league.home.name }}’s standing</BaseButton>
        </div>
        <div v-if="league.countries.length" class="cl-card">
          <h3>Countries</h3>
          <ol class="cl-board"><li v-for="(c, i) in league.countries" :key="c.id"><span class="cl-rank">{{ i + 1 }}</span><span /><span class="cl-name">{{ c.name }}</span><span /><span class="cl-score">{{ c.score }}</span></li></ol>
        </div>
        <p class="cl-note">You play for your home city wherever you are. Set it in Settings.</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cl { display: grid; gap: 10px; }
.cl-head { display: grid; gap: 8px; }
.cl-back, .cl-link { border: 0; background: none; padding: 4px 0; font: inherit; color: var(--c-accent, #1f6f43); cursor: pointer; text-align: left; }
.cl-tabs, .cl-period { display: flex; gap: 6px; }
.cl-tabs button, .cl-period button { flex: 1; min-height: 44px; border: 1px solid #cfc7b8; background: #fff; border-radius: 20px; font: 600 14px system-ui; cursor: pointer; }
.cl-tabs button.on, .cl-period button.on { background: #20232c; color: #fff; border-color: #20232c; }
.cl-card { display: grid; gap: 8px; padding: 12px; background: #f3efe8; border-radius: 14px; border-left: 6px solid transparent; }
.cl-card h3, .cl-card h4, .cl-card p { margin: 0; }
.cl-banner { display: flex; gap: 12px; align-items: center; }
.cl-swatch { width: 44px; height: 44px; border-radius: 12px; flex: none; }
.cl-row { display: flex; gap: 8px; } .cl-row > * { flex: 1; }
.cl-note { font-size: 13px; color: var(--c-muted, #6b6b6b); margin: 0; }
.cl-said { margin: 0; padding: 8px 10px; background: #fff3d6; border-radius: 10px; font-size: 14px; }
.cl-code { font: 700 15px ui-monospace, monospace; letter-spacing: 2px; }
.cl-input { flex: 2; min-height: 44px; padding: 0 10px; border: 1px solid #cfc7b8; border-radius: 10px; font: 16px system-ui; box-sizing: border-box; width: 100%; }
.cl-preview { padding: 10px; border-left: 6px solid; background: #fff; border-radius: 10px; display: grid; gap: 8px; }
.cl-colours { display: flex; flex-wrap: wrap; gap: 8px; }
.cl-colours button { width: 36px; height: 36px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px #cfc7b8; cursor: pointer; }
.cl-colours button.on { box-shadow: 0 0 0 3px #20232c; }
.cl-list, .cl-board { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.cl-list li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 8px 10px; background: #f3efe8; border-radius: 10px; }
.cl-role { font-size: 12px; color: var(--c-muted, #6b6b6b); text-align: right; }
.cl-acts { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
.cl-acts button { border: 1px solid #cfc7b8; background: #fff; border-radius: 14px; padding: 4px 10px; font: 13px system-ui; min-height: 32px; cursor: pointer; }
.cl-board li { display: grid; grid-template-columns: 28px 10px 1fr auto auto; gap: 8px; align-items: center; padding: 6px 4px; border-bottom: 1px solid #e4ddd0; font-size: 14px; }
.cl-board li.me { font-weight: 700; background: #fff8e1; border-radius: 6px; }
.cl-rank { text-align: right; color: var(--c-muted, #6b6b6b); }
.cl-dot { width: 10px; height: 10px; border-radius: 50%; }
.cl-score { font-variant-numeric: tabular-nums; font-weight: 650; }
.cl-ai { margin-left: 4px; padding: 0 4px; border-radius: 4px; background: #20232c; color: #fff; font-size: 10px; vertical-align: 1px; }
.cl-me { border-left-width: 8px; }
</style>
