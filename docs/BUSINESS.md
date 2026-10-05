# Businesses

A player can rent a stall at a market in any open city, stock it, price it and sell to the city's passers-by and to other players. This document is the design and the numbers. Everything is paid in in-game naira through the wallet ledger; there is no real-money path.

| What | Where |
| --- | --- |
| Every number: types, products, costs, caps | `src/game/content/business.ts`, `src/game/content/business-limits.ts` |
| The shop rules (demand, accrual, reputation, rent, closing) — pure | `src/game/business-model.ts` |
| The life's side: paying, collecting, buying, the goods bag | `src/game/systems/business.ts` |
| The shared record and the routes | `server/business/service.ts`, `server/routes/business.ts`, `server/routes/business-mod.ts` |
| The Phone app and the venue button | `src/app/features/business/`, `src/app/features/venue/VenuePanel.vue` |
| The wire types | `src/types/business.ts` |
| The simulation | `scripts/economy-sim.ts` (section "Businesses"), `npm run economy` |

## 1. The shape

**A shop is shared state, not part of a life.** One record per owner in the `business` collection: where it is, its stock, prices, cash box, reputation and rent. A life keeps only its own counters (`state.business`): shops opened, sales collected, what it spent at other players' shops, and the goods it carries. This is why another player can buy while the owner is offline, why two buyers cannot both take the last item (transactions run one at a time on one record), why every device of the owner sees the same shop, and why the shop keeps trading when its owner travels.

**Nothing runs on a timer.** A record stores the time it was last brought up to date (`at`). Reading a shop computes what the passers-by bought since then from timestamps and writes nothing. A write happens only when a player does something: opens, stocks, prices, collects, buys, rates. A poll never costs a row.

**Money moves through the rules engine only.** The route checks the shared record, then runs the server-only action `business.server` on the caller's settled life inside the same transaction and under the same receipt (`ctx.once`), so the charge and the record change are saved together or not at all, and a repeated request is answered with the first outcome.

## 2. Where and what

A venue hosts stalls when its scene kind is `market`: every open city has at least one, so businesses exist everywhere from the first day and a new city gets them without a table of its own. `BUSINESS_VENUES` adds what a market is known for (those types draw 20% more customers), its footfall and its number of stalls (12 unless it says otherwise).

Four types, each with a short menu:

| Type | Setup | Rent a week | Customers a day | Holds | Products |
| --- | --- | --- | --- | --- | --- |
| Food stall | ₦15,000 | ₦7,000 | 30 | 40 | jollof, the city's own plate, puff-puff |
| Provisions kiosk | ₦12,000 | ₦6,000 | 36 | 60 | bread, zobo, soap, smoked fish |
| Fabric stall | ₦25,000 | ₦8,000 | 5 | 12 | ankara, adire, aso-oke, indigo cloth |
| Crafts stall | ₦20,000 | ₦7,000 | 6 | 14 | clay pot, leather sandals, embroidered cap, woven basket |

The owner names the stall (3 to 24 characters, through the same filter as ad text: no blocked term, no link, no contact detail) and picks one of the ad colours and one of the type's icons. No uploads.

One business per player.

## 3. Running it

