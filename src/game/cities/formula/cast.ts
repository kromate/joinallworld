import type { NpcAge } from '../../../types/content.ts'
import type { CityPersonSeed } from '../contentBuilder.ts'
import type { CitySpec, IdentityFact, RealPlaceFact, RealPlaceKind } from '../spec.ts'
import { createNamer, nameRegionFor, type Gender } from './names.ts'

/** A role and two lines for one of the two regulars at a place. `{place}` is the place name. */
interface Part {
  readonly role: string
  readonly quotes: readonly [string, string]
}

interface Pair {
  readonly worker: Part
  readonly visitor: Part
}

/**
 * Roles and lines by kind of place. The lines are about the person's own day, never a claim about
 * the city. Where a line names a food or a market specialty it comes from the sourced identity facts (see `partsFor`).
 */
const PAIRS: Readonly<Record<RealPlaceKind, Pair>> = Object.freeze({
  airport: {
    worker: { role: 'Check-in agent', quotes: ['Please have your ticket and your ID ready.', 'Boarding closes earlier than people think.'] },
    visitor: { role: 'Traveller', quotes: ['I am flying out from {place} today.', 'Travelling is half waiting.'] },
  },
  church: {
    worker: { role: 'Church volunteer', quotes: ['Welcome to {place}. Please come in quietly.', 'I help to keep the place ready for each service.'] },
    visitor: { role: 'Regular worshipper', quotes: ['I have worshipped at {place} for a long time.', 'Sit anywhere there is room, and be welcome.'] },
  },
  'civic-landmark': {
    worker: { role: 'Site attendant', quotes: ['Welcome to {place}. Please take your time.', 'Ask me if you want to know about this place.'] },
    visitor: { role: 'Local resident', quotes: ['I walk past {place} most days.', 'Visitors often stop here for photographs.'] },
  },
  college: {
    worker: { role: 'Student', quotes: ['I am on my way to a lecture at {place}.', 'If you are lost, ask at the gate.'] },
    visitor: { role: 'Lecturer', quotes: ['I teach here, and I still enjoy a good question.', 'Read slowly and ask early.'] },
  },
  'craft-centre': {
    worker: { role: 'Craftsperson', quotes: ['I make things by hand at {place}.', 'Watch first, then try.'] },
    visitor: { role: 'Apprentice', quotes: ['I am learning the work at {place}.', 'My hands are slower than my teacher\'s, for now.'] },
  },
  eatery: {
    worker: { role: 'Cook', quotes: ['The pot at {place} is on, so sit down and eat.', 'Questions can wait until after the food.'] },
    visitor: { role: 'Regular diner', quotes: ['I come to {place} when I can.', 'I take my time with my plate.'] },
  },
  garden: {
    worker: { role: 'Garden keeper', quotes: ['I keep {place} tidy, so please mind the grass.', 'Evenings are the best time here.'] },
    visitor: { role: 'Evening walker', quotes: ['I come to {place} after work to cool down.', 'Fresh air first, then the day.'] },
  },
  government: {
    worker: { role: 'Clerk', quotes: ['Notices go on the board by the door.', 'Bring your papers in order and everything is easier.'] },
    visitor: { role: 'Visitor', quotes: ['I am here about some paperwork.', 'The queue moves faster if you stay calm.'] },
  },
  heritage: {
    worker: { role: 'Site guide', quotes: ['Welcome to {place}. Please take your time.', 'Ask me if you want to know about this place.'] },
    visitor: { role: 'Local resident', quotes: ['I walk past {place} most days.', 'Visitors often stop here for photographs.'] },
  },
  hospital: {
    worker: { role: 'Nurse', quotes: ['Please take a seat and we will call you.', 'Drink water, and ask if you are unsure where to go.'] },
    visitor: { role: 'Patient\'s relative', quotes: ['I am waiting with a relative at {place}.', 'Everyone here is patient, so I must be too.'] },
  },
  industry: {
    worker: { role: 'Works supervisor', quotes: ['Please keep to the marked paths.', 'Safety first, then the schedule.'] },
    visitor: { role: 'Visitor', quotes: ['I am here to learn how {place} works.', 'There is more going on than you can see from the gate.'] },
  },
  market: {
    worker: { role: 'Market trader', quotes: ['Welcome to {place}. Take a look around.', 'Come early. Bargaining is easier before the crowd.'] },
    visitor: { role: 'Shopper', quotes: ['I never leave {place} without comparing three prices.', 'Take your time, and bargain with a smile.'] },
  },
  mosque: {
    worker: { role: 'Mosque caretaker', quotes: ['Welcome to {place}. Please take off your shoes at the door.', 'I keep the place clean for prayer.'] },
    visitor: { role: 'Regular worshipper', quotes: ['I have prayed at {place} for a long time.', 'Come in quietly, and be welcome.'] },
  },
  museum: {
    worker: { role: 'Museum guide', quotes: ['Welcome to {place}. Please take your time.', 'Ask me if you want to know what is on display.'] },
    visitor: { role: 'Visitor', quotes: ['I came to {place} to learn something new.', 'Read the labels slowly. They reward you.'] },
  },
  nightlife: {
    worker: { role: 'Musician', quotes: ['We play at {place} when the evening comes.', 'Stay for the second set.'] },
    visitor: { role: 'Regular listener', quotes: ['I come to {place} for the music.', 'The best seats go early.'] },
  },
  park: {
    worker: { role: 'Park caretaker', quotes: ['I keep {place} tidy, so please mind the grass.', 'Evenings are the best time here.'] },
    visitor: { role: 'Morning walker', quotes: ['I walk through {place} before work.', 'Fresh air first, then the day.'] },
  },
  polling: {
    worker: { role: 'Election official', quotes: ['Voter information is on the notice board.', 'Please have your card ready.'] },
    visitor: { role: 'Voter', quotes: ['I came to {place} to find out how to vote.', 'It is worth knowing before the day.'] },
  },
  polytechnic: {
    worker: { role: 'Student', quotes: ['I am on my way to a workshop at {place}.', 'If you are lost, ask at the gate.'] },
    visitor: { role: 'Instructor', quotes: ['I teach practical work here.', 'Hands first, then the theory.'] },
  },
  port: {
    worker: { role: 'Dock worker', quotes: ['Please keep clear of the loading area.', 'The tide and the timetable both matter here.'] },
    visitor: { role: 'Traveller', quotes: ['I am waiting at {place} for my crossing.', 'Travelling is half waiting.'] },
  },
  'rail-station': {
    worker: { role: 'Station attendant', quotes: ['Check the board for your departure.', 'Stand behind the line on the platform.'] },
    visitor: { role: 'Traveller', quotes: ['I am waiting at {place} for my train.', 'Travelling is half waiting.'] },
  },
  'road-hub': {
    worker: { role: 'Ticket seller', quotes: ['Check the board for your departure.', 'Keep your bags close in a crowd.'] },
    visitor: { role: 'Traveller', quotes: ['I am waiting at {place} for my bus.', 'Travelling is half waiting.'] },
  },
  salon: {
    worker: { role: 'Stylist', quotes: ['Sit down, I will not keep you long.', 'A fresh style changes your whole week.'] },
    visitor: { role: 'Client', quotes: ['I come to {place} before big days.', 'Sit still and it goes faster.'] },
  },
  savings: {
    worker: { role: 'Bank teller', quotes: ['Please fill the form in block letters.', 'Count your money before you leave the counter.'] },
    visitor: { role: 'Customer', quotes: ['I am here to save a little this week.', 'Small savings add up.'] },
  },
  school: {
    worker: { role: 'Student', quotes: ['I am on my way to class at {place}.', 'If you are lost, ask at the gate.'] },
    visitor: { role: 'Teacher', quotes: ['I teach here, and I still enjoy a good question.', 'Read slowly and ask early.'] },
  },
  sport: {
    worker: { role: 'Groundsman', quotes: ['I mark the lines before every match.', 'A good pitch is quiet work.'] },
    visitor: { role: 'Supporter', quotes: ['I come to {place} for the sport.', 'Sit high up and you see the whole game.'] },
  },
  stadium: {
    worker: { role: 'Groundsman', quotes: ['I mark the lines before every match.', 'A good pitch is quiet work.'] },
    visitor: { role: 'Supporter', quotes: ['I come to {place} for the football.', 'Sit high up and you see the whole game.'] },
  },
  university: {
    worker: { role: 'Student', quotes: ['I am on my way to a lecture at {place}.', 'If you are lost, ask at the gate.'] },
    visitor: { role: 'Lecturer', quotes: ['I teach here, and I still enjoy a good question.', 'Read slowly and ask early.'] },
  },
})

