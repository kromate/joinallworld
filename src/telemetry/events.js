/**
 * THE EVENT CATALOGUE — every product-analytics event the game sends to PostHog, in one place.
 * Pure data: imported by the lazily loaded PostHog chunk, by the server and by the tests; it is
 * NOT part of the first download.
 *
 * Each entry says what the event is called, which properties it may carry (anything else is
 * dropped before sending), when it fires and why the team needs it. An event that is not listed
 * here can still be sent with `jaw:track` — it then passes the generic scrubber (ids, codes,
 * numbers and booleans only) — but add it here so its properties are checked by name.
 *
 * Property rules, enforced by src/telemetry/scrub.js for every event: numbers, booleans and short
 * id-like words only. Never chat or message text, a nickname, an email, a position, an IP or a
 * UUID. The player is identified by the session's PUBLIC id as the distinct id, nowhere else.
 *
 * @typedef {'string' | 'number' | 'boolean'} PropType
 * @typedef {object} EventSpec
 * @property {Record<string, PropType>} props   allowed properties and their types
 * @property {string} when                      when it fires (and how often)
 * @property {string} why                       the question it answers
 * @property {'client' | 'server' | 'external'} from   'external' = defined here for another branch to emit with jaw:track
 */

/** @type {Record<string, EventSpec>} */
export const EVENTS = {
  // ---- Views and sessions ---------------------------------------------------------------------
  $pageview: { from: 'client', props: {}, when: 'Once per page load, after consent. Carries only the page origin and path.', why: 'Views are counted apart from players: a page view is not a player.' },
  screen_view: { from: 'client', props: { screen: 'string' }, when: 'The screen in front changed (venue, map), or screen(name) was called.', why: 'Which screens are used; views inside the single page.' },
  session_start: { from: 'client', props: { days_since_first_seen: 'number', returning: 'boolean' }, when: 'Once per Lagos calendar day per device, when a connected player is on the page. Sets the person property first_seen_date once.', why: 'D1/D7/D30 retention, computed in PostHog from this daily event.' },
  day2_return: { from: 'client', props: {}, when: 'Once per device: the first session_start on the day after first_seen_date.', why: 'Last step of the activation funnel.' },
  consent_choice: { from: 'client', props: { choice: 'string', source: 'string' }, when: 'The player chose Accept on the consent sheet or in Settings (a Reject sends nothing).', why: 'How many people accept, and from where.' },

  // ---- Activation funnel and time to first activity ---------------------------------------------
  landed: { from: 'client', props: {}, when: 'Once per device: a browser with no session was shown the nickname entry.', why: 'Top of the activation funnel.' },
  named: { from: 'client', props: { ms_since_landed: 'number' }, when: 'Once per life: the server accepted the nickname and created the session.', why: 'Funnel step 2; the start of "time to first activity".' },
  character_step_completed: { from: 'client', props: { step: 'string', step_index: 'number', ms_in_step: 'number', ms_since_session: 'number' }, when: 'Once per step per life: the server confirmed a character-creation step (look, traits, dream, lottery, home).', why: 'Step timings and drop-off per step of character creation.' },
  character_done: { from: 'client', props: { ms_since_session: 'number', house: 'string', lottery: 'string', backfill: 'boolean' }, when: 'Once per life: the Sim moved in.', why: 'Funnel step 3.' },
  activity_completed: { from: 'client', props: { activity_id: 'string', venue_id: 'string' }, when: 'Every time a timed activity ran to its end (not when cancelled).', why: 'What players actually do; engagement per venue.' },
  first_activity: { from: 'client', props: { activity_id: 'string', venue_id: 'string', ms_since_session: 'number', ms_since_character_done: 'number' }, when: 'Once per life: the first activity_completed.', why: 'Funnel step 4 and the headline number: time to first activity.' },
  first_travel: { from: 'client', props: { mode: 'string', ms_since_session: 'number', backfill: 'boolean' }, when: 'Once per life: the first completed trip.', why: 'Funnel step 5.' },
  first_job_shift: { from: 'client', props: { job_id: 'string', ms_since_session: 'number', backfill: 'boolean' }, when: 'Once per life: the first completed work shift.', why: 'Funnel step 6.' },

  // ---- Invite → joined friend -------------------------------------------------------------------
  friend_request_sent: { from: 'server', props: {}, when: 'A friend request was stored (not a repeat).', why: 'Start of the friend loop.' },
  friend_made: { from: 'server', props: { role: 'string' }, when: 'A friend request was accepted; sent for each of the two players who has accepted analytics (role: accepter | asker).', why: 'Meaningful interaction; invite → friend conversion.' },
  house_knock_sent: { from: 'server', props: {}, when: 'A player knocked at another player’s home (not a repeat).', why: 'House invites as they exist today.' },
  house_knock_answered: { from: 'server', props: { accepted: 'boolean' }, when: 'A host answered a knock.', why: 'How often an invite is accepted.' },
  house_visit: { from: 'server', props: { role: 'string' }, when: 'Once per stay: a guest and the host are in the host’s Home room together (role: guest | host).', why: 'The invite ended with both players in the same place.' },
  invite_link_created: { from: 'external', props: { kind: 'string', channel: 'string' }, when: 'To be emitted by the sharing branch when a share or invite link is made (kind: house | venue | referral; channel: copy | share_sheet | whatsapp…).', why: 'Top of the invite funnel.' },
  invite_link_opened: { from: 'external', props: { kind: 'string', has_session: 'boolean' }, when: 'To be emitted when the page is opened from an invite link.', why: 'Invite funnel step 2.' },
  invite_joined: { from: 'external', props: { kind: 'string', minutes_since_opened: 'number' }, when: 'To be emitted when a player who arrived by an invite link has a session and a finished character.', why: 'Invite funnel step 3.' },
  invite_copresent: { from: 'external', props: { kind: 'string', minutes_since_joined: 'number' }, when: 'To be emitted when inviter and invited are in the same room within N minutes of joining.', why: 'Invite funnel step 4: the invite produced time together.' },

  // ---- Meaningful player interactions (counts and durations only — never content) -----------------
  chat_message_sent: { from: 'server', props: { venue_id: 'string' }, when: 'A venue chat line was accepted and delivered. The text is never read by telemetry.', why: 'Count of public chat.' },
  dm_sent: { from: 'server', props: { kind: 'string' }, when: 'A direct or group message was stored (kind: direct | group). The text is never read by telemetry.', why: 'Count of private messages.' },
  voice_joined: { from: 'server', props: { venue_id: 'string' }, when: 'A player turned proximity voice on in a room.', why: 'Voice adoption (a count; no audio is ever recorded).' },
  voice_left: { from: 'server', props: { venue_id: 'string', seconds: 'number', duration: 'string' }, when: 'Voice was turned off, the room was left or the connection closed.', why: 'Voice session length.' },
  co_presence: { from: 'server', props: { venue_id: 'string', seconds: 'number', minutes: 'number', peers_max: 'number', duration: 'string' }, when: 'A stretch in a room together with at least one other real player ended (30 s or more).', why: 'Co-presence minutes with another real player.' },

  // ---- Health --------------------------------------------------------------------------------
  first_scene: { from: 'client', props: { ok: 'boolean', fps: 'string', renderer: 'string', tti_ms: 'number', scene_ms: 'number' }, when: 'Once per page load: the first 3D scene was drawn (or could not be). fps and renderer are coarse buckets.', why: 'Client performance where players are; time to interactive.' },
  webgl_context_lost: { from: 'client', props: { scene: 'string' }, when: 'A canvas lost its WebGL context.', why: 'GPU trouble on real devices.' },
  action_latency: { from: 'client', props: { action_type: 'string', ms: 'number', bucket: 'string', ok: 'boolean' }, when: 'A sample (1 in 5) of game actions: request to accepted state.', why: 'p50/p95 action latency, computed in PostHog.' },
  action_failed: { from: 'client', props: { action_type: 'string', code: 'string' }, when: 'A game action was refused or failed (every one; "busy" is skipped).', why: 'Action failures by code.' },
  storage_state: { from: 'client', props: { state: 'string' }, when: 'The server said it cannot save (failing) or can again (recovered).', why: 'How many players see the not-saving state.' },
  connection_state: { from: 'client', props: { from: 'string', to: 'string' }, when: 'The connection state changed (connecting, online, new, expired, offline, unreachable).', why: 'Connection quality in the field.' },
  chunk_load_failed: { from: 'client', props: { chunk: 'string' }, when: 'A lazily loaded part of the game did not arrive (scene, map, community, preload).', why: 'Broken deploys and bad networks.' },
  ws_error: { from: 'server', props: { message_type: 'string', code: 'string' }, when: 'A socket message was refused with a machine code.', why: 'Socket error codes by message type.' },
};

/** The steps of the activation funnel, in order, as a PostHog funnel is built from them. */
export const ACTIVATION_FUNNEL = Object.freeze(['landed', 'named', 'character_done', 'first_activity', 'first_travel', 'first_job_shift', 'day2_return']);

/** The names another branch may dispatch with `jaw:track` today. */
export const EXTERNAL_EVENTS = Object.freeze(Object.keys(EVENTS).filter((name) => EVENTS[name].from === 'external'));

/** The property names an event may carry, or null for an event that is not in the catalogue. */
export function allowedProps(name) { return Object.hasOwn(EVENTS, name) ? Object.keys(EVENTS[name].props) : null; }

/**
 * Properties checked against the catalogue: only listed names, each of its listed type.
 * `clean` is the generic scrubber (scrubProps), passed in so this file stays pure data.
 */
export function checkProps(name, props, clean) {
  const spec = Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
  const safe = clean(props, { allow: spec ? Object.keys(spec.props) : null });
  if (spec) for (const key of Object.keys(safe)) if (typeof safe[key] !== spec.props[key]) delete safe[key];
  return safe;
}
