# Accounts

An account is optional. A guest plays at once, exactly as before, with a device session and no sign-in. Signing in attaches the character to something that can be reached again: from another device, or after this device's cookie is gone.

Accounts are **off unless configured**. With no configuration the game shows no sign-in anywhere, stores nothing about accounts, and makes no request to a sign-in provider.

**Deploy gate.** Do not configure accounts on a public server until (1) this design and its code have been reviewed, and (2) **e-mail enumeration protection is ON** in the provider project (section 9, step 4). Without the second, the provider itself tells anyone who asks it whether an address has an account, whatever this server does.

This document is the design. The code is small enough to read beside it:

| What | Where |
| --- | --- |
| Who a person is (ID token verification) | `server/accounts/token.ts` |
| The welcome message of a new account | `server/accounts/welcome.ts`, `server/growth/email/templates.ts` |
| The rate limiter both hosts share | `server/limiter.ts` |
| What an account is in the store, and every change to it | `server/accounts/service.ts` |
| The routes, their guards and limits | `server/routes/auth.ts` |
| Whose session a cookie is (both hosts) | `server/protocol.ts` `sessionOfCookie` |
| Configuration, cookie attributes, the strict origin rule | `server/host-context.ts` |
| The Worker's account tables | `deploy/sqlite-store.ts` |
| The screens | `src/app/features/account/` |
| The start screens' entry | `src/app/features/start/accountEntry.ts` |
| The wire types | `src/types/account.ts` |

## 1. What it is, in ten lines

1. Sign-in is done by a managed identity provider (Firebase Authentication): **Google**, or **e-mail and password** with a confirmed address. The game never stores or sees a password.
2. The browser signs in with the provider directly and receives a short-lived **ID token**. It hands that token to the game server once.
3. The server **verifies the token itself** — signature against the provider's published keys, audience, issuer, times, subject — on both hosts, with Web Crypto. Nothing sent beside the token is believed.
4. An **account** records the provider's subject id, the verified address, how the person signed in and two times. Nothing else about the person.
5. An account has one **active character**: an ordinary session record, filed under a key no browser holds.
6. A signed-in browser holds a **device binding**: a cookie value the server made at sign-in. Several browsers can be bound to one account and play the same character. A binding plays and signs itself out; anything that reaches further needs a fresh sign-in as well.
7. **Signing in never destroys a life.** A played life that cannot be the active character is *set aside* and can be brought back; the player is shown the choice.
8. Sign-in always issues a **new cookie**, named `__Host-sid` over HTTPS so a sibling host cannot plant it. State changes need a same-origin request and the session's own anti-forgery token.
9. **Sign out** removes this browser's binding. **Sign out everywhere**, the data download, switching character and **delete** need a fresh token for the same account. When the owner arrives, earlier bindings end.
10. Everything is rate-limited, and no answer says whether an address has an account.

## 2. The provider, and why it is used this way

**A managed provider instead of a password store.** Hashing passwords well needs a memory-hard function. The Worker runtime offers PBKDF2 only, capped at 100,000 iterations — below current guidance — and a stolen data file would then allow fast offline guessing. A provider also brings what a password store would have to grow: address confirmation, reset e-mails, breach handling, abuse throttling. The cost is a dependency, and that the provider knows who signs in.

**The browser talks to the provider; the server verifies.** The alternative is for the server to take the address and password and call the provider itself. That puts every password in the game server's memory and makes every sign-in come from the server's address, so the provider's per-address abuse limits would apply to all players at once. Here the password goes from the form to the provider over HTTPS and nowhere else.

**REST with `fetch`, not the provider's SDK.** The screens need six calls (create, sign in, send the confirmation link, refresh, exchange a Google credential, delete). Written directly they are about 2 kB, fetched only when a sign-in is first sent; the SDK is many times larger and keeps tokens in browser storage, which this design does not want: here a token lives in memory for one step and is dropped.

**Google sign-in** uses Google's own button script (Google Identity Services). Google draws the button, so its appearance follows Google's rules by construction. The script is added to the page only when the sign-in screen is open and a client id is configured. The credential it returns is exchanged at the provider for the provider's ID token, so the server sees one kind of token whichever way the person signed in, and one person is one account whether they use Google or a password for the same confirmed address.

### What is fetched, and when

