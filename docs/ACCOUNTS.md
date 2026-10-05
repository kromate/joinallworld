# Accounts

An account is optional. A guest plays at once, exactly as before, with a device session and no sign-in. Signing in attaches the character to something that can be reached again: from another device, or after this device's cookie is gone.

Accounts are **off unless configured**. With no configuration the game shows no sign-in anywhere, stores nothing about accounts, and makes no request to a sign-in provider.

This document is the design. The code is small enough to read beside it:

| What | Where |
| --- | --- |
| Who a person is (ID token verification) | `server/accounts/token.ts` |
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
6. A signed-in browser holds a **device binding**: a cookie value the server made at sign-in. Several browsers can be bound to one account and play the same character.
7. **Signing in never destroys a life.** A played life that cannot be the active character is *set aside* and can be brought back; the player is shown the choice.
8. Sign-in always issues a **new cookie**. State changes need a same-origin request and the session's own anti-forgery token.
9. **Sign out** removes this browser's binding. **Sign out everywhere** removes the others. **Delete** removes the account; the character is kept on the device or erased, as asked.
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
| Shape | three base64url parts, at most 4,096 characters |
| Algorithm | the header's `alg` is exactly `RS256`. It is never taken from the key or negotiated, so `none` and HMAC-with-the-public-key forgeries stop here |
| Key | the header's `kid` names a key in the provider's published set |
| Signature | RSASSA-PKCS1-v1_5 with SHA-256 over `header.payload` |
| `aud`, `iss` | the configured project, and the token service's issuer for it |
| `exp` | in the future |
| `iat` | not in the future; at most **5 minutes** old |
| `auth_time` | not in the future; at most **1 hour** old |
| `sub` | 1–128 characters of `[A-Za-z0-9_-]` |
| Provider | `google.com` or `password`. Anonymous and custom tokens are refused |
| `email` | present. `email_verified` must be the boolean `true` before anything is linked |

Claims are read only after the signature has verified. A clock allowance of 60 seconds applies to the "not in the future" checks only.

**Keys** are fetched over HTTPS through the host's outbound fetch (HTTPS only, 15 seconds, no redirects), kept for the lifetime the response's `Cache-Control` gives (clamped to between one minute and one day), and fetched again — at most once a minute — when a token names an unknown key, which is how a rotation is picked up. Keys past their lifetime are not used while the provider cannot be reached. A key set that cannot be fetched is `503 accounts_unavailable`, not a verdict on the token.

