# The launch bonus

The first N players to sign up are given naira **in the game** (there is no real money in the game). Code: `server/bonus/service.ts`, routes in `server/routes/bonus.ts`, the page in `src/app/features/bonus/`.

## Who, and when

* An **account** (Google, or e-mail and password with a verified address), never a guest: guest sessions are free and unlimited, so a script could spend every place in minutes.
* A guest who signs up is paid at that moment. An account that already exists is paid the next time it opens the game. Guests are shown an invitation.
* **One per account, ever.** The marker is on the account record, so another device, another character, a restored character or signing in again can never pay twice. A salted hash of the account id is also kept, so an account that is deleted and made again does not claim a second time.
* A banned account gets nothing.

## Settings

Read on both hosts like other optional settings, and the first three are also settings of the admin screen (Settings), so the campaign can be paused or changed without a release.

| Setting | Default | |
| --- | --- | --- |
| `LAUNCH_BONUS` | `on` | `off`: no new place is given. Places already reserved are still paid. |
| `LAUNCH_BONUS_AMOUNT` | `1000000` | naira each; applies to places taken from then on |
| `LAUNCH_BONUS_PLACES` | `10000` | when this many accounts have claimed, the offer ends for everyone |
| `LAUNCH_BONUS_PER_ADDRESS_DAY` | `20` | payments a day from one network address (IPv4, or IPv6 /64) |

The admin dashboard shows places taken and left (`registerAdminStat`). To reverse a bonus use the ordinary admin debit.

## The money

Credited through the rules engine by the server-only action `wallet.bonus`: one ledger line, "Launch bonus: one of the first 10,000 players", so cash always equals what the life started with plus its ledger. It is a faucet in the economy checks. It is **not** earned from work: it unlocks no gifting and no buying from players. The ride-home debt takes no share of it (only the whole-debt rule of `src/game/relief.ts` can clear a debt that cash comfortably covers).

## One transaction

Account, not already claimed, counter below the places, counter + 1, credit the account's current character, write the marker `{ at, amount, n, held?, told? }`. The store serialises transactions on both hosts, so two devices at once, a replay, and the last place racing the one after it come out exactly right.

## Held, not lost

The place is reserved the first time the account asks (so nobody is told "you got it" and then loses it). The money waits, and a later call pays it, when:

* the account has no started character yet (`held: 'character'`), or
* `LAUNCH_BONUS_PER_ADDRESS_DAY` payments were already made from the network address today (`held: 'address'`). A campus or shared network is slowed, never locked out.

Disposable e-mail domains are not blocked in this version.

## Stored data (additive)

`account.bonus`, the collection `launchBonus` (`{ claimed }`), the collection `launchBonusSeen` (`{ ids }`), and limiter keys `bonus:address:*` and `bonus:ask:*`. Accounts without them load unchanged.

## Routes

* `GET /api/world/bonus` is public: `{ on, amount, places, left }`, cached 45 seconds. `left` is rounded down to a multiple of 10 above 100 and exact at 100 or fewer.
* `POST /api/account/bonus` is the caller's own bonus: `{ state: 'none' | 'ended' | 'held' | 'paid', amount, n, places, held?, show }`. `show` is true once, for the moment; send `seen: true` when it has been shown.
