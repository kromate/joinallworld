/**
 * OWNER: accounts
 * Landing: sign up / log in / continue / new life.
 *
 * Placeholder panel, already registered by panels/index.js but not opened by anything: the
 * existing device-session flow (nickname prompt in ./session.js) remains the only way in until
 * an accounts design has been reviewed. To take over the entry flow later, add
 * `role: 'session-gate'` to this panel — src/life-main.js then opens it instead of ./session.js
 * with params { reason: 'new' | 'expired' }. The panel contract is at the top of src/ui/shell.js.
 */
import { placeholder } from '../dom.ts';

export default {
  id: 'account', title: 'Account', placement: 'modal',
  render() { return placeholder('Account', 'Accounts are not available yet. Your progress is saved to this device session.'); },
};
