/* Vortx Player: peer-to-peer watch party with live chat.
   Play, pause, seek, the video link and chat messages travel over PeerJS data
   channels. No video is relayed. The free public PeerJS server is only used so
   browsers can find each other. Depends on app.js (window.VX) and peerjs.min.js. */
(() => {
  'use strict';

  const VX = window.VX;
  if (!VX) return;
  const { make, toast, store, copy } = VX;
  const $ = (s, r = document) => r.querySelector(s);

  const MAX_PEOPLE = 6;            // the host plus 5 guests
  const TICK_MS = 4000;            // how often the host shares its position
  const DRIFT = 2;                 // seconds of drift allowed before a guest is corrected
  const JOIN_TIMEOUT = 15000;
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'vortx-party-';
  const CODE_RE = /^[A-Z0-9]{6}$/;

  /* ---------- State ---------- */
  let peer = null;
  let role = null;                 // 'host', 'guest' or null
  let code = '';
  let hostId = '';
  let hostConn = null;             // guest side: the connection to the host
  const conns = new Map();         // host side: guest peer id -> connection
  let roster = [];                 // [{ id, name }]
  let me = { id: '', name: '' };
  let sharedUrl = '';              // the video everyone is watching
  let wantPlaying = false;         // whether the room is playing right now
  let pendingSync = null;          // { url, t, playing } to apply once a joined video starts
  let quietUntil = 0;              // local player events before this time are not broadcast
  let tickTimer = 0;
  let joinTimer = 0;
  let ui = null;

  /* ---------- Helpers ---------- */
  const quiet = (ms = 1000) => { quietUntil = Math.max(quietUntil, Date.now() + ms); };
  const isQuiet = () => Date.now() < quietUntil;
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Guest';
  const cleanText = (s) => String(s || '').trim().slice(0, 500);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const player = () => VX.player();
  const inviteLink = () => `${location.origin}${location.pathname}?party=${code}`;

  function safeUrl(v) {
    try {
      const u = new URL(String(v));
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  }

  function randomCode() {
    const bytes = new Uint32Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map((n) => ALPHABET[n % ALPHABET.length]).join('');
  }

  function position(p) {
    let t = 0;
    try { t = p ? p.getPosition() : 0; } catch { /* not ready */ }
    return Number.isFinite(t) ? t : 0;
  }
  function state(p) {
    try { return p ? p.getState() : 'idle'; } catch { return 'idle'; }
  }
  const isPlaying = (p) => ['playing', 'buffering'].includes(state(p));

  function listen(p, event, fn) {
    try { p.off(event, fn); p.on(event, fn); } catch { /* player not set up yet */ }
  }

  /* ---------- Static DOM: icons, button, dialog ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-users" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></symbol>
    </svg>
    <dialog id="partyDialog" class="party-dialog" aria-labelledby="pdTitle">
      <form id="pdForm" class="pd-body" novalidate>
        <h2 id="pdTitle"></h2>
        <p id="pdText" class="pd-text"></p>
        <label for="pdName" class="pd-label">Your name</label>
        <input id="pdName" type="text" maxlength="24" autocomplete="nickname" placeholder="Shown to everyone in the room">
        <p id="pdMsg" class="form-msg" role="status" aria-live="polite"></p>
        <div class="pd-actions">
          <button type="button" class="btn" id="pdCancel">Cancel</button>
          <button type="submit" class="btn-primary" id="pdGo"></button>
        </div>
      </form>
    </dialog>`);

  const btn = make('button', 'btn');
  btn.type = 'button';
  btn.id = 'partyBtn';
  btn.title = 'Watch together';
  btn.setAttribute('aria-pressed', 'false');
  btn.append(VX.icon('users'), make('span', '', 'Party'));
  $('#theaterBtn').before(btn);

  const dlg = $('#partyDialog');
  const dlgUi = {
    form: $('#pdForm'), title: $('#pdTitle'), text: $('#pdText'), name: $('#pdName'),
    msg: $('#pdMsg'), go: $('#pdGo'), cancel: $('#pdCancel'),
  };
  let dialogMode = 'host';
  let dialogCode = '';

  function openDialog(mode, roomCode) {
    if (role) return;
    dialogMode = mode;
    dialogCode = roomCode || '';
    const join = mode === 'join';
    dlgUi.title.textContent = join ? 'Join the watch party' : 'Start a watch party';
    dlgUi.text.textContent = join
      ? `You were invited to room ${dialogCode}. You will watch in sync with everyone in it. Only join parties from people you trust.`
      : 'Friends who open your invite link watch in sync with you, and you can chat. Video and chat go straight between browsers. A free public server only helps them find each other.';
    dlgUi.go.textContent = join ? 'Join' : 'Start party';
    dlgUi.name.value = store.get('vx-name', '');
    dlgUi.msg.textContent = '';
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
      dlgUi.name.focus();
    } else {
      const typed = window.prompt('Your name for the party', dlgUi.name.value);
      if (typed !== null) begin(typed);
    }
  }

  dlgUi.cancel.addEventListener('click', () => dlg.close());
  dlgUi.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ensureLib()) { dlgUi.msg.textContent = 'The watch party library did not load. Reload the page and try again.'; return; }
    dlg.close();
    begin(dlgUi.name.value);
  });

  function begin(rawName) {
    me.name = cleanName(rawName);
    store.set('vx-name', me.name);
    if (dialogMode === 'join') startGuest(dialogCode);
    else startHost();
  }

  function ensureLib() { return typeof window.Peer === 'function'; }

  btn.addEventListener('click', () => {
    if (role && ui) {
      ui.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      ui.input.focus({ preventScroll: true });
    } else {
      openDialog('host');
    }
  });

  /* ---------- Panel ---------- */
  function buildPanel() {
    const panel = make('aside', 'panel party-panel');
    panel.setAttribute('aria-label', 'Watch party');
    panel.innerHTML = `
      <div class="pp-inner">
        <header class="pp-head">
          <div class="pp-title"><strong>Watch party</strong><span class="pp-code" id="ppCode"></span></div>
          <div class="pp-actions">
            <button type="button" class="btn" id="ppInvite">Invite</button>
            <button type="button" class="btn" id="ppLeave">Leave</button>
          </div>
        </header>
        <div class="pp-people" id="ppPeople"></div>
        <div class="pp-log" id="ppLog" role="log" aria-live="polite"></div>
        <p class="pp-status" id="ppStatus" hidden></p>
        <form class="pp-form" id="ppForm" autocomplete="off">
          <label class="sr-only" for="ppInput">Message</label>
          <input id="ppInput" type="text" maxlength="500" placeholder="Message everyone" disabled>
          <button type="submit" class="btn-primary" id="ppSend" aria-label="Send message" disabled><svg class="i"><use href="#i-send"/></svg></button>
        </form>
      </div>`;
    $('.stage-wrap').appendChild(panel);
    ui = {
      panel, code: $('#ppCode', panel), people: $('#ppPeople', panel), log: $('#ppLog', panel),
      status: $('#ppStatus', panel), form: $('#ppForm', panel), input: $('#ppInput', panel),
      send: $('#ppSend', panel), invite: $('#ppInvite', panel), leave: $('#ppLeave', panel),
    };
    document.body.classList.add('party-on');
    btn.setAttribute('aria-pressed', 'true');

    ui.invite.addEventListener('click', async () => {
      toast((await copy(inviteLink())) ? 'Invite link copied' : 'Could not copy the link');
    });
    ui.leave.addEventListener('click', () => leave('You left the party'));
    ui.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = cleanText(ui.input.value);
      if (!text) return;
      ui.input.value = '';
      addMsg(me.name, text, true);
      send({ type: 'chat', name: me.name, text });
    });
    document.dispatchEvent(new CustomEvent('vx:party-ready', { detail: ui }));
  }

  function setConnected(on) {
    ui.input.disabled = !on;
    ui.send.disabled = !on;
    if (on) ui.status.hidden = true;
  }

  function setStatus(text, isError) {
    ui.status.hidden = !text;
    ui.status.textContent = text || '';
    ui.status.classList.toggle('error', !!isError);
  }

  function scrollLog() {
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function pushLog(node) {
    const nearBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 80;
    ui.log.appendChild(node);
    while (ui.log.children.length > 200) ui.log.firstChild.remove();
    if (nearBottom || node.classList.contains('mine')) scrollLog();
  }

  function addMsg(name, text, mine) {
    if (!ui) return;
    const m = make('div', mine ? 'pp-msg mine' : 'pp-msg');
    m.append(make('b', '', name), make('span', '', text));
    pushLog(m);
  }

  function addSys(text) {
    if (!ui) return;
    pushLog(make('div', 'pp-sys', text));
  }

  function renderPeople() {
    if (!ui) return;
    ui.people.replaceChildren();
    roster.forEach((r) => {
      const chip = make('span', 'pp-chip' + (r.id === me.id ? ' me' : '') + (r.id === hostId ? ' host' : ''));
      chip.textContent = r.id === me.id ? `${r.name} (you)` : r.name;
      ui.people.appendChild(chip);
    });
  }

  const nameOf = (id) => (roster.find((r) => r.id === id) || {}).name || 'Someone';

  /* ---------- Messaging ---------- */
  function send(msg, exceptId) {
    try {
      if (role === 'host') {
        conns.forEach((c, id) => { if (id !== exceptId && c.open) c.send(msg); });
      } else if (hostConn && hostConn.open) {
        hostConn.send(msg);
      }
    } catch { /* a closing connection can throw; the close handler cleans up */ }
  }

  function sanitizeRoster(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_PEOPLE).map((r) => ({ id: String((r && r.id) || ''), name: cleanName(r && r.name) })).filter((r) => r.id);
  }

  function shareRoster(exceptId) {
    send({ type: 'roster', hostId, roster }, exceptId);
  }

  function onData(m, from) {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    const fromGuest = role === 'host' ? from : null;

    switch (m.type) {
      /* --- joining --- */
      case 'hello': {
        if (role !== 'host' || !fromGuest) return;
        const name = cleanName(m.name);
        roster = roster.filter((r) => r.id !== fromGuest.peer).concat({ id: fromGuest.peer, name });
        const p = player();
        const cur = VX.current();
        try {
          fromGuest.send({
            type: 'welcome', hostId, roster,
            video: cur ? { url: cur.url, sub: cur.sub || '', title: cur.title, t: position(p), playing: isPlaying(p) } : null,
          });
        } catch { /* ignore */ }
        shareRoster(fromGuest.peer);
        send({ type: 'sys', text: `${name} joined` }, fromGuest.peer);
        addSys(`${name} joined`);
        renderPeople();
        break;
      }
      case 'welcome': {
        if (role !== 'guest') return;
        clearTimeout(joinTimer);
        hostId = String(m.hostId || '');
        roster = sanitizeRoster(m.roster);
        renderPeople();
        setConnected(true);
        addSys('You joined the party.');
        if (m.video) applyLoad(m.video);
        break;
      }
      case 'roster':
        if (role !== 'guest') return;
        hostId = String(m.hostId || hostId);
        roster = sanitizeRoster(m.roster);
        renderPeople();
        break;
      case 'sys':
        if (role === 'guest') addSys(cleanText(m.text));
        break;
      case 'full':
        if (role === 'guest') endParty('That room is full.');
        break;

      /* --- playback --- */
      case 'play':
      case 'pause':
      case 'seek': {
        const t = num(m.t);
        applyPlayback(m.type, t);
        if (fromGuest) send({ type: m.type, t: Number.isFinite(t) ? t : undefined }, fromGuest.peer);
        break;
      }
      case 'load': {
        const by = fromGuest ? nameOf(fromGuest.peer) : cleanName(m.by);
        applyLoad(m);
        addSys(`${by} changed the video`);
        if (fromGuest) send({ type: 'load', url: sharedUrl, sub: m.sub || '', title: m.title, t: 0, playing: true, by }, fromGuest.peer);
        break;
      }
      case 'tick':
        if (role === 'guest') applyTick(m);
        break;

      /* --- chat --- */
      case 'chat': {
        const text = cleanText(m.text);
        if (!text) return;
        const name = fromGuest ? nameOf(fromGuest.peer) : cleanName(m.name);
        addMsg(name, text, false);
        if (fromGuest) send({ type: 'chat', name, text }, fromGuest.peer);
        break;
      }
       case 'voice': {
        if (typeof m.data !== 'string' || !m.data.startsWith('data:audio/')) return;
        const name = fromGuest ? nameOf(fromGuest.peer) : cleanName(m.name);
        document.dispatchEvent(new CustomEvent('vx:voice', { detail: { name, data: m.data, dur: m.dur } }));
        if (fromGuest) send({ type: 'voice', name, data: m.data, dur: m.dur }, fromGuest.peer);
        break;
      }
      default:
    }
  }

  /* ---------- Playback sync ---------- */
  // Local player events become messages, unless we caused them ourselves.
  const handlers = {
    play: () => local('play'),
    pause: () => local('pause'),
    seek: (e) => local('seek', e && Number.isFinite(e.offset) ? e.offset : undefined),
  };

  function local(type, t) {
    if (!role || isQuiet()) return;
    const at = t !== undefined ? t : position(player());
    if (type === 'play') wantPlaying = true;
    if (type === 'pause') wantPlaying = false;
    send({ type, t: at });
  }

  function bindPlayer() {
    const p = player();
    if (!p || !role) return;
    Object.keys(handlers).forEach((ev) => listen(p, ev, handlers[ev]));
    listen(p, 'autostartNotAllowed', notAllowed);
  }

  function notAllowed() {
    toast('Your browser blocked autoplay. Press play to join in.');
  }

  // Some JW versions resume playing after a seek. Put the player back into the room's state.
  function settle(p) {
    setTimeout(() => {
      if (!role) return;
      const s = state(p);
      if (!wantPlaying && s === 'playing') { quiet(800); p.pause(true); }
      else if (wantPlaying && s === 'paused') { quiet(800); p.play(true); }
    }, 500);
  }

  function seekTo(p, t) {
    quiet(1500);
    p.seek(t);
    settle(p);
  }

  function applyPlayback(type, t) {
    const p = player();
    if (!p || !VX.current()) return;
    quiet(1500);

    if (type === 'play') {
      wantPlaying = true;
      if (state(p) === 'idle') {
        const onFirst = () => {
          p.off('firstFrame', onFirst);
          quiet(1500);
          if (Number.isFinite(t) && t > 2) seekTo(p, t);
        };
        p.on('firstFrame', onFirst);
        p.play(true);
        return;
      }
      if (Number.isFinite(t) && Math.abs(position(p) - t) > 1.5) p.seek(t);
      p.play(true);
    } else if (type === 'pause') {
      wantPlaying = false;
      p.pause(true);
      if (Number.isFinite(t) && Math.abs(position(p) - t) > 0.8) seekTo(p, t);
    } else if (type === 'seek' && Number.isFinite(t)) {
      seekTo(p, t);
    }
  }

  function applyTick(m) {
    const p = player();
    if (!p || !VX.current() || m.url !== sharedUrl) return;
    const s = state(p);
    if (s === 'idle' || s === 'buffering' || s === 'complete') return;
    const t = num(m.t);
    const playing = !!m.playing;
    wantPlaying = playing;
    if (Number.isFinite(t) && Math.abs(position(p) - t) > DRIFT) { seekTo(p, t + (playing ? 0.3 : 0)); return; }
    if (playing && s === 'paused') { quiet(1000); p.play(true); }
    else if (!playing && s === 'playing') { quiet(1000); p.pause(true); }
  }

  function applyLoad(v) {
    const url = safeUrl(v.url);
    if (!url) return;
    const sub = v.sub ? safeUrl(v.sub) : '';
    const t = Math.max(0, num(v.t) || 0);
    sharedUrl = url;
    wantPlaying = !!v.playing;
    pendingSync = { url, t, playing: !!v.playing };
    quiet(3000);
    VX.load(url, sub, !!(v.playing || t > 2));
  }

  // Once a video that came from the room has started, move it to the room's position.
  function syncOnFirstFrame() {
    const s = pendingSync;
    const cur = VX.current();
    const p = player();
    if (!s || !cur || !p || s.url !== cur.url) return;
    pendingSync = null;
    quiet(2500);
    if (s.t > 2) p.seek(s.t);
    wantPlaying = s.playing;
    settle(p);
  }

  document.addEventListener('vx:loaded', (e) => {
    const c = e.detail;
    if (!role) return;
    bindPlayer();
    const p = player();
    if (p) listen(p, 'firstFrame', syncOnFirstFrame);

    if (c.url !== sharedUrl) {
      // You picked a new video while in the party, so everyone follows you.
      sharedUrl = c.url;
      wantPlaying = true;
      pendingSync = null;
      send({ type: 'load', url: c.url, sub: c.sub || '', title: c.title, t: 0, playing: true, by: me.name });
      addSys(`You changed the video: ${c.title}`);
    }
  });

  function startTicks() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (role !== 'host' || !conns.size) return;
      const p = player();
      if (!p || !VX.current()) return;
      send({ type: 'tick', url: sharedUrl, t: position(p), playing: isPlaying(p) });
    }, TICK_MS);
  }

  /* ---------- Connections ---------- */
  function explain(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return 'That room was not found. It may have ended, so ask the host for a fresh invite link.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return 'Could not reach the connection service. Check your internet and try again.';
      case 'browser-incompatible': return 'This browser does not support peer-to-peer connections.';
      default: return 'Could not set up the party connection. Try again in a moment.';
    }
  }

  function fail(text) {
    if (!ui) return;
    setConnected(false);
    setStatus(text, true);
  }

  function startHost() {
    role = 'host';
    hostId = '';
    buildPanel();
    setStatus('Creating your room...');
    createHostPeer(0);
  }

  function createHostPeer(attempt) {
    code = randomCode();
    const p = new window.Peer(ID_PREFIX + code, { debug: 1 });
    peer = p;

    p.on('open', (id) => {
      if (peer !== p) return;
      me.id = id;
      hostId = id;
      roster = [{ id, name: me.name }];
      ui.code.textContent = `Room ${code}`;
      setConnected(true);
      renderPeople();
      addSys('Room ready. Press Invite and send the link to your friends. The party ends when you leave.');
      const cur = VX.current();
      if (cur) { sharedUrl = cur.url; wantPlaying = isPlaying(player()); bindPlayer(); const pl = player(); if (pl) listen(pl, 'firstFrame', syncOnFirstFrame); }
      startTicks();
    });

    p.on('connection', onGuestConnection);

    p.on('disconnected', () => {
      // Lost the signalling server. Existing peer connections keep working, so just try to come back.
      setTimeout(() => { if (peer === p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch { /* ignore */ } } }, 1500);
    });

    p.on('error', (err) => {
      if (peer !== p) return;
      if (err.type === 'unavailable-id' && attempt < 4) { peer = null; p.destroy(); createHostPeer(attempt + 1); return; }
      fail(explain(err));
    });
  }

  function onGuestConnection(c) {
    c.on('open', () => {
      if (conns.size >= MAX_PEOPLE - 1) {
        try { c.send({ type: 'full' }); } catch { /* ignore */ }
        setTimeout(() => c.close(), 400);
        return;
      }
      conns.set(c.peer, c);
    });
    c.on('data', (m) => { if (conns.get(c.peer) === c) onData(m, c); });
    c.on('close', () => dropGuest(c));
    c.on('error', () => dropGuest(c));
  }

  function dropGuest(c) {
    if (conns.get(c.peer) !== c) return;
    conns.delete(c.peer);
    const name = nameOf(c.peer);
    const had = roster.some((r) => r.id === c.peer);
    roster = roster.filter((r) => r.id !== c.peer);
    renderPeople();
    if (had) {
      addSys(`${name} left`);
      send({ type: 'sys', text: `${name} left` });
      shareRoster();
    }
  }

  function startGuest(roomCode) {
    role = 'guest';
    code = roomCode;
    hostId = ID_PREFIX + roomCode;
    buildPanel();
    ui.code.textContent = `Room ${code}`;
    setStatus('Joining the room...');

    const p = new window.Peer({ debug: 1 });
    peer = p;

    p.on('open', (id) => {
      if (peer !== p) return;
      me.id = id;
      const c = p.connect(ID_PREFIX + code, { serialization: 'json', reliable: true });
      hostConn = c;
      joinTimer = setTimeout(() => {
        if (peer === p && !c.open) {
          fail('Could not connect. Some office or mobile networks block direct connections, so try a different network.');
        }
      }, JOIN_TIMEOUT);
      c.on('open', () => c.send({ type: 'hello', name: me.name }));
      c.on('data', (m) => { if (hostConn === c) onData(m, c); });
      c.on('close', () => { if (peer === p && hostConn === c) endParty('The host left, so the party has ended.'); });
      c.on('error', () => { if (peer === p && hostConn === c && !c.open) fail('The connection to the host failed.'); });
    });

    p.on('disconnected', () => {
      setTimeout(() => { if (peer === p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch { /* ignore */ } } }, 1500);
    });

    p.on('error', (err) => {
      if (peer !== p) return;
      clearTimeout(joinTimer);
      fail(explain(err));
    });
  }

  /* ---------- Ending ---------- */
  function cleanup() {
    clearInterval(tickTimer);
    clearTimeout(joinTimer);
    const p = peer;
    peer = null;                       // handlers ignore events from a peer that is no longer current
    conns.forEach((c) => { try { c.close(); } catch { /* ignore */ } });
    conns.clear();
    if (hostConn) { try { hostConn.close(); } catch { /* ignore */ } }
    hostConn = null;
    if (p) { try { p.destroy(); } catch { /* ignore */ } }
    const pl = player();
    if (pl) Object.keys(handlers).forEach((ev) => { try { pl.off(ev, handlers[ev]); } catch { /* ignore */ } });
    role = null;
    code = '';
    hostId = '';
    roster = [];
    sharedUrl = '';
    pendingSync = null;
    wantPlaying = false;
        if (ui) { ui.panel.remove(); ui = null; }
    document.body.classList.remove('party-on');
    btn.setAttribute('aria-pressed', 'false');
    document.dispatchEvent(new CustomEvent('vx:party-closed'));
  }

  function leave(message) {
    cleanup();
    if (message) toast(message);
  }
  const endParty = leave;

  window.addEventListener('pagehide', () => { if (peer) { try { peer.destroy(); } catch { /* ignore */ } } });

  /* ---------- Invite link ---------- */
  const invited = String((VX.initialParams && VX.initialParams.get('party')) || '').toUpperCase();
  if (CODE_RE.test(invited)) openDialog('join', invited);

  /* ---------- Hooks for voice.js ---------- */
  VX.party = {
    isActive: () => !!role,
    send: (msg, exceptId) => send(msg, exceptId),
    me: () => me,
  };
})();