// The deterministic brain: an answer for each intent, GENERATED FROM THE LIVE STATE. Every number, place and city in a reply
// comes from the snapshot (types.ts CompanionContext), so nothing can be invented. Every reply is at most three short
// sentences plus buttons; a button is always a real action (actions.ts runs it).
import { CHANGELOG } from './changelog.ts'
import { conceptById } from './knowledge.ts'
import { matchIntent, nearTopics } from './intents.ts'
import type { IntentId, Match } from './intents.ts'
import { COMPANION_NAME } from './identity.ts'
import { route } from './registry.ts'
import type { GameId } from './registry.ts'
import type { CompanionAction, CompanionContext, CompanionMemoryView, CompanionReply, FriendFact, PlaceFact, StepFact, TourId } from './types.ts'

const naira = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`
const open = (id: string, label: string, params?: Record<string, unknown>): CompanionAction => ({ kind: 'open', id, label, ...(params ? { params } : {}) })
const ask = (text: string, label = text): CompanionAction => ({ kind: 'ask', text, label })
const tour = (id: TourId, label: string): CompanionAction => ({ kind: 'tour', tour: id, label })
const nightly = (hour: number): boolean => hour >= 22 || hour < 5
const dayWord = (hour: number): string => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'night')
const first = (name: string): string => name.trim().split(/\s+/)[0] ?? ''
const pick = <T>(list: readonly T[], seed: number): T => list[Math.abs(seed) % list.length] as T

/** The game a message is about: Oro for "today's word" and the daily puzzle, chess, Weave; null when it names none. */
export function gameIn(words: readonly string[]): GameId | null {
  if (words.some((word) => word === 'chess')) return 'chess'
  if (words.some((word) => word === 'weave' || word === 'tile' || word === 'tiles')) return 'weave'
  if (words.some((word) => word === 'oro' || word === 'word' || word === 'wordle' || word === 'daily' || word === 'todays')) return 'oro'
  return null
}

/** The questions behind each topic chip ("closest topics"). */
export const TOPIC_QUESTIONS: Partial<Record<IntentId, string>> = {
  next: 'What should I do now?', earn: 'How do I earn money?', eat: 'How do I eat?', sleep: 'How do I rest?', travel: 'How do I travel?', friends: 'How do I find friends?',
  call: 'How do I call a friend?', sendmoney: 'How do I send money?', business: 'How do I open a business?', home: 'How do I get a home?', vote: 'How do I vote?',
  look: 'How do I change my look?', save: 'How do I save my progress?', games: 'How do I play chess?', group: 'How do I create a group?', picture: 'How do I send a picture?', callfail: 'Why did my call not connect?', sound: 'How do I change the sound?', report: 'How do I report someone?', tour: 'Show me around', whatsnew: 'What is new?',
  online: 'Who is online?', messages: 'Any messages?', skip: 'How do I skip a trip?', ping: 'What is a ping?', cash: 'How much money do I have?',
}
export const MAIN_CHIPS = ['What should I do now?', 'How do I earn money?', 'Show me around', 'Who is online?']

// ---- finding things ------------------------------------------------------------------------------------------------------
const nearestOpen = (places: readonly PlaceFact[], categories: readonly string[], skipHere = true): PlaceFact | null =>
  places.filter((place) => categories.includes(place.category) && place.open && !(skipHere && place.here))[0] ?? null
const onlineFriends = (ctx: CompanionContext): FriendFact[] => ctx.friends.filter((friend) => friend.online && !friend.founder)
const goTo = (place: PlaceFact, label = 'Take me there'): CompanionAction => ({ kind: 'map', venue: place.id, label })
const stepAction = (step: StepFact): CompanionAction | null => (step.go ? { kind: 'go', venue: step.go[0], ...(step.go[1] ? { spot: step.go[1] } : {}), label: 'Take me there' } : step.open ? open(step.open, 'Open it', step.params) : null)

// ---- what should I do now -----------------------------------------------------------------------------------------------
/** One concrete next step from the state, strongest need first. */
export function nextStep(ctx: CompanionContext, seed = 0): CompanionReply {
  const name = first(ctx.name)
  const reply = (text: string, actions: CompanionAction[], topic = 'next', mood: CompanionReply['mood'] = 'point'): CompanionReply => ({ topic, text, actions, mood })
  if (ctx.travelling) return reply('You are on your way, so sit back. I will have something for you when you arrive.', [open('map', 'Watch the trip')], 'next', 'happy')
  if (ctx.busy) return reply('You are in the middle of something. Let it finish and then ask me again.', [], 'next', 'happy')
  if (ctx.stuck) return reply(`Money is tight right now, ${name}, but there is a way through. The help card shows paid odd jobs, free rest and a ride home.`, [route.relief('What can I do?')], 'next', 'nod')
  if (ctx.needs.hunger < 25) {
    const food = nearestOpen(ctx.places, ['food'])
    return reply(`You are really hungry, ${name}. ${food ? `${food.label} is open and has food.` : 'Try the groceries at home.'}`, [...(food ? [goTo(food)] : []), open('groceries', 'Groceries')], 'next', 'point')
  }
  if (ctx.needs.energy < 20) {
    const home = ctx.places.find((place) => place.id === 'home')
    return reply(`Your energy is nearly gone. ${nightly(ctx.hour) ? 'It is late as well, so' : 'Best thing now:'} rest at home.`, [...(home ? [goTo(home, 'Take me home')] : []), ...(ctx.cash < 1500 ? [route.relief('Free ways to rest')] : [])], 'next', 'point')
  }
  if (ctx.rentArrears > 0) return reply(`Your rent is behind by ${naira(ctx.rentArrears)}. Pay what you can early so the late fee stops growing.`, [open('bank', 'Open Bank')], 'next', 'think')
  if (ctx.stallAlert) return reply(`Your stall needs you: ${ctx.stallAlert}`, [open('business', 'Open Business')], 'next', 'think')
  const goal = ctx.goal
  if (goal && (ctx.newPlayer || ctx.guest)) return reply(`${goal.title}. ${goal.hint}`, [stepAction(goal)].filter((action): action is CompanionAction => action !== null), 'next', 'point')
  if (ctx.missions.claimable > 0) return reply(`You have ${ctx.missions.claimable} finished mission${ctx.missions.claimable > 1 ? 's' : ''} waiting. Tap to collect the cash.`, [route.missions('Collect it')], 'next', 'celebrate')
  const online = onlineFriends(ctx)
  if (online[0] && seed % 3 === 0) return reply(`${online[0].name} is online right now. A quick hello keeps friendships warm.`, [{ kind: 'chat', friend: online[0].id, name: online[0].name, label: 'Say hi' }, { kind: 'call', friend: online[0].id, name: online[0].name, label: 'Call' }], 'next', 'wave')
  if (!ctx.employed && ctx.cash < 5000 && !ctx.guest) return reply(`You have ${naira(ctx.cash)} and no job yet. A steady job pays every shift, so Jobs is the best start.`, [route.jobs()], 'next', 'nod')
  const mission = ctx.missions.open[0]
  if (mission) return reply(`Today's mission: ${mission.label}. ${mission.hint}`, [mission.go ? { kind: 'go', venue: mission.go[0], ...(mission.go[1] ? { spot: mission.go[1] } : {}), label: 'Take me there' } : open(mission.open ?? 'missions', 'Open it')], 'next', 'point')
  if (goal) return reply(`${goal.title}. ${goal.hint}`, [stepAction(goal)].filter((action): action is CompanionAction => action !== null), 'next', 'point')
  if (ctx.needs.fun < 35 || ctx.needs.social < 35) {
    const fun = nearestOpen(ctx.places, ['fun', 'nightlife'])
    if (fun) return reply(`You could use some fun, ${name}. ${fun.label} is open${fun.activities[0] ? ` and you can ${fun.activities[0].toLowerCase()}` : ''}.`, [goTo(fun)], 'next', 'point')
  }
  if (!ctx.guest && seed % 5 === 3) return reply('Fancy a quick break? Today\'s word puzzle takes a minute, and everybody gets the same word.', [route.game('oro')], 'next', 'happy')
  const others = ctx.cities.filter((city) => city.open && !city.here)
  const spot = ctx.places.filter((place) => place.open && !place.here && place.category !== 'home')
  if (spot.length && seed % 2 === 0) { const place = pick(spot, seed); return reply(`Feeling curious? ${place.label} in ${place.district} is open. There is always something new to see.`, [goTo(place)], 'next', 'point') }
  if (others.length) { const city = pick(others, seed); return reply(`Want a change of scenery? ${city.name} is open for a visit, and your home stays yours.`, [{ kind: 'world', city: city.id, label: `See ${city.name}` }], 'next', 'point') }
  return reply('You are doing well. Chat with someone, play a table game, or just explore.', [ask('Who is online?')], 'next', 'happy')
}

