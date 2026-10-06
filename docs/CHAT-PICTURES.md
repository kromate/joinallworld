# Pictures in chat: what we can and cannot check

Pictures are off by default; set `CHAT_IMAGES=friends` to switch them on for a host, and `CHAT_IMAGES=off` (or leave it unset) to keep them off (the button disappears and uploads are refused). This note is for the owner: what protects players, and what does not.

## What is checked

- **Who can send.** Only inside a direct chat between two ordinary mutual friends, or a group the sender belongs to. Never to a stranger. Across the founder's automatic friendship only the founder may start; a player may answer with a picture only after the founder has written in that thread. A block either way refuses. A player can set "Pictures from: nobody". A muted or suspended player cannot post, and an operator can stop one player's pictures.
- **What the bytes are.** The browser re-encodes the photo through a canvas (this removes camera and location data), shrinks it to 1280 pixels and aims at 180 kB. The server does not trust that: it accepts only a still JPEG, PNG or WebP that parses to its end, at most 250 kB and 2048 pixels on a side (4 million pixels), and then writes the file out again without any metadata (EXIF and GPS, XMP, colour profiles, comments, text chunks). Animated files, GIF, SVG, HEIC, a file whose type does not match its contents, and decompression-bomb sizes are refused.
- **Where it lives.** In the host's image store (files on Node, one SQLite table in the Durable Object on the Worker), never in the big `social` record. The message holds an id and three numbers.
- **Who can see it.** The picture is served only at `GET /api/social/images/:id`, to a signed-in member of its conversation who has not blocked or been blocked by the sender, with `Cache-Control: private`, `nosniff` and `inline`. There is no public address.
- **Limits.** 20 pictures a day per sender, the newest 50 kept per conversation (older ones are deleted and the bubble says "Picture expired"), 30 days kept, 200 MB in all (oldest removed first). All can be changed by `CHAT_IMAGES_PER_DAY`, `CHAT_IMAGES_PER_CHAT`, `CHAT_IMAGES_RETENTION_DAYS`, `CHAT_IMAGES_MAX_MB`.
- **Blur.** A picture from someone who became a friend less than a day ago, or a friend's first picture in that chat, shows blurred until tapped.
- **Report and removal.** Every picture has Report. The reporter's copy is hidden at once; two different reporters (`CHAT_IMAGES_REPORTS`) hide it for everyone until an operator decides (`/api/mod/pictures`). Leaving the last member out of a conversation, or the conversation being removed, deletes its pictures.

## What is not checked

- **There is no automatic scanning of what a picture shows.** Nothing detects nudity, violence, or anything illegal. A friend can send a harmful picture to a friend; the protections are friendship, limits, blur, report and removal after the fact.
- A recipient can screenshot or save a picture while it is shown. Deleting it from the server does not delete copies on devices.
- The metadata removal is for the file we store. A picture can still show a recognisable place or person in its content.
- Hiding after reports depends on people reporting and on an operator looking (there is no operator inbox beyond the list route).
- A picture that was cached in a browser (`private`, five minutes) may stay visible there for that time after it was hidden.

## Decisions for the owner before it goes live

1. Whether pictures should be on at all given there is no scanning; under-18 players are not separated from adults in chat today.
2. Whether the founder should be able to start pictures to every player.
3. Who looks at `/api/mod/pictures`, and how quickly.
4. The size ceiling and retention for the live host's Durable Object storage.

## Row and storage cost on the Worker

A picture is one row of `chat_images` plus two index entries (3 rows written); deleting it is the same again; serving it reads one row. Each is up to 250 kB. A message without a picture, a poll, a room, a heartbeat and a read of the chat write nothing here.
