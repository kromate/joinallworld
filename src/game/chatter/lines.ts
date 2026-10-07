// The exchange banks: two short lines each, one regular and the answer. English and Nigerian Pidgin; Hausa, Yoruba and Efik only as
// the greetings the moment banks already use, and every line outside plain English is beta until a native speaker has read it.
// No real business or person is named, nothing here is a claim about a real place, and no line makes fun of a people or a faith.
import { BETA_CHATTER_LANGS } from './types.ts'
import type { ChatterLang, Exchange } from './types.ts'
import type { SceneKind } from '../../types/content.ts'
import type { TimeBand } from '../world-time.ts'

type Extra = Partial<Omit<Exchange, 'id' | 'lines' | 'beta'>>
type Entry = readonly [first: string, second: string] | readonly [first: string, second: string, extra: Extra]

/** @param scope the id prefix, unique across all banks (append, never reorder) @param base what every exchange of the bank shares */
export function talk(scope: string, base: Extra, entries: readonly Entry[]): Exchange[] {
  return entries.map((entry, index) => {
    const extra = entry[2] ?? {}
    const lang: ChatterLang = extra.lang ?? base.lang ?? 'en'
    return { weight: 1, ...base, ...extra, lang, beta: BETA_CHATTER_LANGS.includes(lang), id: `${scope}-${index + 1}`, lines: [entry[0], entry[1]] as const }
  })
}

const at = (...kinds: SceneKind[]): Extra => ({ weight: 2, placeKinds: kinds })
const bands = (...list: TimeBand[]): Extra => ({ bands: list })
const PIDGIN: Extra = { lang: 'pcm' }
const MORNING = bands('dawn', 'morning')
const AFTERNOON = bands('afternoon')
const EVENING = bands('evening')
const LATE = bands('evening', 'night')