| When | What | From |
| --- | --- | --- |
| Start screens or Settings ask whether accounts exist | `GET /api/account` | the game server |
| The sign-in screen opens (Google configured) | the Google button script | `accounts.google.com` |
| A sign-in is sent | the provider client (own chunk), then one request | `identitytoolkit.googleapis.com` |
| "I have confirmed it" | a token refresh | `securetoken.googleapis.com` |
| The server verifies its first token (and when keys expire) | the provider's public keys | `www.googleapis.com`, from the server |
| A reset is requested | one request, in the background | `identitytoolkit.googleapis.com`, from the server |

Nothing in the first download of the page contains sign-in code; `src/app/entry.test.ts` holds that.

## 3. Configuration

Three settings. All are the provider's **public** client configuration — the browser is sent the key and the client id — and they are kept in the environment so no deployment's identifiers are in the source.

| Setting | Required | What it is |
| --- | --- | --- |
| `ACCOUNTS_FIREBASE_PROJECT_ID` | yes | The project whose ID tokens this server accepts. It is the token's audience, and its issuer is `https://securetoken.google.com/<project id>` |
| `ACCOUNTS_FIREBASE_API_KEY` | yes | The project's web API key. Sent to the browser |
| `ACCOUNTS_GOOGLE_CLIENT_ID` | no | The OAuth web client id of the Google button (`…apps.googleusercontent.com`). Without it only e-mail sign-in is offered |

The first two must both be present and well formed, or accounts stay off: `GET /api/account` answers `{ "enabled": false }` and every other account route is a 404. There is no service-account key and no server secret: verification needs only public keys.

The Node host reads them from its environment; the Worker reads them as vars. `PUBLIC_ORIGIN`, when set, is sent as the referrer of the server's reset request, so an API key restricted by referrer still accepts it.

## 4. Verifying a token

`server/accounts/token.ts`. In this order:

| Check | Rule |
| --- | --- |
| Shape | three base64url parts, at most 4,096 characters, each in its **one canonical spelling**: decoding is strict (the bytes must encode back to exactly the text given), so padding, whitespace, the standard alphabet and non-zero trailing bits are refused |
| Algorithm | the header's `alg` is exactly `RS256`. It is never taken from the key or negotiated, so `none` and HMAC-with-the-public-key forgeries stop here |
| Key | the header's `kid` names a key in the provider's published set |
| Signature | RSASSA-PKCS1-v1_5 with SHA-256 over `header.payload` |
| `aud`, `iss` | the configured project, and the token service's issuer for it |
| `exp` | in the future |
| `iat` | not in the future; at most **5 minutes** old |
| `auth_time` | not in the future; at most **1 hour** old |
| `sub` | 1–128 characters of `[A-Za-z0-9_-]` |
| Provider | `google.com` or `password`. Anonymous and custom tokens are refused, and so is any token carrying `firebase.tenant` |
| `email` | present. `email_verified` must be the boolean `true` before anything is linked |

Claims are read only after the signature has verified. A clock allowance of 60 seconds applies to the "not in the future" checks only.

**Keys** are fetched over HTTPS through the host's outbound fetch (HTTPS only, 15 seconds, no redirects), kept for the lifetime the response's `Cache-Control` gives (clamped to between one minute and one day), and fetched again — at most once a minute — when a token names an unknown key, which is how a rotation is picked up. Keys past their lifetime are not used while the provider cannot be reached. A key set that cannot be fetched is `503 accounts_unavailable`, not a verdict on the token; after a failed fetch the provider is not asked again for 15 seconds, however many tokens arrive.

**A token is used once.** What is remembered is a SHA-256 over the token's subject, its issue time and its signature's *bytes* — the signed content, not the text it arrived as — kept until the token would be refused as stale anyway. With strict decoding a token has one spelling; with this digest a second spelling could not matter if it had another. A second presentation is `401 invalid_token`, on every route that takes a token. The digest is written in the same transaction as the sign-in, so a sign-in whose write fails has spent nothing.

Every refusal — expired, wrong project, bad signature, replayed, malformed — is the same `401 invalid_token` to the browser. The reason goes to the server log as one word, without the token.

## 5. What is stored

Three collections beside the existing ones. No existing record changes shape.

```
accounts[<id>] = {
  v: 1,
  id,            // "fb:" + subject
  provider,      // "google" | "password": how the person last signed in
  subject,       // the provider's subject id, from a verified token only
  email,         // the verified address, shown to its owner in Settings; used for nothing else
  createdAt, lastSeenAt,
  sessionKey,    // key of the active character in `sessions`, or null
  publicId,      // public id of the active character
  devices,       // keys of this account's device bindings (at most 10)
  parked,        // set-aside characters: [{ id, name, at }] (at most 5)
  welcome?       // the welcome message: 'pending', when it was sent, 'failed' or 'skipped'; absent when none is owed
}
accountDevices[<cookie value>] = { account, createdAt, seenAt, expiresAt }
accountLog = { salt, seq, audit: [{ n, at, event, ref, life? }], used: { <token digest>: <until> },
               sweptAt, accounts, welcome: [{ id, at, tries, nextAt, claimedAt? }] }
```

