# Messaging media source inventory and first-party sticker allocation

## Source pin and method

- Repository: `github.com/kromate/joinallworld`
- Commit: `3e3e0876fc50f3166a0d0968f8616b577da27870`
- Tree: `b64e0558987c5abcb0d8a9d5ef87c02144dcadef`
- Checkout was clean when inspected. This is source review only; no compiler, test, build, server, browser, network, or source mutation was performed.

## Current authoritative contracts

- Persisted messages are `MessageRecord` with text, reply, gift, reactions, one `img`, or one `voice`; there is no sticker/GIF/video/gallery/view-once field (`server/types.ts:271-302`). Picture and voice bytes have separate stores (`server/types.ts:303-343`).
- Public `Message` exposes one `image` and one `voice` (`src/types/social.ts:98-128`). `SendMessageBody` is text/forward plus mentions/reply (`src/types/social.ts:315-323`); picture and voice have separate singular upload bodies/routes (`src/types/social.ts:324-326,490-495`).
- HTTP message send is the existing durable transaction and commit-push path (`server/routes/social.ts:70-87,220-240`). Socket `dm-send` calls the same service (`server/ws/social.ts:123-147`), and the public frame type aliases `SendMessageBody` (`src/types/social.ts:515-524`).
- `service.send` validates the retry key, checks an existing `(sender, conversation, clientId)`, rechecks current membership before returning a duplicate, and conflicts on the stored body/voice fingerprint (`server/social/service.ts:1514-1544`). DM block/player authority is checked through `other`; new strangers get the current chat and awaiting-reply limits; existing groups/houses require current membership (`server/social/service.ts:1545-1577`). Group messages authored by a blocked member remain stored but are hidden per viewer through `visibleTo` (`server/social/service.ts:582,669-674,696-700`).
- Edit/delete is exactly-once through `ctx.once` and fingerprints conversation, sequence, operation, version, and replacement hash. Only the author can act; DM blocks refuse it. Edits are text-only and expire after 15 minutes. Delete leaves a versioned tombstone, drops picture/voice bytes after commit, removes the pin, and rewrites frozen reply text to “Message deleted” (`server/social/service.ts:1687-1729`).
- Block is persisted in the social collection and only updates the in-memory block index after commit; it also cuts the relationship/visits and refreshes affected pin projections (`server/social/service.ts:1350-1378,951-970`).
- Private pictures are stored before the social transaction, removed on refusal/duplicate/failure, and fetched only after two actor/session checks and a fresh conversation authorization check (`server/routes/social.ts:108-160`). Voice uses the equivalent external-byte lifecycle and actor-fenced read (`server/routes/social.ts:162-201`).
- Shared pins are scoped/versioned, exactly-once, membership checked, DM block/owner checked, and exclude deleted/system/gift or unavailable media (`server/social/service.ts:583-619,1457-1500`). The client pin controller fences actor, conversation, authority projection, request order, and disposal (`src/app/features/messages/messagePins.ts:33-77,79-136,154-161`).
- Node registers file image/voice stores in `RouteContext` (`server/server.ts:503-519`); Worker registers SQLite image/voice stores beside the generic SQLite document store (`deploy/cloudflare-worker.ts:316-336,371-375`). Inline social records are serialized generically on Node (`server/store.ts:355-379`) and Worker (`deploy/sqlite-store.ts:644-683`). A sticker ID stored inline therefore needs no new host adapter or blob table.
- Messages is already a lazy phone panel (`src/app/state/panelBodies.ts:5-9`; `src/app/features/panels.ts:33-37`). Inside that chunk, Composer eagerly imports voice, emoji, and picture preparation, and MessageBubble eagerly imports picture/voice renderers (`Composer.vue:1-12`; `MessageBubble.vue:1-11`). A sticker picker/art bundle must add a second lazy boundary.
- Text outbox retries reuse one `clientId`, but the outbox stores only `body`, target, mentions, and reply (`src/game/social-model.ts:24-87`; `src/types/social.ts:592-609`; `socialClient.ts:343-375`). Session replacement clears all caches/outbox (`socialClient.ts:605-623`), but in-flight `sync`, `openThread`, `markRead`, and `deliver` responses have no shared generation check (`socialClient.ts:262-277,328-375`). They can repopulate or mutate the replacement actor’s maps. `MessagesApp` has a local `actorTurn` for several screen calls (`MessagesApp.vue:147,249-255,285-291,350-359`), which does not fence those shared-client responses.
- Guest-first remains server authoritative: pre-Play lives are refused, while a guest who tapped Play is admitted (`server/social/service.ts:372-389`); the Messages UI mirrors that gate (`MessagesApp.vue:107-115`). Text remains a 500-codepoint server limit (`server/social/service.ts:110-118`) with actor-scoped per-conversation drafts and retry-preserving outbox behavior (`Composer.vue:35-50,111-120,154-161`).

