// The download-budget report on a small made-up build: what is first paint, what is startup, how chunks group, what fails.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { addSizes, checks, stableBytes, cityIds, closure, firstPaintFiles, groupOf, lazyGroups, pageAssets, sizeOf, staticImports, startupFiles } from './download-budget.ts'
import type { Dist } from './download-budget.ts'
import type { CityContentAssetManifestRow } from '../src/game/cities/content-asset.ts'

const bytes = (text: string): Uint8Array => Buffer.from(text)
// Random data does not compress, so a file's brotli size is close to its length: sizes in the tests can be set by length.
const noise = (length: number): Uint8Array => randomBytes(length)

function build(extra: Record<string, Uint8Array> = {}): Dist {
  return new Map<string, Uint8Array>(Object.entries({
    'index.html': bytes('<link rel="icon" href="/favicon.svg"><script type="module" src="/assets/app-AAAAAAA.js"></script><link rel="modulepreload" href="/assets/vue-BBBBBBB.js"><link rel="stylesheet" href="/assets/app-CCCCCCC.css">'),
    'assets/app-AAAAAAA.js': bytes('import"./vue-BBBBBBB.js";const l=()=>import("./startApp-DDDDDDD.js");'),
    'assets/vue-BBBBBBB.js': bytes('export const v=1;'),
    'assets/app-CCCCCCC.css': bytes('body{margin:0}'),
    'assets/startApp-DDDDDDD.js': bytes('import{v}from"./vue-BBBBBBB.js";'),
    'assets/city-network-EEEEEEE.js': bytes('export const r=1;'),
    'assets/city-lagos-rules-FFFFFFF.js': bytes('export const a=1;'),
    'assets/city-lagos-content-GGGGGGG.js': bytes('export const b=1;'),
    'assets/city-kano-rules-HHHHHHH.js': bytes('export const a=2;'),
    'assets/city-kano-content-IIIIIII.js': bytes('export const b=2;'),
    'assets/city-kano-scenes-JJJJJJJ.js': bytes('export const s=1;'),
    'assets/city-ibadan-scenes-KKKKKKK.js': bytes('export const s=2;'),
    'assets/world-adapter-LLLLLLL.js': bytes('export const w=1;'),
    ...Object.fromEntries(Object.entries(extra)),
  }))
}

test('static imports are followed, dynamic imports are not', () => {
  assert.deepEqual(staticImports('import"./a-1234567.js";import{x}from"./b-1234567.js";const l=()=>import("./c-1234567.js")'), ['assets/a-1234567.js', 'assets/b-1234567.js'])
  assert.deepEqual(pageAssets(build().get('index.html') ? Buffer.from(build().get('index.html')!).toString() : ''), ['assets/app-AAAAAAA.js', 'assets/vue-BBBBBBB.js', 'assets/app-CCCCCCC.css'])
  assert.deepEqual([...closure(build(), ['assets/startApp-DDDDDDD.js'])].sort(), ['assets/startApp-DDDDDDD.js', 'assets/vue-BBBBBBB.js'])
})

test('first paint is index.html, its stylesheet and scripts, and what they import; startup adds the shell and one city', () => {
  const dist = build()
  assert.deepEqual([...firstPaintFiles(dist)].sort(), ['assets/app-AAAAAAA.js', 'assets/app-CCCCCCC.css', 'assets/vue-BBBBBBB.js', 'index.html'])
  assert.deepEqual(cityIds(dist), ['kano', 'lagos'])
  assert.deepEqual([...startupFiles(dist, 'kano')!].sort(), [...firstPaintFiles(dist), 'assets/startApp-DDDDDDD.js', 'assets/city-kano-rules-HHHHHHH.js', 'assets/city-kano-content-IIIIIII.js'].sort())
  // The world network is lazy; a static import of it from the startup would bring it back into the closure.
  const eager = build({ 'assets/startApp-DDDDDDD.js': bytes('import{v}from"./vue-BBBBBBB.js";import"./city-network-EEEEEEE.js";') })
  assert.ok(startupFiles(eager, 'kano')!.has('assets/city-network-EEEEEEE.js'))
  assert.equal(startupFiles(dist, 'ibadan'), null, 'a city without rules and content chunks has no startup')
})

test('chunks group by name without the hash, and cities fold into one group per kind', () => {
  assert.deepEqual(['assets/city-kano-scenes-JJJJJJJ.js', 'assets/city-port-harcourt-scenes-KKKKKKK.js', 'assets/city-ogun-scenes-a-KKKKKKK.js', 'assets/city-kano-content-IIIIIII.js', 'assets/city-routes-EEEEEEE.js', 'assets/world-adapter-LLLLLLL.js', 'assets/x-1.png', 'assets/font-a1b2c3d4.woff2'].map(groupOf),
    ['city-*-scenes', 'city-*-scenes', 'city-*-scenes-a', 'city-*-content', 'city-routes', 'world-adapter', '*.png files', '*.woff2 files'])
  const groups = lazyGroups(build(), startupFiles(build(), 'lagos')!)
  assert.deepEqual(groups.map((group) => [group.group, group.files]).sort(), [['city-*-content', 1], ['city-*-rules', 1], ['city-*-scenes', 2], ['city-network', 1], ['world-adapter', 1]])
})

