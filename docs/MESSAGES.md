# Messages: groups, mentions, replies, reactions, gifts

Where the rules are: `server/social/service.ts` (both hosts run the same code), the routes in `server/routes/social.ts`, the types in `src/types/social.ts`, the screens in `src/app/features/messages/`.

## Groups

- At most 20 groups per player and 12 people in a group (including the admin). A group is one entry in the `social` collection; 12 members keep a group's record small, so the limit was not raised.
- The creator is the **admin** (`conv.owner`). Only the admin renames, adds and removes. If the admin leaves, the member who has been in the group longest becomes admin (the member list is in the order people joined) and a line says so.
- **Who can add whom.** The adder must be an ordinary friend of the person added (both listed each other). The founder's automatic friendship does not count for a player adding the founder; the founder may add the players who hold it. Someone who blocked the adder, or is blocked by them, cannot be added. A player's setting "Who can add me to groups" (`friends` by default, or `nobody`) is respected.
- An added player gets a `group-added` update with a Leave button and a line in the thread. Leaving is one request.
- Limits: 5 groups created per hour, 30 people added per hour, 30 messages a minute.
- Per player and per chat (kept on the player's own entry, so every device sees it): mute (groups only), pin (at most 3), and "delete for me" (leaves a group; removes a direct chat from the list only, it comes back with only the new message unread).

## Mentions

A client sends `mentions: [{ id, start }]` beside the body. The server checks each against the group's members and that `body` really has `@Name` at `start` (the name is the member's name now), then stores `men: [[id, start, length]]` on the message. Names are never taken from the client. `@everyone` is the admin's only, once every 10 minutes per group. A mention notifies in Updates (`mention`) even when the group is muted, unless the player turned that off; a blocked player's mention does not notify; a stranger's mention reaches a player only through the admin or an ordinary friend; nobody reaches the founder but an ordinary friend. In a direct chat `mentions` is ignored.

## Replies

`replyTo: <seq>` stores `re: { seq, from, text }` where `text` is the first 80 characters (cut between characters a person sees, `server/social/clip.ts`). A message that is gone, a system line, or one the replier cannot see (their blocked author) is sent without a quote. A viewer who blocked the quoted author is not shown the quote.

## Reactions

`POST /api/social/conversations/:id/react { seq, emoji | null }`. One reaction per player per message, stored as `rx: { playerId: emoji }`. At most 6 different emoji on a message. Pushed live to the conversation (`message-changed`). The author gets one quiet Updates line per message ("Joy and 2 others reacted"), never a toast, mail or phone notification.

## Gifts

A gift is a line in the two players' direct chat (`gift: { n, r? }`; the receiver sees "Ada sent you ₦1,500", the sender "You sent ₦1,500"). The money moves exactly as before (`transfer`: same limits, same receipt). The recipient's other devices are told live (`transfer`, `social-sync`, `life-changed`). A gift for a player who is away is applied on their next request; `r` records what a ride debt took of it and is shown to the receiver only.

## Stored shapes (all additive)

| Where | Field | Cost |
| --- | --- | --- |
| `social.convs[id]` | `everyoneAt?` | 1 number, groups only |
| message | `men?: [id, start, length][]` | about 50 bytes per mention |
| message | `re?: { seq, from, text }` | about 140 bytes, only on a reply |
| message | `rx?: { id: emoji }` | about 45 bytes per reaction |
| message | `gift?: { n, r? }` | about 20 bytes, only on a gift |
| message | `img?: { id, w, h, n, rp?, hid?, gone? }` | about 90 bytes, only on a picture (docs/CHAT-PICTURES.md) |
| `social.players[id].convs[conv]` | `mute?`, `pin?` | 6 bytes each |
| `social.players[id]` | `groups?`, `mentions?`, `pictures?`, `noPictures?`, `pics?`, `notify?` | only when set |
| `social.pending[id][]` | `gift?: { conv, seq }` | on a waiting gift |
| `growth.push[id].subs[]` | `tz?` | one number |
| update kinds | `mention`, `reaction` | |

A message that uses none of these costs nothing extra. Older conversations load unchanged.

## Protocol

New routes: `POST /api/social/introduction` (docs/REALISM.md item 13; `POST /api/social/prefs` also takes `introductions`), `GET /api/social/friends/search`, `POST /api/social/conversations/:id/prefs`, `POST /api/social/conversations/:id/react`, `POST /api/social/prefs`, `POST /api/social/notify`, `POST /api/social/images`, `GET /api/social/images/:id`, `POST /api/growth/push/test`, `GET /api/mod/pictures`, `GET /api/mod/pictures/:id`, `POST /api/mod/pictures/:id`, `POST /api/mod/players/:id/pictures`. New frame: `message-changed`. `POST /api/social/reports` also takes `{ conv }` (a group) and `{ conv, image }` (a picture). `GET /api/social/me` gains `prefs` and more `limits`; a conversation may carry `muted`, `pinned`, `mentions`; a message may carry `mentions`, `replyTo`, `reactions`, `gift`, `image`.