## Media gaps in this exact source

- **Sticker:** no message field, request intent, catalogue, renderer, picker, notification label, tombstone rule, or retry fingerprint exists.
- **GIF:** the picture preparer explicitly refuses `image/gif` as animated (`pictureModel.ts:6-11`); the server picture cleaner also has an `animated` fault. There is no GIF catalogue/search/provider contract.
- **Video:** the picture preparer explicitly refuses `video/*` (`pictureModel.ts:8-10`); there is no video reference/store/route/player contract.
- **View once:** neither `MessageRecord`, public `Message`, picture/voice references, nor routes contain a consumption token, per-recipient opened state, atomic consume operation, or replay/tombstone semantics.
- **Gallery:** storage and public types permit one image only, and the composer holds one `photo` and one file (`Composer.vue:52-76,187-203`). There is no ordered media list, batch transaction, partial-failure rule, or gallery viewer.

These are current-source absences, not claims about older branches. A sticker slice does not satisfy the GIF, video, view-once, or gallery programme.

## Smallest complete first-party sticker slice

Use immutable, server-validated IDs with no upload and no third-party lookup. Initial fixed catalogue:

| ID | Accessible text |
|---|---|
| `wave` | Hello — waving hand |
| `thank-you` | Thank you |
| `well-done` | Well done |
| `laugh` | Laughing |
| `love` | Sending love |
| `sorry` | Sorry |
| `on-my-way` | On my way |
| `good-night` | Good night |

Contract:

1. Add a pure shared catalogue module exporting the closed `StickerId` union, immutable ID/text rows, and `stickerById(unknown)`. The server accepts only this table; client text is never authority. IDs are append-only and never reassigned.
2. Persist `sticker?: StickerId` and `intentHash?: string` inline on `MessageRecord`. Expose `sticker?: { id: StickerId; label: string }` on public `Message`. Send on existing HTTP/socket path as `{ ..., body: '', sticker: id, clientId, replyTo? }`; reject body, mentions, forward, image, or voice combined with sticker.
3. Fingerprint the validated request as canonical `['message-intent-v1','sticker',id,requestedReplySeq]`. Store its SHA-256 in `intentHash` on first append. On a matching `(sender,conv,clientId)`, compare `intentHash` before returning duplicate. A different ID, text intent, or reply target is `409 client_id_conflict`. Retain the hash after deletion. Existing text/picture/voice rows keep the present replay fallback; this unit does not silently redefine their historical fingerprints.
4. Apply ordinary-message authority: current DM block/player checks, new-chat and awaiting-reply limits, current group/house membership, and per-view block hiding. A sticker has no user-supplied bytes and adds no picture/voice preference. Whether strangers and active house guests should receive stickers is a product/privacy decision for Astra; the proposed default is the existing text policy, not attachment policy.
5. Deletion sets the normal tombstone and additionally deletes `line.sticker`, while retaining `intentHash`; editing and forwarding a sticker are refused and hidden in UI. Reactions remain valid. Pins may include an available sticker. History trimming/collection needs no byte cleanup.
6. Add one server label helper used by `bodyOf`, `quoteText`, conversation summary, phone push, and pinned labels. Use `Sticker: <accessible text>` in compact text projections. This prevents empty chat rows, quotes, notifications, and screen-reader output (`service.ts:366,570-580,676-687,922-923`; `message-push.ts:93-101`; `messagesThread.ts:18-22`; `PinnedMessages.vue:8`).
7. Extend the outbox from a text-only body to a frozen intent union. Keep the existing `send(...)` text wrapper; add `sendSticker(...)`. Pending sticker rows show the catalogue label and retry the same ID/reply/clientId. Do not clear or rewrite the actor’s text draft when a sticker is picked; preserve the 500-codepoint draft and prefill behavior.
8. Add a shared-client authority generation. Capture it in `sync`, `openThread`, `markRead`, and `deliver`; after every await, discard results when generation changed. Increment it before `resetSocial` clears state. The sticker picker also captures actor + conversation, closes on either change, and ignores a late lazy import/send completion. This is required to keep an old actor’s acknowledged sticker out of the new actor’s cache.
9. In Composer, lazy-load a mobile bottom sheet/grid only after “Stickers” is pressed. Use 44px controls, visible text labels, keyboard list/grid semantics, Escape/close, focus return, and SVG `role="img"`/`aria-label`. In MessageBubble, lazy-load the same artwork renderer only when a sticker is present. The SVG/path artwork is new and first-party; do not import or alter phone 3D art.