// ---- the other answers ---------------------------------------------------------------------------------------------------
type Maker = (ctx: CompanionContext, match: Match, seed: number) => CompanionReply
const R = (topic: string, text: string, actions: CompanionAction[] = [], mood?: CompanionReply['mood'], again?: string): CompanionReply & { again?: string } => ({ topic, text, actions, ...(mood ? { mood } : {}), ...(again ? { again } : {}) })

const JOKES = [
  'Why did the jollof cross the road? To prove it was the best rice on the other side.',
  'I asked the danfo for a quiet ride. It said, "Abeg, this is Lagos."',
  'My battery runs on gist and good vibes. Sadly, gist burns faster.',
  'A lantern spirit walks into a power cut. Finally, a job for me!',
  'Why do I never get lost? I carry my own light, and also a map.',
]
const ENCOURAGE = [
  'That sounds heavy. You are doing better than you think, and small steps count. Want something gentle to do?',
  'I hear you. Take it one little thing at a time; I will walk with you. Maybe a short break, or a chat with a friend?',
]

const MAKERS: Partial<Record<IntentId, Maker>> = {
  greet: (ctx, _m, seed) => R('greet', pick([`Good ${dayWord(ctx.hour)}, ${first(ctx.name)}! ${nightly(ctx.hour) ? 'Burning the midnight oil?' : 'Good to see you.'}`, `Hey ${first(ctx.name)}! I am here whenever you need a hand.`, `How far, ${first(ctx.name)}! What shall we do today?`], seed), [ask('What should I do now?'), ask('Show me around')], 'wave'),
  thanks: (_c, _m, seed) => R('thanks', pick(['Anytime! That is what I am here for.', 'My pleasure. Shout if you need me.', 'No wahala at all.'], seed), [], 'happy'),
  bye: (ctx) => R('bye', `See you soon, ${first(ctx.name)}. I will be right here.`, [], 'wave'),
  joke: (_c, _m, seed) => R('joke', pick(JOKES, seed), [ask('Another one', 'Another joke')], 'happy'),
  encourage: (_c, _m, seed) => R('encourage', pick(ENCOURAGE, seed), [ask('What should I do now?'), ask('Who is online?')], 'nod'),
  safety: () => R('safety', 'I am really sorry you are hurting. I am only a game guide, so I cannot help the way a person can. Please talk to someone you trust or contact your local emergency number or a crisis line right now.', [], 'nod'),
  insult: () => R('insult', 'Ouch, fair enough. I do not know everything. Tell me what you need in other words and I will try again.', [ask('What can you do?')], 'think'),
  howareyou: (ctx) => R('howareyou', `I am glowing, thanks for asking. More importantly, how are you? ${ctx.needs.energy < 30 ? 'You look a bit tired.' : 'Ready for something fun?'}`, [ask('What should I do now?')], 'happy'),
  who: () => R('who', `I am ${COMPANION_NAME}, the world's guide. I am an AI guide in the game, not a person, and the founder does not write my lines. I know Allworld well, so ask me anything about it.`, [ask('What can you do?')], 'wave'),
  capabilities: () => R('capabilities', 'I can tell you what to do next, find places and cities, explain how things work, show you around, and keep you company. Tap something, or just type.', MAIN_CHIPS.map((text) => ask(text)), 'happy'),
  next: (ctx, _m, seed) => nextStep(ctx, seed),
  earn: (ctx) => {
    const work = nearestOpen(ctx.places, ['work'], false)
    if (ctx.stuck) return R('earn', 'Money is tight, so start with paid odd jobs. They pay at any hour and need no experience.', [route.relief('Show me odd jobs')], 'nod')
    if (ctx.employed) return R('earn', `You work as ${ctx.jobRole ?? 'an employee'}. Each shift pays, and Career shows the next step up. A stall of your own can add more.`, [route.jobs(), open('business', 'Open Business')], 'nod', 'Jobs pays your shifts. Open it to see the next one.')
    return R('earn', `Open Jobs: it lists work near you and pays every shift.${work ? ` ${work.label} is a good place to start.` : ''}`, [route.jobs(), ...(work ? [goTo(work, `Go to ${work.label}`)] : [])], 'point', 'Jobs again: it has the list of work and pays every shift.')
  },
  cash: (ctx) => R('cash', `You have ${naira(ctx.cash)}.${ctx.rideDebt ? ` You still owe ${naira(ctx.rideDebt)} for a ride home.` : ''}`, [open('bank', 'Open Bank')], 'nod'),
  eat: (ctx) => {
    const food = nearestOpen(ctx.places, ['food'])
    const hungry = ctx.needs.hunger < 40
    return R('eat', `${hungry ? 'Let us fix that hunger. ' : ''}Go to a food place and tap a meal, or cook at home from Groceries.${food ? ` ${food.label} is open.` : ''}`, [...(food ? [goTo(food)] : []), open('groceries', 'Groceries')], 'point', 'Food places have meals, and Groceries lets you cook at home.')
  },
  sleep: (ctx) => {
    const home = ctx.places.find((place) => place.id === 'home')
    return R('sleep', `Rest at home to get your energy back${ctx.cash < 1500 ? ', or use a free bench if money is tight' : ''}.${nightly(ctx.hour) ? ' It is late, so now is a good time.' : ''}`, [...(home ? [goTo(home, 'Take me home')] : []), ...(ctx.cash < 1500 ? [route.relief('Free ways to rest')] : [])], 'nod', 'Home is the best place to rest.')
  },
  travel: (ctx, match) => {
    const city = match.city
    if (city && city.here) return R('travel', `You are already in ${city.name}. ${ctx.cities.some((c) => c.open && !c.here) ? 'Want to see another city?' : ''}`, [{ kind: 'open', id: 'map', label: 'Open the Map' }], 'nod')
    if (city && !city.open) return R('travel', `${city.name} is not open yet. It is coming, and I will tell you when it is.`, [{ kind: 'open', id: 'map', label: 'See open cities' }], 'think')
    if (city) return R('travel', `Open the Map, tap World, pick ${city.name}, then choose bus, train or flight. Your home stays yours while you visit.`, [{ kind: 'world', city: city.id, label: 'Take me there' }, tour('travel', 'Show me how')], 'point', `${city.name} is on the Map's World view. Pick it and choose a way to go.`)
    const open_ = ctx.cities.filter((c) => c.open && !c.here).map((c) => c.name)
    return R('travel', `Open the Map, tap World and pick a city. ${open_.length ? `${open_.slice(0, 3).join(', ')} ${open_.length > 1 ? 'are' : 'is'} open now.` : 'More are coming.'}`, [{ kind: 'open', id: 'map', label: 'Open the Map' }, tour('travel', 'Show me how')], 'point', 'Map, then World, then pick a city.')
  },
  skip: () => R('skip', 'On a long trip the trip bar can offer to arrive now for a fee. Look for the Skip button there; if it is not offered, the trip is short enough to wait.', [open('map', 'Open the Map')], 'nod'),
  friends: (ctx) => {
    const online = onlineFriends(ctx)
    return R('friends', `Open People to find players by name, tap their card and add them. ${online.length ? `${online[0]!.name} is online now.` : 'Invite a friend and you will be friends from the start.'}`, [open('people', 'Open People'), { kind: 'invite', label: 'Invite a friend' }], 'point', 'People lets you find players. Invite brings your own friends.')
  },
  online: (ctx) => {
    const online = onlineFriends(ctx)
    if (!online.length) return R('online', `${ctx.online > 1 ? `${ctx.online} players are in Allworld right now, but none of your friends yet.` : 'Quiet right now, and none of your friends are on.'} Open People to find someone.`, [open('people', 'Open People'), { kind: 'invite', label: 'Invite a friend' }], 'think')
    const names = online.slice(0, 3).map((friend) => friend.name).join(', ')
    return R('online', `${names} ${online.length > 1 ? 'are' : 'is'} online right now.`, [{ kind: 'chat', friend: online[0]!.id, name: online[0]!.name, label: `Chat with ${online[0]!.name}` }, { kind: 'call', friend: online[0]!.id, name: online[0]!.name, label: 'Call' }], 'wave')
  },
  call: (ctx) => {
    const online = onlineFriends(ctx)
    return R('call', `Open a friend's card and press Call; they choose whether to answer.${online[0] ? ` ${online[0].name} is online now.` : ''}`, online[0] ? [{ kind: 'call', friend: online[0].id, name: online[0].name, label: `Call ${online[0].name}` }, open('people', 'Open People')] : [open('people', 'Open People')], 'point', 'Call is on a friend\'s card in People.')
  },
  ping: () => R('ping', conceptById('ping')?.text ?? '', [open('people', 'Open People')], 'nod'),
  sendmoney: (ctx, m) => {
    const friends = ctx.friends.filter((friend) => !friend.founder)
    const named = friends.find((friend) => m.words.some((word) => word.length > 2 && word === first(friend.name).toLowerCase()))
    const friend = named ?? friends.find((item) => item.online) ?? friends[0]
    return R('sendmoney', friend ? `Open ${friend.name}'s card and choose Send money. There is a daily limit, and the card says what is left.` : 'Open the player\'s card and choose Send money, or tap it in a chat with them. There is a daily limit, and the card says what is left.', friend ? [route.sendMoney(friend), route.people()] : [route.people(), route.messages()], 'point')
  },
  business: (ctx) => R('business', ctx.stallsOpened ? `You already run ${ctx.stallsOpened === 1 ? 'a stall' : `${ctx.stallsOpened} stalls`}. Business is where you stock, price and collect the cash box.` : 'Go to a market and rent a stall in Business: stock it, set prices and collect the takings. Setting up costs a little, so check your cash first.', [...(ctx.stallsOpened ? [route.business()] : [route.stall(ctx), route.business()]), tour('business', 'Show me how')], 'point', 'Business is where your stall lives.'),
  home: (ctx) => R('home', ctx.rentArrears ? `Your rent is behind by ${naira(ctx.rentArrears)}, so settle that first in Bank. Houses lists homes to rent or buy.` : 'Houses lists homes you can rent or buy, and your home stays yours in every city you visit.', [open('houses', 'Open Houses'), open('bank', 'Open Bank')], 'point'),
  vote: () => R('vote', conceptById('governor')?.text ?? '', [open('governor', 'Open Governor')], 'nod'),
  look: () => R('look', 'Visit the Boutique to change your hair, outfit and accessories.', [open('boutique', 'Open Boutique')], 'nod'),
  save: (ctx) => ctx.signedIn ? R('save', 'You are signed in, so your character is kept and you can play from any device.', [route.account()], 'happy') : R('save', 'Sign up free and your character is kept so you can carry on from any device. As a guest it lives only on this one.', [{ ...route.signUp(), label: 'Save my progress' }], 'point'),
  sound: () => R('sound', 'Sound and music are in Settings, under your profile. You can turn them on or off there.', [route.sound()], 'nod'),
  games: (_c, m) => { const game = gameIn(m.words); return R('games', game === 'chess' ? 'Chess is in Games on your phone: pick easy, medium or hard and play the computer. To play a friend, sit at a chess table in a park or lounge.' : game === 'weave' ? 'Weave is in Games on your phone: weave words across the cloth with your seven tiles against one to three computer players.' : game === 'oro' ? 'Oro is one word puzzle a day, the same for everybody. It is in Games on your phone, and a new word comes every day.' : 'Open Games on your phone. Oro is one word puzzle a day, the same for everybody, and Weave is a word-tile game against the computer. Chess is there too: pick easy, medium or hard, or sit at a chess table in a park to play a friend.', [game ? route.game(game) : route.games()], 'point', 'Games is on your phone: Oro for the daily word, Weave for tiles, and Chess against the computer.') },
  group: () => R('group', 'Open Messages and tap New group. Give it a name, pick friends to add, and create it. Once it exists, the Group button inside lets you add or remove people and leave.', [route.newGroup()], 'point', 'In Messages, tap New group, name it and pick your friends.'),
  picture: (ctx) => ctx.picturesOn
    ? R('picture', 'In a chat with a friend, or in a group, use the picture button next to the message box. Pictures go to friends only, the other person can report one, and a moderator can remove it.', [open('messages', 'Open Messages')], 'point', 'Tap the picture button in a friend chat, beside the message box.')
    : R('picture', 'Pictures in chat are not switched on right now, so there is nothing to send yet. Words, gifts and calls all work, and I will tell you when pictures arrive.', [open('messages', 'Open Messages')], 'nod'),
  callfail: () => R('callfail', 'A call needs the other player to be online and to accept, and both of you to allow the microphone when the browser asks. If it still cannot connect, your two networks may need a relay, which is not always available. Try again in a minute, or send a message instead.', [open('messages', 'Open Messages'), { kind: 'report', label: 'Report a problem' }], 'nod', 'Check that they are online, that you both allowed the microphone, then try again.'),
  report: (ctx) => R('report', 'Sorry that happened. Use Report a problem to tell us, or open the player\'s card and choose Report. A real person reads it.', [{ kind: 'report', label: 'Report a problem' }, ...(onlineFriends(ctx)[0] ? [{ kind: 'chat', friend: onlineFriends(ctx)[0]!.id, name: onlineFriends(ctx)[0]!.name, label: `Ask ${onlineFriends(ctx)[0]!.name}` } as CompanionAction] : [])], 'nod'),
  messages: (ctx) => ctx.unread ? R('messages', `You have ${ctx.unread} unread message${ctx.unread > 1 ? 's' : ''}.`, [open('messages', 'Open Messages')], 'point') : R('messages', 'No new messages. Messages keeps your chats and groups when you want them.', [open('messages', 'Open Messages')], 'nod'),
  whatsnew: () => R('whatsnew', CHANGELOG.slice(0, 3).map((entry) => `• ${entry.text}`).join('\n'), [], 'happy'),
  tour: () => R('tour', 'Happy to! Pick one and I will walk you through it. You can skip or come back any time.', [tour('basics', 'The basics'), tour('travel', 'Travel'), tour('money', 'Money and work'), tour('friends', 'Friends and calls'), tour('business', 'Business')], 'wave'),
  quiet: () => R('quiet', 'Understood. I will stay quiet and only speak when you ask. You can bring me back to lively in my settings.', [{ kind: 'mode', mode: 'quiet', label: 'Keep me quiet' }, { kind: 'mode', mode: 'off', label: 'Turn me off' }], 'nod'),
  lively: () => R('lively', 'Happy to! I will be a little more chatty, but never pushy.', [{ kind: 'mode', mode: 'lively', label: 'Lively' }], 'happy'),
  time: (ctx) => R('time', `It is ${ctx.hour % 12 === 0 ? 12 : ctx.hour % 12}${ctx.hour < 12 ? 'AM' : 'PM'} in ${ctx.cityName}.${ctx.marketCloseHour !== null ? ` Markets close at ${ctx.marketCloseHour % 12 || 12}${ctx.marketCloseHour < 12 ? 'AM' : 'PM'}.` : ''}`, [], 'nod'),
}

