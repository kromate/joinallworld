import assert from 'node:assert/strict'
import test from 'node:test'
import { LOTTERY } from '../../content/traits.ts'
import { dreamFor, lotteryBulletsFor } from '../characterContent.ts'
import { loadCityContent } from '../registry.ts'
import { PORT_HARCOURT_CONTENT } from './content.ts'

await loadCityContent('port-harcourt')

test('Port Harcourt startup wording uses local workplaces and free local housing', () => {
  const dream = dreamFor('port-harcourt','yaba-unicorn')
  assert.match(dream.goal,/Rivers State University/)
  assert.match(dream.measure,/level 8 is 60%.*level 5 is 20%.*visit is 5%.*15%/)
  assert.doesNotMatch(`${dream.label} ${dream.goal} ${dream.measure}`,/Yaba|CcHub|Lagos/)
  assert.doesNotMatch(dreamFor('port-harcourt','lekki-landlord').label,/Lekki/)
  for(const id of ['lekki-landlord','afrobeats-star'] as const){
    const local=dreamFor('port-harcourt',id)
    assert.doesNotMatch(`${local.label} ${local.goal} ${local.measure}`,/Lekki|Yaba|CcHub|Lagos/)
  }
  assert.equal(dreamFor('port-harcourt','lekki-landlord').goal,'Build a net worth of ₦1,000,000.')
  assert.equal(dreamFor('port-harcourt','afrobeats-star').goal,'Reach Music level 10.')
  for(const outcome of Object.values(LOTTERY)){
    const bullets=lotteryBulletsFor('port-harcourt',outcome.id).join(' ')
    assert.doesNotMatch(bullets,/Mushin|Yaba|Lekki|three homes/)
    assert.match(bullets,/free starter house/)
  }
})

test('Port Harcourt visit wishes and residents use city-owned wording',()=>{
  const content=PORT_HARCOURT_CONTENT
  assert.ok(content.wishes.some(wish=>wish.id==='ph-visit-0'))
  assert.ok(content.wishes.every(wish=>!wish.id.startsWith('ogun-')))
  const publicVenues=content.venues.filter(venue=>venue.id!=='home')
  assert.equal(content.regulars.length,publicVenues.length*2)
  assert.equal(new Set(content.regulars.map(person=>person.definition.name)).size,content.regulars.length)
  for(const venue of publicVenues){
    const locals=content.regulars.filter(person=>person.venueId===venue.id)
    assert.equal(locals.length,2,`${venue.id} has two residents`)
    for(const person of locals){
      assert.notEqual(person.definition.role,`${venue.name} guide`)
      assert.notEqual(person.definition.role,`${venue.name} regular`)
      assert.ok(person.definition.quotes.every(quote=>quote.length>15))
    }
  }
})
