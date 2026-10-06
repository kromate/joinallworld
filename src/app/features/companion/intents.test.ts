// The intent matcher: a table of phrasings (English, Nigerian English, Pidgin, typos) and what each must be understood as.
// Anything the table does not cover must fall through to "unknown" — the companion never guesses.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchIntent, nearTopics } from './intents.ts'
import type { IntentId } from './intents.ts'
import { distance, normalize, same } from './text.ts'
import { ctx } from './testFixtures.ts'

const TABLE: [string, IntentId][] = [
  // games, groups, pictures, calls that fail
  ['how do I play chess', 'games'], ['how do i play the word game', 'games'], ['what is oro', 'games'], ['where is the daily word', 'games'], ['i wan play game', 'games'], ['how do i play weave', 'games'],
  ['how do I create a group', 'group'], ['abeg how i go make group chat', 'group'], ['can i start a new group', 'group'],
  ['how do I send a picture', 'picture'], ['can i share photos in chat', 'picture'], ['how to post image', 'picture'],
  ['why did my call not connect', 'callfail'], ['my call failed', 'callfail'], ['call dropped', 'callfail'], ['i cant hear the call', 'callfail'], ['why my call no go connect', 'callfail'], ['call not working', 'callfail'],
  // next step
  ['what should I do now', 'next'], ['wetin I go do', 'next'], ['wetin I suppose do now', 'next'], ['I dey bored', 'next'], ['i am bored', 'next'], ['nothing to do', 'next'],
  ['what next?', 'next'], ['give me a mission', 'next'], ['abeg suggest something to do', 'next'], ['I am lost', 'next'], ['where do I start', 'next'], ['wat shud i do', 'next'],
  ['what can I do here', 'next'], ['any ideas?', 'next'], ['i dont know what to do', 'next'], ['recomend something', 'next'], ['now what', 'next'], ['i no know wetin to do', 'next'], ['i am stuck', 'next'], ['boring', 'next'],
  // earn
  ['how do I earn money', 'earn'], ['where I fit work', 'earn'], ['I wan make money', 'earn'], ['how I go make money', 'earn'], ['how can i get a job', 'earn'], ['i am broke', 'earn'], ['i need money abeg', 'earn'],
  ['how do i get paid', 'earn'], ['where can i find work', 'earn'], ['jobs', 'earn'], ['i want to hustle', 'earn'], ['how to make cash fast', 'earn'], ['i no get money', 'earn'], ['how do people get rich here', 'earn'], ['wher can i werk', 'earn'], ['salary', 'earn'], ['how much does a job pay', 'earn'],
  // cash
  ['how much money do i have', 'cash'], ['what is my balance', 'cash'], ['check my wallet', 'cash'], ['how much I get', 'cash'],
  // eat
  ['I wan chop', 'eat'], ['i am hungry', 'eat'], ['how do i eat', 'eat'], ['where can i get food', 'where'], ['I dey hungry', 'eat'], ['my stomach dey pain me', 'eat'], ['how do i cook', 'eat'], ['how to buy groceries', 'eat'], ['hungary', 'eat'], ['i need a meal', 'eat'], ['i am starving', 'eat'], ['abeg i wan chop food', 'eat'],
  // sleep
  ['how do I sleep', 'sleep'], ['i am tired', 'sleep'], ['my energy is low', 'sleep'], ['i wan rest', 'sleep'], ['where can i rest', 'sleep'], ['how do i get energy back', 'sleep'], ['sleepy', 'sleep'], ['i dey tire', 'sleep'], ['exhausted', 'sleep'],
  // travel
  ['how do i travel to Abuja', 'travel'], ['how I go take travel', 'travel'], ['i want to go to ibadan', 'travel'], ['take me to kano', 'travel'], ['abeg how i go reach abuja', 'travel'], ['can i visit another city', 'travel'], ['how do i fly', 'travel'], ['travel', 'travel'],
  ['how do i get to port harcourt', 'travel'], ['abjua', 'travel'], ['how to go lagos to kano', 'travel'], ['i wan travel', 'travel'], ['is there a bus to ibadan', 'travel'], ['train to abuja', 'travel'], ['how do i leave this city', 'travel'], ['other cities', 'travel'],
  // skip
  ['how do i skip the trip', 'skip'], ['can i arrive now', 'skip'], ['this trip is too long', 'skip'], ['skip', 'skip'], ['abeg skip the journey', 'skip'],
  // friends / online
  ['how do i find friends', 'friends'], ['i wan make friends', 'friends'], ['how do I add a friend', 'friends'], ['where can i meet people', 'friends'], ['who is online', 'online'], ['anyone online?', 'online'], ['is any friend online', 'online'], ['who dey online', 'online'], ['who is around', 'online'],
  // call / ping
  ['how do i call a friend', 'call'], ['I wan call somebody', 'call'], ['how do voice calls work', 'call'], ['can i ring my friend', 'call'], ['how do i ping someone', 'ping'], ['what is ping', 'ping'], ['how do i join my friend', 'ping'],
  // send money
  ['how do i send money', 'sendmoney'], ['I wan send money to my friend', 'sendmoney'], ['can i transfer naira', 'sendmoney'], ['how to gift a friend', 'sendmoney'], ['abeg how i go send money', 'sendmoney'],
  // business
  ['how do i open a business', 'business'], ['I wan open shop', 'business'], ['how do i sell things', 'business'], ['how do i rent a stall', 'business'], ['i wan start business', 'business'], ['can i own a shop', 'business'], ['bussiness', 'business'],
  // home
  ['how do i buy a house', 'home'], ['I wan buy house', 'home'], ['where do i live', 'home'], ['how do i pay rent', 'home'], ['how do i decorate my home', 'home'], ['my landlord', 'home'],
  // vote
  ['how do i vote', 'vote'], ['who is the governor', 'vote'], ['when is the election', 'vote'], ['abeg how i go vote', 'vote'], ['can i run for governor', 'vote'],
  // look
  ['how do i change my look', 'look'], ['i wan change my hair', 'look'], ['where can i buy clothes', 'look'], ['change outfit', 'look'], ['how do i change my character', 'look'], ['boutique', 'look'],
  // save
  ['how do i save my progress', 'save'], ['how do i sign up', 'save'], ['will i lose my character', 'save'], ['how to login', 'save'], ['can i play on another device', 'save'], ['create account', 'save'],
  // sound
  ['how do i turn off sound', 'sound'], ['mute the music', 'sound'], ['i cant hear anything', 'sound'], ['how do i turn on the sound', 'sound'], ['too loud', 'sound'],
  // report
  ['how do i report someone', 'report'], ['someone is harassing me', 'report'], ['i found a bug', 'report'], ['this player is rude', 'report'], ['report a problem', 'report'], ['the game is not working', 'report'], ['i wan report person', 'report'],
  // where
  ['where is the hospital', 'where'], ['where is the market', 'where'], ['where can i find a buka', 'where'], ['wia is amala shitta', 'where'], ['take me to the beach', 'where'], ['where is the police station', 'where'], ['find a church', 'where'], ['where be the office', 'where'], ['nearest food', 'where'], ['cchub', 'where'], ['where is cc hub', 'where'], ['show me quilox', 'where'],
  // what is
  ['what is mood', 'whatis'], ['what are needs', 'whatis'], ['what is a stall', 'whatis'], ['explain missions', 'whatis'], ['what are stars for', 'whatis'], ['what does rent mean', 'whatis'], ['what is a billboard', 'whatis'], ['wetin be bae', 'whatis'], ['what is the rich list', 'whatis'], ['meaning of ping', 'ping'],
  // new, tour, settings
  ['what is new', 'whatsnew'], ['any new features', 'whatsnew'], ['what changed', 'whatsnew'], ['show me around', 'tour'], ['give me a tour', 'tour'], ['how does this game work', 'tour'], ['teach me the basics', 'tour'], ['abeg show me how to play', 'tour'], ['tutorial', 'tour'],
  ['be quiet', 'quiet'], ['stop disturbing me', 'quiet'], ['please stop nudging me', 'quiet'], ['go away', 'quiet'], ['you are annoying', 'quiet'], ['talk more', 'lively'], ['any messages', 'messages'], ['do i have unread mail', 'messages'],
  // small talk
  ['hello', 'greet'], ['hi', 'greet'], ['hey there', 'greet'], ['good morning', 'greet'], ['how far', 'greet'], ['how far na', 'greet'], ['yo', 'greet'], ['wetin dey happen', 'greet'], ['sup', 'greet'],
  ['thanks', 'thanks'], ['thank you so much', 'thanks'], ['tanks', 'thanks'], ['well done', 'thanks'], ['bye', 'bye'], ['goodnight', 'bye'], ['see you later', 'bye'], ['tell me a joke', 'joke'], ['say something funny', 'joke'],
  ['I am sad', 'encourage'], ['i feel lonely', 'encourage'], ['i want to give up', 'encourage'], ['motivate me', 'encourage'], ['you are useless', 'insult'], ['how are you', 'howareyou'],
  ['who are you', 'who'], ['are you human', 'who'], ['are you a bot', 'who'], ['what is your name', 'who'], ['who made you', 'who'], ['are you anthony', 'who'], ['what can you do', 'capabilities'], ['help', 'capabilities'], ['help me abeg', 'capabilities'],
  ['i want to hurt myself', 'safety'],
  // unknown: said honestly
  ['what is the capital of france', 'unknown'], ['asdfgh', 'unknown'], ['the quick brown fox', 'unknown'], ['write me a poem about bananas', 'unknown'], ['', 'unknown'], ['how tall is mount everest', 'unknown'], ['what is the weather in london', 'unknown'], ['xyz qwerty', 'unknown'], ['solve 12 times 13', 'unknown'],
]

