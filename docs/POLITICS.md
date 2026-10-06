# Politics

Players run for office, make rules that bind other players, and the arms of government enforce them. Everything is paid in in-game naira; there is no real-money path. Parties, officials and offences are fictional: no real party, person or case appears anywhere.

This is the design and the order it ships in. Status marks: **built**, **next**, **later**.

## 1. Offices

| Tier | Seat | Voters | Weekly term |
| --- | --- | --- | --- |
| City | Chairman of the city's local government (the seat the cities already elect each week) | residents of the city | yes |
| State | Governor | residents of any open city in the state | yes |
| Nation | President | every resident in the country | yes |

One cycle for all three, the one the city election already uses (Lagos time): Monday to Wednesday nominations, Thursday to Saturday voting, Sunday results, and the winner's seven-day term begins at 00:00 on Monday. Nothing runs on a timer: the sitting officeholder and the tally are derived from the stored ballot every time they are read.

A player can hold one seat at a time per tier, and may stand in all three in the same week. The same eligibility applies as today (days lived in the city, days of paid work, a filing fee that is not refunded), with a larger fee for a wider seat. The existing limit of votes per network address applies to every tier.

When nobody stands, or nobody votes, the seat is empty and the defaults in section 4 apply: the world never stalls.

## 2. Parties

Anyone can found a party (a name, a colour, a motto, a fee), so an individual who wants their own banner has one. A player belongs to at most one party; a candidate stands under their party or as an independent. The ballot shows the party. Names pass the same filter as advert text (no blocked term, no link, no contact detail) and are unique.

## 3. Rules that bind other players

A rule is not free text. It is a **decree**: a lever from a fixed menu, set within limits the game writes into its constitution (`src/game/content/politics.ts`). The sitting officeholder sets the levers for their own term. A decree lasts for that term; when the term ends the levers go back to their defaults until the next officeholder sets them. Every decree is public, with who set it and when.

The constitution rules out: targeting a named player, a place of worship, a tribe or a religion; confiscation; and any value outside the lever's range. A lever can only be a number from the menu, so none of this can be broken by wording.

Levers, by seat:

| Seat | Lever | Range | Effect |
| --- | --- | --- | --- |
| City | Market levy | 0–10 % | added to every stall purchase in the city; goes to the city treasury |
| State | Sales tax | 0–10 % | added to every stall purchase in the state's cities; goes to the state treasury |
| Nation | VAT | 0–15 % | added to every stall purchase in the country; goes to the federal treasury |
| Nation | Trade duty | 0–25 % | added to the cost of goods bought to carry between cities; goes to the federal treasury |
| City / State / Nation | Offence penalties | see section 5 | how long, how much (justice) |

Defaults are 0 %: with no officeholder nothing changes from how the game plays today.

## 4. Treasuries

Each seat has a treasury: a whole-naira balance and a public ledger of every credit and debit. Levies and fees fill it. An officeholder draws a weekly salary of at most a fifth of the treasury (never more than a cap) and may fund the justice budget. Money in a treasury is money taken from players, so the sums are counted with the rest of the money in circulation.

## 5. Justice

Players can fight each other and can break the law; the arms of government answer. **Built:** fights, offences, police, arrest and jail. **Later:** courts, lawyers, appeals.

- **Fights.** On another player's card, in the same public place, a player can press Fight. The server decides it: the fitter player usually wins, both lose energy (the loser more, and is left in a bad mood for an hour), and the fight is an *assault* on record for 24 hours. Limits that hold whoever is in office: a player who has lived in the city less than a day cannot fight or be fought; one fight every five minutes, and the same pair only every half hour; nobody is fought at home, offline, in another place, or when blocked; a fighter needs some energy left.
- **Police.** The sitting officeholder of a seat enrols players as officers (city 3, state 8, nation 15). An officer serves only until that officeholder's term ends, so a new term means new decisions. An officer acts in their seat's reach: a city's police in that city, a state's anywhere in the state, the federal police anywhere.
- **Arrest and jail.** An officer standing in the same place as the offender arrests them for an open offence. The sentence is the *assault sentence* lever of the officer's seat (city 1–60 minutes, state 1–120, nation 1–240; defaults 10, 15, 20) and never more than four hours. A jailed player cannot travel, work or fight; they can still message, call and use the Phone. An officer can make six arrests an hour; an offence is acted on once.
- **Checks.** Everything is public to the player concerned: the offender sees they are wanted, is told of the arrest and sees the time left.
- **Courts (later).** Lawyers represent a charged player; judges, appointed by the officeholder, hear a case and decide. A judgement can be appealed once, to the next tier up. Courts can strike down a decree that breaks the constitution.
- **Corruption (later).** Officials can skim the treasury, with a risk of audit and impeachment.

## 6. Order of work

1. **Offices and parties.** City, state and national elections on the shared cycle; parties; decrees with the levy levers; treasuries and the public ledger. **next**
2. **Justice.** Fights, offences, police, arrests, jail. **built**
3. **Courts.** Lawyers, judges, appeals, audits, impeachment, assemblies. **later**

## 7. Where things live

| What | Where |
| --- | --- |
| Constitution: every limit and price | `src/game/content/politics.ts` |
| The shared record: scopes, parties, decrees, treasuries | `server/politics/` (collection `politics`) |
| Elections | `server/civic/elections.ts`, used by every tier |
| Routes | `server/routes/politics.ts` under `/api/politics/` |
| The Phone app | `src/app/features/politics/` |
| Wire types | `src/types/politics.ts` |