- **Stock** is bought from the market's supplier at 60% of a product's base price, up to what the stall holds. In the city a product comes from (adire in Abeokuta, aso-oke in Ibadan, indigo cloth, leather and caps in Kano, clay pots in Abuja, ankara in Lagos, smoked fish in Port Harcourt) it costs 45%. An owner in such a city can buy up to 16 units into a goods bag, travel, and stock their own stall from the bag. The bag, the fare, the stall's capacity and the customers-a-day figure bound what a trip can make.
- **Price** is set per product between 70% and 140% of its base price. At the base price every interested customer buys; at 120% seven in ten do, at 140% three in ten; at 70% a quarter more come.
- **Customers** arrive only during trading hours (the venue's, or 07:00–20:00), more at the hours a type is busy. How many: the type's figure × the market's footfall × known-for bonus × reputation × upgrades. A customer chooses among what is in stock; a narrow range still serves a little over half of them.
- **The cash box** holds the takings until the owner collects them, from anywhere. It stops filling from passers-by at ₦50,000.
- **Reputation** is 1 to 5 stars and starts at 3. At the end of each trading day it rises when at least four in five customers were served, and falls when fewer than two in five were — an empty or overpriced stall. A buyer's rating moves it a tenth of the way to that rating. Stars scale customers from ×0.75 to ×1.25.
- **Food spoils**: 30% of unsold food is lost at midnight (10% with the cooler).
- **Upgrades**, once each: a shop front (₦40,000: holds half as much again, 40% more customers, rent ×1.5), a better display (₦15,000: 10% more customers), storage (₦10,000: holds half as much again; for food, the cooler).
- **Rent** is paid a week ahead. When a week runs out the next is taken from the cash box. If the box cannot cover it the stall shuts — it sells nothing — and the owner has three days to pay from their wallet; after that the market closes it: stock is bought back at half its cost and that, with whatever is in the box, waits for the owner for 30 days.
- **Closing** by choice returns half of the setup and upgrade costs, half the cost of the stock and the whole cash box.

Being away: collecting, paying rent and closing work from any city. Opening, stocking, pricing and upgrading need the owner at the market.

## 4. Other players

At a market, "Shops" lists every stall there with its stars, its menu and its owner. A player standing in that market can buy up to three of a product at the shop's price; the buyer gets what the product does (a meal restores hunger, soap hygiene, cloth and crafts a mood lift that lasts half a day), the cash box gets the price, and the owner gets a line in Messages → Updates ("Bola bought 2 × Jollof rice at Mama Put"). After buying, the buyer may rate the stall once. The shop card opens a chat with the owner. A player who has blocked the owner, or is blocked by them, sees no Buy and no Chat.

## 5. Why this cannot be used to move money

A gift between players is limited to money earned from work (`TRANSFER_LIMITS`). A purchase is a second way for naira to pass from one player to another, so it carries the same idea and tighter numbers:

- The buyer must have earned ₦1,000 from paid work, and a life can never spend more at players' shops than it has earned from work. Start cash, gifts and prizes cannot be passed on through a shop.
- A purchase delivers something: a product that restores a need cannot be bought when that need is already full, and a mood item cannot be bought while its mood lasts.
- The price is the shop's, inside the 70–140% band; the owner paid 45–60% of base for the item, so at most a little over half of what a buyer pays is the owner's gain.
- ₦5,000 and six items a day from one buyer at one shop; ₦8,000 and eight purchases a day for a buyer in total; ₦15,000 a day of player sales for a shop. Buyers who share a network address share one buyer's allowance at a shop. A buyer on a device the owner has used is refused.
- Shop takings never count as earned from work, so owning a shop does not raise what its owner may give away.
- Nothing flows to the buyer but the product's effect: there is no resale.

## 6. The faucet

Passers-by are the one source of new naira here. A stall's customers a day are a fixed figure times bounded multipliers, so a day's takings have a ceiling that does not depend on how long anyone plays. `npm run economy` plays a diligent owner, an absentee, a price gouger, a trader who sources across cities and two colluding players, and prints what each made beside a career; `src/game/economy.test.ts` asserts the bounds.

## 7. Stored data

- `state.business` (additive; a life saved before it loads with zeros): `{ opened, sales, spent, buys: { day, spent, count }, bag }`.
- `db.business` (created by the first shop): `{ v: 1, shops: { [ownerId]: shop }, reports: [] }`. A shop holds public ids and names only.
- A new update kind, `business`, in Messages → Updates.

## 8. Moderation

A stall's name passes the text filter when it is given. Anyone can report a shop (`POST /api/business/report`); the operator lists reports, replaces a name with a neutral one, or closes a shop with the owner's refund (`/api/mod/business/…`), and each of those is written to the moderation audit and told to the owner.

## 9. Not in this version

Hiring a friend as attendant; a second business; the stall's name drawn in the scene; shops in venues other than markets; gift-wrapped purchases for another player; a city-wide shop directory with travel directions.