test(`the intent table: ${TABLE.length} phrasings, each understood as the intent it should be`, () => {
  const context = ctx()
  const wrong: string[] = []
  for (const [text, intent] of TABLE) {
    const got = matchIntent(text, context).intent
    if (got !== intent) wrong.push(`"${text}" -> ${got} (wanted ${intent})`)
  }
  assert.deepEqual(wrong, [])
  assert.ok(TABLE.length >= 150, `${TABLE.length} phrasings`)
})

test('the city, the place and the idea a message names are found with it', () => {
  const context = ctx()
  assert.equal(matchIntent('how do I travel to Abuja', context).city?.id, 'abuja')
  assert.equal(matchIntent('i wan go port harcourt', context).city?.id, 'port-harcourt')
  assert.equal(matchIntent('abjua', context).city?.id, 'abuja')
  assert.equal(matchIntent('where is the hospital', context).place?.id, 'hospital')
  assert.equal(matchIntent('where can I get food', context).place?.id, 'amala-shitta', 'a kind of place finds the best open one')
  assert.equal(matchIntent('what is a stall', context).concept?.id, 'stall')
  assert.equal(matchIntent('where is quilox', context).place?.id, 'quilox')
})

test('nothing is guessed: unknown questions fall through and offer the nearest topics', () => {
  const context = ctx()
  for (const text of ['what is the capital of france', 'tell me about the moon landing', 'qqqq zzzz']) assert.equal(matchIntent(text, context).intent, 'unknown', text)
  assert.ok(nearTopics('how do I get cash quickly please').length <= 3)
  assert.ok(nearTopics('something about friends and money').length >= 1)
})

test('text: Pidgin and Nigerian English become plain words; small slips are forgiven; unrelated words are not', () => {
  assert.equal(normalize('Abeg, wetin I go do?'), 'please what should i do')
  assert.equal(normalize('How far!'), 'hello')
  assert.equal(normalize('I wan chop'), 'i want to eat')
  assert.equal(distance('abuja', 'abjua'), 1)
  assert.ok(same('bussiness', 'business') && same('recomend', 'recommend') && same('hungary', 'hungry'))
  assert.ok(!same('cat', 'cut') && !same('rent', 'rest') && !same('work', 'walk') && !same('what', 'whot'))
})