**A token is used once.** Its SHA-256 digest is stored until the token would be refused as stale anyway; a second presentation is `401 invalid_token`. The digest is written in the same transaction as the sign-in, so a sign-in whose write fails has spent nothing.

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
  parked         // set-aside characters: [{ id, name, at }] (at most 5)
}
accountDevices[<cookie value>] = { account, createdAt, seenAt, expiresAt }
accountLog = { salt, seq, audit: [{ n, at, event, ref, life? }], used: { <token digest>: <until> } }
```

- **No password, no ID token, no refresh token** is stored. The server never receives a refresh token.
- **The address** is kept because the person needs to see which account a device is signed in to. It is not used to contact anyone. It is the only personal detail stored; it is removed with the account.
- **The audit trail** records an event, a time and a reference (a salted hash of the account id), plus the public id of a character where one is involved. No token, address, subject id or cookie. At most 2,000 lines.
- **Device bindings** are keyed by the cookie value, as session records are. A copy of the data file therefore contains valid cookies, as it always has; see the open questions.

**On the Node host** the three are collections of the JSON document. **On the Worker** `accounts` and `accountDevices` are tables of their own (`accounts`, `account_devices`), read by key, so a request by a signed-in browser reads two rows; `accountLog` is an ordinary collection. The tables are created with `CREATE TABLE IF NOT EXISTS` beside the existing ones. A database made before them gains them empty on its next start; no existing table, index or row is touched (`deploy/sqlite-store.test.ts` starts from such a database).

Every change is one store transaction: the account, its bindings, the session records and the archive are written together or not at all.

## 6. Sessions

A guest is unchanged: the cookie is the key of the guest's session record.

A signed-in browser's cookie is the key of a **device binding**. The binding names the account; the account names its active character; the character is a session record with `account` set, filed under a random key that is never sent to any browser. `sessionOfCookie` resolves this in one place for both hosts, and refuses a cookie that names an account's character directly — so that key is not a credential even if it leaked.

Consequences:

- Several browsers can be bound to one account. They play one character, as two tabs always could.
- Removing a binding ends that browser's access at once, without touching the character.
- A binding has the same sliding 30-day lifetime as a session. A character nobody has reached for 30 days is archived by the existing sweep, and brought back from the archive at the next sign-in.
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

In every case the browser gets a **new** cookie, a binding it presented is removed, and the token is spent.

### The merge rule

When both sides have a played life, neither is destroyed and nothing is merged. The default is the safe one: **the account's character stays active, and the device's life is set aside** — moved to the existing archive, marked with the account that may bring it back, with its lives, its character record and its set-aside lives intact.

The player is then shown both characters by name and asked which to play. Choosing the other one swaps them (`POST /api/account/character`): the one that was active is set aside in its place. The choice can be changed at any time from Settings. Closing the screen without choosing leaves the default.

An account can hold five set-aside characters. A sign-in that would need a sixth is refused (`409 parked_full`) with nothing changed: that device simply stays a guest, life intact. Only the account's own set-aside characters can be chosen; another account's, or an unowned archive entry, is `404`.

### Signing out and deleting

- **Sign out** removes this browser's binding and its cookie. The character stays with the account. A guest cannot "sign out": that would discard the only key to its life (`409 account_required`).
- **Sign out everywhere** removes every *other* binding. This browser stays signed in.
- **Delete** needs a fresh ID token for the same account as well as the cookie — a stolen cookie cannot delete an account. It removes the account, every binding and every set-aside character. The active character is the player's choice: kept on this device as an ordinary guest life (a new cookie, no account), or erased. The browser then asks the provider to delete its own record of the person.
- **Export** (`GET /api/account/export`) returns everything stored about the account to its owner.

## 7. Routes

All under `/api/account`. `GET /api/account` always answers; every other route is a 404 when accounts are off.

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/account` | — | `{ enabled: false }`, or `{ enabled, provider: { apiKey, googleClientId }, csrf, guest, account, character, parked }` |
| `POST /api/account/sign-in` | `{ idToken, csrf? }` | `{ outcome, created, character, parked, csrf }` and a new cookie |
| `POST /api/account/character` | `{ use, csrf }` | `{ character, parked }` |
| `POST /api/account/sign-out` | `{ csrf }` | `{ ok }`, cookie removed |
| `POST /api/account/sign-out-everywhere` | `{ csrf }` | `{ ok, ended }` |
| `POST /api/account/delete` | `{ idToken, csrf, confirm: "delete", erase? }` | `{ ok, kept }`, a guest cookie or none |
| `GET /api/account/export` | — | the account's stored data |
| `POST /api/account/password-reset` | `{ email, csrf? }` | `{ ok: true }` |

`GET /api/account` never returns a token, a cookie value or the subject id.

### Guards on every state-changing route

On top of what the host already does for every API request (a foreign `Origin` is refused; a body must be JSON of at most 8 kB; a per-address limit):

1. **A strict origin.** The request must carry an `Origin` header naming this host, and if the browser sent `Sec-Fetch-Site` it must be `same-origin`. The host's general rule lets a request *without* an `Origin` through; these routes do not (`403 origin_required`).
2. **The session's own token.** If the browser presented a session cookie, the body must carry the `csrf` value `GET /api/account` issued for that cookie (`403 csrf_rejected`). The token is a SHA-256 digest of the cookie value under a fixed label: it needs no storage and is new whenever the cookie is. A page on another site can read neither the cookie (HttpOnly) nor that answer.

A browser with no cookie at all — signing in on a new device — has no token to send; the strict origin rule, the JSON content type and `SameSite=Lax` are what stop a forged sign-in there.