- **No password, no ID token, no refresh token** is stored. The server never receives a refresh token.
- **The address** is kept because the person needs to see which account a device is signed in to. It is not used to contact anyone. It is the only personal detail stored; it is removed with the account.
- **The audit trail** records an event, a time and a reference (a salted hash of the account id), plus the public id of a character where one is involved. No token, address, subject id or cookie. At most 2,000 lines.
- **Device bindings** are keyed by the cookie value, as session records are. A copy of the data file therefore contains valid cookies, as it always has; see the open questions.

**On the Node host** the three are collections of the JSON document. **On the Worker** `accounts` and `accountDevices` are tables of their own (`accounts`, `account_devices`), read by key, so a request by a signed-in browser reads two rows; `accountLog` is an ordinary collection. The tables are created with `CREATE TABLE IF NOT EXISTS` beside the existing ones. A database made before them gains them empty on its next start; no existing table, index or row is touched (`deploy/sqlite-store.test.ts` starts from such a database).

Every change is one store transaction: the account, its bindings, the session records and the archive are written together or not at all.

**Both tables are bounded and swept.** At most hourly, inside a sign-in's transaction, bindings that have expired are removed, and so is an account with no live binding and no character (active, archived or set aside) — nothing anyone could come back to. The store holds at most 20,000 accounts (a provisional value); at the bound the sweep runs first, and only if nothing can go is a *new* account refused (`503 account_capacity`). Existing accounts are never refused.

## 6. Sessions

A guest is unchanged: the cookie is the key of the guest's session record.

### The cookie's name

Over HTTPS the session cookie is **`__Host-sid`** — a name a browser accepts only with `Secure`, `Path=/` and no `Domain`, so a page on a sibling host of the same site cannot set or overwrite it. It used to be `sid`, which a sibling host *can* set for the whole site. The old name is still read so that nobody is logged out:

- `__Host-sid`, when present, is the session cookie and `sid` is ignored. Two different values under *this* name are nobody's session.
- With no `__Host-sid`, the **first `sid`** is the cookie — exactly what the build before this one did, so a guest who has not been upgraded yet sees no new behaviour. It is honoured for a **guest's own session record only**, and that answer also sets it as `__Host-sid`. A guest who was playing keeps their life.
- A **device binding is honoured from `__Host-sid` only.** The same value arriving as `sid` opens nothing.

**The old cookie is kept for this release.** An upgrade sets `__Host-sid` and does *not* remove `sid`: the browser then holds both, and `__Host-sid` wins. The reason is rollback — the build before this one reads only `sid`, so if this release had to be withdrawn, every guest would still be known. `sid` is removed in one place only, when a browser signs out of an account (a signed-out browser must not fall back to whatever `sid` it still holds). **Removing `sid` for good — no longer reading it, and clearing it on upgrade — belongs to a later release**, once this one is no longer a rollback target. Until a guest's first answer from this release, a sibling host that plants a `sid` ahead of theirs can still put them in its own guest session, as it could before; after that answer it cannot.

Without HTTPS — development on plain http — a browser refuses a `__Host-` cookie, so the name stays `sid` there and is honoured for everything. The Worker host always sets `__Host-sid`.

An `Origin` header must name this host **with its scheme**: reached over HTTPS, the same host name over plain http is another origin and is refused.

A signed-in browser's cookie is the key of a **device binding**. The binding names the account; the account names its active character; the character is a session record with `account` set, filed under a random key that is never sent to any browser. `sessionOfCookie` resolves this in one place for both hosts, and refuses a cookie that names an account's character directly — so that key is not a credential even if it leaked.

Consequences:

- Several browsers can be bound to one account. They play one character, as two tabs always could.
- Removing a binding ends that browser's access at once, without touching the character.
- A binding has the same sliding 30-day lifetime as a session, and an **absolute lifetime of 90 days** from when it was made: after that the person signs in again, however often they played.
- A character nobody has reached for 30 days is archived by the existing sweep — with the city its character is in, its set-aside lives and its quick-start flag — and brought back whole from the archive at the next sign-in.
- Sockets are opened under the character's key and remember the cookie they were opened with. A socket whose binding is removed, or whose session moved, is closed (code 4401).

