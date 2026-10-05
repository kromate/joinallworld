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
 * ONE SOURCE PER EVENT. `from` names the one place that reports it: 'quick-start' (the first minute and the landing of a
 * link: src/quick-start/entry.ts track), 'world' (where you live), 'growth' (missions, tables, sharing, outreach) — all
 * three arrive as `jaw:track` DOM events, as do those of 'campus' (the UNILAG campus: src/life-main.js, from the server's state) — 'client' (derived here from the server's states: ./funnel.ts and ./core.ts) and
 * 'server' (server/telemetry/instrument.ts). src/telemetry/telemetry.test.ts reads the game's sources and fails if a
 * `track('…')` call names an event that is not listed here, or carries a property this list would drop.
 *
 * Property rules, enforced by src/telemetry/scrub.ts for every event: numbers, booleans and short
 * id-like words only. Never chat or message text, a nickname, an email, a position, an IP or a
 * UUID. The player is identified by the session's PUBLIC id as the distinct id, nowhere else.
 */
import type { SafeProps } from './scrub.ts';

export type PropType = 'string' | 'number' | 'boolean';
export interface EventSpec {
  /** allowed properties and their types */
  props: Record<string, PropType>;
  /** when it fires (and how often) */
  when: string;
  /** the question it answers */
  why: string;
  /** the one place that reports it (see ONE SOURCE PER EVENT) */
  from: 'client' | 'server' | 'quick-start' | 'world' | 'growth' | 'campus';
}