const fill = (text: string, place: RealPlaceFact): string => text.replaceAll('{place}', place.name)

/** The sourced food or specialty a place features, if any. Lines about food and goods use only these facts. */
const featuredFacts = (spec: CitySpec, place: RealPlaceFact): readonly IdentityFact[] => {
  const byId = new Map<string, IdentityFact>([
    ...spec.identity.foods, ...spec.identity.crafts, ...spec.identity.industries, ...(spec.identity.culture ?? []),
  ].map((fact): [string, IdentityFact] => [fact.id, fact]))
  const ids = [...(place.featuredIdentityId ? [place.featuredIdentityId] : []), ...(place.specialtyIds ?? [])]
  return ids.flatMap(id => byId.get(id) ?? [])
}

const partsFor = (spec: CitySpec, place: RealPlaceFact): Pair => {
  const base = PAIRS[place.kind]
  const facts = featuredFacts(spec, place)
  const first = facts[0]
  if (!first) return base
  if (place.kind === 'eatery') {
    return {
      worker: { role: base.worker.role, quotes: [`Today the pot at {place} holds ${first.name}.`, 'Sit down and eat first. Questions can wait.'] },
      visitor: { role: base.visitor.role, quotes: [`I come to {place} for ${first.name}.`, first.description] },
    }
  }
  if (place.kind === 'market') {
    const names = facts.map(fact => fact.name).join(' and ')
    return {
      worker: { role: base.worker.role, quotes: [`Looking for ${names}? You are in the right place.`, base.worker.quotes[1]] },
      visitor: { role: base.visitor.role, quotes: [first.description, base.visitor.quotes[1]] },
    }
  }
  return base
}

