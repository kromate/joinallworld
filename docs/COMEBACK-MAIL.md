# Comeback mail

A small number of e-mails that bring a player back to a world they already live in: a character who
is hungry, a friend who is waiting, something that finished while they were away. In the spirit of the
reminder mails of language-learning apps: few, specific, warm, easy to stop.

Allworld is a digital world you can live in. These mails say so in plain words and never describe it as
a game about one city.

## What is sent

Everything is decided on the server from stored state. The browser takes no part.

| Type | Preference | Sent when | Subject (example) |
|------|------------|-----------|-------------------|
| waiting | Friends | A friend wrote to you, sent you a gift, or you have a friend request, and you have not looked. The mail counts them and names friends only; message text is never included. A blocked or muted sender never counts. | `Ada is waiting for you` |
| nudge | Friends | A friend pressed "Nudge to come back" on your card. One per friend per 7 days; it expires after 7 days. | `Ada is waiting for you in Allworld` |
| need | Needs | You have been away 24 hours or more and your hunger, energy or social need would be low (under 20) when you return. Only the worst one is named. | `Kunle is hungry` |
| milestone | Milestones | Something finished: a house upgrade, a shift you can work today, a savings deposit that matured, a win at a table that is still to collect, the Governor election (you were elected, or voting opened today). | `Your house upgrade is finished` |
| event | Events | A calendar event in your city starts within the next 24 hours, and you have been away a day or more. | `Lagos Jazz Night starts tonight` |
| away | When I've been away | You have been away 3, 7 and 28 days. Each is sent once per absence. The 28-day mail is the last one: after it, silence until you come back. (It is 28, not 30, because a saved life that has not been visited for 30 days expires; the goodbye must arrive while the character still exists.) | `Your world is still here` |
| week | Weekly digest | The existing Sunday summary. | unchanged |

## The limits (one module, `src/game/comeback.ts`)

* Never while the player has been active in the last 12 hours.
* Never between 21:00 and 08:00 Lagos time. A mail that qualifies at night is sent at 08:00 or later.
* At most one mail in 24 hours and three in 7 days, counted across every type. The weekly digest counts as one.
* When several qualify, one is chosen: waiting, then nudge, then need, then milestone, then event, then away.
* Per type: a need alert at most once every 3 days; waiting, nudge and milestone at most once every 2 days and event once every 3; each milestone or event only once; each away step once per absence.
* Back-off: after 3 mails in a row that were not followed by a visit, at most one mail per 14 days. After the 28-day mail, or after five mails in a row with no visit whatever they were, none until the player returns. The 28-day mail is never held back by a stronger reason.
* The operator switch and the daily cap (`EMAIL_DAILY_CAP`) apply to every mail.

A visit is any sign of play after the mail: the growth hello, a saved action, a social request.

## Consent and control

* Comeback mail goes to one of two addresses, decided in one place (`mailRecipientOf`, `server/growth/recipient.ts`), and only while "E-mail me about my character" is on: the address confirmed through the double opt-in of Stay in touch, or — for the character that is an account's active one — the account's verified address (never for a player who said they are under 18).
* An account made from now on starts with the preference on; the creation screen says so next to its button ("We'll e-mail you a few times a week at most about your character. You can turn this off any time."). An older account has to switch it on itself. The record is made at the character's first visit after the change (`account.mailOptIn`, then `growth.comeback[id].acct`).
* The welcome message of a new account is one of the character's mails: it is in the same ledger (type `welcome`) and under the same daily cap, so no one is sent a welcome and a comeback mail on one day. The weekly digest is sent only to a Stay in touch address.
* "Unsubscribe from everything" works for an account holder from the mail's link, with no sign-in; the account itself is untouched.
* A player who confirms an address starts with the preference on. The confirmation page says: "We'll send you a few e-mails a week at most about your character. Change this any time."
* An address that was confirmed before this feature existed keeps what it had: the "away" e-mail (3 days away; now also at 7 and 28 days, with the same caps and quiet hours) and the weekly digest. It consented to a different sentence, so every other type (Needs, Friends, Milestones, Events) starts off and the player turns it on in Stay in touch. The record is made at the contact's first visit after the change, marked `legacy` and the switches in Stay in touch show exactly this (the master switch on, only "When I've been away" and the weekly digest ticked). Turning the master switch off, or unsubscribing from everything, ends the special start.
* Stay in touch has a switch for each type (Needs, Friends, Milestones, Events, When I've been away, Weekly digest) and "Pause all for 30 days".
* Every mail has a footer that says why it was sent, a link to stop that type, a link to unsubscribe from everything, and a link to the preferences. The `List-Unsubscribe` and `List-Unsubscribe-Post` headers point at the unsubscribe-from-everything address. None of these needs a login. Unsubscribing from everything deletes the address, as before.

## Nudging a friend

On the card of a friend who has been away 2 days or more, "Nudge to come back" asks the server to remember that you want them back. The server checks that you are friends, that neither has blocked the other, and that you have not nudged that friend in the last 7 days. The answer is always the same sentence, "We'll let them know if they've asked for e-mails", whether or not the friend has an address, so nobody learns who has one. A player may nudge at most 5 friends an hour.

## What a mail never contains

Message text, exact balances, coordinates, another player's address, images, tracking pixels or third-party assets. Every player-written word (a name, an event title) is escaped.

## How it runs

`players with a confirmed address` are the only ones considered. Each has a record with the next time it is worth looking at: after a visit, 12 hours later; in quiet hours, at 08:00; when capped, when the cap clears; otherwise hourly. A tick (the existing heartbeat, at most once a minute) does nothing at all when the mailer is not configured, when the switch is off, or when no record is due. When some are due it looks at a bounded batch, decides, claims the chosen mail in a stored transaction (so a restart or a second tick cannot send it twice) and then sends. One collection read per tick that has work; the game's lives are read only for players that are due.

Counters (queued, sent, failed, suppressed, unsubscribed) per type are kept per day for 14 days in the operator view (`GET /api/mod/growth/outreach`, section `comeback`), with the number of rounds that opened the store since the server started. They hold no address, name or id. They are not sent to analytics: a server-side mail has no player consent context.

The e-mail "away" message that used to go to anyone away a day is replaced by the 3, 7 and 28 day steps and the reasons above; the weekly digest stays, on the shared ledger and with its own switch.

## Where it lives

* Rules and numbers: `src/game/comeback.ts` (pure), words: `src/game/comeback-words.ts`, switch names: `src/game/comeback-prefs.ts`, deep links: `src/game/go-links.ts`.
* Schedule, claim, preferences, nudge: `server/growth/comeback.ts`; the recipient: `server/growth/recipient.ts`; the mail layout: `server/growth/email/comeback.ts`.
* Client: the switches in `TouchApp.vue`, the nudge on `PlayerCard.vue`, the allow-listed `?go=` link in `src/quick-start/entry.ts` and `src/app/features/landing/landingStore.ts`.
* A link in a mail opens `/?go=<panel>` (needs, messages, people, career, houses, events, governor, tables, bank, touch). Anything else is ignored.