export const EVENTS: Record<string, EventSpec> = {
  // ---- Views and sessions ---------------------------------------------------------------------
  $pageview: { from: 'client', props: {}, when: 'Once per page load, after consent. Carries only the page origin and path.', why: 'Views are counted apart from players: a page view is not a player.' },
  screen_view: { from: 'client', props: { screen: 'string' }, when: 'The screen in front changed (venue, map), or screen(name) was called.', why: 'Which screens are used; views inside the single page.' },
  session_start: { from: 'client', props: { days_since_first_seen: 'number', returning: 'boolean' }, when: 'Once per Lagos calendar day per device, when a connected player is on the page. Sets the person property first_seen_date once.', why: 'D1/D7/D30 retention, computed in PostHog from this daily event.' },
  day2_return: { from: 'client', props: {}, when: 'Once per device: the first session_start on the day after first_seen_date.', why: 'Last step of the activation funnel.' },
  consent_choice: { from: 'client', props: { choice: 'string', source: 'string' }, when: 'The player chose Accept on the consent sheet or in Settings (a Reject sends nothing).', why: 'How many people accept, and from where.' },

  // ---- The first minute (reported by the quick start: src/quick-start/entry.ts; `ms` = milliseconds since this device landed)
  landed: { from: 'quick-start', props: { join: 'boolean', ms: 'number' }, when: 'Once per device: the landing screen (a name, a quick character, Play) was shown to a browser with no session. join: it arrived by an invite or share link.', why: 'Top of the activation funnel.' },
  named: { from: 'quick-start', props: { edited: 'boolean', length: 'number', ms: 'number' }, when: 'Play was tapped with this name. Only whether the suggestion was edited and how long the name is — never the name.', why: 'Do people keep the suggested name?' },
  quick_look_done: { from: 'quick-start', props: { shuffles: 'number', preset: 'string', edited: 'boolean', ms: 'number' }, when: 'Play was tapped with this character: how many shuffles, which one-tap preset (if any), whether "More options" was opened.', why: 'How much character choice the landing needs.' },
  play_tapped: { from: 'quick-start', props: { taps: 'number', ms: 'number' }, when: 'Play was tapped (taps: taps on the landing screen, Play included).', why: 'Funnel step 2; the start of "time to first reward".' },
  arrived: { from: 'quick-start', props: { venue: 'string', ms: 'number' }, when: 'Once per life: the server confirmed the quick start and the player is standing in a public venue.', why: 'Funnel step 3: seconds from landing to being in the world.' },
  first_activity_started: { from: 'quick-start', props: { activity: 'string', venue: 'string', ms: 'number' }, when: 'Once per life: a guest started their first activity.', why: 'Does the first goal get tapped?' },
  first_activity_completed: { from: 'quick-start', props: { venue: 'string', server_ms: 'number', ms: 'number' }, when: 'Once per life: the first activity finished and paid (server_ms: server time from the life’s creation).', why: 'Funnel step 4 and the headline number: time to first reward.' },
  save_character_offered: { from: 'quick-start', props: { trigger: 'string', step: 'number', ms: 'number' }, when: 'The "Make this life yours" sheet was put in front of a guest (trigger: first-reward | third-activity | next-day | home | buy | asked).', why: 'Which offer converts.' },
  settle_traits_done: { from: 'quick-start', props: { ms: 'number' }, when: 'Once per life: the traits step of settling in was saved.', why: 'Drop-off per step of settling in.' },
  settle_dream_done: { from: 'quick-start', props: { ms: 'number' }, when: 'Once per life: the dream step was saved.', why: 'Drop-off per step of settling in.' },
  settle_lottery_done: { from: 'quick-start', props: { ms: 'number' }, when: 'Once per life: the birth lottery was rolled.', why: 'Drop-off per step of settling in.' },
  save_character_done: { from: 'quick-start', props: { activities: 'number', ms: 'number' }, when: 'Once per life: the life settled in (it has its local government and its house).', why: 'Funnel step 5: guest → resident.' },
  join_landed: { from: 'quick-start', props: { code: 'string', ms: 'number' }, when: 'A new visitor’s invite link was answered (code: joined | here | at_home | reconnecting | out | offline | refused).', why: 'How often an invite puts two people in the same place.' },

  // ---- After the first minute (derived by telemetry from the server’s states: src/telemetry/funnel.ts)
  activity_completed: { from: 'client', props: { activity_id: 'string', venue_id: 'string' }, when: 'Every time a timed activity ran to its end (not when cancelled).', why: 'What players actually do; engagement per venue.' },
  first_travel: { from: 'client', props: { mode: 'string', ms_since_session: 'number', backfill: 'boolean' }, when: 'Once per life: the first completed trip.', why: 'Funnel step 6.' },
  first_job_shift: { from: 'client', props: { job_id: 'string', ms_since_session: 'number', backfill: 'boolean' }, when: 'Once per life: the first completed work shift.', why: 'Funnel step 7.' },
  streak_day: { from: 'client', props: { days: 'number', stamps: 'number' }, when: 'The life’s count of days lived actively went up (once per Lagos day; the count never goes down). stamps: days played this week.', why: 'Return rhythm, counted kindly: days played, not days missed.' },
  event_joined: { from: 'client', props: { venue_id: 'string', total: 'number' }, when: 'The player showed up at an event of the calendar (the life’s count of events attended went up).', why: 'Do scheduled events bring people to a place?' },

  // ---- Where you live (the world layer: src/ui/panels/lga-card.js, world-panels.js, src/life-main.js)
  lga_chosen: { from: 'world', props: { method: 'string', lga: 'string' }, when: 'A local government was chosen or changed (method: device | manual; lga: its id, one of a fixed list — never a position).', why: 'How people choose where they live; which areas fill.' },
  // ---- The UNILAG campus (src/life-main.js, from the server's own state as it changes; the programme id only)
  campus_enrolled: { from: 'campus', props: { programme: 'string' }, when: 'Once per enrolment: the server matriculated this life as a UNILAG student.', why: 'How many visitors to the campus become students.' },
  campus_graduated: { from: 'campus', props: { programme: 'string' }, when: 'Once per degree: the server recorded the graduation.', why: 'How many students finish the two semesters.' },

  house_allocated: { from: 'world', props: {}, when: 'The server set a plot aside for this life (or moved it). No address.', why: 'Settle-in ends with a house on the map.' },
  house_styled: { from: 'world', props: {}, when: 'The look of the player’s house was changed.', why: 'Is house styling used?' },
  estate_viewed: { from: 'world', props: { lga: 'string' }, when: 'A local government’s page (its estates and residents directory) was opened.', why: 'Do people look around their area?' },
  neighbour_card_opened: { from: 'world', props: { from: 'string' }, when: 'A resident’s card was opened (from: directory | map).', why: 'Does the directory lead to people?' },

  // ---- Missions, tables, sharing and outreach (the growth panels: src/ui/panels/*, src/tables/client.ts)
  mission_completed: { from: 'growth', props: { kind: 'string' }, when: 'A finished mission was collected (kind: life | discovery | social).', why: 'Which missions get done.' },
  table_sat: { from: 'growth', props: { game: 'string' }, when: 'The player sat down at a game table.', why: 'Table adoption per game.' },
  match_started: { from: 'growth', props: { game: 'string', vs: 'string' }, when: 'A table game the player sits in began (vs: player | bot).', why: 'Real matches against people.' },
  match_finished: { from: 'growth', props: { game: 'string', result: 'string' }, when: 'A table game the player sat in ended (result: won | lost | draw | called_off).', why: 'Completion of matches.' },
  share_card_created: { from: 'growth', props: { kind: 'string' }, when: 'A share link and card were made (kind: invite | house | missions | week | table | event).', why: 'What people share.' },
  invite_created: { from: 'growth', props: {}, when: 'A share that invites someone was made (invite, house or table).', why: 'Top of the invite funnel.' },
  share_opened: { from: 'growth', props: { surface: 'string' }, when: 'The share sheet opened with a link ready (surface: hud | prompt | phone | table | other).', why: 'Where people start sharing from.' },
  share_channel: { from: 'growth', props: { channel: 'string' }, when: 'A button of the share sheet was pressed (channel: copy | native | whatsapp | x | telegram | qr).', why: 'Which way of sending the link people choose.' },
  invite_prompt_shown: { from: 'growth', props: { moment: 'string' }, when: 'The invitation chip appeared (moment: first-goal | home | empty-venue | table-win); at most once per moment per device.', why: 'How often the prompts reach people, per moment.' },
  invite_prompt_dismissed: { from: 'growth', props: { moment: 'string' }, when: 'The invitation chip was closed with "Not now" (same moments).', why: 'Whether a prompt is too much: dismissals per moment against shown.' },
  invite_opened: { from: 'quick-start', props: { kind: 'string', has_session: 'boolean' }, when: 'Once per page load: the page was opened from an invite, share or table link (kind: house | share | table).', why: 'Invite funnel step 2.' },
  invite_joined: { from: 'quick-start', props: { kind: 'string' }, when: 'A new life was attached to the sharer’s link as a referral (once per life; nothing is paid yet).', why: 'Invite funnel step 3.' },
  invite_colocated: { from: 'quick-start', props: { kind: 'string' }, when: 'A visitor who came by a link was put in the same venue as the player it pointed at.', why: 'Invite funnel step 4: the invite produced time together.' },
  referral_rewarded: { from: 'growth', props: {}, when: 'A referral gift was paid to this player (after the friend’s paid work).', why: 'Bottom of the invite funnel.' },
  push_prompt_shown: { from: 'growth', props: {}, when: 'The game’s own notification explanation was shown (before the browser’s prompt).', why: 'Push opt-in funnel.' },
  push_prompt_accepted: { from: 'growth', props: {}, when: 'Notifications were switched on.', why: 'Push opt-in funnel.' },
  push_prompt_declined: { from: 'growth', props: {}, when: 'The notification prompt was declined (in the game or in the browser).', why: 'Push opt-in funnel.' },
  email_optin_started: { from: 'growth', props: {}, when: 'A consented e-mail address was submitted. The address is never an event property.', why: 'E-mail opt-in funnel.' },
  email_optin_confirmed: { from: 'growth', props: {}, when: 'The address was confirmed from its e-mail.', why: 'E-mail opt-in funnel.' },
  unsubscribed: { from: 'growth', props: { channel: 'string' }, when: 'A channel was switched off in the game (channel: push | email).', why: 'Are messages welcome?' },

  // ---- People (recorded by the server for players who accepted: server/telemetry/instrument.ts) ---
  friend_request_sent: { from: 'server', props: {}, when: 'A friend request was stored (not a repeat).', why: 'Start of the friend loop.' },
  friend_made: { from: 'server', props: { role: 'string' }, when: 'A friend request was accepted; sent for each of the two players who has accepted analytics (role: accepter | asker).', why: 'Meaningful interaction; invite → friend conversion.' },
  house_knock_sent: { from: 'server', props: {}, when: 'A player knocked at another player’s home (not a repeat).', why: 'House invites as they exist today.' },
  house_knock_answered: { from: 'server', props: { accepted: 'boolean' }, when: 'A host answered a knock.', why: 'How often an invite is accepted.' },
  house_visit: { from: 'server', props: { role: 'string' }, when: 'Once per stay: a guest and the host are in the host’s Home room together (role: guest | host).', why: 'The invite ended with both players in the same place.' },

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
export const ACTIVATION_FUNNEL = Object.freeze(['landed', 'play_tapped', 'arrived', 'first_activity_completed', 'save_character_done', 'first_travel', 'first_job_shift', 'day2_return']);
/** The invite funnel, in order. */
export const INVITE_FUNNEL = Object.freeze(['invite_created', 'invite_opened', 'invite_joined', 'invite_colocated', 'referral_rewarded']);

/** The events that reach the facade as `jaw:track` DOM events from the game's own screens (everything not derived or server-side). */
export const TRACKED_EVENTS = Object.freeze(Object.keys(EVENTS).filter((name) => { const from = EVENTS[name]?.from; return from !== undefined && ['quick-start', 'world', 'growth', 'campus'].includes(from); }));

/** The property names an event may carry, or null for an event that is not in the catalogue. */
export function allowedProps(name: string): string[] | null { const spec = Object.hasOwn(EVENTS, name) ? EVENTS[name] : undefined; return spec ? Object.keys(spec.props) : null; }

/**
 * Properties checked against the catalogue: only listed names, each of its listed type.
 * `clean` is the generic scrubber (scrubProps), passed in so this file stays pure data.
 */
export function checkProps(name: string, props: unknown, clean: (props: unknown, options: { allow: readonly string[] | null }) => SafeProps): SafeProps {
  const spec = (Object.hasOwn(EVENTS, name) ? EVENTS[name] : undefined) ?? null;
  const safe = clean(props, { allow: spec ? Object.keys(spec.props) : null });
  if (spec) for (const key of Object.keys(safe)) if (typeof safe[key] !== spec.props[key]) delete safe[key];
  return safe;
}
