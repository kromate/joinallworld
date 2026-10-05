/**
 * The cast: two regulars per venue, placed by venue id (`at` is where they stand in its scene).
 * A venue that does not exist in the running build simply has no cast. Every name, role and quote line is original.
 */
/**
 * Where each regular stands in their venue's scene: a landmark key of that scene kind
 * (src/scene/venues-*.js). Original placement; a regular without one joins the general crowd.
 */

import { CAMPUS_NPCS } from '../../../campus/unilag/content.ts';
import type { NpcId } from '../../../types/life.ts';
import type { NpcDefinition } from '../../../types/content.ts';

const NPC_PLACES: Record<string, string> = {
  amaka: 'counter', 'baba-sege': 'table', kunle: 'trees', 'mama-ronke': 'drinks', zainab: 'lounge', deji: 'bar',
  tega: 'desks', halima: 'pitch', 'femi-sax': 'stage', yeni: 'floor', 'oga-tunde': 'benches', chidi: 'banter',
  'iya-bose': 'produce', emeka: 'gadgets', 'coach-bayo': 'weights', ngozi: 'treadmills', 'mrs-okafor': 'reception', dapo: 'lounge',
  'dj-kay': 'dj', 'simi-vip': 'bookcase', 'ranger-musa': 'gate', tolu: 'tower', aisha: 'shops', uche: 'cinema',
  'captain-jide': 'water', blessing: 'bar', 'nurse-kemi': 'reception', 'papa-john': 'waiting', 'mama-bisi': 'chair', funke: 'dryer',
  somto: 'view', lola: 'lounge', 'sergeant-audu': 'desk', 'corporal-ife': 'bench', 'sister-grace': 'choir', 'usher-ben': 'pews',
  'alhaji-sani': 'prayer', 'mallam-isa': 'mihrab', 'oap-tobi': 'studio', 'sound-ada': 'control', 'agent-wale': 'queue', 'mrs-bello': 'officials',
  'protocol-segun': 'steps', 'madam-secretary': 'office',
  'agent-bimpe': 'desk', 'porter-sule': 'arrivals', 'engineer-chioma': 'control', 'driver-mustapha': 'loading',
};
const npc = (id: NpcId, venue: string, name: string, role: string, emoji: string, quotes: string[], extra: Pick<NpcDefinition, 'beta' | 'note'> = { beta: true }): Omit<NpcDefinition, 'at'> => ({ id, venue, name, role, emoji, quotes, ...extra });
export const NPCS: Record<NpcId, NpcDefinition> = Object.fromEntries([
  npc('amaka', 'amala-shitta', 'Amaka', 'Serving', '👩🏾‍🍳', ['Extra meat is extra money, no vex.', 'This pot has fed half of Surulere today.', 'You look like somebody that skipped breakfast.'], { note: 'Name and role are fixed; quotes are original.' }),
  npc('baba-sege', 'amala-shitta', 'Baba Sege', 'Regular customer', '👴🏾', ['I have eaten here since before you were born.', 'Abula first, wahala later.'],),
  npc('kunle', 'park', 'Kunle', 'Sketching by the trees', '🧑🏾‍🎨', ['Sit small, let me draw your shadow.', 'Art no dey rush. Lagos dey rush.', 'This breeze is the only free thing left.']),
  npc('mama-ronke', 'park', 'Mama Ronke', 'Selling zobo', '👩🏾', ['Cold zobo, sweet like better news.', 'My customer! You no greet today?']),
  npc('zainab', 'library', 'Zainab', 'Reading in the lounge', '👩🏾‍💼', ['Shh. This chapter is getting good.', 'Have you read anything that changed your mind lately?']),
  npc('deji', 'library', 'Deji', 'Behind the bar', '🧑🏾‍🍳', ['Chapman or something stronger?', 'Everybody tells the barman the truth.']),
  npc('tega', 'cchub', 'Tega', 'Debugging', '🧑🏾‍💻', ['It works on my machine. NEPA took the machine.', 'Ship first, sleep later.']),
  npc('halima', 'cchub', 'Halima', 'Pitching a startup', '👩🏾‍💻', ['We are Uber, but for generators.', 'Do you know any investor? Any at all?']),
  npc('femi-sax', 'shrine', 'Femi Sax', 'Tuning up', '🎷', ['Music is the weapon. The horn is the bullet.', 'Stay for the second set. That is the real one.']),
  npc('yeni', 'shrine', 'Yeni', 'Dancing near the stage', '💃🏾', ['If your waist is not moving, check your pulse.', 'Tonight the band no go tire.']),
  npc('oga-tunde', 'viewing-centre', 'Oga Tunde', 'Running the screen', '📺', ['Fifty naira for the bench, argument is free.', 'If light goes, nobody should shout at me.']),
  npc('chidi', 'viewing-centre', 'Chidi', 'Arguing about football', '⚽', ['That referee needs glasses and prayers.', 'My club will win the league. Write it down.']),
  npc('iya-bose', 'market', 'Iya Bose', 'Selling pepper', '🌶️', ['Fresh pepper! Price it well, I will sell.', 'Customer, last price is last price.']),
  npc('emeka', 'market', 'Emeka', 'Phone accessories', '📱', ['Original charger, I swear on my shop.', 'Screen guard? I fit it now-now.']),
  npc('coach-bayo', 'i-fitness', 'Coach Bayo', 'Personal trainer', '🏋🏾', ['One more rep. I said one more.', 'Jollof is not a pre-workout.']),
  npc('ngozi', 'i-fitness', 'Ngozi', 'On the treadmill', '🏃🏾‍♀️', ['Five kilometres before work, every day.', 'The gym is cheaper than the hospital.']),
  npc('mrs-okafor', 'office', 'Mrs Okafor', 'Front desk', '👩🏾‍💼', ['Sign the visitors book, please.', 'The lift is working today. Thank God.']),
  npc('dapo', 'office', 'Dapo', 'On a tea break', '☕', ['This meeting could have been an email.', 'Month end is far, my brother.']),
  npc('dj-kay', 'quilox', 'DJ Kay', 'On the decks', '🎧', ['Request? Send it with a drink.', 'When the beat drops, forget your problems.']),
  npc('simi-vip', 'quilox', 'Simi', 'In the VIP queue', '🥂', ['My name should be on the list.', 'These heels were a mistake.']),
  npc('ranger-musa', 'canopy-walk', 'Ranger Musa', 'Guiding visitors', '🧭', ['Do not look down. Okay, look small.', 'The monkeys here have no respect.']),
  npc('tolu', 'canopy-walk', 'Tolu', 'Taking pictures', '📷', ['Stand there, the light is perfect.', 'I came for peace and content.']),
  npc('aisha', 'palms', 'Aisha', 'Window shopping', '🛍️', ['I am only looking. My account knows why.', 'The AC here is the real attraction.']),
  npc('uche', 'palms', 'Uche', 'Cinema usher', '🎬', ['Screen three, straight then left.', 'No outside popcorn. I do not make the rules.']),
  npc('captain-jide', 'beach', 'Captain Jide', 'Boat operator', '⛵', ['Life jacket first, selfie after.', 'The sea has its own mind today.']),
  npc('blessing', 'beach', 'Blessing', 'Selling coconuts', '🥥', ['Fresh coconut, I will cut it for you.', 'Sand is free, shade is not.']),
  npc('nurse-kemi', 'hospital', 'Nurse Kemi', 'On duty', '👩🏾‍⚕️', ['Have you eaten before taking that drug?', 'Take your card to the next window.']),
  npc('papa-john', 'hospital', 'Papa John', 'Waiting his turn', '👴🏾', ['I have been number twelve since morning.', 'Health is wealth. I have neither today.']),
  npc('mama-bisi', 'salon', 'Mama Bisi', 'Braiding hair', '💇🏾‍♀️', ['Sit well, this style takes three hours.', 'All the gist in Lagos passes through this chair.']),
  npc('funke', 'salon', 'Funke', 'Under the dryer', '👩🏾‍🦱', ['Did you hear what happened on our street?', 'Beauty is pain, my sister.']),
  npc('somto', 'rooftop', 'Somto', 'Watching the skyline', '🌇', ['From up here the traffic looks peaceful.', 'One day, one of those towers will be mine.']),
  npc('lola', 'rooftop', 'Lola', 'Hosting tonight', '🍸', ['Table for how many?', 'Sunset is our best staff member.']),
  npc('sergeant-audu', 'police', 'Sergeant Audu', 'At the counter', '👮🏾', ['Write your statement. Use your own biro.', 'Bail is free. So they say.']),
  npc('corporal-ife', 'police', 'Corporal Ife', 'On gate duty', '👮🏾‍♀️', ['Park well. This is not your compound.', 'Wetin you carry?']),
  npc('sister-grace', 'church', 'Sister Grace', 'Choir practice', '🎶', ['Alto section, we are flat again.', 'You are welcome in the house.']),
  npc('usher-ben', 'church', 'Usher Ben', 'Arranging chairs', '🪑', ['Front row is free, nobody ever wants it.', 'Service starts on time. African time.']),
  npc('alhaji-sani', 'mosque', 'Alhaji Sani', 'After prayers', '🧔🏾', ['Peace be upon you, my friend.', 'Patience is half of everything.']),
  npc('mallam-isa', 'mosque', 'Mallam Isa', 'Teaching', '📿', ['Come and sit. Knowledge is not heavy.', 'Small small, the bird builds its nest.']),
  npc('oap-tobi', 'radio', 'OAP Tobi', 'On air soon', '🎙️', ['Lagos, are you with me this morning?', 'Three, two, one — we are live.']),
  npc('sound-ada', 'radio', 'Ada', 'Sound engineer', '🎚️', ['Do not touch that fader.', 'Your voice is fine. The mic is the problem.']),
  npc('agent-wale', 'polling-unit', 'Agent Wale', 'Party agent', '🗳️', ['Have you collected your card?', 'Every vote is one vote. Count it.']),
  npc('mrs-bello', 'polling-unit', 'Mrs Bello', 'Electoral officer', '📋', ['Queue here. One person, one line.', 'Ink on the finger, then you may go.']),
  npc('protocol-segun', 'state-house', 'Segun', 'Protocol officer', '🕴🏾', ['His Excellency is in a meeting.', 'Do you have an appointment?']),
  npc('madam-secretary', 'state-house', 'Madam Abike', 'Secretary', '🗂️', ['Drop your letter, we will get back to you.', 'The file is on the table.']),
  npc('agent-bimpe', 'airport', 'Bimpe', 'Travel desk agent', '👩🏾‍💼', ['Abuja and Port Harcourt are on the board. The planes are still coming.', 'Window or aisle? I am only practising.']),
  npc('porter-sule', 'airport', 'Sule', 'Porter at Arrivals', '🧑🏾', ['Oga, let me carry that one for you.', 'Every flight lands with one suitcase too many.']),
  npc('engineer-chioma', 'refinery', 'Engr Chioma', 'Shift engineer', '👩🏾', ['Hard hat on before you say hello.', 'When the flare is quiet, everybody is happy.']),
  npc('driver-mustapha', 'refinery', 'Mustapha', 'Tanker driver', '👨🏾', ['I have been on this queue since dawn.', 'Full tank going out, empty stomach coming back.']),
].map((entry) => [entry.id, { ...entry, at: NPC_PLACES[entry.id] ?? null }]));

Object.assign(NPCS, CAMPUS_NPCS);