### Signing in

`POST /api/account/sign-in` is "save your character" and "restore your character": the same request.

| This browser has | The account has | What happens | `outcome` |
| --- | --- | --- | --- |
| a guest session | no played character | the guest's record becomes the account's character (same public id) | `linked` |
| a **played** guest life | a **played** character | the account's stays active; the guest's life is **set aside** | `parked` |
| nothing, or an unplayed session | a played character | this browser is attached to the account's character | `restored` |
| nothing | no character | signed in; the next new life becomes the account's character | `signed_in` |

"Played" is the rule the expiry archive already uses: a life whose quick start was never confirmed is not a life to keep. A guest in the middle of the quick start who saves keeps that same unfinished character.

In every case the browser gets a **new** cookie, a binding it presented is removed, and the token is spent. The answer says how many devices are now signed in (`devices`) and how many this sign-in signed out (`ended`); the screen shows both.

### When the owner arrives

A binding made earlier may not be the owner's: someone can register an address before its owner does and, if the owner then confirms it, hold a sign-in to "their" account. So a sign-in **ends every other binding** when either is true:

- it **links a character into an account that already existed** — whoever was signed in before did not bring this character; or
- it uses **another way of signing in** than the account last did (a password account signed in to with Google, or the reverse).

A sign-in that only restores, by the same way of signing in, ends nothing: an ordinary second device must not sign out the first. The provider does not put "the password was changed" in a token, so a password reset by itself is not detected; that case is covered by the count of signed-in devices on the sign-in screen and in Settings, beside **Sign out everywhere else**, and by the 90-day lifetime.

### The merge rule

