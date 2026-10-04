/**
 * OWNER: accounts
 * Account logic for server/routes/auth.ts (credential checks, account records).
 *
 * INERT BY DESIGN: nothing here is used by the server yet and the foundation changes nothing
 * about authentication. The existing device-session model stays exactly as it is — random
 * secret in an HttpOnly cookie, separate public ID, sliding expiry, expired lives archived
 * without their secret — until an accounts design has been reviewed.
 *
 * Keep this module portable (no node:* imports at module scope) so the Worker can share it.
 */
export const ACCOUNTS_ENABLED = false;