### Limits

Through the existing limiter (`ctx.allow`): in memory on the Node host, stored on the Worker.

| What | Key | Limit | On excess |
| --- | --- | --- | --- |
| Sign-in and delete attempts | address | 10 a minute | `429 account_rate_limited` |
| Sign-in and delete attempts | whole server | 300 a minute | same |
| Sign-in and delete, after the token verified | account | 8 per 5 minutes | same |
| Reset requests | address | 5 per 15 minutes | same |
| Reset requests | address written to | 3 an hour | same |
| Reset requests | whole server | 120 a minute | same |
| Sign out, sign out everywhere, choose a character | address | 30 a minute | same |
| Export | address | 6 a minute | same |

The per-address-written-to limit is keyed by a hash of the address and applies whether or not it has an account.

### Not saying whether an address has an account

- The game server takes an address in one place only, the reset request. It always answers `{ ok: true }`, and it answers before the provider has: the provider is asked in the background and its reply is never relayed.
- Every refused token is one answer.
- On the sign-in screen, a wrong password, an unknown address, a malformed address and a disabled account are one sentence; creating an account has one sentence for every refusal that is not about the password.
- The browser's own requests to the provider are a different matter: what the provider itself reveals is decided by the provider project's settings. See the console steps.

## 8. The screens

`src/app/features/account/`. All text is rendered as text.

- **Sign in / Save your character** (`AccountSignIn.vue`, panel `account-sign-in`): the Google button, an e-mail and password form (`autocomplete="username"`, and `current-password` or `new-password`), create account, forgot password, and always "Not now". The password field is cleared before anything is sent. A new account is told to confirm its address; "I have confirmed it" carries on.
- **The choice** (`AccountChoice.vue`): both characters by name, which one is in play, and one button each.
- **Settings** (`AccountSettings.vue`): for a guest, what an account is for and the two ways in; signed in, the address, sign out, sign out everywhere, the data download, set-aside characters, and delete — which is a second step, asks for the password or Google again, and says exactly what goes.

After a sign-in went through the cookie is new, so the page starts again with it; when the character in play is a different one, the copy of the old life this device kept is dropped first.

Tokens live in the store's closure, in memory, for one step. Nothing is written to browser storage. Nothing typed on these screens is logged or sent to telemetry, and the telemetry scrubber replaces any signed token in any text it sees.

The start screens reach all this through one small interface, `useAccountEntry(): { available, openSignIn(), openSave() }`. `available` is false until the server has said accounts are configured.

## 9. Setting it up

Nothing here is done by the game; an operator does it once in the provider's console.

1. **Create a project** for the game (Firebase console). Use a project of its own: its ID tokens are the keys to accounts.
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**. Leave "one account per e-mail address" on.
3. **Authentication → Settings → Authorised domains**: add the game's domain. The exchange of a Google credential is refused for a domain not listed.
4. **Authentication → Settings → User actions**: turn **e-mail enumeration protection** on. Without it the provider's own replies distinguish an unknown address from a wrong password to anyone who asks it directly.
5. **Authentication → Settings → Password policy**: require at least 10 characters, to match the form.
6. **Authentication → Templates**: the confirmation and reset e-mails are sent by the provider; set the sender name and, optionally, a custom domain for the links.
7. **Project settings → General**: the **Project ID** is `ACCOUNTS_FIREBASE_PROJECT_ID`; the **Web API key** is `ACCOUNTS_FIREBASE_API_KEY`.
8. **Google Cloud console → APIs & Services → Credentials**: the OAuth **Web client** the Google provider uses. Its **client id** is `ACCOUNTS_GOOGLE_CLIENT_ID`; add the game's origin to its **Authorised JavaScript origins**. If the client is not the one the Google provider created, add it to the provider's list of allowed client ids.
9. **The same page, the API key**: restrict it to the Identity Toolkit API and the Token Service API, and to the game's domain as HTTP referrer. Set `PUBLIC_ORIGIN` on the game server so its reset request passes that restriction.
10. Set the three settings on the host and restart it. `GET /api/account` then answers `enabled: true`.

