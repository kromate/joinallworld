// OWNER: accounts — what sign-in needs from the page's security headers (server/accounts/csp.ts), and that it matches what the client really loads and calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { accountsCspAdditions } from './csp.ts';
import { accountsConfig } from '../host-context.ts';

const CONFIG = { projectId: 'allworld-test-project', apiKey: 'test-web-api-key-0000000000000000000000', googleClientId: '1234567890-testclient.apps.googleusercontent.com' };
const NOTHING = { csp: { 'script-src': [], 'connect-src': [], 'frame-src': [], 'style-src': [] }, coop: 'same-origin' };

test('accounts off: nothing is added and the opener policy stays strict', () => {
  for (const off of [null, undefined, accountsConfig({}), accountsConfig({ ACCOUNTS_FIREBASE_PROJECT_ID: 'allworld-test-project' })]) assert.deepEqual(accountsCspAdditions(off), NOTHING);
});

test('e-mail sign-in only: the two identity endpoints, no script, no frame, no popup', () => {
  assert.deepEqual(accountsCspAdditions({ ...CONFIG, googleClientId: '' }), { csp: { 'script-src': [], 'connect-src': ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'], 'frame-src': [], 'style-src': [] }, coop: 'same-origin' });
});

test('with the Google button: its script, frame, stylesheet and requests, and popups may keep their opener', () => {
  assert.deepEqual(accountsCspAdditions(CONFIG), {
    csp: { 'script-src': ['https://accounts.google.com/gsi/client'], 'connect-src': ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://accounts.google.com/gsi/'], 'frame-src': ['https://accounts.google.com/gsi/'], 'style-src': ['https://accounts.google.com/gsi/style'] },
    coop: 'same-origin-allow-popups',
  });
  const first = accountsCspAdditions(CONFIG); first.csp['connect-src'].push('https://evil.example');
  assert.ok(!accountsCspAdditions(CONFIG).csp['connect-src'].includes('https://evil.example'), 'each call answers with lists of its own');
  for (const sources of Object.values(accountsCspAdditions(CONFIG).csp)) for (const source of sources) { assert.match(source, /^https:\/\/[a-z.]+(\/[a-z/]*)?$/); assert.ok(!/[*'\s;,]/.test(source), 'no wildcard, keyword or separator: a source cannot widen the policy'); }
});

test('the list is what the client really reaches: every outside address in the sign-in code is covered, and nothing else is listed', async () => {
  const read = (name: string) => readFile(new URL(`../../src/app/features/account/${name}`, import.meta.url), 'utf8');
  const code = (await Promise.all(['identityProvider.ts', 'googleButton.ts', 'accountStore.ts', 'useAccount.ts', 'AccountSignIn.vue', 'AccountSettings.vue', 'AccountChoice.vue'].map(read))).join('\n').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  const reached = [...new Set([...code.matchAll(/https:\/\/[A-Za-z0-9.-]+[A-Za-z0-9/._-]*/g)].map(match => match[0]))].sort();
  assert.deepEqual(reached, ['https://accounts.google.com/gsi/client', 'https://identitytoolkit.googleapis.com/v1/accounts', 'https://securetoken.googleapis.com/v1/token']);
  const needs = accountsCspAdditions(CONFIG);
  for (const url of reached.filter(item => item.includes('googleapis'))) assert.ok(needs.csp['connect-src'].some(source => url.startsWith(source)), `${url} is allowed by connect-src`);
  assert.ok(needs.csp['script-src'].includes('https://accounts.google.com/gsi/client'));
  // The button is drawn in the popup mode (no ux_mode, no login_uri, no FedCM switch): that is what the opener policy above is for.
  const button = await read('googleButton.ts');
  assert.ok(!/ux_mode|login_uri|use_fedcm/.test(button.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')), 'if the button’s mode changes, the opener policy in csp.ts must be looked at again');
});
