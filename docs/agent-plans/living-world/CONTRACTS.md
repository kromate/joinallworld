# Programme contracts, version 1 proposal

Phase 0 contract boundary. These examples are internal proposals, not deployed routes or provider operations. Implementation must validate untrusted fields before using these types. Sol owns shared registrations, persistence wiring, event unions and release integration; a worker owns only its named new files.

## Active driving

The driver sends controls, never coordinates, checkpoint counts, score or a passed flag:

```json
{"journeyId":"server-issued","routeVersion":"authored-course-v1","sequence":12,"frames":[{"throttle":0.3,"brake":0,"steer":-0.2}]}
```

Each frame is a fixed 100 ms step. At most five frames per packet; only server elapsed-time credit permits simulation. Reject nonfinite controls, unexpected fields, duplicate/conflicting sequence, impossible time catch-up and another actor's journey. The server computes metre position, speed, heading, ordered checkpoints, off-road/speed-limit violations and required stops. A stop is an actively reached checkpoint and stationary dwell, not a passive mission timer. Assessment criteria and route version are authored server-side. Paused/background/offline input stops safely; reconnect cannot replay held acceleration.

Pure module proposed exports: `DrivingInput`, `DrivingState`, `DrivingRoute`, `createDriving`, `stepDriving`, `pauseDriving`, `readDrivingState`. Rule module accepts no clocks, DOM, RNG, network or wallet. A route is versioned, bounded road polylines plus ordered checkpoint/stop zones; authored training geometry is labelled as such. Consume actual street metre/tile/door geometry through an adapter for later city driving. A standalone fixture alone does not accept district driving.

Visuals reuse `buildVehicle`/`poseVehicle` and published driver/door/seat anchors. Door opening, entering, seated steering, braking and exit are animated under a bounded host demand loop. Visual interpolation/prediction cannot award a qualification or advance a parcel. Reuse the canonical avatar, complete look and disposal lifecycle; avoid a second character family. Keyboard and touch controls include steering and separate throttle/brake. Lazy renderer/panel assets preserve existing budgets.

## Qualification and permission

Qualification: `{id, version, evidenceJourneyId, earnedAt, status}`. Permission: `{id, actor, resourceId, scope, qualificationVersion, issuedAt, expiresAt, status}`. A simulated road-test qualification is earned from terminal server assessment, once for that evidence. Vehicle ownership and grant remain distinct. Starter practice/rental requires no money/collateral. Departure, collection and delivery recheck actor, current qualification, grant, vehicle and route version. Expiry/revocation pauses at a safe position with explicit recovery; no stale client keeps authority.

## Stock and parcel settlement

Shared domain record: `{id, version, city, origin, destination, product, quantity, reward, carrier, custody, status}`. States: offered → accepted → collected → delivered; cancelled/expired are terminal. Recorded offer terms cannot be overwritten by client-supplied stock/reward. Acceptance reserves one carrier; collection binds custody. Delivery requires authoritative destination proximity and current permission. In one existing store transaction: verify terminal state and expected version, add the exact stock to the existing shop, credit through the wallet API, mark delivered, emit one event. Never mutate cash directly or pay from mission listeners a second time.

Request receipts provide lost-response retry/conflicting payload behavior. Persisted terminal state provides uniqueness with new IDs, after 24-hour receipt expiry and host restart. Cancellation racing delivery has one valid terminal winner. Unavailable/closed shop returns a recoverable decision without inventing stock; abandonment releases the resource according to explicit terms. NPC suppliers/customers keep the same rules usable alone. Outcomes are acknowledged only after durable commit succeeds; canonical server-only `ctx.act` updates life/wallet authority within the transaction.

Example committed observation: `{schemaVersion:1, eventId:"delivery:server-id:1", aggregateVersion:4, kind:"living-world.delivery.completed", quantity:3, gameReward:120}`. This is fictional gameplay, not real earnings proof.

