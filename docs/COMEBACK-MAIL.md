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

* Comeback mail goes only to an address the player has confirmed through the existing double opt-in, and only while "E-mail me about my character" is on. A later change lets a verified account address be that recipient, through `mailRecipientOf` in `server/growth/comeback.ts` and nothing else.
* A player who confirms an address starts with the preference on. The confirmation page says: "We'll send you a few e-mails a week at most about your character. Change this any time."
* An address that was confirmed before this feature existed starts with the preference off (it consented to a different sentence). The player can turn it on in Stay in touch. Their weekly digest is unchanged.
* Stay in touch has a switch for each type (Needs, Friends, Milestones, Events, When I've been away, Weekly digest) and "Pause all for 30 days".
* Every mail has a footer that says why it was sent, a link to stop that type, a link to unsubscribe from everything, and a link to the preferences. The `List-Unsubscribe` and `List-Unsubscribe-Post` headers point at the unsubscribe-from-everything address. None of these needs a login. Unsubscribing from everything deletes the address, as before.

## Nudging a friend

On the card of a friend who has been away 2 days or more, "Nudge to come back" asks the server to remember that you want them back. The server checks that you are friends, that neither has blocked the other, and that you have not nudged that friend in the last 7 days. The answer is always the same sentence, "We'll let them know if they've asked for e-mails", whether or not the friend has an address, so nobody learns who has one. A player may nudge at most 5 friends an hour.

## What a mail never contains

Message text, exact balances, coordinates, another player's address, images, tracking pixels or third-party assets. Every player-written word (a name, an event title) is escaped.

## How it runs

`players with a confirmed address` are the only ones considered. Each has a record with the next time it is worth looking at: after a visit, 12 hours later; in quiet hours, at 08:00; when capped, when the cap clears; otherwise hourly. A tick (the existing heartbeat, at most once a minute) does nothing at all when the mailer is not configured, when the switch is off, or when no record is due. When some are due it looks at a bounded batch, decides, claims the chosen mail in a stored transaction (so a restart or a second tick cannot send it twice) and then sends. One collection read per tick that has work; the game's lives are read only for players that are due.

Counters (queued, sent, failed, suppressed, unsubscribed) per type are kept per day for 14 days in the operator view. They hold no address, name or id.