const GENERATED = 'Generated regular. The name is drawn from a reviewed regional pool.'

/**
 * Two regulars at every place, in the order of `places`. A place the spec's `cast` covers uses the authored
 * pair. Any other place gets a generated pair, named from the pool for the city's region. No name is
 * numbered, none repeats within the city, and the same city always generates the same people.
 */
export function castFor(spec: CitySpec, places: readonly RealPlaceFact[]): readonly CityPersonSeed[] {
  const authored = new Map<string, CityPersonSeed[]>()
  for (const entry of spec.cast ?? []) authored.set(entry.placeId, [...(authored.get(entry.placeId) ?? []), entry])
  const region = nameRegionFor(spec.state.id)
  const namer = createNamer(spec.id, region, (spec.cast ?? []).map(entry => entry.name))
  return places.flatMap((place, index): readonly CityPersonSeed[] => {
    const own = authored.get(place.id)
    if (own) return own
    const pair = partsFor(spec, place)
    // The visitor's age cycles through young, elder and adult so a city has a mix of ages.
    const visitorAge: NpcAge = (['young', 'elder', 'adult'] as const)[index % 3]!
    const make = (part: Part, age: NpcAge, gender: Gender): CityPersonSeed => ({
      name: namer.next(gender, age === 'elder'),
      role: part.role,
      quotes: [fill(part.quotes[0], place), fill(part.quotes[1], place)],
      age,
      note: GENERATED,
    })
    const first: Gender = index % 2 === 0 ? 'female' : 'male'
    return [make(pair.worker, 'adult', first), make(pair.visitor, visitorAge, first === 'female' ? 'male' : 'female')]
  })
}