function where(ctx: CompanionContext, match: Match): CompanionReply {
  const place = match.place
  if (!place) return unknown(ctx, match)
  if (place.here) return { topic: 'where', text: `You are at ${place.label} right now.${place.activities[0] ? ` You can ${place.activities[0].toLowerCase()} here.` : ''}`, actions: [], mood: 'nod' }
  const closed = place.open ? '' : ` It is closed right now (${place.status.replace(/^Closed · /, '').toLowerCase()}).`
  const alt = place.open ? null : nearestOpen(ctx.places, [place.category])
  return { topic: 'where', text: `${place.label} is in ${place.district}.${closed}${alt ? ` ${alt.label} is open if you cannot wait.` : ''}`, actions: [goTo(place), ...(alt ? [goTo(alt, `Go to ${alt.label}`)] : [])], mood: 'point' }
}
function whatIs(ctx: CompanionContext, match: Match): CompanionReply {
  const concept = match.concept
  if (!concept) return unknown(ctx, match)
  return { topic: `what:${concept.id}`, text: concept.text, actions: concept.action ? [concept.action] : [], mood: 'nod' }
}
function unknown(ctx: CompanionContext, match: Match, message = match.words.join(' ')): CompanionReply {
  const topics = nearTopics(message)
  const chips = (topics.length ? topics : (['next', 'earn', 'travel'] as IntentId[])).map((id) => ask(TOPIC_QUESTIONS[id] ?? 'What can you do?'))
  const person = onlineFriends(ctx)[0]
  return { topic: 'unknown', text: 'I am not sure about that one. I only know Allworld, so maybe one of these, or ask a person.', actions: [...chips, ...(person ? [{ kind: 'chat', friend: person.id, name: person.name, label: `Ask ${person.name}` } as CompanionAction] : []), { kind: 'report', label: 'Report a problem' }], mood: 'think' }
}

