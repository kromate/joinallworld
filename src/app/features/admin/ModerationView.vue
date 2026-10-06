<script setup lang="ts">
// The reports queue with the reported content in context, one-tap answers, shops that may need a plain name, and live content that can be removed.
// Other features add their own queues through the tool descriptors (server/admin/tools.ts), listed at the bottom.
import { onMounted, ref } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { absolute } from './adminModel.ts'

const emit = defineEmits<{ player: [id: string] }>()
const api = useAdmin()
interface Report { id: string; about: string; aboutName: string; aboutNow: string | null; byName: string; reason: string; text: string; at: number; status: string; evidence: string[]; note?: string }
const status = ref('open'), reports = ref<Report[]>([]), error = ref(''), note = ref(''), notes = ref<Record<string, string>>({}), minutes = ref(60)
async function load(): Promise<void> { const r = await api.get<{ reports: Report[] }>('/api/admin/moderation/reports', { status: status.value }); if (r.ok) { reports.value = r.data.reports; error.value = '' } else error.value = r.error.reason }
async function act(report: Report, action: 'dismiss' | 'warn' | 'mute'): Promise<void> {
  const r = await api.post(`/api/admin/moderation/reports/${report.id}/act`, { action, note: notes.value[report.id] ?? '', minutes: minutes.value }, `report:${report.id}:${action}`)
  note.value = r.ok ? `${report.id}: done.` : r.error.reason
  void load()
}
interface Shop { shop?: string; id?: string; name?: string; by?: { id: string; name: string }; reason?: string; current?: string | null; live?: boolean }
const shops = ref<Shop[]>([])
async function loadShops(): Promise<void> { const r = await api.get<{ reports: Shop[] }>('/api/admin/moderation/shops'); if (r.ok) shops.value = r.data.reports }
async function shop(item: Shop, action: 'rename' | 'close'): Promise<void> { const r = await api.post('/api/admin/moderation/shops/act', { shop: item.shop, action }, `shop:${item.shop}:${action}`); note.value = r.ok ? 'Done.' : r.error.reason; void loadShops() }
const city = ref('lagos'), content = ref<{ ads: { text: string; kind?: string; slot?: string; by: { name: string } }[]; radio: { id: string; title: string; venue?: string; by: { name: string } }[]; announcements: { id: string; text: string; by: { name: string } }[] } | null>(null)
async function loadContent(): Promise<void> { const r = await api.get<NonNullable<typeof content.value>>('/api/admin/moderation/content', { city: city.value }); if (r.ok) content.value = r.data; else error.value = r.error.reason }
async function remove(body: Record<string, unknown>): Promise<void> { const r = await api.post('/api/admin/moderation/content/remove', { cityId: city.value, ...body }, `content:${JSON.stringify(body)}`); note.value = r.ok ? 'Removed.' : r.error.reason; void loadContent() }
onMounted(() => { void load(); void loadShops(); void loadContent() })
</script>

<template>
  <section>
    <h2>Moderation</h2>
    <p v-if="note" class="adm-ok" role="status">{{ note }}</p><p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <div class="adm-card">
      <div class="adm-row"><h3 style="flex:1;margin:0">Player reports</h3><label>Show<select v-model="status" @change="load"><option value="open">Open</option><option value="all">All</option><option value="dismissed">Dismissed</option><option value="actioned">Actioned</option></select></label></div>
      <p v-if="!reports.length" class="adm-muted">No reports.</p>
      <div v-for="report in reports" :key="report.id" class="adm-card" style="margin-bottom:8px;background:#fafbfc">
        <div><b>{{ report.id }}</b> · {{ report.reason }} · about <a href="#" @click.prevent="emit('player', report.about)">{{ report.aboutNow ?? report.aboutName }}</a> by {{ report.byName }} · {{ absolute(report.at) }} <span class="adm-chip">{{ report.status }}</span></div>
        <p v-if="report.text" style="margin:6px 0">“{{ report.text }}”</p>
        <ul v-if="report.evidence.length" class="adm-sub"><li v-for="line in report.evidence" :key="line">{{ line }}</li></ul>
        <p v-if="report.note" class="adm-sub">Note: {{ report.note }}</p>
        <div v-if="report.status === 'received'" class="adm-row" style="margin:6px 0 0"><label style="flex:1;min-width:180px">Note or reason<input v-model="notes[report.id]" maxlength="200"></label><label>Mute minutes<input v-model.number="minutes" type="number" min="1" style="width:90px"></label>
          <button class="adm-btn" @click="act(report, 'dismiss')">Dismiss</button><button class="adm-btn" @click="act(report, 'warn')">Warn</button><button class="adm-btn danger" @click="act(report, 'mute')">Mute</button></div>
      </div>
      <p class="adm-sub">To suspend, open the player and use Ban or Suspend.</p>
    </div>
    <div class="adm-two" style="margin-top:12px">
      <div class="adm-card"><h3>Reported shops</h3><p v-if="!shops.length" class="adm-muted">None.</p>
        <div v-for="item in shops" :key="item.shop" style="margin-bottom:8px"><b>{{ item.current ?? item.name }}</b> <span class="adm-sub">{{ item.reason }}</span><div class="adm-row" style="margin:4px 0 0"><button class="adm-btn" @click="shop(item, 'rename')">Plain name</button><button class="adm-btn danger" @click="shop(item, 'close')">Close</button></div></div></div>
      <div class="adm-card"><div class="adm-row"><h3 style="flex:1;margin:0">Live city content</h3><label>City<select v-model="city" @change="loadContent"><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label></div>
        <template v-if="content"><div v-for="ad in content.ads" :key="(ad.kind ?? '') + ad.slot" class="adm-sub">Ad “{{ ad.text }}” by {{ ad.by.name }} <button class="adm-btn" @click="remove({ kind: ad.kind, slot: ad.slot })">Remove</button></div>
          <div v-for="a in content.announcements" :key="a.id" class="adm-sub">Notice “{{ a.text }}” by {{ a.by.name }} <button class="adm-btn" @click="remove({ kind: 'announcement', id: a.id })">Remove</button></div>
          <div v-for="r in content.radio" :key="r.id" class="adm-sub">Shout-out “{{ r.title }}” by {{ r.by.name }} <button class="adm-btn" @click="remove({ kind: 'radio', id: r.id, venue: r.venue })">Remove</button></div>
          <p v-if="!content.ads.length && !content.announcements.length && !content.radio.length" class="adm-muted">Nothing live.</p></template></div>
    </div>
    <div v-if="admin.me?.tools.length" class="adm-card" style="margin-top:12px"><h3>Tools from other features</h3><div v-for="tool in admin.me.tools" :key="tool.id" class="adm-sub">{{ tool.title }} ({{ tool.kind }})</div></div>
  </section>
</template>
