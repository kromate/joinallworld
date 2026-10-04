/**
 * The player-facing words about telemetry: the consent sheet and the "What we collect" text that
 * the sheet and Settings both show. Plain strings only, so they can be read, tested and translated
 * in one place. SECURITY.md ("Telemetry") says the same things for operators — keep them in step.
 */
export const CONSENT = Object.freeze({
  title: 'Help improve Allworld?',
  ask: 'May we count how the game is used on this device? For example: how many players tap Play, finish their first activity, take a first trip or come back the next day. It shows us what is confusing or broken.',
  optional: 'This is optional. The game is exactly the same whichever you choose, and you can change your mind at any time in Sim → Settings → Privacy.',
  accept: 'Accept',
  reject: 'Reject',
  more: 'What we collect',
  less: 'Hide details',
  // Settings (the same sheet, showing the choice in force)
  settingsTitle: 'Analytics and error reports',
  on: 'Usage analytics is ON for this device.',
  off: 'Usage analytics is OFF for this device.',
  unset: 'You have not chosen yet. Nothing is being counted.',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  close: 'Close',
  signal: 'Your browser sends a “Do Not Track” or “Global Privacy Control” signal. We treat that as Reject: usage analytics is off and stays off while the signal is on.',
  under18: 'Usage analytics is off for players under 18: you told the game you are under 18 (Phone, Stay in touch).',
  notConfigured: 'This server does not have usage analytics switched on. Nothing is being counted.',
  noErrors: 'This server does not have error reports switched on either.',
});

/** Where the analytics provider stores data, said in words when the host tells us. */
export function regionWords(host: unknown): string {
  const name = String(host ?? '');
  if (/(^|\/\/)eu\./.test(name)) return ' Its servers for this game are in the European Union.';
  if (/(^|\/\/)us\./.test(name)) return ' Its servers for this game are in the United States.';
  return '';
}

export interface CollectSection { heading: string; lines: string[] }

/** The "What we collect" text, as sections of { heading, lines }. */
export function whatWeCollect({ host = '' }: { host?: string } = {}): CollectSection[] {
  return [
    { heading: 'If you accept: usage analytics', lines: [
      'Which steps you complete: starting to play (how long your name is and whether you changed the suggestion — never the name), your first activity, each step of settling in, your first trip and first work shift, and the days you come back.',
      'What you use: missions you collect, table games you sit down to and how they end, links you share or arrive by, notifications or e-mail you switch on or off (never the address), and the local government you choose for your house — one of twenty, chosen by you, never your position.',
      'Counts, never content: that a chat line or a message was sent, that voice was joined and for how long, that you became friends with someone or visited a home, and how many minutes you spent in a place with another player.',
      'How the game runs for you: a rough frame-rate band, how long loading took, how long actions take, which actions fail and why, and connection problems.',
      'Your player code — the same public code other players can already see — so the counts belong to one player. Not your nickname.',
    ] },
    { heading: 'Never collected, whatever you choose', lines: [
      'What you write: chat, messages, your nickname, group names, reports.',
      'Where your character stands, your real location, or your IP address.',
      'Voice audio. Recordings of your screen, your clicks or your typing.',
      'An e-mail address or phone number. If you give the game an e-mail address for its own messages, it is never sent to analytics or to error reports.',
    ] },
    { heading: 'Always on: error reports', lines: [
      'When the game crashes or a request fails, we receive a short technical report: the kind of error, where in the code it happened, the last few action names and result codes, your browser type and your player code.',
      'It contains no chat, names, positions or anything you typed, uses no cookies, and is not used to study what you do. We need it to keep the game working, so it does not depend on this choice.',
    ] },
    { heading: 'Who receives it', lines: [
      `Usage analytics goes to PostHog, and error reports go to Sentry — companies that process this data for us.${regionWords(host)} It is not sold, not used for advertising and not combined with data from other sites.`,
      'Your choice is remembered on this device only. If you reject, nothing is sent and nothing is stored except the fact that you said no.',
    ] },
  ];
}
