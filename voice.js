/* Vortx Player: voice messages inside the watch-party chat.
   Records a short clip, sends it as a data URL over the same PeerJS data
   channel party.js already uses for chat. No live calling, no separate
   media negotiation. Depends on app.js (window.VX) and party.js (window.VX.party). */
(() => {
  'use strict';

  const VX = window.VX;
  if (!VX) return;
  const { make, toast } = VX;
  const $ = (s, r = document) => r.querySelector(s);

  const MAX_MS = 60000;        // 60s cap per clip
  const MAX_BYTES = 700000;    // ~700KB encoded, keeps data-channel sends fast
  const MIME = (() => {
    const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  })();

  let ui = null;          // party.js's ui object, from vx:party-ready
  let micBtn = null;
  let rec = null;
  let chunks = [];
  let startedAt = 0;
  let recTimer = 0;

  function fmtDur(ms) {
    const s = Math.round(ms / 1000);
    return `0:${String(s).padStart(2, '0')}`;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function bubble(name, dataUrl, dur, mine) {
    if (!ui) return;
    const m = make('div', mine ? 'pp-msg pp-voice mine' : 'pp-msg pp-voice');
    m.append(make('b', '', name));
    const row = make('div', 'pp-voice-row');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = dataUrl;
    audio.preload = 'none';
    row.append(audio, make('span', 'pp-voice-dur', fmtDur(dur)));
    m.appendChild(row);
    ui.log.appendChild(m);
    const nearBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 120;
    if (nearBottom || mine) ui.log.scrollTop = ui.log.scrollHeight;
  }

  async function startRecording() {
    if (!VX.party || !VX.party.isActive()) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('Voice messages are not supported in this browser.');
      return;
    }
    if (!MIME) { toast('No supported audio format found for recording.'); return; }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('Microphone access was blocked. Allow it in your browser settings to send voice messages.');
      return;
    }

    chunks = [];
    rec = new MediaRecorder(stream, { mimeType: MIME });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      finishRecording();
    };
    rec.start();
    startedAt = Date.now();
    micBtn.classList.add('is-recording');
    micBtn.setAttribute('aria-pressed', 'true');
    recTimer = setTimeout(stopRecording, MAX_MS);
  }

  function stopRecording() {
    clearTimeout(recTimer);
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  async function finishRecording() {
    micBtn.classList.remove('is-recording');
    micBtn.setAttribute('aria-pressed', 'false');
    const dur = Date.now() - startedAt;
    rec = null;
    if (dur < 500) { toast('Too short — hold the mic button a bit longer.'); return; }
    const blob = new Blob(chunks, { type: MIME });
    chunks = [];
    if (blob.size > MAX_BYTES) { toast('That clip is too long to send. Try a shorter message.'); return; }

    let dataUrl;
    try { dataUrl = await blobToDataUrl(blob); }
    catch { toast('Could not process the recording.'); return; }

    const name = VX.party.me().name;
    bubble(name, dataUrl, dur, true);
    VX.party.send({ type: 'voice', name, data: dataUrl, dur });
  }

  function toggle() {
    if (rec && rec.state === 'recording') stopRecording();
    else startRecording();
  }

  function attach(partyUi) {
    ui = partyUi;
    micBtn = make('button', 'btn icon-btn mic-btn');
    micBtn.type = 'button';
    micBtn.id = 'voiceMicBtn';
    micBtn.title = 'Hold or click to record a voice message';
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.appendChild(VX.icon('mic'));
    ui.send.before(micBtn);
    micBtn.addEventListener('click', toggle);
  }

  function detach() {
    if (rec && rec.state === 'recording') { try { rec.stop(); } catch { /* ignore */ } }
    rec = null;
    micBtn = null;
    ui = null;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-mic" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></symbol>
    </svg>`);

  document.addEventListener('vx:party-ready', (e) => attach(e.detail));
  document.addEventListener('vx:party-closed', detach);
  document.addEventListener('vx:voice', (e) => {
    const { name, data, dur } = e.detail;
    bubble(name, data, dur, false);
  });
})();