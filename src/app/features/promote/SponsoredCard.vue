<script setup lang="ts">
// A Sponsored card in the feed (docs/PROMOTE.md): a business that paid for a week, marked as such, opening the business in the game.
import '../feed/feed.css'
import { useApp } from '../../state/app.ts'
import { mediaUrl } from '../feed/feedApi.ts'
import type { ListingView } from '../../../types/promote.ts'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ listing: ListingView }>()
const { game, shell } = useApp()
const playApp = isPlayApp()
const note = (): void => { void game.fetchJson('/api/promote/contact', { method: 'POST', body: { listing: props.listing.id } }).catch(() => undefined) }
const message = (): void => { note(); shell.open('person', { player: props.listing.owner.id, name: props.listing.owner.name }) }
const visit = (): void => { note(); shell.open('showcase', { shop: props.listing.shop }) }
</script>

<template>
  <article v-if="!playApp" class="feed-card" data-sponsored>
    <div class="feed-head"><div class="feed-who"><b>{{ listing.name }}</b><small>Sponsored · {{ listing.categoryLabel }}<template v-if="listing.area"> · {{ listing.area }}</template></small></div></div>
    <img v-if="listing.photo" class="feed-media" :src="mediaUrl(listing.photo)" alt="" loading="lazy">
    <p v-if="listing.about" class="feed-body">{{ listing.about }}</p>
    <div class="feed-bar"><button type="button" @click="message">Message</button><button v-if="listing.shop" type="button" @click="visit">Visit shop</button><button type="button" @click="shell.open('promote')">More businesses</button></div>
  </article>
</template>
