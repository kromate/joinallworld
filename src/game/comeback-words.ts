/**
 * OWNER: growth
 * The words of a comeback mail, as pure functions of a plan (src/game/comeback.ts). Short, warm, specific, no tricks:
 * a subject that says what is true, one sentence of why, a few lines, ONE button. Never a message body, a balance,
 * a place on the map or another person's address. The e-mail layout lives in server/growth/email/comeback.ts.
 *
 * TONE. A mail states a fact and an opening. It never says the player lost something by being away and never guilts.
 */
import { WEEKDAYS, formatHour, lagosTime } from './clock.ts';
import { firstName, PREF_OF } from './comeback.ts';
import type { GoTarget } from './go-links.ts';
import type { Plan, PrefKey } from './comeback.ts';

export interface MailWords {
  subject: string
  heading: string
  intro: string
  lines: string[]
  button: { label: string; go: GoTarget }
  /** The switch this mail answers to (for "stop these"). */
  pref: PrefKey
}

/** "Ada", "Ada and Tunde", "Ada, Tunde and Bola". */
export function listNames(names: readonly string[]): string {
  const clean = names.map((name) => firstName(name));
  if (clean.length <= 1) return clean[0] ?? 'A friend';
  return `${clean.slice(0, -1).join(', ')} and ${clean.at(-1)}`;
}
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The game's guide speaks in the mails that are about the player's own character: a line, never a message from a person. */
export const GUIDE = 'Lumo, the game’s AI guide, here.';

const NEED_WORDS = {
  hunger: { word: 'hungry', intro: (who: string) => `${GUIDE} ${who} has not eaten for a while, and a meal sorts it out.`, button: (who: string) => `Feed ${who}` },
  energy: { word: 'tired', intro: (who: string) => `${GUIDE} ${who} could do with a rest, and a nap at home is all it takes.`, button: (who: string) => `Let ${who} rest` },
  social: { word: 'lonely', intro: (who: string) => `${GUIDE} ${who} has not talked to anyone in a while, and a friend is only a message away.`, button: () => 'Say hello' },
} as const;

/** "tonight at 7 pm" / "today at 2 pm" / "tomorrow at 10 am", in Lagos time, from `now`. */
export function whenWords(start: number, now: number): string {
  const a = lagosTime(now), b = lagosTime(start);
  const part = b.day === a.day ? (b.hour >= 18 ? 'tonight' : 'today') : b.day === a.day + 1 ? 'tomorrow' : `on ${WEEKDAYS[b.weekday] ?? 'the day'}`;
  return `${part} at ${formatHour(b.hour + b.minute / 60)}`;
}

const AWAY = (name: string, step: number): { subject: string; intro: string; button: string } => {
  if (step >= 28) return { subject: 'One last note from Allworld', intro: `It has been four weeks, ${name}. Your character is still where you left them, and a life that goes a month without a visit is put away, so this is the last e-mail you will get unless you come back.`, button: 'Pick up where I left off' };
  if (step >= 7) return { subject: `${name}, your world is still here`, intro: `${GUIDE} It has been a week. Your character is where you left them, and a few things moved on without you:`, button: 'Pick up where I left off' };
  return { subject: 'Your world is still here', intro: `${GUIDE} It has been ${step === 3 ? 'three days' : `${step} days`}, ${name}. Here is some of what happened:`, button: 'See what happened' };
};

