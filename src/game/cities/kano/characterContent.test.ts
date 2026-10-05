import assert from 'node:assert/strict'
import test from 'node:test'
import {KANO_CONTENT} from './content.ts'
import {KANO_RULES} from './rules.ts'
import {KANO_LANDMARKS} from './landmarks.ts'

test('Kano starts in Nassarawa and offers culturally appropriate scenes and travel',()=>{
  assert.equal(KANO_RULES.defaultRentedHome,'kano-nassarawa-home')
  assert.equal(KANO_RULES.districts.find(district=>district.id==='nassarawa')?.localUnitId,'nassarawa')
  assert.equal(KANO_CONTENT.venues.find(venue=>venue.kind==='park')?.id,'nassarawa-garden')
  assert.ok(KANO_CONTENT.venues.every(venue=>venue.kind!=='club'))
  const garden=KANO_CONTENT.venues.find(venue=>venue.id==='tea-garden')
  assert.equal(garden?.kind,'park')
  assert.ok(garden&&Object.values(garden.definition.spots).flatMap(spot=>spot.activities).some(activity=>activity.tags?.includes('nightlife')))
  assert.ok(KANO_CONTENT.localModes?.every(mode=>mode.id!=='okada'))
  assert.match(KANO_CONTENT.localModes?.find(mode=>mode.id==='keke')?.label??'',/Adaidaita sahu/)
  assert.equal(KANO_CONTENT.localModeZones.length,3)
  const zones:readonly {venueIds:readonly string[]}[]=KANO_CONTENT.localModeZones
  assert.ok(zones.every(zone=>!zone.venueIds.includes('airport')&&!zone.venueIds.includes('buk-new')))
  assert.deepEqual(KANO_RULES.links.filter(link=>'status' in link).map(link=>link.mode),['rail'],'only the train is still coming; every road and flight can be booked')
  assert.ok(KANO_RULES.climate.beta)
  assert.equal(KANO_RULES.climate.rainChanceByMonth.length,12)
  assert.ok(KANO_RULES.climate.rainChanceByMonth[7]>KANO_RULES.climate.rainChanceByMonth[0])
  assert.match(KANO_LANDMARKS.find(marker=>marker.id==='kofar-kabuga')?.note??'',/demolished in 2014/)
})

test('Kano owns resident, career and activity wording',()=>{
  const publicVenues=KANO_CONTENT.venues.filter(venue=>venue.id!=='home')
  assert.equal(KANO_CONTENT.regulars.length,publicVenues.length*2)
  assert.equal(new Set(KANO_CONTENT.regulars.map(person=>person.definition.name)).size,KANO_CONTENT.regulars.length)
  for(const venue of publicVenues){
    const residents=KANO_CONTENT.regulars.filter(person=>person.venueId===venue.id)
    assert.equal(residents.length,2)
    assert.notEqual(residents[0]?.definition.role,residents[1]?.definition.role)
    assert.ok(residents.every(person=>person.definition.quotes.every(quote=>quote.length>15)))
  }
  const prose=[KANO_CONTENT.culture,KANO_CONTENT.venues.map(venue=>[venue.name,venue.whatYouCanDo,venue.definition]),KANO_CONTENT.regulars,KANO_CONTENT.workplaces,Object.values(KANO_CONTENT.dreamWording??{}),Object.values(KANO_CONTENT.lotteryWording??{})]
  const serialized=JSON.stringify(prose)
  assert.doesNotMatch(serialized,/\b(?:Lagos|Port Harcourt|Ogun|Mushin|CcHub|Lekki|Yaba|Quilox|nightclub|bar)\b/i)
  const dj=KANO_CONTENT.workplaces.find(workplace=>workplace.careerId==='dj')?.definition
  assert.ok(dj?.track)
  assert.ok(dj.ladder.every(rung=>rung.role!=='Club DJ'))
  assert.ok(KANO_CONTENT.wishes.every(wish=>!wish.id.startsWith('ph-')&&!wish.id.startsWith('fct-')&&!wish.id.startsWith('ogun-')))
  const activities=KANO_CONTENT.venues.flatMap(venue=>Object.values(venue.definition.spots).flatMap(spot=>spot.activities))
  assert.ok(activities.some(activity=>activity.id==='kano-indigo-learn'))
  assert.ok(activities.some(activity=>activity.id==='kano-leather-learn'))
  assert.ok(activities.some(activity=>activity.id==='kano-market-haggle'))
})