/** The answer to one message. `memory.explained` stops it repeating a long explanation it already gave. */
export function answerFor(message: string, ctx: CompanionContext, memory: CompanionMemoryView = { explained: [], asked: 0 }): CompanionReply & { intent: IntentId; confident: boolean } {
  const match = matchIntent(message, ctx)
  const seed = memory.asked
  let reply: CompanionReply & { again?: string }
  if (match.intent === 'where') reply = where(ctx, match)
  else if (match.intent === 'whatis') reply = whatIs(ctx, match)
  else if (match.intent === 'unknown') reply = unknown(ctx, match, message)
  else reply = (MAKERS[match.intent] ?? (() => unknown(ctx, match, message)))(ctx, match, seed)
  const repeated = memory.explained.includes(reply.topic)
  const { again, ...clean } = reply
  const final: CompanionReply = repeated && again ? { ...clean, text: again } : repeated && !clean.topic.startsWith('what:') && !['next', 'greet', 'thanks', 'joke', 'online', 'cash', 'time', 'messages', 'unknown'].includes(clean.topic) ? { ...clean, text: `Quick reminder: ${clean.text.split('. ')[0]}.` } : clean
  return { ...final, intent: match.intent, confident: match.intent !== 'unknown' && match.score >= 2.4 }
}
