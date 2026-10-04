import './community.css';

export async function createCommunity(container, { cityId = 'lagos', venueId = 'park', onStatus = () => {}, audioStreamFactory = null, diagnostics = false, onPeerStats = () => {}, iceTransportPolicy = 'all' } = {}) {
  container.innerHTML = `<section class="community" aria-label="Local community">
    <header class="community-header"><div><span class="community-eyebrow">People nearby</span><h2>Community</h2></div><span class="community-connection" role="status">Connecting…</span></header>
    <p class="community-room"></p>
    <form class="community-name"><label for="community-nickname">Choose a device nickname</label><div class="community-input-row"><input id="community-nickname" name="name" required minlength="3" maxlength="24" autocomplete="nickname" placeholder="Your name"><button>Join room</button></div><p>This nickname is saved on this device. It is not a verified identity.</p></form>
    <p class="community-private-note" hidden>Your home is private to this device session. Public nearby voice and community chat are available at shared venues.</p><div class="community-content" hidden><div class="community-presence"><h3>In this room <span class="community-count">0</span></h3><ul class="community-members" aria-label="Room members"></ul></div>
    <div class="community-proximity"><h3>Nearby voice</h3><p class="community-position" role="status">Waiting for your venue position…</p><div class="community-position-map" role="img" aria-label="People in venue voice space"></div><div class="community-movement" aria-label="Move within venue voice space"><button type="button" class="community-north" aria-label="Move north two units">↑ North</button><button type="button" class="community-west" aria-label="Move west two units">← West</button><button type="button" class="community-south" aria-label="Move south two units">↓ South</button><button type="button" class="community-east" aria-label="Move east two units">East →</button></div><p class="community-position-note">Move in this venue voice space. Nearby voices fade with distance and stop at 12 units. This map does not move the scene’s characters.</p></div><div class="community-voice"><div class="community-voice-top"><h3>Voice circle</h3><button class="community-join-voice" type="button">Join voice</button><button class="community-mute" type="button" hidden>Mute mic</button><button class="community-leave-voice" type="button" hidden>Leave voice</button></div><p class="community-voice-status" role="status">Your microphone is off. Join voice to request access.</p><div class="community-device" hidden><label for="community-microphone">Microphone</label><select id="community-microphone" aria-label="Microphone device"></select><small>Device changes apply the next time you join voice.</small></div><p class="community-playback-note" hidden></p><p class="community-network-note">Relay availability is checked when you join voice. Microphone starts muted.</p><div class="community-audio"></div></div>
    <div class="community-chat"><h3>Room chat</h3><ol class="community-messages" aria-label="Room messages" aria-live="polite" aria-relevant="additions"></ol><form class="community-compose"><label class="community-sr-only" for="community-message">Message this room</label><div class="community-input-row"><input id="community-message" maxlength="500" required autocomplete="off" placeholder="Say hello to this room…"><button>Send</button></div></form></div></div>
    <div class="community-feedback" role="status"></div><button class="community-retry" type="button" hidden>Reconnect</button>
  </section>`;
  const $ = (selector) => container.querySelector(selector);
  const el = {
    connection: $('.community-connection'), room: $('.community-room'), name: $('.community-name'), content: $('.community-content'),
    members: $('.community-members'), count: $('.community-count'), messages: $('.community-messages'), compose: $('.community-compose'),
    join: $('.community-join-voice'), mute: $('.community-mute'), leave: $('.community-leave-voice'), voice: $('.community-voice-status'),
    proximity: $('.community-proximity'), voiceSection: $('.community-voice'), chatSection: $('.community-chat'), privateNote: $('.community-private-note'),
    position: $('.community-position'), positionMap: $('.community-position-map'), north: $('.community-north'), south: $('.community-south'), west: $('.community-west'), east: $('.community-east'), relay: $('.community-network-note'), playbackNote: $('.community-playback-note'),
    audio: $('.community-audio'), device: $('.community-device'), deviceSelect: $('#community-microphone'), feedback: $('.community-feedback'), retry: $('.community-retry'),
  };
  let room = { cityId, venueId }, session = null, socket = null, members = [], stream = null;
  let destroyed = false, connected = false, roomReady = false, voice = false, muted = false, joiningVoice = false;
  let reconnectTimer = null, attempts = 0, voiceGeneration = 0, selectedDevice = '', diagnosticsTimer = null;
  let iceConfig = null, iceConfigRequest = null, playbackContext = null;
  const VOICE_RADIUS = 12, SPACE_BOUND = 20;
  const sourceLabel = audioStreamFactory ? 'Test audio' : 'Microphone';
  const diagnosticsPanel = diagnostics ? document.createElement('pre') : null;
  if (diagnosticsPanel) { diagnosticsPanel.className = 'community-diagnostics'; diagnosticsPanel.setAttribute('aria-label', 'Synthetic test connection diagnostics'); el.audio.append(diagnosticsPanel); }
  const rejectedPeers = new Set();
  const peers = new Map(), pending = new Map(), seen = new Set(), listeners = [];
  const listen = (target, event, handler) => { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); };
  const feedback = (message) => { el.feedback.textContent = message; };
  const report = (label) => {
    el.connection.textContent = label;
    const status = label === 'Connected' ? 'online' : label === 'Choose a nickname' ? 'session-required' : /Connecting|Reconnecting/.test(label) ? 'connecting' : 'offline';
    onStatus({ connected, session: session ? { ...session } : null, status });
  };
  const send = (message) => { if (socket?.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify(message)); return true; };
  const roomLabel = () => {
    const privateHome = room.venueId === 'home';
    const venueName = privateHome ? 'Your home (private)' : room.venueId === 'library' ? 'Library' : room.venueId === 'club' ? 'Club' : 'Park';
    el.room.textContent = `${room.cityId === 'ibadan' ? 'Ibadan' : 'Lagos'} · ${venueName}`;
    el.proximity.hidden = privateHome; el.voiceSection.hidden = privateHome; el.chatSection.hidden = privateHome; el.privateNote.hidden = !privateHome;
  };
  roomLabel();

  function validPosition(member) {
    const position = member?.position;
    return position && Number.isFinite(position.x) && Number.isFinite(position.z) ? position : null;
  }
  function distanceTo(member) {
    const self = validPosition(members.find((person) => person.id === session?.id)), other = validPosition(member);
    return self && other ? Math.hypot(self.x - other.x, self.z - other.z) : Infinity;
  }
  function nearby(member) { return room.venueId !== 'home' && !rejectedPeers.has(member?.id) && member?.enabled && member.id !== session?.id && distanceTo(member) < VOICE_RADIUS; }
  function moveTo(x, z) {
    if (!roomReady || room.venueId === 'home' || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    return send({ type: 'move', x: Math.max(-SPACE_BOUND, Math.min(SPACE_BOUND, x)), z: Math.max(-SPACE_BOUND, Math.min(SPACE_BOUND, z)) });
  }
  function step(dx, dz) {
    const self = validPosition(members.find((person) => person.id === session?.id));
    if (self) moveTo(self.x + dx, self.z + dz);
  }
  function renderPosition() {
    el.positionMap.replaceChildren();
    const self = validPosition(members.find((person) => person.id === session?.id));
    el.position.textContent = self ? `Your voice position: ${self.x.toFixed(1)}, ${self.z.toFixed(1)} · range ${VOICE_RADIUS} units` : 'Waiting for your venue position…';
    for (const button of [el.north, el.south, el.west, el.east]) button.disabled = !roomReady || !self;
    if (self) {
      const range = document.createElement('span'); range.className = 'community-hearing-range';
      range.style.left = `${(self.x + SPACE_BOUND) * 2.5}%`; range.style.top = `${(self.z + SPACE_BOUND) * 2.5}%`; el.positionMap.append(range);
    }
    for (const member of members) {
      const position = validPosition(member); if (!position) continue;
      const pin = document.createElement('span'); pin.className = `community-position-pin${member.id === session?.id ? ' is-self' : ''}${member.enabled ? ' is-speaking' : ''}`;
      pin.style.left = `${(position.x + SPACE_BOUND) * 2.5}%`; pin.style.top = `${(position.z + SPACE_BOUND) * 2.5}%`;
      pin.textContent = member.id === session?.id ? 'You' : member.name;
      pin.title = `${member.name}: ${position.x.toFixed(1)}, ${position.z.toFixed(1)}${member.id !== session?.id ? ` · ${distanceTo(member).toFixed(1)} units away` : ''}`;
      el.positionMap.append(pin);
    }
    const labels = members.filter(validPosition).map((member) => `${member.name} at ${member.position.x}, ${member.position.z}`);
    el.positionMap.setAttribute('aria-label', `Venue voice space, north at top. ${labels.join('; ')}`);
  }
  async function ensureVoiceConfig(generation) {
    const expired = iceConfig?.expiresAt && Date.now() >= iceConfig.expiresAt;
    if (iceConfig && !expired) return true;
    if (!iceConfigRequest) iceConfigRequest = fetch('/api/voice-config').then(async (response) => {
      if (!response.ok) throw new Error('Voice configuration unavailable');
      const config = await response.json();
      if (!Array.isArray(config.iceServers) || !config.iceServers.length) throw new Error('Voice configuration unavailable');
      const expiresAt = config.expiresAt ? (typeof config.expiresAt === 'number' ? config.expiresAt : Date.parse(config.expiresAt)) : null;
      if (expiresAt && expiresAt <= Date.now()) throw new Error('Voice relay credentials expired');
      return { ...config, expiresAt };
    }).catch(() => { throw new Error('Voice configuration unavailable'); }).finally(() => { iceConfigRequest = null; });
    const config = await iceConfigRequest;
    if (destroyed || generation !== voiceGeneration) return false;
    iceConfig = config;
    el.relay.textContent = config.turnConfigured ? 'TURN relay configured. Nearby voice can use the relay when a direct connection is unavailable.' : 'Direct-only voice (STUN): no TURN relay is available yet. Restrictive networks may fail to connect.';
    return true;
  }
  function renderMembers() {
    el.members.replaceChildren();
    el.count.textContent = String(members.length);
    for (const member of members) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${member.name}${member.id === session?.id ? ' (you)' : ''}`;
      const state = document.createElement('small');
      state.textContent = member.enabled ? `${member.muted ? 'Mic muted' : 'In voice'}${member.id !== session?.id ? distanceTo(member) < VOICE_RADIUS ? ' · near' : ' · out of range' : ''}` : 'Here';
      li.append(name, state); el.members.append(li);
    }
    renderPosition();
  }
  function voiceStatus() {
    el.join.hidden = voice; el.join.disabled = joiningVoice || !roomReady;
    el.join.textContent = joiningVoice ? (audioStreamFactory ? 'Preparing test audio…' : 'Requesting microphone…') : (audioStreamFactory ? 'Join test audio' : 'Join voice');
    el.mute.hidden = !voice; el.leave.hidden = !voice;
    el.mute.textContent = muted ? (audioStreamFactory ? 'Unmute test audio' : 'Unmute mic') : (audioStreamFactory ? 'Mute test audio' : 'Mute mic'); el.mute.setAttribute('aria-pressed', String(muted));
    if (!voice) {
      el.voice.textContent = audioStreamFactory ? (joiningVoice ? 'Preparing synthetic audio…' : 'Synthetic test audio is off. Join test audio to start.') : joiningVoice ? 'Waiting for microphone permission…' : 'Your microphone is off. Join voice to request access.';
      return;
    }
    const active = [...peers.values()].filter((peer) => peer.pc.connectionState === 'connected').length;
    const failed = [...peers.values()].some((peer) => ['failed', 'disconnected'].includes(peer.pc.connectionState));
    el.voice.textContent = `${sourceLabel} ${muted ? 'muted.' : 'on.'} ${failed ? 'A peer connection has been interrupted; leave and rejoin to retry.' : active ? `Connected to ${active} ${active === 1 ? 'person' : 'people'}.` : peers.size ? 'Connecting to nearby people…' : 'No one in voice is within 12 units. Move closer on the venue map.'}`;
  }
  function closePeer(id) {
    const peer = peers.get(id); if (!peer) return;
    peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null;
    peer.pc.close(); peer.remoteStream?.getTracks().forEach((track) => track.stop());
    peer.audioSource?.disconnect(); peer.gainNode?.disconnect(); peer.analyser?.disconnect();
    peer.audio.srcObject = null; peer.wrapper.remove(); peers.delete(id);
  }
  function leaveVoice(notify = true) {
    voiceGeneration++; clearInterval(diagnosticsTimer); diagnosticsTimer = null; joiningVoice = false; voice = false; muted = false;
    stream?.getTracks().forEach((track) => track.stop()); stream = null; iceConfig = null;
    [...peers.keys()].forEach(closePeer);
    closePlaybackContext();
    if (notify) send({ type: 'voice-state', enabled: false, muted: false });
    voiceStatus();
    if (diagnosticsPanel) diagnosticsPanel.textContent = JSON.stringify({ voice: false, muted: false, trackCount: 0, liveTrackCount: 0, peers: [] }, null, 2);
  }
function closePlaybackContext() {
    const context = playbackContext; playbackContext = null; context?.close().catch(() => {});
  }
  function setPeerGain(id, peer) {
    const gain = Math.max(0, 1 - distanceTo(members.find((member) => member.id === id)) / VOICE_RADIUS);
    peer.gain = gain;
    if (peer.gainNode) peer.gainNode.gain.value = gain;
    else peer.audio.volume = gain;
  }
  function signal(id, data) { if (voice && nearby(members.find((member) => member.id === id))) send({ type: 'signal', to: id, data }); }
  function makePeer(id) {
    if (peers.has(id)) return peers.get(id);
    if (!voice || !stream || id === session.id) return null;
    const member = members.find((person) => person.id === id);
    if (!nearby(member) || !iceConfig) return null;
    const pc = new RTCPeerConnection({ iceServers: iceConfig.iceServers, iceTransportPolicy: iceTransportPolicy === 'relay' ? 'relay' : 'all' });
    const wrapper = document.createElement('div'), audio = document.createElement('audio'), play = document.createElement('button');
    audio.autoplay = true; audio.playsInline = true;
    play.type = 'button'; play.textContent = `Play audio from ${member.name}`; play.hidden = true;
    play.addEventListener('click', () => audio.play().then(() => { peer.htmlSinkState = 'playing'; play.hidden = true; }).catch(() => feedback('Audio playback is blocked. Check your browser sound permissions.')));
    wrapper.append(audio, play); el.audio.append(wrapper);
    audio.volume = Math.max(0, 1 - distanceTo(member) / VOICE_RADIUS);
    const peer = { pc, audio, wrapper, gain: audio.volume, htmlSinkState: 'idle', candidates: [], chain: Promise.resolve() };
    peers.set(id, peer);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = ({ candidate }) => { if (candidate) signal(id, { candidate: candidate.toJSON() }); };
    pc.onconnectionstatechange = voiceStatus;
    pc.ontrack = ({ streams, track }) => {
      const remoteStream = streams[0] || new MediaStream([track]);
      peer.remoteStream = remoteStream; audio.muted = Boolean(playbackContext); audio.srcObject = remoteStream;
      const startMutedSink = () => {
        audio.muted = true;
        audio.play().then(() => { if (peers.get(id) === peer) peer.htmlSinkState = 'playing'; }).catch(() => {
          if (peers.get(id) !== peer) return;
          peer.htmlSinkState = 'blocked'; play.hidden = false; feedback('Tap the audio button to enable received audio playback.');
        });
      };
      if (peer.gainNode) { startMutedSink(); return; }
      if (playbackContext && !peer.audioSource) {
        try {
          peer.audioSource = playbackContext.createMediaStreamSource(remoteStream);
          peer.gainNode = playbackContext.createGain(); peer.gainNode.gain.value = peer.gain;
          peer.audioSource.connect(peer.gainNode); peer.gainNode.connect(playbackContext.destination);
          if (diagnostics) {
            peer.analyser = playbackContext.createAnalyser(); peer.analyser.fftSize = 512;
            peer.audioSamples = new Float32Array(peer.analyser.fftSize); peer.gainNode.connect(peer.analyser);
          }
          audio.muted = true; play.hidden = true; startMutedSink();
          return;
        } catch {
          peer.audioSource?.disconnect(); peer.gainNode?.disconnect(); peer.analyser?.disconnect();
          peer.audioSource = null; peer.gainNode = null; peer.analyser = null;
          el.playbackNote.hidden = false; el.playbackNote.textContent = 'Spatial playback is unavailable for this connection. Browser audio volume is a fallback and may not fade reliably on every device; the distance cutoff still applies.';
        }
      }
      audio.muted = false;
      audio.play().catch(() => { play.hidden = false; feedback('Tap the audio button to hear a person in your voice circle.'); });
    };
    return peer;
  }
  function peerOperation(id, operation) {
    const peer = makePeer(id); if (!peer) return;
    peer.chain = peer.chain.then(async () => { if (peers.get(id) === peer) await operation(peer); }).catch(() => {
      if (voice && peers.get(id) === peer) { feedback('A voice connection could not be established. Leave and rejoin voice to retry.'); voiceStatus(); }
    });
  }
  async function syncPeers() {
    if (!voice) return;
    let eligible = new Set(members.filter(nearby).map((member) => member.id));
    for (const id of peers.keys()) if (!eligible.has(id)) closePeer(id);
    for (const [id, peer] of peers) setPeerGain(id, peer);
    const generation = voiceGeneration;
    try { if ([...eligible].some((id) => !peers.has(id)) && !await ensureVoiceConfig(generation)) return; } catch { feedback('Relay configuration could not be refreshed. New voice connections are paused.'); return; }
    if (!voice || generation !== voiceGeneration) return;
    eligible = new Set(members.filter(nearby).map((member) => member.id));
    for (const id of eligible) {
      if (peers.has(id)) continue;
      const peer = makePeer(id);
      if (peer && session.id < id) peerOperation(id, async ({ pc }) => {
        await pc.setLocalDescription(await pc.createOffer()); signal(id, { description: pc.localDescription.toJSON() });
      });
    }
    voiceStatus();
  }
  async function receiveSignal(message) {
    if (!voice || !nearby(members.find((member) => member.id === message.from))) return;
    const generation = voiceGeneration;
    try { if (!peers.has(message.from) && !await ensureVoiceConfig(generation)) return; } catch { feedback('Voice configuration could not be refreshed.'); return; }
    if (!voice || generation !== voiceGeneration || !nearby(members.find((member) => member.id === message.from))) return;
    const data = message.data;
    if (!data || typeof data !== 'object') return;
    peerOperation(message.from, async (peer) => {
      const { pc } = peer;
      if (data.description) {
        const description = data.description;
        if (!['offer', 'answer'].includes(description.type)) return;
        // Only the lower session id offers, so both sides cannot negotiate at once.
        if (description.type === 'offer' && message.from > session.id) return;
        if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(description);
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
        if (description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer()); signal(message.from, { description: pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else if (peer.candidates.length < 100) peer.candidates.push(data.candidate);
      }
    });
  }
  function appendChat(message, delivery = 'Sent') {
    const li = document.createElement('li'), meta = document.createElement('div'), author = document.createElement('strong');
    const body = document.createElement('p'), status = document.createElement('small');
    author.textContent = message.from?.name || session.name;
    status.textContent = delivery;
    meta.append(author, status); body.textContent = message.body; li.append(meta, body); el.messages.append(li);
    while (el.messages.children.length > 80) el.messages.firstElementChild.remove();
    el.messages.scrollTop = el.messages.scrollHeight;
    return { li, status };
  }
  function retryPending() {
    if (!roomReady) return;
    for (const [clientId, message] of pending) {
      if (message.sent || message.failed) continue;
      message.sent = send({ type: 'chat', body: message.body, clientId }); message.status.textContent = 'Sending…';
    }
  }
  function receive(event) {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'presence') {
      members = message.members || []; rejectedPeers.clear(); roomReady = true; renderMembers(); retryPending(); syncPeers(); voiceStatus();
    } else if (message.type === 'chat') {
      if (seen.has(message.id)) return;
      seen.add(message.id); if (seen.size > 100) seen.delete(seen.values().next().value);
      const local = pending.get(message.clientId);
      if (local && message.from?.id === session.id) { local.status.textContent = 'Sent'; local.retry?.remove(); pending.delete(message.clientId); }
      else appendChat(message);
    } else if (message.type === 'signal') receiveSignal(message);
    else if (message.type === 'error') {
      const rejected = pending.get(message.clientId);
      if (rejected) {
        rejected.failed = true; rejected.sent = false; rejected.status.textContent = 'Not sent';
        if (!rejected.retry) {
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry message';
          retry.addEventListener('click', () => {
            if (destroyed || !pending.has(message.clientId)) return;
            rejected.failed = false; rejected.sent = false; rejected.status.textContent = roomReady ? 'Sending…' : 'Pending reconnection';
            retry.hidden = true; retryPending();
          });
          rejected.retry = retry; rejected.li.append(retry);
        }
        rejected.retry.hidden = false;
      }
      if (message.error === 'peer_out_of_range') {
        const rejected = message.to ? [message.to] : [...peers].filter(([, peer]) => peer.pc.connectionState !== 'connected').map(([id]) => id);
        for (const id of rejected) { rejectedPeers.add(id); closePeer(id); }
        voiceStatus(); return;
      }
      if (message.error === 'voice_room_full') { leaveVoice(); feedback('This voice circle is full. Try joining when someone leaves.'); }
      else if (message.error === 'rate_limited') feedback('Messages are arriving too quickly. Pause briefly before sending more.');
      else feedback(message.message || 'The room could not process that action.');
    }
  }
  function connect() {
    if (destroyed || !session || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(reconnectTimer); roomReady = false; el.retry.hidden = true; report(attempts ? 'Reconnecting…' : 'Connecting…'); voiceStatus();
    const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`); socket = current;
    current.onopen = () => { if (destroyed || socket !== current) return; connected = true; attempts = 0; report('Connected'); send({ type: 'join', ...room }); };
    current.onmessage = (event) => { if (!destroyed && socket === current) receive(event); };
    current.onclose = () => {
      if (destroyed || socket !== current) return;
      socket = null; connected = false; roomReady = false; members = []; renderMembers(); leaveVoice(false);
      for (const message of pending.values()) { message.sent = false; if (!message.failed) message.status.textContent = 'Pending reconnection'; }
      report('Disconnected');
      if (attempts < 5) { const delay = Math.min(1000 * 2 ** attempts, 15000); attempts++; reconnectTimer = setTimeout(connect, delay); }
      else { el.retry.hidden = false; feedback('The room is offline. Reconnect when the server is available.'); }
    };
    current.onerror = () => report('Connection unavailable');
  }
  async function joinVoice() {
    if (!roomReady || room.venueId === 'home' || joiningVoice || voice) return;
    if ((!audioStreamFactory && !navigator.mediaDevices?.getUserMedia) || !window.RTCPeerConnection) { feedback('Voice needs a supported browser on localhost or HTTPS.'); return; }
    const generation = ++voiceGeneration; joiningVoice = true; feedback(''); voiceStatus();
    let resumePlayback = Promise.resolve();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    el.playbackNote.hidden = true;
    if (AudioContext) {
      try {
        playbackContext = new AudioContext(); const context = playbackContext;
        resumePlayback = context.resume().then(() => { if (context.state && context.state !== 'running') throw new Error('Playback suspended'); });
      } catch { resumePlayback = Promise.reject(new Error('Playback unavailable')); }
    } else resumePlayback = Promise.reject(new Error('WebAudio unsupported'));
    try {
      try { await resumePlayback; } catch {
        if (destroyed || generation !== voiceGeneration) return;
        closePlaybackContext(); el.playbackNote.hidden = false;
        el.playbackNote.textContent = 'This browser cannot use spatial WebAudio playback. Browser audio volume is a fallback and may not fade reliably on every device; the distance cutoff still applies.';
      }
      if (destroyed || generation !== voiceGeneration) return;
      if (!await ensureVoiceConfig(generation) || !roomReady) return;
      const constraints = { audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true, video: false };
      const acquired = await (audioStreamFactory ? audioStreamFactory(constraints) : navigator.mediaDevices.getUserMedia(constraints));
      acquired.getAudioTracks().forEach((track) => { track.enabled = false; });
      if (destroyed || generation !== voiceGeneration || !roomReady) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired; voice = true; muted = true; joiningVoice = false;
      stream.getAudioTracks().forEach((track) => { track.onended = () => { if (voice) { leaveVoice(); feedback('Microphone access ended. Join voice to try again.'); } }; });
      send({ type: 'voice-state', enabled: true, muted: true }); syncPeers(); voiceStatus();
      if (!audioStreamFactory) loadMicrophones(generation);
      if (diagnostics) { updateDiagnostics(generation); diagnosticsTimer = setInterval(() => updateDiagnostics(generation), 1000); }
    } catch (error) {
      if (generation !== voiceGeneration || destroyed) return;
      leaveVoice(false); feedback(error.name === 'NotAllowedError' ? 'Microphone permission was denied. You can still use room chat.' : error.message?.includes('configuration') || error.message?.includes('credentials') ? 'Voice connection settings are unavailable. Try joining again when the relay service is ready.' : 'No microphone could be opened. Check your device and try again.');
    }
  }
  async function getDiagnostics() {
    const peerStats = await Promise.all([...peers].map(async ([id, peer]) => {
      const result = { id, connectionState: peer.pc.connectionState, inboundPacketsReceived: 0, totalAudioEnergy: 0, outboundPacketsSent: 0, rms: null, gain: peer.gain, playbackMode: peer.gainNode ? 'web-audio' : 'media-element-fallback', htmlSinkState: peer.htmlSinkState, distance: distanceTo(members.find((member) => member.id === id)), sourceAudioLevel: null, sourceTotalAudioEnergy: null, inboundAudioLevel: null, receiverTracks: peer.remoteStream?.getAudioTracks?.().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })) || [] };
      try {
        if (peer.analyser) {
          peer.analyser.getFloatTimeDomainData(peer.audioSamples);
          result.rms = Math.sqrt(peer.audioSamples.reduce((sum, value) => sum + value * value, 0) / peer.audioSamples.length);
        }
        const stats = await peer.pc.getStats();
        let selectedPairId = null;
        stats.forEach((stat) => { if (stat.type === 'transport' && stat.selectedCandidatePairId) selectedPairId = stat.selectedCandidatePairId; });
        if (!selectedPairId) stats.forEach((stat) => { if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') selectedPairId = stat.id; });
        const pair = selectedPairId && stats.get(selectedPairId);
        if (pair) { result.localCandidateType = stats.get(pair.localCandidateId)?.candidateType || null; result.remoteCandidateType = stats.get(pair.remoteCandidateId)?.candidateType || null; }
        stats.forEach((stat) => {
          if (stat.kind !== 'audio' && stat.mediaType !== 'audio') return;
          if (stat.type === 'media-source') { if (Number.isFinite(stat.audioLevel)) result.sourceAudioLevel = stat.audioLevel; if (Number.isFinite(stat.totalAudioEnergy)) result.sourceTotalAudioEnergy = stat.totalAudioEnergy; }
          if (stat.type === 'inbound-rtp') { result.inboundPacketsReceived += stat.packetsReceived || 0; result.totalAudioEnergy += stat.totalAudioEnergy || 0; if (Number.isFinite(stat.audioLevel)) result.inboundAudioLevel = stat.audioLevel; }
          if (stat.type === 'outbound-rtp') result.outboundPacketsSent += stat.packetsSent || 0;
        });
      } catch { result.statsUnavailable = true; }
      return result;
    }));
    const localTracks = stream?.getAudioTracks().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })) || [];
    const trackCount = stream?.getTracks().filter((track) => track.readyState !== 'ended').length || 0;
    const remoteTrackCount = [...peers.values()].reduce((count, peer) => count + (peer.remoteStream?.getTracks().filter((track) => track.readyState !== 'ended').length || 0), 0);
    return { voice, muted, trackCount, liveTrackCount: trackCount + remoteTrackCount, localTracks, playbackContextState: playbackContext?.state || null, position: validPosition(members.find((member) => member.id === session?.id)), relayMode: iceConfig?.mode || null, peers: peerStats };
  }
  async function updateDiagnostics(generation) {
    const snapshot = await getDiagnostics();
    if (destroyed || !voice || generation !== voiceGeneration) return;
    diagnosticsPanel.textContent = JSON.stringify(snapshot, null, 2); onPeerStats(snapshot);
  }
  async function loadMicrophones(generation) {
    if (!navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (destroyed || generation !== voiceGeneration) return;
      const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId);
      el.deviceSelect.replaceChildren();
      const fallback = document.createElement('option'); fallback.value = ''; fallback.textContent = 'System default'; el.deviceSelect.append(fallback);
      for (const [index, device] of inputs.entries()) {
        const option = document.createElement('option'); option.value = device.deviceId; option.textContent = device.label || `Microphone ${index + 1}`; el.deviceSelect.append(option);
      }
      if (selectedDevice && !inputs.some((device) => device.deviceId === selectedDevice)) selectedDevice = '';
      el.deviceSelect.value = selectedDevice; el.device.hidden = false;
    } catch { feedback('Microphone choices could not be listed. You can still use the system microphone.'); }
  }
  listen(el.north, 'click', () => step(0, -2));
  listen(el.south, 'click', () => step(0, 2));
  listen(el.west, 'click', () => step(-2, 0));
  listen(el.east, 'click', () => step(2, 0));
  listen(el.deviceSelect, 'change', () => { selectedDevice = el.deviceSelect.value; if (voice) feedback('Leave and rejoin voice to use the selected microphone.'); });
  listen(el.join, 'click', joinVoice);
  listen(el.leave, 'click', () => leaveVoice());
  listen(el.mute, 'click', () => { muted = !muted; stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; }); send({ type: 'voice-state', enabled: voice, muted }); voiceStatus(); });
  listen(el.retry, 'click', () => { attempts = 0; feedback(''); connect(); });
  listen(el.compose, 'submit', (event) => {
    event.preventDefault(); const input = el.compose.querySelector('input'), body = input.value.trim();
    if (!body) return;
    if (pending.size >= 25) { feedback('Wait for pending messages to send before adding more.'); return; }
    const clientId = crypto.randomUUID(), row = appendChat({ body, from: session }, roomReady ? 'Sending…' : 'Pending reconnection');
    const sent = roomReady && send({ type: 'chat', body, clientId });
    pending.set(clientId, { body, ...row, sent }); input.value = ''; feedback('');
  });
  listen(el.name, 'submit', async (event) => {
    event.preventDefault(); const name = el.name.querySelector('input').value.trim(), button = el.name.querySelector('button');
    if (name.length < 3) { feedback('Use a nickname with at least three characters.'); return; }
    button.disabled = true;
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error('Session unavailable');
      const result = await response.json(); if (destroyed) return; session = result.session;
      el.name.hidden = true; el.content.hidden = false; feedback(''); connect();
    } catch { feedback('Could not save your device nickname. Check the local server and try again.'); }
    finally { button.disabled = false; }
  });
  listen(window, 'pagehide', () => leaveVoice());
  try {
    const response = await fetch('/api/session');
    if (response.ok) { const result = await response.json(); session = result.session; el.name.hidden = true; el.content.hidden = false; connect(); }
    else report(response.status === 401 ? 'Choose a nickname' : 'Server unavailable');
  } catch { report('Server unavailable'); feedback('Start the local community server to join a room.'); }
  voiceStatus(); renderPosition();
  return {
    getSession() { return session ? { ...session } : null; },
    getDiagnostics,
    moveTo,
    join(nextCityId, nextVenueId) {
      if (destroyed || (room.cityId === nextCityId && room.venueId === nextVenueId)) return;
      leaveVoice(); room = { cityId: nextCityId, venueId: nextVenueId }; roomReady = false; members = [];
      for (const message of pending.values()) message.status.textContent = 'Not delivered: room changed';
      pending.clear(); seen.clear(); rejectedPeers.clear(); el.messages.replaceChildren(); renderMembers(); roomLabel();
      feedback(''); if (connected) send({ type: 'join', ...room }); voiceStatus();
    },
    destroy() {
      if (destroyed) return; destroyed = true; clearTimeout(reconnectTimer); leaveVoice();
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.close(); socket = null; }
      listeners.forEach((remove) => remove()); container.replaceChildren();
    },
  };
}