export const PLACE_EXCHANGES: Exchange[] = [
  ...talk('buka', at('buka'), [
    ['Aunty, the rice don finish?', 'Not yet. Sit down, I dey serve.', PIDGIN],
    ['Extra meat, please.', 'Extra money too?'],
    ['Is the soup hot?', 'Hot enough to settle every argument.'],
    ['Wash your hand first!', 'I just did, Mama. Look.'],
    ['Pepper small, abeg.', 'Small is a big word in this kitchen.', PIDGIN],
    ['Who is that last plate for?', 'Whoever reaches it first.'],
    ['Akara and pap?', 'Hot from the pan. Sit.', MORNING],
    ['Eating again?', 'The rice is calling my name.', AFTERNOON],
  ]),
  ...talk('market', at('market'), [
    ['How much be this one?', 'For you, special price.', PIDGIN],
    ['Special price? I heard that yesterday.', 'Yesterday was a different tomato.'],
    ['Oga, last price?', 'Last price na last price.', PIDGIN],
    ['Is your fish fresh?', 'It was swimming this morning.'],
    ['Madam, come and see fabric!', 'I am only looking.'],
    ['Reduce small now.', 'If I reduce, I go lose. Take am, small.', PIDGIN],
    ['Where is this onion from?', 'The farm, my friend. Smell it.'],
    ['Your scale is cheating me!', 'My scale is honest. Your eyes are hungry.'],
  ]),
  ...talk('hub', at('hub'), [
    ['Where you dey go?', 'Wherever this bus dey go.', PIDGIN],
    ['Who get change?', 'Not me. I only have notes.', PIDGIN],
    ['Driver, wait! I dey come!', 'Run faster then!', PIDGIN],
    ['Is this the bus for the market?', 'Check the front glass. It says.'],
    ['Conductor, how much?', 'Same as yesterday, plus traffic.'],
    ['The bus is full.', 'There is still room. Move in small.'],
  ]),
  ...talk('club', at('club'), [
    ['Is the DJ any good tonight?', 'He just played the one song everybody knows.'],
    ['Your shoes are shining!', 'Rent money. Worth it.'],
    ['What time does this end?', 'End? Who told you it ends?', bands('night')],
    ['Shall we dance?', 'After this song. And the next.'],
    ['Too loud! I cannot hear you!', 'That is the whole idea!'],
  ]),
  ...talk('office', at('office'), [
    ['Did you send the email?', 'I sent it. It is living its own life now.'],
    ['The network is down again.', 'Then it is a meeting day.'],
    ['Who took my stapler?', 'Nobody. It left on its own.'],
    ['Is the boss in?', 'In body. Not in mood.'],
    ['Lunch?', 'Five minutes. One more email.', AFTERNOON],
    ['The light just went.', 'Generator is warming up. Save your work.'],
  ]),
  ...talk('gym', at('gym'), [
    ['How many reps left?', 'Three. Maybe thirty.'],
    ['Can I work in?', 'Only if you carry the weights back.'],
    ['Is the bench free?', 'I am just resting. For ten minutes.'],
    ['Leg day again?', 'Leg day is any day I cannot climb stairs.'],
    ['Your form is good.', 'My form is good because I am scared.'],
  ]),
  ...talk('mall', at('mall'), [
    ['Is that sale real?', 'Real until you reach the till.'],
    ['Which floor is the food court?', 'Up. Then follow your nose.'],
    ['The AC is the best thing here.', 'Better than the discount.'],
    ['Do you have this in my size?', 'Let me check at the back.'],
    ['I only came to look.', 'Everybody only came to look.'],
  ]),
  ...talk('park', at('park', 'hilltop', 'lakeside'), [
    ['Fine weather today.', 'Enjoy it. The sun makes no promises.'],
    ['Your child can run!', 'Too well. I am out of breath.'],
    ['Is this bench free?', 'Free. The shade is the price.'],
    ['Who is winning?', 'The one who is not running.'],
    ['Good evening o.', 'Good evening. How was your day?', EVENING],
    ['Morning jog?', 'Morning walk. A jog in disguise.', MORNING],
  ]),
  ...talk('beach', at('beach'), [
    ['The water is warm.', 'Do not go too deep o.'],
    ['Cold coconut! Cold coconut!', 'Give me one. A cold one.'],
    ['Watch your shoes!', 'Too late. The sea has them.'],
    ['Horse ride?', 'Not today. My back says no.'],
    ['The breeze is sweet.', 'It is why we came.'],
  ]),
  ...talk('hospital', at('hospital'), [
    ['Which ward is that?', 'Down the corridor, turn left. Take your time.'],
    ['How is your mother?', 'Better. She asked for pepper soup.'],
    ['Thank you, Nurse.', 'Drink water and rest. That is the medicine.'],
    ['Is the queue moving?', 'Slowly, but it is moving.'],
    ['Please keep your voice down.', 'Sorry. I am just relieved.'],
  ]),
  ...talk('salon', at('salon'), [
    ['Not too short, please.', 'Trust me. I know my work.'],
    ['That style is fresh!', 'Three hours of my life, but yes.'],
    ['Is it too tight?', 'A little. It will look good.'],
    ['Who is next?', 'Me. I came at seven.'],
    ['Is the dryer free?', 'In ten minutes. Or twenty.'],
    ['How long again?', 'Not long. Say a small prayer.'],
  ]),
  ...talk('rooftop', at('rooftop'), [
    ['See the lights!', 'Every window has a story.', LATE],
    ['Cold drink?', 'Cold, with ice. Please.'],
    ['The view is something.', 'The bill is something too.'],
    ['Is it always this breezy?', 'Only when you forgot your jacket.'],
  ]),
  ...talk('police', at('police'), [
    ['I want to report a lost phone.', 'Sit down. We will write it carefully.'],
    ['Is there a form?', 'There is a form. There is always a form.'],
    ['I am here for my statement.', 'Take a seat. Someone will call you.'],
    ['Thank you for your time.', 'That is our work.'],
  ]),
  ...talk('worship', at('worship'), [
    ['Peace be with you.', 'And with you.'],
    ['Good morning. How is the family?', 'By God’s grace, well.', MORNING],
    ['Is this seat taken?', 'No. Sit. There is room.'],
    ['That was a beautiful service.', 'Yes. I needed it.'],
    ['Welcome. First time here?', 'Yes. Everyone is so kind.'],
  ]),
  ...talk('radio', at('radio'), [
    ['Are we live?', 'Ten seconds. Breathe.'],
    ['Who is on after the news?', 'The one with the good music.'],
    ['Can you turn the mic up?', 'It is up. Speak up.'],
    ['Calling in from where?', 'Right here, in the studio!'],
  ]),
  ...talk('polling', at('polling'), [
    ['Is the line moving?', 'Slowly. Patience is part of it.'],
    ['Do I need my card?', 'Yes. And your patience.'],
    ['Where do I queue?', 'Here. Behind the man in the blue shirt.'],
  ]),
  ...talk('viewing', at('viewing'), [
    ['Who are you supporting?', 'The one that is winning.'],
    ['Referee! Are you blind?', 'Sit down! He is watching.'],
    ['That was offside!', 'Everything is offside to you.'],
    ['Two minutes left. Anything can happen.', 'Something always does.'],
    ['Somebody turn up the sound!', 'The generator is doing its best.'],
    ['You came late.', 'I came when the goal came.'],
  ]),
  ...talk('walk', at('walk'), [
    ['Mind the pothole!', 'I saw it. We are old friends.'],
    ['How far?', 'I dey. And you?', PIDGIN],
    ['Greet your people.', 'I will. Greet yours.'],
  ]),
  ...talk('airport', at('airport'), [
    ['Is the flight on time?', 'On time, by Nigerian standards.'],
    ['Where is my passport?', 'In your hand. Please do not lose it again.'],
    ['Which gate?', 'Look at the board. It will change.'],
    ['Safe trip!', 'Thank you. Greet everybody at home.'],
  ]),
  ...talk('works', at('refinery', 'statehouse'), [
    ['Is the visitor line this way?', 'Yes. Have your ID ready.'],
    ['Shift change soon?', 'Soon. My feet say now.'],
  ]),
  ...talk('campus', at('unilag', 'quad'), [
    ['Are you ready for the test?', 'Ready? I am praying.'],
    ['Where is the lecture hall?', 'Follow the crowd. Everybody is late.'],
    ['Library or cafeteria?', 'Cafeteria. The books can wait.'],
    ['Did you read the note?', 'I read the note. The note did not read me.'],
    ['Group project, again.', 'And I am the one doing it.'],
  ]),
]