## 10. Content-Security-Policy

Needed only when accounts are configured:

| Directive | Origin | For |
| --- | --- | --- |
| `script-src` | `https://accounts.google.com/gsi/client` | the Google button script |
| `frame-src` | `https://accounts.google.com/gsi/` | the button and the account chooser |
| `connect-src` | `https://accounts.google.com/gsi/` | the button's own requests |
| `style-src` | `https://accounts.google.com/gsi/style` | the button's stylesheet |
| `connect-src` | `https://identitytoolkit.googleapis.com` | sign in, create, send the confirmation link, exchange, delete |
| `connect-src` | `https://securetoken.googleapis.com` | the token refresh after an address is confirmed |

The first four are needed only when `ACCOUNTS_GOOGLE_CLIENT_ID` is set. The Google chooser opens as a popup: a `Cross-Origin-Opener-Policy` stricter than `same-origin-allow-popups` breaks it. The server's own requests (keys, reset) are not subject to the page's policy.

## 11. Threats, and the test that covers each

| Threat | Answer | Test |
| --- | --- | --- |
| A forged or altered token | signature checked before any claim; fixed algorithm | `token.test.ts` "a bad signature, a changed payload, another key and another algorithm …" |
| A token for another project or issuer | `aud`, `iss` | "expired, stale, future, wrong audience and wrong issuer …" |
| An old or replayed token | 5-minute age, one use | `auth.test.ts` "token replay: an ID token signs in once" |
| A client that vouches for itself | only the token is read | "an unverified address links nothing …" |
| Claiming an address nobody confirmed | `email_verified` required | same |
| Session fixation | a new cookie at every sign-in; the presented one is never kept; a record's key is not a credential | "session fixation: …" |
| CSRF and login CSRF | strict origin and the session's own token | "CSRF: account state changes need this host as Origin …" |
| Guessing, flooding | limits per address, per account, per address written to | "rate limits: …" |
| Finding out who has an account | one answer per kind of refusal; reset answers before the provider | "enumeration: …" |
| Taking someone else's set-aside life; filling the archive | only the account's own; five at most | "merge abuse: …" |
| A cookie alone deleting an account | a fresh token for the same account | "delete: needs a fresh token …" |
| A failed write leaving half a sign-in | one transaction | "a sign-in whose write fails has no effect …" |
| A signed-out device still connected | its sockets are closed | "a socket opened under a session that was signed out …" |
| Old data lost on upgrade | tables added beside the others | `sqlite-store.test.ts` "a database made before accounts existed …" |

The Worker runs the same flows in `deploy/cloudflare.test.ts` ("Cloudflare: accounts — …").

## 12. Open questions

1. **Tokens are not bound to a browser.** An ID token stolen in the minutes before it is used (a script running in the page, a compromised device) can be used once from elsewhere to bind another browser to the account. The 5-minute age and single use bound this; a nonce issued by the server and carried in the token would close it, but the provider's password sign-in has no place to put one.
2. **Cookie values are stored as keys**, for sessions and now for device bindings. A copy of the data file contains valid cookies. Storing a digest instead needs the same change for sessions, and an asynchronous digest in what is a synchronous lookup today.
3. **Erasing a character does not erase what other collections hold under its public id**: messages it sent, its place in a neighbourhood, a consented contact address. Deleting an account removes the account, its bindings, its set-aside characters and, if asked, the character's own record. A complete erasure needs each feature to take part.
4. **Expired bindings of accounts that never return** are pruned only when that account next signs in. They are inert; a periodic sweep would remove them.
5. **A sign-in that needs a sixth set-aside character** is refused. There is no screen for discarding a set-aside character, by design, until it is decided how such a discard should be confirmed.
6. **The reset request is proxied; sign-in is not.** Someone who talks to the provider directly meets the provider's own limits and replies, not the game's. Enumeration protection in the provider project is what covers that path.
7. **Account sessions have no absolute lifetime**, only the sliding 30 days, like device sessions.
8. **One character per account per world.** A second world would need the account to hold a character per world.
