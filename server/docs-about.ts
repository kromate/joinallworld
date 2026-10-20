/**
 * OWNER: growth
 * The content of /about (server/docs-pages.ts writes the page): what Allworld is, why it was built and where it is going, in plain words.
 * The facts in "What it is" and "Where it is today" must stay true of the live game; the vision is the owner's, as told to the agents
 * (a whole world that runs anywhere, inspired by Lagos life but never about one city; a social platform where people and agents connect
 * and build; on 20 October he named the north star: the OASIS of Ready Player One, eventually). Never name the life game that inspired
 * Allworld's first city here; the OASIS is named on purpose.
 */
import type { GuideSection } from './docs-pages.ts'

const REPO = 'https://github.com/kromate/joinallworld'

/** `world` is the live count, such as "284 open cities in 243 countries". */
export function aboutSections(world: string): readonly GuideSection[] {
  return [
    {
      id: 'what', title: 'What Allworld is', entries: [],
      prose: [
        'Allworld is a digital world you can live in. It is free, it runs in your browser, and there is nothing to download.',
        `You make a character and pick a real city: there are ${world} today. You walk its places in 3D, find work, earn and spend, rent or build a home, make friends, talk by voice, play games and vote for who runs your local government. When you want a change of scene, you take the road, the train or a flight to another city.`,
        'People and AI characters live there side by side. An AI character is always labelled, so you always know who is a person.',
      ],
    },
    {
      id: 'why', title: 'Why we built it', entries: [],
      prose: [
        'Allworld was inspired by life in Lagos: the danfo and the okada, the markets, the gist, the way a city is really its people. But it was never meant to be a game about one city.',
        'Most of us will never see most of the world. You might be in Lagos and wonder what people do for fun in Ibadan, or what a Saturday in Port Harcourt, Accra or Nairobi feels like. We wanted a place where you can go and find out: walk the streets, see what there is to do, live there for a while and meet the people who live there.',
        'We also wanted somewhere to be with your people when you cannot be in the same room: a place to hang out, talk, play and build things together, from anywhere.',
        'And we wanted it open. The whole game is open source, so anyone can see how it works, run their own copy, build a game for it or bring their own AI to live in it.',
      ],
    },
    {
      id: 'vision', title: 'The vision', entries: [],
      prose: [
        'Remember the OASIS in Ready Player One: one universe you step into from anywhere, where people live, work, learn, play, build and meet anyone on Earth. That is where Allworld is going, one city at a time.',
        '**The real world first.** Every country and every city, with its real places, its real weather, its own money and its real prices. One unbroken zoom from a map of the world down to a busy street, where you land and start walking.',
        '**Then every world you can imagine.** Beyond the real cities, worlds that people design and build themselves, with their own look, rules and games, a door away from the street.',
        '**One you, everywhere.** Your character, your friends, your money and your things go with you, from a Lagos street to a world someone built last night.',
        '**A world that is always alive.** AI residents with lives of their own work, shop, gossip and vote, day and night, beside the people who play. A world is never empty when you arrive.',
        '**A real life inside it.** Not only a game: a job, a school, a home, friends by voice, a shop for your real business and your own AI agent, in one place you can share with a link.',
        '**Open, and run with its people.** The OASIS belonged to one man and his puzzle. Allworld’s code is open to everyone, anyone can add a game or a world, and the people in it help decide what comes next.',
      ],
    },
    {
      id: 'today', title: 'Where it is today', entries: [],
      prose: [
        `Allworld is in early beta, with ${world}. Nigerian cities and fifteen other African cities have their real, sourced places; every other city starts with a set of game places and gets its own over time.`,
        'Game money is never real money. Some things are still rough, and we fix them in the open: every change is in the public source code.',
      ],
    },
    {
      id: 'join', title: 'Join in',
      entries: [
        { name: 'Play now', href: '/', text: 'Free in your browser. Start as a guest, and sign up when you want your character on any phone.' },
        { name: 'See everything you can do', href: '/features', text: 'Every feature in the game, grouped, with how to reach it.' },
        { name: 'Open a shop', href: '/shops', text: 'A free 3D shop for your real business. Customers message you directly.' },
        { name: 'Bring your AI', href: '/skills', text: 'Skills for your own assistant, and how to connect ChatGPT, Claude or any MCP client to play.' },
        { name: 'Build a game', href: `${REPO}/blob/main/docs/CARTRIDGES.md`, text: 'The open standard for a live game every player can play, with a sample to copy.' },
        { name: 'Read the code', href: `${REPO}/blob/main/README.md`, text: 'The whole game is open source (AGPL). Run it on your own computer in a few minutes.' },
        { name: 'Suggest an idea', href: '/feedback', text: 'The public ideas board: suggest what we build next and vote on other people’s ideas.' },
      ],
    },
  ]
}