When both sides have a played life, neither is destroyed and nothing is merged. The default is the safe one: **the account's character stays active, and the device's life is set aside** — moved to the existing archive, marked with the account that may bring it back, with its lives, its character record, its set-aside lives and its exactly-once receipts intact (on the Worker the receipts are rows keyed by the character's public id and simply stay where they are).

The player is then shown both characters by name and asked which to play. Choosing the other one swaps them (`POST /api/account/character`): the one that was active is set aside in its place. The swap is proved with a fresh token from the sign-in that has just happened (its refresh token is still in memory), so nothing is asked twice. The choice can be changed at any time from Settings, where it asks for the password or Google again. Closing the screen without choosing leaves the default.

An account can hold five set-aside characters. A sign-in that would need a sixth is refused (`409 parked_full`) with nothing changed: that device simply stays a guest, life intact. Only the account's own set-aside characters can be chosen; another account's, or an unowned archive entry, is `404`.

### What a binding is worth

A binding lets its browser **play the character** and **sign itself out**. Nothing else. A stolen cookie therefore cannot read the account's address, end the owner's other sign-ins, swap the character in play or delete anything.

Everything that reaches further needs **proof**: the binding *and* a fresh verified ID token for the same account, used once.

| | Binding alone | Binding and a fresh token |
| --- | --- | --- |
| Play; sign this browser out | yes | — |
| Sign out everywhere else | no | yes |
| Download the account's data | no | yes |
| Bring a set-aside character into play | no | yes |
| Delete the account | no | yes |

- **Sign out** removes this browser's binding and its cookie. The character stays with the account. A guest cannot "sign out": that would discard the only key to its life (`409 account_required`).
- **Sign out everywhere** removes every *other* binding. This browser stays signed in.
- **Delete** removes the account, every binding and every set-aside character. The active character is the player's choice: kept on this device as an ordinary guest life (a new cookie, no account), or its saved life removed. The browser then asks the provider to delete its own record of the person. **Not removed:** messages the character already sent to other players, its place in neighbourhood and other public listings, and one line in the audit trail (an event, a time and a salted reference — no address). The screen says so.
- **Export** (`POST /api/account/export`) returns everything stored about the account to its owner.

### When accounts are switched off again

A browser that signed in while accounts were configured is not stuck if the configuration is later removed: its binding still resolves, so it **keeps playing its character**; `GET /api/account` answers `{ enabled: false }` together with who it is; and **sign-out still works**. Every other account route is a 404, and the screens show only "signed in as …" and Sign out.

## 7. Routes

All under `/api/account`. `GET /api/account` always answers; every other route is a 404 when accounts are off.

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/account` | — | `{ enabled: false }` (with `account`, `character`, `csrf` for a browser still signed in), or `{ enabled, provider: { apiKey, googleClientId }, csrf, guest, account, character, parked }` |
| `POST /api/account/sign-in` | `{ idToken, csrf? }` | `{ outcome, created, character, parked, devices, ended, csrf }` and a new cookie |
| `POST /api/account/sign-out` | `{ csrf }` | `{ ok }`, cookie removed. Works when accounts are off |
| `POST /api/account/character` | `{ idToken, use, csrf }` | `{ character, parked }` |
| `POST /api/account/sign-out-everywhere` | `{ idToken, csrf }` | `{ ok, ended }` |
| `POST /api/account/export` | `{ idToken, csrf }` | the account's stored data |
| `POST /api/account/delete` | `{ idToken, csrf, confirm: "delete", erase? }` | `{ ok, kept }`, a guest cookie or none |
| `POST /api/account/password-reset` | `{ email, csrf? }` | `{ ok: true }` |

`GET /api/account` never returns a token, a cookie value or the subject id.

### Guards on every state-changing route

On top of what the host already does for every API request (a foreign `Origin` is refused; a body must be JSON of at most 8 kB; a per-address limit):

1. **A strict origin.** The request must carry an `Origin` header naming this host — with `https` when the host is reached over HTTPS — and if the browser sent `Sec-Fetch-Site` it must be `same-origin`. The host's general rule lets a request *without* an `Origin` through; these routes do not (`403 origin_required`).
2. **The session's own token.** If the browser presented a session cookie, the body must carry the `csrf` value `GET /api/account` issued for that cookie (`403 csrf_rejected`). The token is a SHA-256 digest of the cookie value under a fixed label: it needs no storage and is new whenever the cookie is. A page on another site can read neither the cookie (HttpOnly) nor that answer.

A browser with no cookie at all — signing in on a new device — has no token to send; the strict origin rule, the JSON content type and `SameSite=Lax` are what stop a forged sign-in there.

### Limits

Through the shared limiter (`ctx.allow`, `server/limiter.ts`): in memory on the Node host, stored on the Worker.

| What | Key | Limit | Counted |
| --- | --- | --- | --- |
| A token (sign-in and every proof) | address | 10 a minute | every attempt, before the token is verified |
| A token | whole server | 300 a minute | **only a token that verified and whose address is confirmed** |
| A token | account | 8 per 5 minutes | the same |
| Reset requests | whole server | 120 a minute | looked at first, without counting |
| Reset requests | address | 5 per 15 minutes | |
| Reset requests | address written to | 3 an hour | |
| Sign out | address | 30 a minute | |

On excess: `429 account_rate_limited`.

- **Neither junk nor throwaway sign-ups can spend a shared bucket.** The server-wide sign-in bucket and the per-account one count only tokens whose signature and claims verified *and* whose address is confirmed. A validly signed token of an unconfirmed account — which anyone can mint by signing up at the provider — counts against its own address and nothing else. What bounds verification work is the per-address ten a minute.
- **The shared reset bucket has no reserved slice, on purpose.** An attacker with many addresses can spend the 120 a minute, and real resets are then refused until the minute passes. A slice reserved for "an address that has had no reset in the last hour" would not help: the attacker's requests name a fresh address each time and qualify for it just as well, and nothing in a reset request distinguishes a real person from them — it carries only an address. The bucket exists to bound what this server asks of the provider and how much mail it can cause; the per-address and per-address-written-to limits bound each attacker and each target. A person who is refused can also reset directly through the provider's own page, which this server does not gate. If this becomes a problem in practice the fix is a proof of work or a challenge on the reset form, not a larger bucket.
- **Key names.** Every key of these routes starts `account:sign-in` or `account:reset`.
- **A refused request leaves no row.** A reset first *looks at* the shared bucket (`ctx.peek`, which counts nothing and creates nothing), then counts the address it came from, then the address it writes to. The per-address-written-to limit is keyed by a hash of the address and applies whether or not it has an account.
- **These keys cannot starve the game.** Limiter rows are bounded per *class* of key, each class in its own table: account keys (`account:…`, at most 4,000 rows) and everything else (10,000). A full table does not refuse new keys — it drops the rows that expire soonest to make room — so neither a flood of account keys nor a flood of anything else can turn a new visitor away. The operator's own rows are never dropped.

### Not saying whether an address has an account

- The game server takes an address in one place only, the reset request. It always answers `{ ok: true }`, and it answers before the provider has: the provider is asked in the background and its reply is never relayed.
- Every refused token is one answer.
- On the sign-in screen, a wrong password, an unknown address, a malformed address and a disabled account are one sentence; creating an account has one sentence for every refusal that is not about the password.
- The browser's own requests to the provider are a different matter: what the provider itself reveals is decided by the provider project's settings. See the console steps.

## 8. The screens

`src/app/features/account/`. All text is rendered as text.

- **Sign in / Save your character** (`AccountSignIn.vue`, panel `account-sign-in`): the Google button, an e-mail and password form (`autocomplete="username"`, and `current-password` or `new-password`), create account, forgot password, and always "Not now". The password field is cleared before anything is sent. A new account is told to confirm its address; "I have confirmed it" carries on.
- **The choice** (`AccountChoice.vue`): both characters by name, which one is in play, and one button each.
- **Settings** (`AccountSettings.vue`): for a guest, what an account is for and the two ways in; signed in, the address and how many devices are signed in, sign out, sign out everywhere else, the data download, set-aside characters, and delete. Everything but signing this device out is a second step that asks for the password or Google again; the delete step says exactly what is removed and what is not.

After a sign-in went through the cookie is new, so the page starts again with it; when the character in play is a different one, the copy of the old life this device kept is dropped first.

Tokens live in the store's closure, in memory: an ID token for one step, a sign-in's refresh token until the page starts again (so the choice that may follow can be proved). Nothing is written to browser storage. Nothing typed on these screens is logged or sent to telemetry, and the telemetry scrubber replaces any signed token in any text it sees.

The start screens reach all this through one small interface, `useAccountEntry(): { available, openSignIn(), openSave() }`. `available` is false until the server has said accounts are configured.

## 9. Setting it up

Nothing here is done by the game; an operator does it once in the provider's console.

1. **Create a project** for the game (Firebase console). Use a project of its own: its ID tokens are the keys to accounts.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**. Leave "one account per e-mail address" on.
3. **Authentication → Settings → Authorised domains**: add the game's domain. The exchange of a Google credential is refused for a domain not listed.
4. **Authentication → Settings → User actions**: turn **e-mail enumeration protection** ON. **This is a deploy gate**: without it the provider's own replies distinguish an unknown address from a wrong password to anyone who asks it directly, and nothing this server does can hide that.
5. **Authentication → Settings → Password policy**: a minimum of 6 characters and no required character classes, to match the form. The game deliberately keeps passwords easy; six is the provider's own floor.
6. **Authentication → Templates**: the confirmation and reset e-mails are sent by the provider; set the sender name and, optionally, a custom domain for the links.
7. **Project settings → General**: the **Project ID** is `ACCOUNTS_FIREBASE_PROJECT_ID`; the **Web API key** is `ACCOUNTS_FIREBASE_API_KEY`.
8. **Google Cloud console → APIs & Services → Credentials**: the OAuth **Web client** the Google provider uses. Its **client id** is `ACCOUNTS_GOOGLE_CLIENT_ID`; add the game's origin to its **Authorised JavaScript origins**. If the client is not the one the Google provider created, add it to the provider's list of allowed client ids.
9. **The same page, the API key**: restrict it to the Identity Toolkit API and the Token Service API, and to the game's domain as HTTP referrer. Set `PUBLIC_ORIGIN` on the game server so its reset request passes that restriction.
10. Set the three settings on the host and restart it. `GET /api/account` then answers `enabled: true`.

## 10. Content-Security-Policy and Cross-Origin-Opener-Policy

The game page is given a Content-Security-Policy and `Cross-Origin-Opener-Policy: same-origin` by the host's security headers. **When accounts are configured**, these additions are needed, and only then:

| Directive | Addition | For | Needed when |
| --- | --- | --- | --- |
| `script-src` | `https://accounts.google.com/gsi/client` | the Google button script | a Google client id is set |
| `frame-src` | `https://accounts.google.com/gsi/` | the button itself (an iframe) and the account chooser | a Google client id is set |
| `style-src` | `https://accounts.google.com/gsi/style` | the button's stylesheet | a Google client id is set |
| `connect-src` | `https://accounts.google.com/gsi/` | the button's own requests | a Google client id is set |
| `connect-src` | `https://identitytoolkit.googleapis.com` | sign in, create, send the confirmation link, exchange a Google credential, delete | accounts are configured |
| `connect-src` | `https://securetoken.googleapis.com` | a fresh token (after an address is confirmed; for the merge choice) | accounts are configured |

Nothing else: no `img-src`, `font-src` or `form-action` addition, and no inline script. The server's own requests (the provider's keys, the reset, the welcome message) are not subject to the page's policy.