test('sizes: brotli is smaller than gzip is smaller than raw for text, and sums add up', () => {
  const size = sizeOf(bytes('const a=1;'.repeat(500)))
  assert.ok(size.brotli < size.gzip && size.gzip < size.raw, JSON.stringify(size))
  assert.deepEqual(addSizes([{ raw: 1, gzip: 2, brotli: 3 }, { raw: 10, gzip: 20, brotli: 30 }]), { raw: 11, gzip: 22, brotli: 33 })
})

test('a small build is inside every budget it can measure; budgets with no artifact are reported as not measured', () => {
  const results = checks(build())
  assert.equal(results.filter((item) => item.status === 'over').length, 0)
  const byName = Object.fromEntries(results.map((item) => [item.budget, item.status]))
  assert.equal(byName.FIRST_PAINT_BROTLI, 'ok')
  assert.equal(byName.STARTUP_BROTLI, 'ok')
  assert.equal(byName.SCENE_HOST_RAW, 'ok')
  for (const name of ['BASE_BODY_BROTLI', 'CLIP_PACK_BROTLI', 'WARDROBE_ITEM_BROTLI', 'STREET_TILE_BROTLI', 'TALK_INDEX_BYTES', 'TALK_CITY_PACK_BYTES']) assert.equal(byName[name], 'not measured', name)
})

test('a budget that is exceeded is reported over', () => {
  const dist = build({
    'assets/app-AAAAAAA.js': noise(600_000),
    'assets/avatar/base-body.glb': noise(300_001),
    'assets/avatar/clip-pack-1.bin': noise(120_000),
    'assets/avatar/clip-pack-2.bin': noise(120_000),
    'assets/wardrobe/hat.glb': noise(59_000),
    'assets/wardrobe/coat.glb': noise(61_000),
  })
  const byName = Object.fromEntries(checks(dist).map((item) => [item.budget, item]))
  assert.equal(byName.LOADING_RAW?.status, 'over')
  assert.equal(byName.FIRST_PAINT_BROTLI?.status, 'over')
  assert.equal(byName.BASE_BODY_BROTLI?.status, 'over')
  assert.equal(byName.CLIP_PACK_BROTLI?.status, 'over', 'a pack is the sum of its files')
  assert.equal(byName.WARDROBE_ITEM_BROTLI?.status, 'over', 'an item is the largest of its files')
  assert.ok((byName.WARDROBE_ITEM_BROTLI?.measured ?? 0) > 60_000)
})

test('talk index and each immutable city pack have independent raw-byte budgets', () => {
  const digest = 'b'.repeat(64), pack = bytes('p'.repeat(5_000_001))
  const reference = { city: 'accra', path: `/assets/talk-banks/accra-${digest}.json`, sha256: digest, bytes: pack.byteLength, banks: 1 }
  const indexText = JSON.stringify({ schema: 'allworld-talk-index', version: 1, cities: [reference] })
  const index = bytes(indexText + ' '.repeat(256_001 - indexText.length))
  const dist = build({
    'assets/talk-banks/index.json': index,
    [`assets/talk-banks/accra-${digest}.json`]: pack,
  })
  const measured = Object.fromEntries(checks(dist).map(item => [item.budget, item]))
  assert.equal(measured.TALK_INDEX_BYTES?.measured, 256_001)
  assert.equal(measured.TALK_INDEX_BYTES?.status, 'over')
  assert.equal(measured.TALK_CITY_PACK_BYTES?.measured, 5_000_001)
  assert.equal(measured.TALK_CITY_PACK_BYTES?.status, 'over')
})

test('scene packs enforce raw city bytes even for compressible text, and separate kit and hero Brotli caps', () => {
  const digest = 'a'.repeat(64)
  const dist = build({
    'assets/recipe-city-accra-abcdef0.js': bytes('x'.repeat(120_001)),
    [`assets/scene-factory/kits/gulf-guinea-${digest}.glb`]: noise(300_001),
    [`assets/scene-factory/heroes/accra-${digest}.glb`]: noise(60_001),
  })
  const measured = Object.fromEntries(checks(dist).map(item => [item.budget, item]))
  assert.equal(measured.CITY_SCENE_RECIPES_BYTES?.measured, 120_001)
  assert.equal(measured.CITY_SCENE_RECIPES_BYTES?.status, 'over')
  assert.equal(measured.SCENE_KIT_BROTLI?.status, 'over')
  assert.equal(measured.HERO_BROTLI?.status, 'over')
  assert.equal(measured.STARTUP_BROTLI?.status, 'ok', 'lazy scene packs do not enter startup')
});