/** Talk that fits anywhere a person can stand, so a venue with no bank of its own still has some. */
export const ANYWHERE_EXCHANGES: Exchange[] = [
  ...talk('anywhere', {}, [
    ['How far?', 'I dey. You?', PIDGIN],
    ['Good morning o!', 'Morning! You are early.', MORNING],
    ['The sun today ehn.', 'It wants to cook us.', AFTERNOON],
    ['Light came back.', 'Praise God. I can charge my phone.'],
    ['Long time!', 'Too long. How is work?'],
    ['How is work?', 'Work is work. The money is the problem.'],
    ['Where do you stay now?', 'Not far. And you?'],
    ['Greet your family for me.', 'I will. They will be glad.'],
    ['Weekend plans?', 'Rest. Maybe. If life allows.'],
    ['Day don end.', 'Thank God for today.', { ...LATE, lang: 'pcm' }],
    ['Did you hear the news?', 'No. Tell me quickly.'],
    ['You are looking well.', 'Thank you. Small small.'],
  ]),
]

/** A few of a city's own greetings: the ones src/moments/cities.ts already uses. All beta. */
export const CITY_EXCHANGES: Exchange[] = [
  ...talk('ibadan', { weight: 3, cityIds: ['ibadan'], lang: 'yo' }, [
    ['Ẹ kú àárọ̀ o!', 'Ẹ kú àárọ̀! Ṣé àlàáfíà ni?', MORNING],
    ['Ẹ kú iṣẹ́!', 'Ẹ ṣé o! How is the day?'],
  ]),
  ...talk('kano', { weight: 3, cityIds: ['kano'], lang: 'ha' }, [
    ['Ina kwana?', 'Lafiya lau. How is home?', MORNING],
    ['Sannu da aiki!', 'Yauwa, sannu. How is the day?'],
  ]),
  ...talk('calabar', { weight: 3, cityIds: ['calabar'], lang: 'efi' }, [
    ['Mbọm!', 'Mbọm o! How is the day?'],
    ['Sosongo!', 'It is nothing. Sit, eat.'],
  ]),
]