## Barber consent and participation

Service grant: `{id, barber, customer, body, styleId, catalogueVersion, appearanceFingerprint, gamePrice, expiresAt, consentGeneration, status}`. Customer approval is for an exact preview and price; the barber cannot pass arbitrary appearance JSON. Revalidate approved catalogue/body style, unchanged canonical appearance fingerprint, current grant and presence before committing through existing wardrobe/appearance authority. There is no existing monotonic appearance version: bind consent to a canonical complete-look fingerprint until an additive version contract is integrated. Decline, departure, revoke and precommit disconnect cancel without applying/changing cash. Commit appearance + agreed simulated payment + terminal appointment in one transaction through a checked server-authorized wardrobe service action. Duplicate completion cannot restyle/repay; reconnect after commit returns the canonical committed result.

Apprenticeship requires active choices and controlled tools on consenting NPC practice. Tool upgrade spends earned game cash through the wallet once and unlocks one named approved practice style; upgrade, NPC result, service progress and wardrobe ownership survive reload. NPC practice appearance is explicitly distinguished from another real player's appearance. No simulated barber credential implies a real qualification.

## Save compatibility, sync and failure

Additive `livingWorld` life slice defaults to empty v1 progress; no global save-version bump or namespace replacement. Sanitization must bound arrays/maps and validate every nested number/string/reference. Shared records use an additive named collection; old saves remain readable. No migration resets a balance, receipt, appearance, existing business or gameplay slice. Test interrupted storage writes/response loss, sanitizer round trips and restart on Node and Worker. Older core-only rollback may discard newer fields: prefer reviewed forward fixes until data-compatible rollback is proven.

Disabled external capability: status explicitly says unavailable; no transport, credential read or external write. Proposed internal sync takes only typed minimal game observations with stable connection/workspace mapping and consent generation. Outbox dispatch/reconciliation rechecks consent; disconnect cancels queued exports, reconnect creates a new generation with no old replay. External completion cannot pay a game reward. Provider operation names/schema/permissions come only from separately verified authorized contracts. Commerce, real NGN and Goalmatic usage credits remain separate domains.

Canonical committed source-event reference is unique even if a caller changes observation ID, kind or aggregate version. Every dispatch lease persists a monotonic attempt version; results and authoritative reconciliation must match that exact attempt. Lost/expired leases remain uncertain until that attempt is reconciled. Provider output is untrusted and malformed receipts cannot change queue state. Oversized or malformed saved sync data must be quarantined unchanged, with exports unavailable; never reset it into active consent. A future dispatcher must recheck persisted consent immediately before transport and use verified provider idempotency, because local attempt fencing cannot undo a request already sent.

## Bounded acceptance

Use A1–A10 in PHASES.md. First implementation batch is active driving foundation plus its authority and mobile control contract; final district acceptance still requires the complete school/rental/restock/barber/earn/improve/reload loop. Every unit records its level (pure fixture, Node API, Worker API, browser, physical device, staging, live) separately. No contract example is claimed to exist at any of those levels.

Explicit race cases: same driving sequence with same versus changed frames, two concurrent packets, lost reply, pause/finish/revoke race and failed durable write. Stored last packet fingerprint distinguishes a retry from conflict; stale sequences return current cursor without applying input. Simulation credit is bounded by server elapsed time and reset at pause/reconnect; clock reversal and large jumps cannot accumulate acceleration. Terminal evidence can grant a qualification only once. Map/version change pauses the trip and preserves custody for recovery.

Parcel acceptance/collection/cancellation/expiry/abandonment/delivery race with one terminal winner; stock cap/closure are checked before any credit. Two barbers cannot hold one chair/customer service; customer style changes/revocation/departure before commit reject atomically. Missing NPC appearance data leaves the service unavailable with other practice usable. Old core-only builds must not be used as rollback until additive life-field preservation is proven; preferred recovery is a reviewed forward fix.
