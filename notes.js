/* Vortx Player: timestamp notes and bookmarks.
   Saved in this browser only. Depends on app.js, which exposes window.VX. */
(() => {
  'use strict';

  const VX = window.VX;
  if (!VX) return;
  const { make, toast, fmtTime, store } = VX;
  const $ = (s, r = document) => r.querySelector(s);

  const KEY = 'vx-notes';
  const MAX_VIDEOS = 40;
  const MAX_NOTES = 200;
  const MAX_TEXT = 200;

  /* ---------- State ---------- */
  let ctx = null;        // { key, url } for the video that is loaded now
  let notes = [];        // [{ id, t, text, ts }] sorted by time
  let pinned = null;     // time (seconds) frozen for the note being written
  let lastPos = 0;
  let lastDur = 0;

  /* Notes are keyed by origin + path, so links that only differ by an expiring
     ?token= still share their notes. Links with no path use the full URL. */
  function keyFor(url) {
    try {
      const u = new URL(url);
      return u.pathname.length > 1 ? u.origin + u.pathname : u.href;
    } catch { return url; }
  }

  const allNotes = () => store.get(KEY, {});

  function loadNotes() {
    const entry = allNotes()[ctx.key];
    notes = ((entry && entry.list) || []).slice().sort((a, b) => a.t - b.t);
  }

  function saveNotes() {
    const all = allNotes();
    if (notes.length) all[ctx.key] = { ts: Date.now(), list: notes };
    else delete all[ctx.key];
    const keep = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts).slice(0, MAX_VIDEOS);
    store.set(KEY, Object.fromEntries(keep.map((k) => [k, all[k]])));
  }

  /* ---------- Player helpers ---------- */
  const player = () => VX.player();
  function nowPos() {
    const p = player();
    let t = 0;
    try { t = p ? p.getPosition() : 0; } catch { /* player not ready */ }
    return Number.isFinite(t) ? Math.max(0, t) : lastPos;
  }
  const hasDuration = () => Number.isFinite(lastDur) && lastDur > 0;

  function jump(t) {
    const p = player();
    if (!p) return;
    if (p.getState() === 'idle') {
      // Nothing has started yet: start playback, then move once the first frame is out.
      const onFirst = () => { p.off('firstFrame', onFirst); p.seek(t); };
      p.on('firstFrame', onFirst);
      p.play(true);
      return;
    }
    p.seek(t);
    if (p.getState() !== 'playing') p.play(true);
  }

  /* ---------- Icons and DOM ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></symbol>
      <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 4H7l3-4z"/></symbol>
    </svg>`);

  const btn = make('button', 'btn');
  btn.type = 'button';
  btn.id = 'notesBtn';
  btn.title = 'Notes and bookmarks (B)';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-controls', 'notesPanel');
  btn.append(VX.icon('bookmark'), make('span', '', 'Notes'));
  $('#theaterBtn').before(btn);

  const panel = make('section', 'panel notes');
  panel.id = 'notesPanel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'notesTitle');
  panel.innerHTML = `
    <div class="notes-head">
      <h2 id="notesTitle"><svg class="i"><use href="#i-bookmark"/></svg>Notes <span class="notes-count" id="notesCount"></span></h2>
      <button type="button" class="icon-btn" id="notesClose" aria-label="Close notes"><svg class="i"><use href="#i-x"/></svg></button>
    </div>
    <div class="notes-track" id="notesTrack" hidden>
      <div class="notes-rail"><i class="notes-fill" id="notesFill"></i></div>
    </div>
    <form class="notes-form" id="notesForm" autocomplete="off">
      <button type="button" class="time-chip" id="notesChip" aria-pressed="false" title="Click to freeze or release the time">
        <svg class="i"><use href="#i-pin"/></svg><span id="notesChipTime">0:00</span>
      </button>
      <label class="sr-only" for="notesInput">Note</label>
      <input id="notesInput" type="text" maxlength="${MAX_TEXT}" placeholder="Add a note for this moment (optional)">
      <button type="submit" class="btn" id="notesSave"><svg class="i"><use href="#i-bookmark"/></svg><span>Save</span></button>
    </form>
    <p class="notes-hint" id="notesHint"></p>
    <ul class="notes-list" id="notesList"></ul>`;
  $('.now').after(panel);

  const ui = {
    count: $('#notesCount', panel), track: $('#notesTrack', panel), rail: $('.notes-rail', panel),
    fill: $('#notesFill', panel), form: $('#notesForm', panel), chip: $('#notesChip', panel),
    chipTime: $('#notesChipTime', panel), input: $('#notesInput', panel), save: $('#notesSave', panel),
    hint: $('#notesHint', panel), list: $('#notesList', panel), close: $('#notesClose', panel),
  };

  /* ---------- Rendering ---------- */
  function updateChip() {
    ui.chipTime.textContent = fmtTime(pinned !== null ? pinned : lastPos);
    ui.chip.setAttribute('aria-pressed', String(pinned !== null));
  }

  function updateFill() {
    ui.fill.style.width = hasDuration() ? `${Math.min(100, (lastPos / lastDur) * 100)}%` : '0';
  }

  function render() {
    const enabled = !!ctx;
    ui.input.disabled = !enabled;
    ui.save.disabled = !enabled;
    ui.chip.disabled = !enabled;
    ui.count.textContent = notes.length ? `(${notes.length})` : '';

    ui.rail.querySelectorAll('.notes-marker').forEach((m) => m.remove());
    ui.track.hidden = !(enabled && hasDuration() && notes.length);

    if (!enabled) ui.hint.textContent = 'Play a video first, then bookmark the moments you want to come back to.';
    else if (!notes.length) ui.hint.textContent = 'Nothing saved yet. Press B while watching, or type a note and press Save.';
    else ui.hint.textContent = '';

    ui.list.replaceChildren();
    notes.forEach((n) => {
      const li = make('li', 'note');

      const main = make('button', 'note-main');
      main.type = 'button';
      main.title = 'Jump to this moment';
      main.append(make('span', 'note-time', fmtTime(n.t)), make('span', n.text ? 'note-text' : 'note-text is-empty', n.text || 'Bookmark'));
      main.addEventListener('click', () => jump(n.t));

      const del = make('button', 'icon-btn');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete note at ${fmtTime(n.t)}`);
      del.appendChild(VX.icon('x'));
      del.addEventListener('click', () => {
        notes = notes.filter((x) => x.id !== n.id);
        saveNotes();
        render();
      });

      li.append(main, del);
      ui.list.appendChild(li);

      if (hasDuration()) {
        const m = make('button', 'notes-marker');
        m.type = 'button';
        m.style.left = `${Math.min(100, (n.t / lastDur) * 100)}%`;
        m.title = `${fmtTime(n.t)}${n.text ? ' - ' + n.text : ''}`;
        m.setAttribute('aria-label', `Jump to ${fmtTime(n.t)}`);
        m.addEventListener('click', () => jump(n.t));
        ui.rail.appendChild(m);
      }
    });

    updateChip();
    updateFill();
  }

  /* ---------- Actions ---------- */
  function addNote() {
    if (!ctx) return;
    if (notes.length >= MAX_NOTES) return toast(`This video has reached the limit of ${MAX_NOTES} notes`);
    const t = Math.floor(pinned !== null ? pinned : nowPos());
    notes.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      t,
      text: ui.input.value.trim().slice(0, MAX_TEXT),
      ts: Date.now(),
    });
    notes.sort((a, b) => a.t - b.t);
    saveNotes();
    ui.input.value = '';
    ui.input.blur();     // hand the keyboard back to the player and shortcuts
    pinned = null;
    render();
    toast(`Bookmarked at ${fmtTime(t)}`);
  }

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-pressed', String(open));
    if (!open) pinned = null;
    updateChip();
  }

  function quickAdd() {
    if (!ctx) return toast('Play a video first to add a note');
    setOpen(true);
    pinned = nowPos();
    updateChip();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    ui.input.focus({ preventScroll: true });
  }

  /* ---------- Events ---------- */
  btn.addEventListener('click', () => setOpen(panel.hidden));
  ui.close.addEventListener('click', () => setOpen(false));
  ui.form.addEventListener('submit', (e) => { e.preventDefault(); addNote(); });

  ui.chip.addEventListener('click', () => {
    pinned = pinned === null ? nowPos() : null;
    updateChip();
  });
  // Typing a note freezes the time you started at, so a slow typist saves the right moment.
  ui.input.addEventListener('focus', () => {
    if (ctx && pinned === null) { pinned = nowPos(); updateChip(); }
  });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pinned = null; ui.input.value = ''; ui.input.blur(); updateChip(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); quickAdd(); }
  });

  function onTime(e) {
    lastPos = e.position || 0;
    if (Number.isFinite(e.duration) && e.duration > 0 && e.duration !== lastDur) {
      lastDur = e.duration;
      render();
      return;
    }
    if (pinned === null) updateChip();
    updateFill();
  }

  function attach(c) {
    ctx = { key: keyFor(c.url), url: c.url };
    pinned = null;
    lastPos = 0;
    lastDur = 0;
    ui.input.value = '';
    loadNotes();
    render();
    const p = player();
    if (p) {
      try { p.off('time', onTime); p.on('time', onTime); } catch { /* ignore */ }
    }
  }

  document.addEventListener('vx:loaded', (e) => attach(e.detail));
  if (VX.current()) attach(VX.current());   // a shared link may have loaded before this file ran
  else render();
})();