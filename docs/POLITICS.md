# Politics

Players run for office, make rules that bind other players, and the arms of government enforce them. Everything is paid in in-game naira; there is no real-money path. Parties, officials and offences are fictional: no real party, person or case appears anywhere.

This is the design and the order it ships in. Status marks: **built**, **next**, **later**.

## 1. Offices

| Tier | Seat | Voters | Weekly term |
| --- | --- | --- | --- |
| City | Chairman of the city's local government (the seat cities already elect each week; a city may give it its own title) | residents of the city | yes |
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

## 4. Treasuries, grants, audits and impeachment

Each seat has a treasury: a whole-naira balance and a public ledger of every credit and debit. Levies, filing fees, court fees and bail fill it. The officeholder may draw a salary of at most a fifth of the treasury (never more than a cap), once a term.

- **Grants.** The officeholder can also pay a grant out of the treasury to a resident who has lived in the city a day, for a purpose written in the open (3 to 80 characters). A grant is at most 30% of the treasury and never above the seat's salary cap; a term allows five, and a player gets one. Every grant is public.
- **Audits.** Any resident can ask for an audit of the sitting officeholder's term, at most every ten minutes per seat. It reports what came in, what was drawn as salary and what was granted, and warns when the numbers alone look wrong: *concentration* (more than half of the money granted went to one person, with at least two grants), *party favour* (more than 70% went to the officeholder's own party), or *drained* (salary and grants took over 90% of what came in, once at least ₦1,000 came in).
- **Impeachment.** Residents can sign a petition to remove the sitting officeholder, but only after an audit of that term has warned of something. It takes more than half of the votes the officeholder won, and never fewer than the seat's quorum. A signer has lived there a day and been paid for work on two days, and signs once. When the last signature lands the officeholder is removed at once: the seat is empty, their decrees lapse, and the police and judges they enrolled lose their posts, until the next election. A petition and an audit belong to one term.

Money in a treasury is money taken from players, so every amount in and out is counted and shown.

## 5. Justice

Players can fight each other and can break the law; the arms of government answer. **Built:** fights, offences, police, arrest, jail, bail, courts, lawyers and one appeal. **Later:** audits and impeachment.

- **Fights.** On another player's card, in the same public place, a player can press Fight. The server decides it: the fitter player usually wins, both lose energy (the loser more, and is left in a bad mood for an hour), and the fight is an *assault* on record for 24 hours. Limits that hold whoever is in office: a player who has lived in the city less than a day cannot fight or be fought; one fight every five minutes, and the same pair only every half hour; nobody is fought at home, offline, in another place, or when blocked; a fighter needs some energy left.
- **Police.** The sitting officeholder of a seat enrols players as officers (city 3, state 8, nation 15). An officer serves only until that officeholder's term ends, so a new term means new decisions. An officer acts in their seat's reach: a city's police in that city, a state's anywhere in the state, the federal police anywhere.
- **Arrest and jail.** An officer standing in the same place as the offender arrests them for an open offence. The sentence is the *assault sentence* lever of the officer's seat (city 1–60 minutes, state 1–120, nation 1–240; defaults 10, 15, 20) and never more than four hours. A jailed player cannot travel, work or fight; they can still message, call and use the Phone. An officer can make six arrests an hour; an offence is acted on once.
- **Checks.** Everything is public to the player concerned: the offender sees they are wanted, is told of the arrest and sees the time left.
- **Bail.** Each seat has a bail lever (city up to ₦5,000, state ₦20,000, nation ₦50,000; default 0, which means none). A jailed player can pay the bail set by the seat that arrested them and go free at once; it goes to that seat's treasury.
- **Courts.** A jailed player can appeal the arrest for a small court fee (₦500, into the arresting seat's treasury), with a statement and, if they choose, a lawyer. A judge of that seat's court reads the case and rules: uphold (the sentence stands), reduce (half of the time left comes off) or quash (the player goes free), and gives public reasons. A judge is enrolled like police (city 2, state 4, nation 6) by the officeholder, for their term, and can never rule on a case they are part of. After a ruling that is not a quash, the defendant can take the case once to the next court up (city to state, state to federal) for ₦1,500; that ruling is final. Rulings are public.
- **Lawyers.** Any player can list themselves as a lawyer (the bar holds 40). A defendant names one when appealing; the lawyer files one written argument. The fee is agreed in chat; the game does not move it.

## 6. Order of work

1. **Offices and parties.** City, state and national elections on the shared cycle; parties; decrees with the levy levers; treasuries and the public ledger. **next**
2. **Justice.** Fights, offences, police, arrests, jail. **built**
3. **Courts.** Judges, lawyers, bail, appeals. **built**
4. **Checks on the officeholders.** Grants, audits, impeachment. **built**. Assemblies that pass laws by vote. **later**

## 7. Where things live

| What | Where |
| --- | --- |
| Constitution: every limit and price | `src/game/content/politics.ts` |
| The shared record: scopes, parties, decrees, treasuries | `server/politics/` (collection `politics`) |
| Elections | `server/civic/elections.ts`, used by every tier |
| Routes | `server/routes/politics.ts` under `/api/politics/` |
| The Phone app | `src/app/features/politics/` |
| Wire types | `src/types/politics.ts` |
