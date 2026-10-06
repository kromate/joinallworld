// Moments that fit any place in any city, the ones that wait for a city condition, and the small sets of the less common place kinds.
// Voice: Nigerian Pidgin and plain English, one short line each. No real business or person is named.
import { AFTERNOON, DAWN, DAYTIME, EVENING, LATE, MORNING, NIGHT, bank, here } from './bank.ts'
import type { Moment } from './types.ts'

/** Anywhere, by time of day and by season. */
export const ANYWHERE: Moment[] = [
  ...bank('any-dawn', { weight: 1, ...DAWN }, [
    'Cock don crow. Early risers dey move.',
    'A broom scratches the road somewhere nearby.',
    'The first danfo of the day clears its throat.',
    'Birds are louder than the traffic. For now.',
    ['Somebody is boiling water for a bath. You can hear it.', { fx: 'hush' }],
  ]),
  ...bank('any-morning', { weight: 1, ...MORNING }, [
    'Everybody dey rush like say the road go close.',
    'Somebody’s phone is ringing and nobody is answering.',
    ['“Good morning o!” flies across the road, three times.', { fx: 'crowd' }],
    'The sun is already serious about its job.',
    'A hawker passes: “Cold water! Cold water!”',
  ]),
  ...bank('any-afternoon', { weight: 1, ...AFTERNOON }, [
    'Heat dey bite. Even the shade dey sweat.',
    'Lunch smell is winning every argument.',
    'Slow hour. Everybody is waiting for the heat to forgive them.',
    'A ceiling fan somewhere is losing a brave fight.',
    'Somebody is fanning with a folded cardboard.',
  ]),
  ...bank('any-evening', { weight: 1, ...EVENING }, [
    'Traffic don start to thicken.',
    'The evening breeze finally shows its face.',
    ['Generators clear their throats for the night.', { fx: 'power-on' }],
    'Someone is shouting a price they will definitely reduce.',
    'Smoke from a roadside grill drifts across the street.',
  ]),
  ...bank('any-night', { weight: 1, ...NIGHT }, [
    'Night don come. The city dey hum.',
    'Somewhere, music is competing with a generator.',
    'Moths circle the one bulb that is still on.',
    'Crickets are doing the night shift.',
    ['A dog barks twice, thinks about it, and stops.', { fx: 'hush' }],
  ]),
  ...bank('any-harmattan', { weight: 2, season: { harmattan: true } }, [
    ['Harmattan dust don cover everything.', { fx: 'dust' }],
    'Dry air, ashy knees. Somebody is asking for body cream.',
    'Cold morning, hot afternoon. Classic harmattan.',
    ['Dust on every car window. Somebody wrote a name in it.', { fx: 'dust' }],
    ['The haze hangs low and the sun is a pale coin.', { ...DAYTIME, fx: 'dust' }],
    ['Lips are cracking. Lip balm is the new currency.', {}],
  ]),
  ...bank('any-wet', { weight: 2, season: { wet: true } }, [
    'Rain smell dey air.',
    'Puddles are choosing their victims today.',
    'The umbrella people look very smug.',
    ['Dark clouds gather. Everybody is looking up.', { ...EVENING, fx: 'rain' }],
    'Mud on every shoe, forgiven by everyone.',
    ['Thunder rolls far off. Somebody says, “E don almost reach.”', { fx: 'rain' }],
  ]),
]

/**
 * Lines that wait for a condition of the city. Nothing supplies the conditions yet (the city-conditions lane will), so until then these
 * are only picked when a caller passes them in PickOptions.conditions.
 */
export const CONDITIONED: Moment[] = [
  ...bank('cond-power-restored', { weight: 4, cond: 'power-restored' }, [
    ['Light don come!', { fx: 'power-on' }],
    ['“NEPA, thank you!” somebody shouts, then laughs at themselves.', { fx: 'power-on' }],
    ['Fans spin up. Phones start charging. The whole street sighs.', { fx: 'power-on' }],
    ['A cheer rolls down the street as the bulbs flicker on.', { fx: 'power-on' }],
  ]),
  ...bank('cond-power-cut', { weight: 4, cond: 'power-cut' }, [
    ['NEPA don take light again.', { fx: 'power-off' }],
    ['The lights drop and the generators answer, one by one.', { fx: 'power-off' }],
    ['Phone torches come out. The room turns into a small constellation.', { fx: 'power-off' }],
    ['“Light don go!” somebody calls, and nobody is surprised.', { fx: 'power-off' }],
  ]),
  ...bank('cond-rain', { weight: 4, cond: 'rain' }, [
    ['Rain dey fall. Everybody dey run enter shade.', { fx: 'rain' }],
    ['Rain beats the roof so loud that talking is optional.', { fx: 'rain' }],
    ['A plastic bag becomes an umbrella. A good one.', { fx: 'rain' }],
    ['The road is a river now, and the danfo is a boat.', { fx: 'rain' }],
  ]),
  ...bank('cond-go-slow', { weight: 4, cond: 'go-slow' }, [
    ['Hold-up don block the road. Bring snacks.', { fx: 'horn' }],
    ['Horns, horns, horns. Nobody is moving, everybody is loud.', { fx: 'horn' }],
    ['Hawkers walk between the cars: water, gala, phone chargers.', { fx: 'crowd' }],
  ]),
  ...bank('cond-match-night', { weight: 4, cond: 'match-night' }, [
    ['Match night. Every screen in the street has found a crowd.', { fx: 'crowd' }],
    ['Somebody shouts a score and gets argued with from three sides.', { fx: 'laugh' }],
    ['A far-off roar means somebody just scored. Nobody knows who.', { fx: 'crowd' }],
  ]),
]

