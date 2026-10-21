import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = async (path: string): Promise<string> => readFile(new URL(path, import.meta.url), 'utf8')

test('Play mode removes the digital checkout entry points while keeping their web branches', async () => {
  const [earn, plans, work, businesses, noticeboard, shop, room, premieres, commerce, bonus] = await Promise.all([
    source('./features/earn/EarnApp.vue'),
    source('./features/feed/PlansApp.vue'),
    source('./features/feed/WorkApp.vue'),
    source('./features/promote/BusinessesApp.vue'),
    source('./features/neighbourhood/NoticeboardApp.vue'),
    source('./features/showcase/ShopPage.vue'),
    source('./features/showcase/room/ShopInside.vue'),
    source('./features/watch/Premieres.vue'),
    source('./features/commerce/CommerceApp.vue'),
    source('./features/bonus/BonusLine.vue'),
  ])

  assert.match(earn, /v-if="!playApp" class="feed"/)
  assert.match(plans, /v-if="!playApp && open\.price/)
  assert.match(work, /v-if="!playApp && g\.paid/)
  assert.match(businesses, /v-if="!playApp && l\.status === 'live'"/)
  assert.match(noticeboard, /v-else-if="!playApp && m\.canGo && m\.event\.price"/)
  assert.match(shop, /v-if="!playApp && shop\.pay"/)
  assert.match(room, /const showPay = computed\(\(\) => !playApp/)
  assert.match(premieres, /&& \(!playApp \|\| !item\.price\)/)
  assert.match(commerce, /v-if="!playApp" class="commerce-earnings"/)
  assert.match(bonus, /of in-game naira/)
})

test('the rating feature stays default-off and lazy at startup', async () => {
  const extras = await source('./startExtras.ts')
  assert.match(extras, /VITE_PLAY_RATING_PROMPT === 'on'/)
  assert.match(extras, /import\('\.\/features\/rating\/startRatingPrompt\.ts'\)/)
  assert.doesNotMatch(extras, /^import .*startRatingPrompt/m)
})

test('Play mode suppresses paid promotional inventory while ordinary businesses remain', async () => {
  const [ads, civic, feed, sponsored, shopFront, businesses, map, overview] = await Promise.all([
    source('./features/civic/AdsApp.vue'), source('./features/civic/register.ts'), source('./features/feed/FeedApp.vue'),
    source('./features/promote/SponsoredCard.vue'), source('./features/promote/ShopFront.vue'), source('./features/promote/BusinessesApp.vue'),
    source('./features/travel/MapApp.vue'), source('./features/travel/MapOverview.vue'),
  ])
  assert.match(ads, /when: \(\) => !playApp/)
  assert.match(civic, /id: 'ads'/)
  assert.match(feed, /sponsored\.value = playApp \? \[\]/)
  assert.match(sponsored, /<article v-if="!playApp"/)
  assert.match(shopFront, /v-if="!playApp && listing\.boosted"/)
  assert.match(businesses, /every business open to customers/)
  assert.match(map, /playApp \? \{ billboards: false, sea: false \}/)
  assert.match(overview, /!playApp \|\| item\.id !== 'billboards'/)
})


test('Play mode starts from the lazy extras, never from the first download', async () => {
  const [boot, extras] = await Promise.all([source('./bootstrap.ts'), source('./startExtras.ts')])
  assert.doesNotMatch(boot, /playMode/)
  assert.match(extras, /import\('\.\/playMode\.ts'\)\.then\(\(\{ isPlayApp, startPlayMode \}\) => \{\n    startPlayMode\(\)/)
})

test('inside the Play app the phone does not list Earn or Billboards; the web lists them as before', async () => {
  const { listedApps } = await import('./features/phone/phoneHomeModel.ts')
  const panels = ['earn', 'ads', 'bank', 'feed'].map(id => ({ id, title: id, placement: 'phone' })) as unknown as Parameters<typeof listedApps>[0]
  assert.deepEqual(listedApps(panels, true).map(app => app.id), ['bank', 'feed'])
  assert.deepEqual(listedApps(panels, false).map(app => app.id), ['earn', 'ads', 'bank', 'feed'])
})
