# Server city-isolation audit

City-local records use the validated city selected by the server. Civic residents, rich lists,
neighbours, elections, announcements, billboards, hunt totals and radio queues live under
`civic.cities[cityId]`. Table ratings and first-party growth metrics use city books. Pending table
results record the city where the match ended and can be paid only into that city's life. Share
facts keep their source city, and scheduled digests use the character's stored current city.

These records are intentionally account-global:

- Rich-list and directory privacy preferences follow the person across every city. Travelling must
  not make somebody visible after they opted out.
- The civic vote-address salt and moderation audit are server security state. Ballots and salted
  address counters remain city-local inside each election; the raw address is never stored.
- Friends, direct messages, blocks, moderation, support reports, age and analytics consent remain
  account-global. Travel must retain these protections and relationships.
- E-mail and push consent, contacts, send periods and provider caps remain account-global. Travel
  must not opt a person in twice or bypass a contact limit.
- The table pair counter is account-global. It is an anti-farming cap, so playing the same opponent
  after travel cannot earn another allowance. Ratings are city-local; payouts are exactly once.
- Share codes are global lookup keys. Their immutable facts and source `cityId` are city-bound.
- Telemetry consent is account-global. A `city_id` is added only from a registry-validated server
  response, stored character state or room key; client coordinates and unknown strings are refused.

`server/city-isolation.test.ts` exercises the owned collection boundaries with Lagos and Ibadan.