/** The less common place kinds: a small set each. */
export const MINOR_KINDS: Moment[] = [
  ...bank('rooftop', here('rooftop'), [
    'The city spreads out below, all rooftops and water tanks.',
    ['A speaker from the next building is playing someone’s wedding song.', { fx: 'music' }],
    ['Wind up here smells of cold drinks and distant frying.', EVENING],
    ['Lights come on across the skyline one block at a time.', { ...EVENING, fx: 'power-on' }],
    'Somebody is taking a selfie with the whole city behind them.',
    ['Night up here: horns far below, stars politely above.', NIGHT],
    'A neighbour’s washing line flaps like a flag on a nearby roof.',
  ]),
  ...bank('radio', here('radio'), [
    ['The red ON AIR light is on. Everybody whispers.', { fx: 'hush' }],
    'A presenter laughs into the microphone, then coughs it away.',
    ['Callers are lining up to greet their friends on air.', { ...DAYTIME, fx: 'laugh' }],
    'A producer waves frantically: ten seconds to the news.',
    ['The jingle plays and the studio shuffles back to its seats.', { fx: 'music' }],
    'Somebody asks for a request song and gets a story instead.',
    ['Late-night show: soft voice, soft lamp, long silences.', NIGHT],
  ]),
  ...bank('polling', here('polling'), [
    'A queue forms in the shade. Everybody has an opinion.',
    ['An official reads names off a list, slowly and clearly.', { fx: 'hush' }],
    'A voter checks their card for the third time, just in case.',
    'Someone fans themselves with a voter’s register.',
    'Whispers: “I hear the line is shorter on the other side.” It isn’t.',
    ['A child waits with a parent, bored but extremely well-behaved.', DAYTIME],
    'Neighbours who never talk are chatting in line today.',
  ]),
  ...bank('statehouse', here('statehouse'), [
    'A flag snaps in the wind above the gate.',
    'Staff in smart clothes hurry up the steps with files.',
    ['A convoy’s siren winds up and fades somewhere beyond the wall.', { fx: 'horn' }],
    ['The guard at the gate checks every pass, politely and thoroughly.', DAYTIME],
    'A clerk carries a stack of paper that is taller than a clerk.',
    'Visitors wait under the portico, rehearsing what to say.',
    ['Evening: the corridors empty and the cleaners take over.', EVENING],
  ]),
  ...bank('shrine', here('shrine'), [
    ['A horn section warms up with two notes and a laugh.', { fx: 'music' }],
    ['Drums test the room. The room tests back.', { fx: 'music' }],
    ['Somebody sets a chair, steps back, then sets it again.', {}],
    ['Dancers stretch in the corner like athletes.', { ...LATE, fx: 'music' }],
    'The air smells of smoke, sweat and a very good night ahead.',
    ['The band counts four, and the whole room moves.', { ...NIGHT, fx: 'music' }],
  ]),
  ...bank('walk', here('walk'), [
    'Footsteps, bicycle bells and the odd shout across the street.',
    'A trader sets her tray down and straightens it, again.',
    ['Someone sings quietly to themselves, sure no one can hear.', { fx: 'music' }],
    'An old man and a young man argue amiably about the shortcut.',
    'A shopkeeper sweeps dust from the door into the road.',
    ['Evening walkers pass, greeting everyone and no one.', EVENING],
    'A kid zigzags on a bicycle, pursued by a distant “Be careful!”',
  ]),
  ...bank('airport', here('airport'), [
    ['A boarding call nobody can quite hear.', { fx: 'hush' }],
    'A trolley with one bad wheel is winning against its owner.',
    'An aunty is re-packing a suitcase at the scale. Again.',
    'The departures board flips a whole row at once. Gasps.',
    ['An engine roars far off, and half the room looks up.', { fx: 'horn' }],
    'Someone is hugging a relative goodbye for the third time.',
    'A relative with a very large bag of food arrives late.',
  ]),
  ...bank('quad', here('quad'), [
    'Students cut across the grass, pretending they are not late.',
    ['A group is loudly revising and quietly panicking.', { ...DAYTIME, fx: 'laugh' }],
    'Somebody sells snacks from a box and doubles as an adviser.',
    'A lecturer strides past, and the group straightens up as if on cue.',
    'Shade under the big tree is the most valuable seat on campus.',
    ['After classes: laughter, football, and a speaker with one song.', { ...EVENING, fx: 'music' }],
  ]),
  ...bank('hilltop', here('hilltop'), [
    'The wind up here has a long way to go and takes its time.',
    'The view goes on until it turns into haze.',
    ['A small group pauses, breathless, and pretends to admire the view.', { fx: 'laugh' }],
    ['Down below, rooftops catch the last of the sun.', EVENING],
    'A goat looks down from a rock as if it owns the place.',
    ['Dawn up here is slow, gold and absolutely worth it.', DAWN],
  ]),
  ...bank('lakeside', here('lakeside'), [
    'Water laps, small and patient, against the bank.',
    'A fisherman casts and waits, as he has for years.',
    ['Dragonflies stitch the air above the reeds.', DAYTIME],
    ['A canoe slides by with the quietest paddle in the world.', { fx: 'hush' }],
    'Somebody skips a stone. It sinks. They pick another.',
    ['Evening: the water goes copper, and the birds go home.', EVENING],
  ]),
  ...bank('refinery', here('refinery'), [
    'A siren tests itself and everybody keeps working.',
    ['Hard hats pass in pairs, talking shop.', DAYTIME],
    'A tanker idles at the gate, and the driver naps with his cap over his eyes.',
    'The canteen bell goes, and the whole yard moves at once.',
    ['A radio crackles an instruction nobody quite catches.', { fx: 'hush' }],
    ['Night shift: bright lights, long shadows and strong tea.', NIGHT],
  ]),
]