const cityRow = (id: string, data: Uint8Array): CityContentAssetManifestRow => {
  const sha256 = 'a'.repeat(64)
  return { id, path: `/assets/cities/${id}.${sha256}.json`, sha256, bytes: data.byteLength }
}
const talkPack = (id: string, data: Uint8Array): Record<string, Uint8Array> => {
  const sha256 = 'b'.repeat(64), path = `/assets/talk-banks/${id}-${sha256}.json`
  const index = bytes(JSON.stringify({ schema: 'allworld-talk-index', version: 1, cities: [{ city: id, path, sha256, bytes: data.byteLength, banks: 1 }] }))
  return { 'assets/talk-banks/index.json': index, [path.slice(1)]: data }
}

test('combined city download cap catches only the sum while every individual file stays within its own cap', () => {
  const content = bytes('x'.repeat(4_000_000)), recipe = bytes('r'.repeat(100_000)), talk = bytes('t'.repeat(900_001)), row = cityRow('lagos', content)
  assert.ok(content.byteLength <= 5_000_000 && recipe.byteLength <= 120_000 && talk.byteLength <= 5_000_000)
  const result = checks(build({ [row.path.slice(1)]: content, 'assets/recipe-city-lagos-abcdef0.js': recipe, ...talkPack('lagos', talk) }), 'lagos', [row])
  const combined = result.find(item => item.budget === 'CITY_CONTENT_RECIPE_TALK_BYTES')
  assert.deepEqual([combined?.measured, combined?.status], [5_000_001, 'over'])
  assert.equal(result.find(item => item.budget === 'CITY_SCENE_RECIPES_BYTES')?.status, 'ok')
  assert.equal(result.find(item => item.budget === 'TALK_CITY_PACK_BYTES')?.status, 'ok')
})

test('combined city download cap includes exactly five million raw bytes', () => {
  const content = bytes('x'.repeat(4_000_000)), recipe = bytes('r'.repeat(100_000)), talk = bytes('t'.repeat(900_000)), row = cityRow('lagos', content)
  const result = checks(build({ [row.path.slice(1)]: content, 'assets/recipe-city-lagos-abcdef0.js': recipe, ...talkPack('lagos', talk) }), 'lagos', [row])
  const combined = result.find(item => item.budget === 'CITY_CONTENT_RECIPE_TALK_BYTES')
  assert.deepEqual([combined?.measured, combined?.status], [5_000_000, 'ok'])
})

test('city membership uses exact IDs, permits absent categories, and does not merge slug prefixes', () => {
  const port = noise(100), harbor = noise(200), recipe = noise(50)
  const rows = [cityRow('port', port), cityRow('port-harcourt', harbor)]
  const result = checks(build({
    [rows[0]!.path.slice(1)]: port,
    [rows[1]!.path.slice(1)]: harbor,
    'assets/recipe-city-port-harcourt-abcdef0.js': recipe,
  }), 'lagos', rows)
  const combined = result.find(item => item.budget === 'CITY_CONTENT_RECIPE_TALK_BYTES')
  assert.deepEqual([combined?.measured, combined?.status, combined?.detail.includes('port-harcourt')], [250, 'ok', true])
})

test('combined city accounting fails closed on duplicate IDs and unknown asset membership', () => {
  const row = cityRow('port', noise(10))
  assert.throws(() => checks(build(), 'lagos', [row, row]), /Invalid or duplicate city content manifest row/)
  assert.throws(() => checks(build({ 'assets/recipe-city-port-harcourt-abcdef0.js': noise(10) }), 'lagos', [row]), /Unknown, duplicate, or ambiguous city recipe/)
  assert.throws(() => checks(build({ ...talkPack('port-harcourt', noise(10)) }), 'lagos', [row]), /Unknown, duplicate, or ambiguous Talk city reference/)
})

test('the fx chunk is not measured until a build has one, then held to its raw and gzip budgets', () => {
  const status = (dist: Dist) => Object.fromEntries(checks(dist).map((item) => [item.budget, item.status]))
  assert.equal(status(build()).FX_RAW, 'not measured')
  assert.equal(status(build({ 'assets/fx-MMMMMMM.js': bytes('export const f=1;') })).FX_RAW, 'ok')
  assert.equal(status(build({ 'assets/fx-MMMMMMM.js': bytes('export const f=1;') })).FX_GZIP, 'ok')
  const big = status(build({ 'assets/fx-MMMMMMM.js': noise(400_001) }))
  assert.equal(big.FX_RAW, 'over')
  assert.equal(big.FX_GZIP, 'over')
})


test('sizes: two files that differ only in the chunk hashes they name measure the same compressed size', () => {
  const a = bytes('import"./assets/engine-1a2b3c4.js";import"./assets/fx-9f8e7d6.js";' + 'const a=1;'.repeat(200))
  const b = bytes('import"./assets/engine-0badf00.js";import"./assets/fx-c0ffee1.js";' + 'const a=1;'.repeat(200))
  assert.equal(stableBytes(a).length, a.length)
  assert.deepEqual(sizeOf(a), sizeOf(b))
  assert.equal(Buffer.from(stableBytes(bytes('plain text, no hashes'))).toString(), 'plain text, no hashes')
})