/** The words for one plan; `name` is the player's character. */
export function mailWords(plan: Plan, { name, now }: { name: string; now: number }): MailWords {
  const who = firstName(name);
  const pref = PREF_OF[plan.type];
  switch (plan.type) {
    case 'need': {
      const w = NEED_WORDS[plan.need];
      return { subject: `${who} is ${w.word}`, heading: `${who} is ${w.word}`, intro: w.intro(who), lines: [], button: { label: w.button(who), go: plan.go }, pref };
    }
    case 'waiting': {
      const lines: string[] = [];
      if (plan.messages) lines.push(`${plural(plan.messages, 'message', 'messages')} from your friends`);
      if (plan.gifts) lines.push(plan.gifts === 1 ? 'A gift from a friend' : `${plan.gifts} gifts from friends`);
      if (plan.requests) lines.push(plan.requests === 1 ? 'A friend request' : `${plan.requests} friend requests`);
      if (plan.joined) lines.push(plan.joined === 1 ? 'A friend joined through your link' : `${plan.joined} friends joined through your link`);
      if (plan.joined && plan.names.length && !plan.messages && !plan.gifts && !plan.requests) {
        const who = listNames(plan.names), subject = `${who} joined Allworld through your link`;
        return { subject, heading: subject, intro: `${who} ${plan.names.length === 1 ? 'is' : 'are'} in Allworld now and waiting for you. Say hello.`, lines: [], button: { label: 'Say hello', go: plan.go }, pref };
      }
      if (!plan.names.length) {
        const subject = plan.requests === 1 ? 'Someone wants to be your friend in Allworld' : `${plan.requests} people want to be your friends in Allworld`;
        return { subject, heading: subject, intro: 'Open the game to see who, and say yes or not now.', lines: [], button: { label: 'See who', go: plan.go }, pref };
      }
      const list = listNames(plan.names), are = plan.names.length === 1 ? 'is' : 'are';
      return { subject: `${list} ${are} waiting for you`, heading: `${list} ${are} waiting for you`, intro: 'Here is what is waiting for you in Allworld:', lines, button: { label: 'See what is waiting', go: plan.go }, pref };
    }
    case 'nudge': {
      const list = listNames(plan.names), are = plan.names.length === 1 ? 'is' : 'are';
      return { subject: `${list} ${are} waiting for you in Allworld`, heading: `${list} ${are} waiting for you`, intro: `${list} would like to see you in Allworld. Come and say hello.`, lines: [], button: { label: plan.names.length === 1 ? `Say hello to ${listNames(plan.names)}` : 'Say hello', go: plan.go }, pref };
    }
    case 'milestone':
      switch (plan.what) {
        case 'elected': return { subject: 'You were elected Chairman', heading: 'You were elected Chairman', intro: 'The votes are in and the seat is yours for the week. People will be watching for what you announce.', lines: [], button: { label: 'Open the State House', go: plan.go }, pref };
        case 'house': return { subject: 'Your house upgrade is finished', heading: 'Your house upgrade is finished', intro: `Your ${plan.label} is ready. Come and have a look round.`, lines: [], button: { label: 'See my house', go: plan.go }, pref };
        case 'deposit': return { subject: 'Your savings have matured', heading: 'Your savings have matured', intro: `Your ${plan.label} fixed deposit has come to its end.`, lines: [], button: { label: 'Open the bank', go: plan.go }, pref };
        case 'table': return { subject: 'You won at the table', heading: 'You won at the table', intro: 'Your win is waiting to be collected.', lines: [], button: { label: 'Collect it', go: plan.go }, pref };
        case 'vote': return { subject: 'Voting for Chairman is open today', heading: 'Voting for Chairman is open today', intro: 'The polls stay open until the end of Saturday. Everyone gets one vote.', lines: [], button: { label: 'See the candidates', go: plan.go }, pref };
        case 'shift': return { subject: `Your ${plan.label} shift is open`, heading: `Your ${plan.label} shift is open`, intro: 'Today’s paid shift is there for you whenever you want it.', lines: [], button: { label: 'Open my career', go: plan.go }, pref };
      }
      break;
    case 'event': {
      const when = whenWords(plan.start, now);
      return { subject: `${plan.title} starts ${when}`, heading: plan.title, intro: `${plan.title} starts ${when} at ${plan.venue}. You would be welcome.`, lines: [], button: { label: 'See the event', go: plan.go }, pref };
    }
    case 'away': {
      const w = AWAY(who, plan.step);
      return { subject: w.subject, heading: w.subject, intro: w.intro, lines: plan.step >= 28 ? [] : plan.facts.slice(0, 3), button: { label: w.button, go: plan.go }, pref };
    }
  }
  return { subject: 'Allworld', heading: 'Allworld', intro: '', lines: [], button: { label: 'Open Allworld', go: 'needs' }, pref };
}

/** The footer's "stop these" wording, per switch. */
export const STOP_WORDS: Readonly<Record<PrefKey, string>> = Object.freeze({
  needs: 'Stop e-mails about my character’s needs', friends: 'Stop e-mails about my friends', milestones: 'Stop e-mails about milestones',
  events: 'Stop e-mails about events', away: 'Stop e-mails for when I have been away', week: 'Stop the weekly digest',
});