## Proposed disjoint ownership whitelist

New files owned by the sticker unit:

- `src/types/message-sticker.ts`
- `src/app/features/messages/stickers/StickerArtwork.vue`
- `src/app/features/messages/stickers/StickerPicker.vue`
- `src/app/features/messages/stickers/StickerMessage.vue`

Existing files the unit must own while integrating:

- contracts/persistence/service: `server/types.ts`, `server/social/service.ts`, `server/growth/message-push.ts`, `src/types/social.ts`
- retry/fencing: `src/game/social-model.ts`, `src/app/features/social/socialClient.ts`
- message UI/projections: `src/app/features/messages/MessagesApp.vue`, `Composer.vue`, `MessageBubble.vue`, `PinnedMessages.vue`, `messagePins.ts`, `messagePinsFrame.ts`, `messagesThread.ts`
- focused proof only: `server/social.test.ts`, `server/chat.test.ts`, `server/message-push.test.ts`, `src/game/social.test.ts`, `src/app/features/social/socialClient.test.ts`, `src/app/features/messages/messagesComponents.test.ts`

No ownership is required in `server/routes/social.ts`, `server/ws/social.ts`, Node/Worker store adapters, panel registration, picture/voice modules, Family, money, budgets, general store semantics, or phone 3D artwork. If implementation discovers one is required, stop and re-scope instead of widening silently.

## Required proof and unresolved decisions

- Focused tests: valid/invalid catalogue ID; same-ID duplicate; different intent conflict; retry after delete returns the tombstone; membership/block/house behavior; pin/quote/summary/push labels; edit/forward refusal; old-actor late send/history response ignored; draft remains intact; picker focus/labels; lazy module absent before activation.
- Persistence proof must exercise one Node restart and one Worker Durable Object restart using the existing social collection, with no sticker blob table. Then run the project’s normal TypeScript, focused messaging, build, startup-budget, and mobile-native accessibility gates. None was run in this review.
- Astra must decide stranger/house availability, notification wording, catalogue art/text suitability, and whether fixed first-party stickers require any new report/moderation surface. This report makes no privacy, consent, household, or activation approval.

## File hashes at the inspected pin

- `server/types.ts` `d391f5d9b16a5ae53b2cb67f4d01ffa7078095b224adf9eb214bdb0fe9d85b4b`
- `server/social/service.ts` `d8532e16cfd49f5e3fd4df77804cbff3ba518ac3725a65c1800da3232da61e6a`
- `server/routes/social.ts` `d4cf9be06ad354bcb2611203c40597a399d8a758725de507d330cbe952b2df9a`
- `server/ws/social.ts` `f24e6bcea7d38ed009920823def55accef0caa86e9fa7df259ec8b3878527e3d`
- `server/growth/message-push.ts` `7f3082edf0a953f18e800bb718b403a557cd37795aad71d1002fc59a8a861f17`
- `server/server.ts` `c551d2a3f1b157b908cbc7ab6dc57d993019d43cf73494bb0f5cf9e49722d5e7`
- `deploy/cloudflare-worker.ts` `b53d611a9d3cf71c400a186eef8aa8c0495dce7df14c6623ada4ca42d68a6982`
- `deploy/sqlite-store.ts` `a54149ccc1f4f1a4db69379a041b0fcd7c90f5830fbcbe7393d261c690f58b5d`
- `src/types/social.ts` `333487defca0f0e7f3f916e56ca0f907a7cbfb617a173c01640e0b5f62d3bd7e`
- `src/game/social-model.ts` `fcd7125d97deea81daa3b8564ffcebbf4a5756e034b9444e05b9dca270b67837`
- `src/app/features/social/socialClient.ts` `2c7ffae30671f1ad8b520c731d2960df14e120c35a74752d9b3e6122739cb092`
- `src/app/features/messages/MessagesApp.vue` `3917d57bcc88f023edc2d5a4d05ed63d34967b650163ccff3b79697160b7923a`
- `src/app/features/messages/Composer.vue` `8e8bc0164bb8e4c15f0d70f70108266cbfc77d01a1a2b3a2f550a6b6d4845400`
- `src/app/features/messages/MessageBubble.vue` `c2a36fbbbad1c725f414677680ab052aecf68b8fc78fb3d1f6689f1a88a19503`
- `src/app/features/messages/messagePins.ts` `6194259c60027837a6db1db6c9311a129594fe9d5cc913087e919cd01a474339`
