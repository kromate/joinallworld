<script setup lang="ts">
// A shop-front card (docs/PROMOTE.md, "Business street"): one business of the city, with an awning, its photo and what it offers. It opens the
// business in the game: a message to the owner, and their Showcase shop (where a business keeps its own outside links). The listing rules stay
// what they are: no phone numbers or links in a listing, so there is no WhatsApp button here.
import '../feed/feed.css'
import './shopfront.css'
import { useApp } from '../../state/app.ts'
import { mediaUrl } from '../feed/feedApi.ts'
import type { ListingView } from '../../../types/promote.ts'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ listing: ListingView; opened?: boolean }>()
const { game, shell } = useApp()
const playApp = isPlayApp()
const note = (): void => { void game.fetchJson('/api/promote/contact', { method: 'POST', body: { listing: props.listing.id, via: 'street' } }).catch(() => undefined) }
const message = (): void => { note(); shell.open('person', { player: props.listing.owner.id, name: props.listing.owner.name }) }
const visit = (): void => { note(); shell.open('showcase', { shop: props.listing.shop }) }
</script>

<template>
  <article class="shopfront" :class="{ 'is-opened': opened }" :data-listing="listing.id">
    <div class="shopfront-awning" aria-hidden="true" />
    <div class="shopfront-body">
      <div class="shopfront-head">
        <img v-if="listing.photo" class="shopfront-photo" :src="mediaUrl(listing.photo)" alt="" loading="lazy" width="64" height="64">
        <div class="feed-who"><b>{{ listing.name }}</b><small>{{ listing.categoryLabel }}<template v-if="listing.area"> · {{ listing.area }}</template><template v-if="!playApp && listing.boosted"> · Sponsored</template></small></div>
      </div>
      <p v-if="listing.about" class="feed-body">{{ listing.about }}</p>
      <div class="feed-bar"><button type="button" @click="message">Message {{ listing.owner.name }}</button><button v-if="listing.shop" type="button" @click="visit">Visit shop</button></div>
    </div>
  </article>
</template>
