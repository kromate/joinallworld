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
| ping | Friends | A friend pressed **Ping** on your card ("I am here, come and join me") while you were not in the game. Sent at once, under caps of its own: see [Ping](#ping). | `Ada is waiting for you in Allworld` |

## The limits (one module, `src/game/comeback.ts`)

* Never while the player has been active in the last 12 hours.
* Never between 21:00 and 08:00 Lagos time. A mail that qualifies at night is sent at 08:00 or later.
* At most one mail in 24 hours and three in 7 days, counted across every type the schedule sends. The weekly digest counts as one. A friend's ping is the one kind with caps of its own: see [Ping](#ping).
* When several qualify, one is chosen: waiting, then nudge, then need, then milestone, then event, then away.
* Per type: a need alert at most once every 3 days; waiting, nudge and milestone at most once every 2 days and event once every 3; each milestone or event only once; each away step once per absence.
* Back-off: after 3 mails in a row that were not followed by a visit, at most one mail per 14 days. After the 28-day mail, or after five mails in a row with no visit whatever they were, none until the player returns. The 28-day mail is never held back by a stronger reason.
* The operator switch and the daily cap (`EMAIL_DAILY_CAP`) apply to every mail.

A visit is any sign of play after the mail: the growth hello, a saved action, a social request.

### A friend joined through your link

A player who comes through an invite link and the inviter become friends without a request (`server/social/service.ts` `meetInviter`), and the inviter gets an update in the game that opens the friend's card. While that update is unread it is one of the things *waiting* (a Friends mail: `Ada joined Allworld through your link`), under the same switches, caps, quiet hours and unsubscribe links as every other mail.

It is the one thing that may be mailed to a player who was active in the last 12 hours, and nothing else rides along with it then. It waits 10 minutes after the newest join, so several joins are one mail, and it is never sent while the player is connected to the game: they are looked at again every 10 minutes until they have left or read the update. Before this, a friend joining was not a reason for any mail.

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

## Ping

**"I am here — come and join me."** On a friend's card, and in the header of a direct chat, a friend who is in the game has **Call**; a friend who is not (offline, or connected but nowhere) has **Ping** in the same place. One tap, no form. The friend is told through every channel they have, and if they come they land right where the pinger is.

### What a ping does

1. The server checks the pair (below) and records one pending ping: who, to whom, when, the pinger's city and venue, and when it ends. A home is recorded as `home` and is only ever said as "at home in Lagos": no street, no plot, no local government, in the game or in a mail.
2. One line goes into the friend's Updates ("Ada is at Freedom Park, Lagos and pinged you to come."), for when they are back.
3. If the friend is **in the game**, on any device: a notice — "Ada is at Freedom Park, Lagos" with **Join**, **Call** and **Chat**. Nothing leaves the game.
4. If they are **not**: a notification to a browser they subscribed, and an e-mail to the address comeback mail may write to (`mailRecipientOf`) — each only if its own rules below allow it.
5. The pinger is told one of three sentences, and nothing else: "Ada is in the game and has been told.", "Pinged. Ada will see it when they are back." or "It is night for Ada; they will see it when they are back." The sentence comes from the clock and from presence (which a friend sees anyway). It never depends on whether an address or a notification exists, nothing is sent until the pinger has been answered, and nothing is ever reported back about delivery or reading. Under the button the pinger also gets the join link to hand on themselves: the device's share sheet (or Copy link), and a WhatsApp button that only opens WhatsApp's own share address with the message written. No number is asked for and nothing is sent by the game.

### Who may ping whom

Friends only; never across a block, either way (a block made after a ping closes it, and the join then says no more than "left"); never a muted sender; not while the pinger is on a trip (there is no place to join them yet) or has no live connection.

**The founder.** Every player holds the automatic friendship with the founder (`server/social/founder.ts`). Across it a player **cannot ping the founder at all**: it would be one notice, and at worst one mail, per player. The refusal says so ("… is everyone's first friend, so they cannot be pinged. Send them a message instead."), and nothing is stored or sent. The founder pinging such a friend is an ordinary ping, one friend per request, under the same counts as everyone: there is no way to ping many players at once. A friendship the founder made by request is a friendship like any other.

### The numbers (`src/game/ping.ts`, `PING`)

| Number | Value | Why |
| --- | --- | --- |
| `liveMinutes` | 60 | A ping is about now. After an hour "come and join me" is no longer true. |
| `pairMinutes` | 30 | The same friend can be pinged again after half an hour. The card says until when. |
| `perHour`, `perDay` | 10, 30 | Pings one player may send, to anyone. Enough for a group of friends; too few to work through a list. |
| `mail.pairHours`, `mail.pairPerDay` | 4, 2 | One friend reaches a player's inbox once in four hours and twice a day. A later ping still shows in the game. |
| `mail.recipientPerDay`, `mail.recipientPerWeek` | 2, 5 | Ping mails one player gets from **everybody together**. Kept low on purpose: these come on top of the automatic mails. |
| `mail.unansweredPerSender` | 3 | After three ping mails from one friend with no visit since, that friend's pings are not mailed until the player has been back. |
| `mail.unansweredInAll` | 5 | After five from anybody with no visit since, none at all until they have been back. |
| `pushPerDay` | 6 | Ping notifications one player's browsers are sent in a day. |
| `freeJoinsPerDay` | 3 | Journeys to another city a player makes free of charge by joining a friend, in 24 hours. |
| `quietFrom`, `quietTo` | 21, 8 | The quiet hours of every other mail, Lagos time. |

### The mail, and how it differs from the automatic ones

A ping is asked for by a friend and is worth something only in the next hour, so two of the usual gates do not apply: it **is** sent to a player who was active in the last 12 hours, and it is **not** held to be folded into a later mail. Everything that protects the recipient does apply:

* "E-mail me about my character" on, the **Friends** switch on, no pause; never to a minor; never to an unconfirmed address. The mail's "Stop e-mails about my friends" link switches Friends off, and "Unsubscribe from everything" works as in every other mail. Both need no sign-in.
* Never while the recipient is connected to the game, or was a moment ago.
* Never at night. A ping at night is **not** held until morning — it would be stale — so nothing is sent, the pinger is told it is night, and the line in Updates is what the friend finds. (The player's own time zone is not known to the server; the night is the one every other mail uses.)
* The caps in the table. They are counted in a ledger of their own (`growth.comeback[id].pings`), **apart from** the one-a-day, three-a-week ledger of the automatic mails. Shared, a friend who pings often would use up the mails about a player's needs and milestones, and a milestone mail would silence a friend for a day. Apart, each kind is bounded by its own promise: the footer of a ping mail says "at most 2 times a day, never at night". The worst week for one player is three automatic mails and five pings.
* The operator's e-mail switch and `EMAIL_DAILY_CAP` apply. The counters of the operator view have a `ping` row.

The mail has the look of the account welcome message: who pinged, where they are, one button "Join Ada" (the join link), that they land right where their friend is, how long it is good for, and the footer. No image, nothing fetched when it is read, no pixel, no redirect: the only thing the server learns is that the join link was used, by the signed-in player it was made for.

### The join link

`https://<origin>/j/<token>`. The token is a version, the pinger, the recipient and an expiry, with an HMAC-SHA-256 over them made with a key this server keeps for itself (`ctx.keyFile('ping-signing')`); only one spelling of it is accepted. It names a ping and nothing else:

* **It is not a login.** Opening it sets no cookie and signs nobody in. The page keeps the token on the device for an hour and asks `POST /api/social/ping/open` once it has a session.
* The recipient's session: the join goes ahead (they pressed "Join" in their mail). Another player's session: "That invitation was for another player. Nothing was changed." No session: the normal start; after logging in as the right player the join goes ahead.
* It ends with its ping: after an hour, when the pinger cancels, or when the pinger has left the game (a heartbeat ends their pings once they are offline past the reconnect grace; a join or a list finds the same from presence).

### The join

`POST /api/social/ping/join` needs no token: it is a request by the recipient, exactly once per client id, and everything is checked again against stored state — the ping is live, the two are still friends, neither blocked the other, the pinger is still connected. Then the joiner goes to where the pinger is **now**, not where they pinged from:

* **Same city:** placed at that venue at once.
* **Another city:** an arrival there through the same code as the end of a trip between cities (`arriveInCity`): a home left behind is kept (a city that was only being visited leaves nothing behind), a life with no house there arrives as a visitor — nothing asks it to choose a local government, its one main home is untouched and no house is given — and a life that owns a house there has it again; the job rules of a change of city apply. No fare, no trip time — at most `freeJoinsPerDay` times in 24 hours, only to an open city that has a link back, and **the way home is paid as usual**. Nothing else is opened or said on arrival (not the first-home sheet, not the trip's welcome); the notice says "You joined Ada at Agodi Gardens, Ibadan."
* **The pinger is at home:** the join never opens a door. In the same city nobody is moved; in another city the joiner arrives at that city's public arrival place. Either way the notice says "Ada is at home in Ibadan. Knock to come in.", and coming in is the house's own knock.
* **Refused, with the reason:** in the middle of an action ("Finish or cancel what you are doing first" — nothing is thrown away), a life still held for its look, a guest who has not settled in asked to change city, the pinger on a trip ("Try again when they have arrived").
* **Too late:** "Ada has left. You can message them.", with Chat. The joiner stays where they are.

On success both are told ("Bayo joined you at Freedom Park, Lagos"), the pair's chat is one tap away, and Call is offered when both are connected. A call is never placed for them: the microphone opens only on a tap.

### Invites

A new player who comes through an invite link is put beside the inviter when the inviter is in a public venue of the newcomer's city (as before). When the inviter is in **another** city the newcomer is told which ("Ada is in Ibadan right now — you can travel there once you have settled in"): a new character starts in the city its player chose, and a guest cannot travel between cities. The inviter, once the two are friends, is offered the same **Join** a ping gives ("Bayo joined through your link", with Join, Call and Chat) for the next hour, while the newcomer is in the game. Nobody pressed Ping for that, so no mail and no notification is sent for it; the existing "joined through your link" notice and mail are unchanged.

### What is stored

Additive only; a store from before this reads unchanged.

* `social.pings` — `{ "<from>><to>": { from, to, at, expires, cityId, venue, state, auto? } }`, at most 5 000, each dropped once it is over and the wait before the next ping has passed.
* `social.pingJoins` — `{ [publicId]: [ms] }`, the free journeys of the last 24 hours.
* `growth.comeback[id].pings` — `[{ at, from }]`, the ping mails sent to a player, a week of them, at most 24.
* One more kind of line in `social.players[id].updates` (`ping`), one more row in `growth.comebackStats` (`ping`), and one more key the server makes for itself (`ping-signing`).
* The hourly and daily counts of a sender, and a recipient's notifications, are rate-limiter rows (`ping:hour:`, `ping:day:`, `ping:push:`).

## What a mail never contains

Message text, exact balances, coordinates, another player's address, images, tracking pixels or third-party assets. Every player-written word (a name, an event title) is escaped.

## How it runs

`players with a confirmed address` are the only ones considered. Each has a record with the next time it is worth looking at: after a visit, 12 hours later; in quiet hours, at 08:00; when capped, when the cap clears; otherwise hourly. A tick (the existing heartbeat, at most once a minute) does nothing at all when the mailer is not configured, when the switch is off, or when no record is due. When some are due it looks at a bounded batch, decides, claims the chosen mail in a stored transaction (so a restart or a second tick cannot send it twice) and then sends. One collection read per tick that has work; the game's lives are read only for players that are due.

Counters (queued, sent, failed, suppressed, unsubscribed) per type are kept per day for 14 days in the operator view (`GET /api/mod/growth/outreach`, section `comeback`), with the number of rounds that opened the store since the server started. They hold no address, name or id. They are not sent to analytics: a server-side mail has no player consent context.

The e-mail "away" message that used to go to anyone away a day is replaced by the 3, 7 and 28 day steps and the reasons above; the weekly digest stays, on the shared ledger and with its own switch.

## Where it lives

* Rules and numbers: `src/game/comeback.ts` (pure), words: `src/game/comeback-words.ts`, switch names: `src/game/comeback-prefs.ts`, deep links: `src/game/go-links.ts`.
* Schedule, claim, preferences, nudge: `server/growth/comeback.ts`; the recipient: `server/growth/recipient.ts`; the mail layout: `server/growth/email/comeback.ts`.
* Ping: numbers and the mail decision `src/game/ping.ts`; the ping and the join `server/social/ping.ts`, routes `server/routes/ping.ts`; what leaves the game `server/growth/ping-mail.ts`, the mail `server/growth/email/ping.ts`; the life's side of a join `src/game/systems/social.ts` (`join`); the browser `src/app/features/ping`.
* Client: the switches in `TouchApp.vue`, the nudge and Ping on `PlayerCard.vue`, the allow-listed `?go=` link in `src/quick-start/entry.ts` and `src/app/features/landing/landingStore.ts`.
* A link in a mail opens `/?go=<panel>` (needs, messages, people, career, houses, events, governor, tables, bank, touch). Anything else is ignored.