`server/accounts/csp.ts` `accountsCspAdditions(config)` returns exactly this table for a given configuration, and the opener policy below, for the host's header builder to apply; `server/accounts/csp.test.ts` holds it equal to what the sign-in code really loads and calls.

**`Cross-Origin-Opener-Policy` must be relaxed to `same-origin-allow-popups` on the game page when a Google client id is set** (`accountsCspAdditions(config).coop`). This client draws Google's button in its default **popup** mode: the account chooser opens as a popup on `accounts.google.com` and hands the credential back to the page that opened it. Under `same-origin` the two are put in separate browsing-context groups, the popup cannot reach its opener, and the sign-in never completes. With no Google client id — e-mail sign-in only — nothing opens a popup and `same-origin` stays.

The modes that would keep `same-origin` were considered and are not used:

- **Redirect mode** (`ux_mode: 'redirect'`) has Google post the credential to an address on the game server as a cross-site form POST. This server deliberately accepts no such request (a foreign `Origin` is refused, a body must be JSON), the credential would pass through the server instead of going from the browser to the provider, and the per-button nonce check is lost. It would need a new endpoint and its own review.
- **FedCM** (the browser's own account chooser) removes the popup only in browsers that implement it; the others still open one. It cannot be relied on to keep `same-origin` everywhere.

How sure: **high for the CSP origins** (the four Google documents for its identity script, plus the two endpoints this code itself calls, which a test pins against the source); **high but untested for COOP** — it follows from how the popup flow works and from Google's documentation as remembered, and no test here loads Google's script or opens its popup. Confirm it once, in a browser, against the staging configuration before the header ships.

## 11. Threats, and the test that covers each

| Threat | Answer | Test |
| --- | --- | --- |
| A forged or altered token | signature checked before any claim; fixed algorithm | `token.test.ts` "a bad signature, a changed payload, another key and another algorithm …" |
| A token for another project, issuer or tenant | `aud`, `iss`, no `firebase.tenant` | "expired, stale, future, wrong audience and wrong issuer …", "a token of a tenant …" |
| An old or replayed token | 5-minute age, one use | `auth.test.ts` "token replay: an ID token signs in once" |
| A used token respelled (trailing bits, padding, whitespace) | strict decoding; digest over the signed content | `token.test.ts` "a token has exactly ONE spelling …"; `auth.test.ts` "H1 — …" |
| A client that vouches for itself; an unconfirmed address | only the token is read; `email_verified` required | "an unverified address links nothing …" |
| Session fixation | a new cookie at every sign-in; a record's key is not a credential | "session fixation: …" |
| Cookie tossing from a sibling host | `__Host-sid` wins and cannot be planted; a binding honoured under that name only; two values under it refused | "M2 — over HTTPS the cookie is __Host-sid …" |
| CSRF and login CSRF | strict origin (with scheme) and the session's own token | "CSRF: account state changes need this host as Origin …" |
| A stolen cookie reaching past its browser | proof for sign-out-everywhere, export, switch, delete | "a binding alone plays and signs itself out …" |
| An earlier binding surviving the owner's arrival | owner-arrival sign-out; 90-day lifetime; device count shown | "M3 — when the real owner arrives …" |
| Guessing, flooding | limits per address, per account, per address written to | "rate limits: …" |
| Junk, or throwaway unconfirmed sign-ups, spending a shared bucket | the shared bucket counts verified tokens of confirmed addresses only | "M1 — junk cannot spend the shared sign-in bucket …", "N3 — validly signed tokens of throwaway, unconfirmed accounts …" |
| A rollback logging every upgraded guest out | the old cookie is kept beside the new one | "M2 — …" (no answer to a guest removes `sid`) |
| Welcome mail repeated by delete and re-create; a stuck queue | once per address in 30 days; daily allowance; stale claims released once, then abandoned | "N5 — …", "N6 — …" |
| Sign-in visible but blocked by the page's own policy | the additions are a tested function of the configuration | `csp.test.ts` |
| Filling the limiter to lock everyone out | bounded classes; a full table makes room | `limiter.test.ts`; "H2 — a flood of reset requests leaves the site open …" |
| A storm of key fetches | one attempt per 15 seconds after a failure | `token.test.ts` "a provider that cannot be reached is not asked again for every token …" |
| Finding out who has an account | one answer per kind of refusal; reset answers before the provider | "enumeration: …" |
| Taking someone else's set-aside life; filling the archive | only the account's own; five at most | "merge abuse: …" |
| A failed write leaving half a sign-in | one transaction | "a sign-in whose write fails has no effect …" |
| A signed-out device still connected | its sockets are closed | "a socket opened under a session that was signed out …" |
| A restored character missing parts | the archive keeps everything a record carries | "M4 — a character archived by the 30-day sweep comes back whole …" |
| A retried action applied twice after a swap | receipts travel with a set-aside character | "Node: a set-aside character keeps its exactly-once receipts …" |
| Tables growing without bound | hourly sweep; a bound on accounts | "housekeeping: …" |
| Players stuck when accounts are switched off | sign-out outlives the configuration | "accounts switched off after being on …" |
| Old data lost on upgrade | tables added beside the others | `sqlite-store.test.ts` "a database made before accounts existed …" |

The Worker runs the same flows in `deploy/cloudflare.test.ts` ("Cloudflare: accounts — …", "Cloudflare: accounts hardening — …", "Cloudflare: a limiter table full …", "Cloudflare: the welcome message …").

## 12. The welcome message

A new account is sent **one** e-mail, to the address its owner has confirmed, through the game's existing mailer. It is a message about the account the person has just made — not a subscription — so it needs no marketing consent, carries no unsubscribe link (nothing follows it) and is never sent again. It has a text part and an HTML part that say the same thing, one button to the game, no image and nothing that reports whether it was opened; every value written into it is escaped, and its subject carries nothing a person chose.

- **Owed** from the transaction that *creates* the account (`welcome: 'pending'`, and an entry in a queue of at most 500). An account is created by a verified token only; a guest, an unverified address, a later sign-in, another device and a restore create nothing and so owe nothing.
- **Claimed** in a saved transaction before each attempt. Only the claimant sends, so two requests — or a request and the retry — can never both send it.
- **Settled** afterwards: sent (the account records when; never again), refused for good (a 4xx from the mailer: given up), or worth retrying (network, 429, 5xx after the mailer's own three attempts): tried again after 5 minutes, then 20, 80 …, five times in all.
- **A claim nobody settled** — the host stopped in the middle of a send — does not sit in the queue for good. After a day it is released for **one** last attempt; if that one is not settled within a day either, it is abandoned. Never a third: a message that may already have gone out is not sent again and again.
- **Once per address in 30 days.** A salted hash of each welcomed address is remembered for 30 days (at most 5,000), so deleting an account and making it again earns no second message.
- **It counts against the mailer's daily allowance** (`EMAIL_DAILY_CAP`, default 500), in the same counter as the mailer's other messages. At the allowance it waits for the next day, without using up an attempt.
- It is sent after the sign-in has been answered and can neither delay nor fail it.
- **Off when the mailer is not configured** (`ZEPTOMAIL_AUTH`, `EMAIL_FROM_ADDRESS` and `PUBLIC_ORIGIN`): nothing is marked, queued, sent or logged. The operator's e-mail switch holds it back like a failed send. The mailer has no bounce or complaint feed today; a 4xx answer is the only "do not send to this address" signal there is, and it is honoured.
- An account that is swept (no binding, no character) and whose owner returns more than 30 days after their welcome is a new account, and is welcomed as one.

## 13. Open questions

1. **Tokens are not bound to a browser.** An ID token stolen in the minutes before it is used (a script running in the page, a compromised device) can be used once from elsewhere to bind another browser to the account. The 5-minute age and single use bound this; a nonce issued by the server and carried in the token would close it, but the provider's password sign-in has no place to put one.
2. **Cookie values are stored as keys**, for sessions and now for device bindings. A copy of the data file contains valid cookies. Storing a digest instead needs the same change for sessions, and an asynchronous digest in what is a synchronous lookup today.
3. **Erasing a character does not erase what other collections hold under its public id**: messages it sent, its place in a neighbourhood, a consented contact address. Deleting an account removes the account, its bindings, its set-aside characters and, if asked, the character's own record. A complete erasure needs each feature to take part.
5. **A password reset by itself does not end other sign-ins.** The provider's token does not say that a password changed. Linking into an existing account, a change in the way of signing in, the 90-day lifetime and the visible device count cover the rest; revoking on reset would need the server to learn of the reset from the provider.
5a. **A sign-in that needs a sixth set-aside character** is refused. There is no screen for discarding a set-aside character, by design, until it is decided how such a discard should be confirmed.
6. **The reset request is proxied; sign-in is not.** Someone who talks to the provider directly meets the provider's own limits and replies, not the game's. Enumeration protection in the provider project is what covers that path.
7. **A guest not yet upgraded is where they were before this release** with respect to a sibling host planting `sid` (section 6); their first answer from this release ends that. `sid` itself is still read and kept, for rollback; removing it is a later release.
8. **One character per account per world.** A second world would need the account to hold a character per world.
