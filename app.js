/* Vortx Player: theme switch, JW Player integration, history, sharing. No dependencies. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const SAMPLE = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

  const el = {
    form: $('#playForm'), url: $('#videoUrl'), sub: $('#subUrl'), badge: $('#typeBadge'),
    paste: $('#pasteBtn'), clear: $('#clearBtn'), msg: $('#formMsg'),
    stage: $('#stage'), errText: $('#stageErrorText'), errBox: $('#stageError'),
    retry: $('#retryBtn'), sample: $('#sampleBtn'),
    title: $('#nowTitle'), meta: $('#nowMeta'),
    share: $('#shareBtn'), download: $('#downloadBtn'), theater: $('#theaterBtn'),
    list: $('#recentList'), empty: $('#recentEmpty'), clearRecent: $('#clearRecent'),
    toasts: $('#toasts'),
  };

  /* ---------- Storage (safe against blocked/full storage) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  };

  /* ---------- Small helpers ---------- */
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    el.toasts.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function make(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + `:${String(sec).padStart(2, '0')}`;
  };

  /* ---------- Theme ---------- */
  const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
  const themeColor = { glass: '#0a0f1f', cinema: '#050507' };
  let themeTimer;

  function setTheme(theme, persist = true) {
    root.classList.add('theme-anim');
    root.dataset.theme = theme;
    themeButtons.forEach((b) => {
      const on = b.dataset.themeChoice === theme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('meta[name="theme-color"]').setAttribute('content', themeColor[theme]);
    if (persist) store.set('vx-theme', theme);
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove('theme-anim'), 500);
  }

  themeButtons.forEach((b, i) => {
    b.addEventListener('click', () => setTheme(b.dataset.themeChoice));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const next = themeButtons[(i + 1) % themeButtons.length];
      setTheme(next.dataset.themeChoice);
      next.focus();
    });
  });
  setTheme(root.dataset.theme === 'cinema' ? 'cinema' : 'glass', false);

  /* ---------- Stream types ---------- */
  const TYPES = {
    hls:  { label: 'HLS',  jw: 'hls' },
    dash: { label: 'DASH', jw: 'dash' },
    mp4:  { label: 'MP4',  jw: 'mp4',  direct: true },
    webm: { label: 'WebM', jw: 'webm', direct: true },
    ogg:  { label: 'OGG',  jw: 'ogg',  direct: true },
    mkv:  { label: 'MKV',  jw: 'mp4',  direct: true },
    mp3:  { label: 'MP3',  jw: 'mp3',  direct: true },
    aac:  { label: 'AAC',  jw: 'aac',  direct: true },
    auto: { label: 'Auto', jw: undefined, direct: true },
  };
  const EXT = {
    m3u8: 'hls', m3u: 'hls', mpd: 'dash',
    mp4: 'mp4', m4v: 'mp4', mov: 'mp4', webm: 'webm', ogv: 'ogg', ogg: 'ogg',
    mkv: 'mkv', mp3: 'mp3', m4a: 'aac', aac: 'aac',
  };

  function parseUrl(raw) {
    let v = (raw || '').trim();
    if (v.startsWith('//')) v = 'https:' + v;
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol) ? u : null;
    } catch { return null; }
  }

  function detectType(u) {
    const last = u.pathname.split('/').pop();
const ext = last.includes('.') ? last.split('.').pop().toLowerCase() : '';
    if (EXT[ext]) return EXT[ext];
    const s = u.href.toLowerCase();
    if (/m3u8|format=hls|type=hls/.test(s)) return 'hls';
    if (/\.mpd|format=dash|type=dash/.test(s)) return 'dash';
    return 'auto';
  }

  function titleFrom(u) {
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  const name = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[._-]+/g, ' ').trim();
  if (/^[a-f0-9]{16,}$/i.test(name)) return 'Video';   // <- new line
  return name || u.hostname;
}

  /* ---------- Form UI ---------- */
  function setMsg(text) { el.msg.textContent = text || ''; }

  function syncInput() {
    const has = el.url.value.trim().length > 0;
    el.clear.hidden = !has;
    const u = parseUrl(el.url.value);
    el.badge.hidden = !u;
    if (u) el.badge.textContent = TYPES[detectType(u)].label;
    setMsg('');
  }
  el.url.addEventListener('input', syncInput);

  el.clear.addEventListener('click', () => { el.url.value = ''; syncInput(); el.url.focus(); });

  el.paste.addEventListener('click', async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return toast('Your clipboard is empty');
      el.url.value = text;
      syncInput();
      el.url.focus();
    } catch {
      toast('Clipboard access is blocked. Paste into the box instead.');
      el.url.focus();
    }
  });

  el.form.addEventListener('submit', (e) => { e.preventDefault(); playFromInput(); });

  function playFromInput() {
    const u = parseUrl(el.url.value);
    if (!u) return setMsg('Enter a full video link that starts with http:// or https://');
    const subRaw = el.sub.value.trim();
    if (subRaw && !parseUrl(subRaw)) return setMsg('The subtitle link needs to start with http:// or https://');
    start(u.href, subRaw ? parseUrl(subRaw).href : '', { autostart: true });
  }

  /* ---------- Player ---------- */
  let player = null;
  let current = null;
  let lastSaved = -10;

  const resume = {
    all: () => store.get('vx-resume', {}),
    save(url, t, d) {
      const all = resume.all();
      all[url] = { t: Math.floor(t), d: Math.floor(d), ts: Date.now() };
      const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts).slice(0, 40);
      store.set('vx-resume', Object.fromEntries(keys.map((k) => [k, all[k]])));
    },
    clear(url) { const all = resume.all(); delete all[url]; store.set('vx-resume', all); },
  };

  function showError(text) {
    el.errText.textContent = text;
    el.errBox.hidden = false;
  }
  function hideError() { el.errBox.hidden = true; }

  function friendlyError(e) {
    const base = (e && e.message) ? e.message.replace(/\.$/, '') : 'This video could not be played';
    const code = e && e.code ? ` (code ${e.code})` : '';
    return `${base}${code}. Check that the link is public, points straight to the video, and allows playback from other websites.`;
  }

  function start(url, sub, { autostart, forceType }) {
    hideError();
    setMsg('');
    const u = new URL(url);
    if (location.protocol === 'https:' && u.protocol === 'http:') {
      showError('This link starts with http://, and browsers block it on a secure page. Try the https:// version of the link.');
      return;
    }
    if (typeof window.jwplayer !== 'function') {
      showError('The JW Player library did not load. Check your connection or any ad blocker, then reload the page.');
      return;
    }

    const type = forceType || detectType(u);
    current = { url: u.href, sub, type, title: titleFrom(u), host: u.hostname };

    const item = { file: current.url, title: current.title };
    item.type = TYPES[type].jw || 'mp4';   // unknown links are treated as plain video
    if (sub) item.tracks = [{ file: sub, kind: 'captions', label: 'Subtitles', default: true }];

    lastSaved = -10;
    player = window.jwplayer('player');
    player.setup({
      playlist: [item],
      width: '100%',
      height: '100%',
      autostart,
      mute: false,
      stretching: 'uniform',
      preload: 'metadata',
      displaytitle: false,
      displaydescription: false,
      playbackRateControls: [0.5, 0.75, 1, 1.25, 1.5, 2],
      skin: { active: getComputedStyle(root).getPropertyValue('--accent').trim() || '#0a84ff' },
    });

    player.on('ready', () => el.stage.classList.add('is-active'));
    const fail = (e) => {
  if (current.type !== type) return;   // stale event from a replaced attempt
  if (type === 'auto') return start(url, sub, { autostart: true, forceType: 'hls' });
  showError(friendlyError(e));
};
player.on('setupError', fail);
player.on('error', fail);
    player.on('play', () => { document.title = `${current.title} · Vortx Player`; });
    player.on('firstFrame', () => {
      const saved = resume.all()[current.url];
      const dur = player.getDuration();
      if (saved && saved.t > 15 && Number.isFinite(dur) && dur > saved.t + 20) {
        player.seek(saved.t);
        toast(`Resumed from ${fmtTime(saved.t)}`);
      }
    });
    player.on('time', (e) => {
      if (!Number.isFinite(e.duration) || e.duration <= 0) return; // live streams
      if (Math.abs(e.position - lastSaved) < 5) return;
      lastSaved = e.position;
      resume.save(current.url, e.position, e.duration);
    });
        player.on('complete', () => {
      resume.clear(current.url);
      document.dispatchEvent(new CustomEvent('vx:complete', { detail: current }));
    });

    updateNow();
    addRecent(current);
    history.replaceState(null, '', shareLink(current).replace(location.origin, ''));
    document.dispatchEvent(new CustomEvent('vx:loaded', { detail: current }));
  }

  function updateNow() {
    el.title.textContent = current.title;
    el.meta.textContent = `${TYPES[current.type].label} from ${current.host}`;
    el.share.disabled = false;
    el.download.disabled = !TYPES[current.type].direct;
    el.download.title = el.download.disabled ? 'Streams (HLS/DASH) cannot be downloaded as one file' : 'Download';
  }

  el.retry.addEventListener('click', () => {
    if (current) start(current.url, current.sub, { autostart: true }); else playFromInput();
  });

  el.sample.addEventListener('click', () => {
    el.url.value = SAMPLE;
    syncInput();
    playFromInput();
  });

  /* ---------- Share, download, theater ---------- */
  function shareLink(c) {
    const p = new URLSearchParams({ url: c.url });
    if (c.sub) p.set('sub', c.sub);
    return `${location.origin}${location.pathname}?${p}`;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = make('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  el.share.addEventListener('click', async () => {
    if (!current) return;
    const link = shareLink(current);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: current.title, url: link }); return; } catch { /* cancelled, fall back to copy */ }
    }
    toast((await copy(link)) ? 'Link copied' : 'Could not copy the link');
  });

  el.download.addEventListener('click', () => {
    if (!current) return;
    const a = make('a');
    a.href = current.url;
    a.download = '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Download started. If the host blocks it, the video opens in a new tab.');
  });

  function setTheater(on) {
    document.body.classList.toggle('theater', on);
    el.theater.setAttribute('aria-pressed', String(on));
    if (on) el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.theater.addEventListener('click', () => setTheater(!document.body.classList.contains('theater')));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.matches('input, textarea, [contenteditable]')) return;
    if (e.key === '/') { e.preventDefault(); el.url.focus(); el.url.select(); }
    else if (e.key === 't' || e.key === 'T') el.theater.click();
  });

  /* ---------- Recently played ---------- */
  function addRecent(c) {
    const list = store.get('vx-recent', []).filter((r) => r.url !== c.url);
    list.unshift({ url: c.url, sub: c.sub, type: c.type, title: c.title, host: c.host });
    store.set('vx-recent', list.slice(0, 12));
    renderRecents();
  }

  function renderRecents() {
    const list = store.get('vx-recent', []);
    el.list.replaceChildren();
    el.empty.hidden = list.length > 0;
    el.clearRecent.hidden = list.length === 0;

    list.forEach((r) => {
      const li = make('li', 'recent-item');
      const main = make('button', 'recent-main');
      main.type = 'button';
      main.append(make('span', 'badge', (TYPES[r.type] || TYPES.auto).label));
      const text = make('span', 'recent-text');
      text.append(make('b', '', r.title), make('small', '', r.host));
      main.appendChild(text);
      main.addEventListener('click', () => {
        el.url.value = r.url;
        el.sub.value = r.sub || '';
        syncInput();
        start(r.url, r.sub || '', { autostart: true });
        el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      const del = make('button', 'icon-btn');
      del.type = 'button';
      del.setAttribute('aria-label', `Remove ${r.title}`);
      del.appendChild(icon('x'));
      del.addEventListener('click', () => {
        store.set('vx-recent', store.get('vx-recent', []).filter((x) => x.url !== r.url));
        renderRecents();
      });

      li.append(main, del);
      el.list.appendChild(li);
    });
  }

  el.clearRecent.addEventListener('click', () => { store.set('vx-recent', []); renderRecents(); });

  /* ---------- Public API for feature modules (notes.js, party.js) ---------- */
  const params = new URLSearchParams(location.search);

  window.VX = {
    make, toast, icon, fmtTime, store, copy,
    player: () => player,
    current: () => current,
    load: (url, sub, autostart = true) => start(url, sub || '', { autostart }),
    initialParams: params,
  };

  /* ---------- Boot ---------- */
  renderRecents();

  const shared = parseUrl(params.get('url'));
  if (shared) {
    el.url.value = shared.href;
    el.sub.value = params.get('sub') || '';
    syncInput();
    // Browsers block autoplay without a click, so a shared link waits for the play button.
    start(shared.href, parseUrl(params.get('sub'))?.href || '', { autostart: false });
  }
})();