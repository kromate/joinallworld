/**
 * OWNER: social
 * People tab of the Sim sheet (friends and relationships) — also the target of the E shortcut.
 *
 * Starter content (extend freely): points to the existing community panel (presence, chat,
 * voice), which stays as it is.
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./people.css and import it here.
 */
export default {
  id: 'people', title: 'People', icon: '👥', placement: 'sim-tab', order: 50,
  render(state) {
    return state.location === 'home'
      ? '<p>Your home is private. Visit a public venue to meet people. Home invitations are not available yet.</p>'
      : '<p>No friends yet.</p><button class="ui-button is-primary" data-people-community>Open community chat</button>';
  },
  bind(root, api) {
    root.querySelector('[data-people-community]')?.addEventListener('click', () => { api.close(); api.toggleCommunity(true); });
  },
};
