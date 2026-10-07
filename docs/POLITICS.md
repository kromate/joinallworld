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

### Assemblies

Each seat has an assembly beside its officeholder: a city council (up to 2 members), a state assembly (4) and a National Assembly (6). Nobody votes for it separately. It is filled by the **runners-up of the same weekly election**, best first, each with at least one vote, so a quiet week simply has a small one and a seat won with nobody else standing has none. An election that did not reach its quorum seats nobody. The assembly sits for the whole term, even if the officeholder is removed by petition.

- **No assembly: no change.** A seat without members lets its officeholder decree directly, as in the table above.
- **With an assembly, a rule changes only by a bill.** The officeholder or any member proposes setting one lever to a value inside its range (a term allows 8 bills; a newer bill on a lever replaces the open one). Members vote once each; the officeholder does not vote.
- **The officeholder's bill** passes with a majority of the assembly (more than half of its members). The members who vote against can stop it.
- **A member's bill** passes with two thirds of the assembly (never fewer than two members), or with a majority and the officeholder's signature. The officeholder can veto it, which ends it. A lone member can never pass a law alone: with an assembly of one, a member's bill needs the signature.
- **A bill that can no longer pass fails** at once (even every vote still to come would not reach a majority).
- **A law holds for the term**, whoever then sits, and ends with it. Laws go where decrees go (levies, sentences, bail) and are written to the public record as *law* entries with the vote.

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

## 6. The public record, and trust

What a government did must be easy to read and hard to change. That is most of what makes a world worth belonging to, and it is the part a copy cannot bring along.

- **The Hall of Records.** Every finished term (who won, how many voted, their party, whether the election counted or was void, whether they were removed), every ruling, every removal by petition, every party founded and every action of the operator is written once to a public list. Nothing is edited or removed. It holds names and counts only: never who voted for whom. Anyone can read it without signing in: `GET /api/world/records` (filter by `scope` and `kind`, page back with `before`), and `GET /api/world/records/proof` for the seal. In the game it is Politics → Records, or the address `/records`.
- **Sealed.** Each entry carries the SHA-256 of the one before it and of its own facts (`src/records/chain.ts`). Change, remove or reorder any entry and every later seal stops matching. The Records screen checks what it was shown in the player's own browser and says so; anyone can run the same check on the JSON. The newest seal is published, so a player or a journalist can keep it and later prove the past was not rewritten.
- **Written as it happens.** Terms are written lazily: a seat's ended terms are written the next time anyone passes through its city's civic pulse, and always before a new candidacy could prune old ballots (ballots are kept eight weeks). Nothing runs on a timer.
- **The operator is on the record too.** In Admin → World → Government an operator can remove an officeholder for the rest of the term (they type the holder's name), release a jailed player, or dismiss an officer or judge. Each needs a reason of at least ten characters. Each is written to the admin audit log and to the public record as an *operator* entry that names the action, the person and the reason. The operator cannot rewrite a past entry. The dashboard has a Government card: seats held, petitions, audit warnings, money in the treasuries, people in jail, open offences, officers and judges, and the number of records.
- **One calendar.** The Politics screen shows one weekly cycle for city, state and nation (nominations Monday to Wednesday, voting Thursday to Saturday, results on Sunday), and every resident's Updates carry the election news of all three seats, once each.

## 7. Order of work

1. **Offices and parties.** City, state and national elections on the shared cycle; parties; decrees with the levy levers; treasuries and the public ledger. **next**
2. **Justice.** Fights, offences, police, arrests, jail. **built**
3. **Courts.** Judges, lawyers, bail, appeals. **built**
4. **Checks on the officeholders.** Grants, audits, impeachment, and assemblies that pass laws by vote. **built**

## 8. Where things live

| What | Where |
| --- | --- |
| Constitution: every limit and price | `src/game/content/politics.ts` |
| The shared record: scopes, parties, decrees, treasuries | `server/politics/` (collection `politics`) |
| Elections | `server/civic/elections.ts`, used by every tier |
| Routes | `server/routes/politics.ts` under `/api/politics/` |
| The Phone app | `src/app/features/politics/` |
| The public record: chain, store, archive, routes | `src/records/chain.ts`, `server/records/`, `server/routes/records.ts`, `src/types/records.ts` |
| The operator's government tools | `server/admin/politics.ts`, Admin → World → Government |
| Wire types | `src/types/politics.ts` |
