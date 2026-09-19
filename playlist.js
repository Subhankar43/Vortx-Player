/* Vortx Player: playlist / queue, with auto-advance on completion.
   Saved in this browser only. Depends on app.js, which exposes window.VX. */
(() => {
  'use strict';

  const VX = window.VX;
  if (!VX) return;
  const { make, toast, store } = VX;
  const $ = (s, r = document) => r.querySelector(s);

  const KEY = 'vx-queue';
  const MAX_ITEMS = 60;

  let queue = store.get(KEY, []);   // [{ id, url, sub, title }]
  let activeId = null;

  function save() { store.set(KEY, queue.slice(0, MAX_ITEMS)); }

  function parseUrl(raw) {
    let v = (raw || '').trim();
    if (v.startsWith('//')) v = 'https:' + v;
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol) ? u : null;
    } catch { return null; }
  }

  function titleFromUrl(u) {
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const name = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[._-]+/g, ' ').trim();
    return name || u.hostname;
  }

  /* ---------- Icons and DOM ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    </svg>`);

  const btn = make('button', 'btn');
  btn.type = 'button';
  btn.id = 'queueBtn';
  btn.title = 'Playlist / queue';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-controls', 'queuePanel');
  btn.append(VX.icon('list'), make('span', '', 'Queue'));
  $('#theaterBtn').before(btn);

  const panel = make('section', 'panel queue');
  panel.id = 'queuePanel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'queueTitle');
  panel.innerHTML = `
    <div class="queue-head">
      <h2 id="queueTitle"><svg class="i"><use href="#i-list"/></svg>Playlist <span class="queue-count" id="queueCount"></span></h2>
      <label class="queue-auto"><input type="checkbox" id="queueAutoplay"> Autoplay next</label>
      <button type="button" class="icon-btn" id="queueClose" aria-label="Close playlist"><svg class="i"><use href="#i-x"/></svg></button>
    </div>
    <form class="queue-add" id="queueAddForm" autocomplete="off">
      <textarea id="queueAddInput" rows="2" placeholder="Paste one or more links, one per line. Optional: Title | https://link"></textarea>
      <button type="submit" class="btn"><svg class="i"><use href="#i-plus"/></svg><span>Add</span></button>
    </form>
    <button type="button" class="link-btn" id="queueAddCurrent">Add the video playing now</button>
    <ul class="queue-list" id="queueList"></ul>
    <p class="empty" id="queueEmpty">Your queue is empty. Paste some links above.</p>
  `;
  $('.now').after(panel);

  const ui = {
    count: $('#queueCount', panel), auto: $('#queueAutoplay', panel), close: $('#queueClose', panel),
    addForm: $('#queueAddForm', panel), addInput: $('#queueAddInput', panel),
    addCurrent: $('#queueAddCurrent', panel), list: $('#queueList', panel), empty: $('#queueEmpty', panel),
  };
  ui.auto.checked = store.get('vx-queue-autoplay', true);

  function render() {
    ui.count.textContent = queue.length ? `(${queue.length})` : '';
    ui.empty.hidden = queue.length > 0;
    ui.list.replaceChildren();
    queue.forEach((item, i) => {
      const li = make('li', item.id === activeId ? 'queue-item is-active' : 'queue-item');

      const main = make('button', 'queue-main');
      main.type = 'button';
      main.append(make('span', 'queue-index', String(i + 1)), make('span', 'queue-item-title', item.title));
      main.addEventListener('click', () => playItem(item.id));

      const up = make('button', 'icon-btn', '↑');
      up.type = 'button'; up.disabled = i === 0; up.setAttribute('aria-label', 'Move up');
      up.addEventListener('click', () => { [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]]; save(); render(); });

      const down = make('button', 'icon-btn', '↓');
      down.type = 'button'; down.disabled = i === queue.length - 1; down.setAttribute('aria-label', 'Move down');
      down.addEventListener('click', () => { [queue[i + 1], queue[i]] = [queue[i], queue[i + 1]]; save(); render(); });

      const del = make('button', 'icon-btn');
      del.type = 'button'; del.setAttribute('aria-label', `Remove ${item.title}`);
      del.appendChild(VX.icon('x'));
      del.addEventListener('click', () => { queue = queue.filter((x) => x.id !== item.id); save(); render(); });

      li.append(main, up, down, del);
      ui.list.appendChild(li);
    });
  }

  ui.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const lines = ui.addInput.value.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    lines.forEach((line) => {
      let title = '', raw = line;
      const pipe = line.indexOf('|');
      if (pipe > -1) { title = line.slice(0, pipe).trim(); raw = line.slice(pipe + 1).trim(); }
      const u = parseUrl(raw);
      if (!u || queue.length >= MAX_ITEMS) return;
      queue.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: u.href, sub: '', title: title || titleFromUrl(u) });
      added++;
    });
    if (!added) return toast('No valid links found. Links must start with http:// or https://');
    ui.addInput.value = '';
    save(); render();
    toast(`Added ${added} item${added > 1 ? 's' : ''} to the queue`);
  });

  ui.addCurrent.addEventListener('click', () => {
    const c = VX.current();
    if (!c) return toast('Nothing is playing yet');
    queue.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: c.url, sub: c.sub || '', title: c.title });
    save(); render();
    toast('Added to the queue');
  });

  function playItem(id) {
    const item = queue.find((x) => x.id === id);
    if (!item) return;
    activeId = id;
    VX.load(item.url, item.sub, true);
    render();
  }

  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-pressed', String(!panel.hidden));
  });
  ui.close.addEventListener('click', () => { panel.hidden = true; btn.setAttribute('aria-pressed', 'false'); });
  ui.auto.addEventListener('change', () => store.set('vx-queue-autoplay', ui.auto.checked));

  // Keep the active row in sync when a video loads from Recently Played, a shared link, etc.
  document.addEventListener('vx:loaded', (e) => {
    const match = queue.find((x) => x.url === e.detail.url);
    activeId = match ? match.id : null;
    render();
  });

  document.addEventListener('vx:complete', () => {
    if (!ui.auto.checked) return;
    const i = queue.findIndex((x) => x.id === activeId);
    const next = queue[i + 1];
    if (!next) return toast('Queue finished');
    playItem(next.id);
  });

  render();
})();