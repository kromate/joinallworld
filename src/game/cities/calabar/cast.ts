import type { CastEntry } from '../spec.ts'

const FICTION = 'Fictional character, written for the game.'
const EFIK = 'Fictional character. The Efik wording and honorific are beta and await native-speaker review.'
const MORNING = { text: 'Emesiere', meaning: 'Good morning', identityId: 'efik-greetings' } as const
const MORNING_REPLY = { text: 'Emesiere nde', meaning: 'Good morning (reply)', identityId: 'efik-greetings' } as const
const HOW_ARE_YOU = { text: 'Idem fo?', meaning: 'How are you?', identityId: 'efik-greetings' } as const
const THANKS = { text: 'Sọsọñọ', meaning: 'Thank you', identityId: 'efik-greetings' } as const

/**
 * Two regulars at each of Calabar's 17 places. The people are original fiction.
 * Every food, festival, landmark, greeting and honorific a line mentions is listed in `facts`
 * and traces to a sourced identity fact in the Calabar spec. Efik wording is beta and carries a note.
 */
export const CITY_CAST: readonly CastEntry[] = [
  { placeId: 'sacred-heart-cathedral', name: 'Mma Affiong', role: 'Church volunteer', age: 'elder', greeting: MORNING, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Emesiere! Come in, there is room on the bench.', 'I have swept this aisle for many years and I still enjoy it.'] },
  { placeId: 'sacred-heart-cathedral', name: 'Edikan Bassey', role: 'Youth choir singer', age: 'young', note: FICTION, facts: ['calabar-carnival-season'],
    quotes: ['We practise on weekday evenings after school.', 'December is busy across Calabar, even for the choir.'] },

  { placeId: 'apostolic-church-calabar', name: 'Ete Ekpenyong', role: 'Church elder', age: 'elder', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Idem fo? Sit down, the service will not start without you.', 'A church is only as warm as the people who open the door.'] },
  { placeId: 'apostolic-church-calabar', name: 'Ime Etim', role: 'Church usher', age: 'adult', note: FICTION,
    quotes: ['Please take a programme and I will find you a seat.', 'I came here as a child, and now I hold the door.'] },

  { placeId: 'native-delicacies-food', name: 'Ima Archibong', role: 'Cook', age: 'adult', note: FICTION, facts: ['edikang-ikong'],
    quotes: ['Edikang Ikong is an Efik and Ibibio soup, and I stir mine slowly.', 'Sit down and eat first; questions can wait.'] },
  { placeId: 'native-delicacies-food', name: 'Mma Ekaette', role: 'Regular customer', age: 'elder', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Idem fo? I am well, and I came here for my soup.', 'The young ones rush. I take my time with my plate.'] },

  { placeId: 'chef-green-local-cuisine-hub', name: 'Etim Asuquo', role: 'Chef', age: 'adult', note: FICTION, facts: ['afang-soup', 'ekpang-nkukwo'],
    quotes: ['Afang soup began with the Ibibio, and the Efik cook it too.', 'People also ask me for Ekpang Nkukwo, the cocoyam pottage.'] },
  { placeId: 'chef-green-local-cuisine-hub', name: 'Nkoyo Effiong', role: 'Kitchen assistant', age: 'young', note: FICTION, facts: ['abak-atama'],
    quotes: ['I wash the leaves before anyone else arrives.', 'Abak Atama, the palm-fruit soup, takes patience, the chef says.'] },

  { placeId: 'unicross-main-campus', name: 'Inyang Ekong', role: 'Student', age: 'young', greeting: MORNING, note: EFIK, facts: ['efik-greetings'],
    quotes: ['Emesiere! I am rushing to a lecture.', 'If you are lost, ask at the gate. I am lost too.'] },
  { placeId: 'unicross-main-campus', name: 'Ete Eyo', role: 'Retired lecturer', age: 'elder', note: EFIK, facts: ['efik-honorifics'],
    quotes: ['I taught for many years and I still like a good question.', 'Read slowly, and greet your elders properly.'] },

  { placeId: 'slave-history-museum', name: 'Mma Iniobong', role: 'Museum guide', age: 'elder', note: EFIK, facts: ['efik-honorifics', 'marina-resort'],
    quotes: ['This museum is inside the Marina Resort, on the river.', 'Please walk slowly. This is a place for remembering.'] },
  { placeId: 'slave-history-museum', name: 'Okon Ita', role: 'Visitor attendant', age: 'adult', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings'],
    quotes: ['Idem fo? Please sign the book before you go in.', 'Many visitors ask big questions, and I send them to the guide.'] },

  { placeId: 'national-museum-calabar', name: 'Ekanem Asuquo', role: 'Collections assistant', age: 'adult', note: FICTION, facts: ['marina-resort'],
    quotes: ['I look after the objects in the galleries, and some days I dust more than I read.', 'The Marina Resort is down the hill by the river, if you want to see more.'] },
  { placeId: 'national-museum-calabar', name: 'Ete Archibong', role: 'Retired teacher', age: 'elder', note: EFIK, facts: ['efik-honorifics'],
    quotes: ['I bring my grandchildren here so they know where they come from.', 'Ask the guides. They know more than I do.'] },

  { placeId: 'bassey-duke-statue', name: 'Ofonime Bassey', role: 'Street photographer', age: 'young', note: FICTION, facts: ['calabar-carnival-season'],
    quotes: ['I take pictures of visitors by the statue.', 'In December the road gets so busy I stand on a wall.'] },
  { placeId: 'bassey-duke-statue', name: 'Ete Edet', role: 'Neighbour', age: 'elder', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Idem fo? I walk past this statue every morning.', 'Calabar changes, but the walk stays the same.'] },

  { placeId: 'ucth-calabar', name: 'Idara Ekpo', role: 'Nurse', age: 'adult', note: FICTION,
    quotes: ['Please take a seat and we will call you.', 'Drink water. Many people forget that.'] },
  { placeId: 'ucth-calabar', name: 'Ete Ita', role: 'Waiting patient', age: 'elder', greeting: THANKS, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Sọsọñọ, young one, for giving me your seat.', 'I have waited longer than this before.'] },

  { placeId: 'navy-reference-hospital', name: 'Akpan Inyang', role: 'Hospital orderly', age: 'adult', note: FICTION,
    quotes: ['Please ask at the desk if you are unsure where to go.', 'The corridors are long, so follow the signs.'] },
  { placeId: 'navy-reference-hospital', name: 'Mfon Edem', role: 'Medical student on placement', age: 'young', note: FICTION,
    quotes: ['I learn more from the nurses than from my books.', 'Ask me nothing hard. It is my first week.'] },

  { placeId: 'calabar-municipal-hq', name: 'Uduak Ekpo', role: 'Clerk', age: 'adult', note: FICTION,
    quotes: ['Notices go on the board by the door.', 'Bring your papers in order and everything is easier.'] },
  { placeId: 'calabar-municipal-hq', name: 'Ete Efiom', role: 'Retired civil servant', age: 'elder', greeting: MORNING, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Emesiere! Ask me anything about queues.', 'I spent a lifetime in offices like this one.'] },

  { placeId: 'uj-esuene-stadium', name: 'Bassey Etim', role: 'Groundsman', age: 'adult', note: FICTION,
    quotes: ['I mark the lines before every match.', 'A good pitch is quiet work.'] },
  { placeId: 'uj-esuene-stadium', name: 'Nsa Okon', role: 'Football fan', age: 'young', note: FICTION, facts: ['calabar-carnival-season'],
    quotes: ['December means carnival, but I still come for the football.', 'Sit high up and you see the whole game.'] },

  { placeId: 'millennium-park-calabar', name: 'Atim Okpo', role: 'Park caretaker', age: 'adult', note: FICTION, facts: ['calabar-carnival-season'],
    quotes: ['Mind the grass, we are growing it back.', 'Millennium Park hosts events in December, and I still find the litter.'] },
  { placeId: 'millennium-park-calabar', name: 'Aniekan Udo', role: 'Morning jogger', age: 'young', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings'],
    quotes: ['Idem fo? I run two laps before work.', 'Join me if you can keep up.'] },

  { placeId: 'calabar-municipal-gardens', name: 'Ete Udoh', role: 'Garden keeper', age: 'elder', greeting: MORNING, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Emesiere! The flower beds like early visitors.', 'I water by hand because I like to see each plant.'] },
  { placeId: 'calabar-municipal-gardens', name: 'Imaobong Eyo', role: 'Evening walker', age: 'young', note: FICTION, facts: ['ekpang-nkukwo'],
    quotes: ['I come here after work to cool down.', 'Afterwards I go home for Ekpang Nkukwo, if anyone has made it.'] },

  { placeId: 'first-bank-calabar', name: 'Utibe Akpabio', role: 'Bank teller', age: 'adult', note: FICTION,
    quotes: ['Please fill the form in block letters.', 'Count your money before you leave the counter.'] },
  { placeId: 'first-bank-calabar', name: 'Mma Ofon', role: 'Customer', age: 'elder', greeting: THANKS, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Sọsọñọ, my child, for helping me with the form.', 'My eyes are not what they were.'] },

  { placeId: 'polaris-bank-calabar', name: 'Edidiong Ntia', role: 'Customer service officer', age: 'young', note: FICTION,
    quotes: ['Welcome. Is this your first time with us?', 'Saving a little each week adds up, trust me.'] },
  { placeId: 'polaris-bank-calabar', name: 'Ete Ibok', role: 'Retired trader', age: 'elder', greeting: HOW_ARE_YOU, note: EFIK, facts: ['efik-greetings', 'efik-honorifics'],
    quotes: ['Idem fo? I keep my savings small and my plans smaller.', 'Trade taught me patience.'] },

  { placeId: 'watt-market', name: 'Mma Uyai', role: 'Market trader', age: 'elder', greeting: MORNING, note: EFIK, facts: ['efik-greetings', 'efik-honorifics', 'watt-market-goods'],
    quotes: ['Emesiere! Watt Market sells food, clothes and electronics. What do you need?', 'Come early. Bargaining is easier before the crowd.'] },
  { placeId: 'watt-market', name: 'Nse Etuk', role: 'Phone accessories seller', age: 'young', note: FICTION, facts: ['watt-market-goods'],
    quotes: ['Phone chargers? I have three kinds. Which phone do you use?', 'The market has food, clothes and electronics, and I sell the electronics.'] },
]
