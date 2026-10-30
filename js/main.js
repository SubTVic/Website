import { computeHomography, applyH, FIELD_CORNERS } from './homography.js';
import { Tracker, makeMatcher, sampleColor } from './vision.js';
import { Game, ROD_U } from './game.js';
import { AudioEngine } from './audio.js';
import { Director } from './commentator.js';

const PROC_WIDTH = 320; // Verarbeitungsauflösung (Breite in Pixel)
const BALL_CM = 3.5;
const TEAM_COLORS_DEFAULT = ['#e5484d', '#3e8ef7'];

const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  names: ['Heim', 'Gast'],
  tableLen: 120,
  tableWid: 68,
  shotKmh: 18,
  fillerSec: 8,
  tol: 20,
  voice: true,
  autoGoals: true,
  swapped: false,
  goalsToWin: 10,
  expert: true,
  crowd: 0.5,
  tts: 'browser',
  elevenKey: '',
  elevenModel: 'eleven_flash_v2_5',
  voiceReporter: '',
  voiceExperte: '',
};

// ——— Persistenz (nur Komfort, die App läuft auch ohne) ———
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const settings = load('kicker.settings', DEFAULTS);
const calib = load('kicker.calib', { corners: [], ball: null, teams: [null, null] });

// ——— DOM ———
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
const maskCanvas = document.createElement('canvas');
const mctx = maskCanvas.getContext('2d');

const tracker = new Tracker();
const audio = new AudioEngine();
const game = new Game({ ...settings, goalMissSec: 0.5 });
let step = 'camera'; // camera | corners | ball | teams | ready | live
let pickTeam = null;
let debug = false;
let lastBall = null;
let teamBlobs = [[], []];
let fps = 0;
let frameData = null;
let gameOver = false;

const director = new Director({
  audio,
  getSettings: () => settings,
  onLine: (speaker, text, big) => showSubtitle(speaker, text, big),
  onStatus: (text, kind) => {
    $('ai-status').textContent = text;
    $('ai-status').dataset.kind = kind;
  },
  onGameOver: () => {
    gameOver = true;
    game.pause();
    renderPanel();
  },
});

const commentCtx = () => ({ names: settings.names, snapshot: game.snapshot(), gameTime: game.elapsed });

// ——— Kamera / Video ———
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    onVideoReady();
  } catch (err) {
    alert(`Kamera konnte nicht gestartet werden: ${err.message}\n\nHinweis: Die Seite muss über https:// (oder localhost) geöffnet sein.`);
  }
}

function startFile(file) {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.loop = true;
  video.play().then(onVideoReady);
}

function onVideoReady() {
  const scale = PROC_WIDTH / video.videoWidth;
  proc.width = PROC_WIDTH;
  proc.height = Math.round(video.videoHeight * scale);
  maskCanvas.width = proc.width;
  maskCanvas.height = proc.height;
  document.body.classList.add('has-video');
  requestWakeLock();
  const valid = calib.corners.length === 4 && calib.corners.every(([x, y]) => x <= video.videoWidth && y <= video.videoHeight);
  if (valid) applyCalibration();
  else calib.corners = [];
  setStep(!valid ? 'corners' : !calib.ball ? 'ball' : 'ready');
  requestAnimationFrame(loop);
}

async function requestWakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}

// ——— Kalibrierung ———
let H = null; // Video -> Spielfeld
let Hinv = null; // Spielfeld -> Video

function applyCalibration() {
  H = computeHomography(calib.corners, FIELD_CORNERS);
  Hinv = computeHomography(FIELD_CORNERS, calib.corners);
  tracker.configure(proc.width, proc.height, H, proc.width / video.videoWidth);
  save('kicker.calib', calib);
}

// Erwartete Ballfläche in Verarbeitungspixeln (für die Größenprüfung)
function expectedBallArea() {
  const c = calib.corners;
  const s = proc.width / video.videoWidth;
  const len = (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1])) / 2;
  const d = (BALL_CM / settings.tableLen) * len * s;
  return Math.PI * (d / 2) ** 2;
}

function onTap(ev) {
  const [x, y] = toVideo(ev.clientX, ev.clientY);
  if (x < 0 || y < 0 || x > video.videoWidth || y > video.videoHeight) return;
  if (step === 'corners') {
    calib.corners.push([x, y]);
    if (calib.corners.length === 4) {
      applyCalibration();
      setStep(calib.ball ? 'ready' : 'ball');
    } else renderPanel();
  } else if (step === 'ball' || step === 'teams') {
    if (!frameData) return;
    const s = proc.width / video.videoWidth;
    const color = sampleColor(frameData.data, proc.width, proc.height, Math.round(x * s), Math.round(y * s));
    if (step === 'ball') {
      calib.ball = color;
      save('kicker.calib', calib);
      setStep('ready');
    } else if (pickTeam !== null) {
      calib.teams[pickTeam] = color;
      pickTeam = null;
      save('kicker.calib', calib);
      renderPanel();
    }
  }
}

function toVideo(cx, cy) {
  const r = overlay.getBoundingClientRect();
  const { scale, ox, oy } = fit(r.width, r.height);
  return [(cx - r.left - ox) / scale, (cy - r.top - oy) / scale];
}

function fit(w, h) {
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
  return { scale, ox: (w - video.videoWidth * scale) / 2, oy: (h - video.videoHeight * scale) / 2 };
}

// ——— Hauptschleife ———
let lastFrameT = performance.now();

function loop() {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;
  const now = performance.now();
  fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrameT)) * 0.1;
  lastFrameT = now;

  pctx.drawImage(video, 0, 0, proc.width, proc.height);
  frameData = pctx.getImageData(0, 0, proc.width, proc.height);

  lastBall = null;
  teamBlobs = [[], []];
  if (H && calib.ball) {
    const exp = expectedBallArea();
    const specs = [{ match: makeMatcher(calib.ball, settings.tol), minArea: Math.max(2, exp * 0.15) }];
    calib.teams.forEach((c) => c && specs.push({ match: makeMatcher(c, settings.tol), minArea: Math.max(2, exp * 0.2) }));
    const results = tracker.process(frameData.data, specs);
    lastBall = chooseBall(results[0], exp);
    let k = 1;
    calib.teams.forEach((c, i) => {
      if (c) teamBlobs[i] = results[k++].filter((b) => b.u >= 0 && b.u <= 1 && b.v >= 0 && b.v <= 1);
    });
  }

  const t = now / 1000;
  const events = game.update(t, lastBall, teamBlobs);
  if (events.length) onEvents(events);
  director.tick(game.running, commentCtx());

  draw();
  updateScoreboard();
}

let prevBall = null;
function chooseBall(blobs, exp) {
  const cands = blobs.filter((b) => b.area < exp * 5 && b.roundness > 0.3);
  if (!cands.length) return null;
  const now = performance.now();
  let best;
  if (prevBall && now - prevBall.time < 300) {
    // Nächster Kandidat zur letzten Position
    best = cands.reduce((a, b) => (Math.hypot(b.u - prevBall.u, b.v - prevBall.v) < Math.hypot(a.u - prevBall.u, a.v - prevBall.v) ? b : a));
  } else {
    // Größte Übereinstimmung mit Ballgröße und Rundheit
    const score = (b) => b.roundness - Math.abs(Math.log(b.area / exp)) * 0.3;
    best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
  }
  prevBall = { ...best, time: now };
  return best;
}

function onEvents(events) {
  logEvents(events);
  director.handle(events, commentCtx());
  if (events.some((e) => e.type === 'goal')) flashGoal();
}

// ——— Zeichnen ———
function draw() {
  const dpr = window.devicePixelRatio || 1;
  const r = overlay.getBoundingClientRect();
  if (overlay.width !== Math.round(r.width * dpr) || overlay.height !== Math.round(r.height * dpr)) {
    overlay.width = Math.round(r.width * dpr);
    overlay.height = Math.round(r.height * dpr);
  }
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const { scale, ox, oy } = fit(r.width, r.height);
  octx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  const px = 1 / scale; // eine Bildschirm-Pixelbreite in Videokoordinaten

  if (debug && H && calib.ball) drawMask();

  // Ecken während der Kalibrierung
  octx.fillStyle = '#ffd60a';
  if (step !== 'live') calib.corners.forEach(([x, y], i) => {
    octx.beginPath();
    octx.arc(x, y, 7 * px, 0, Math.PI * 2);
    octx.fill();
    octx.font = `${14 * px}px system-ui`;
    octx.fillText(String(i + 1), x + 10 * px, y - 10 * px);
  });

  if (Hinv) {
    const P = (u, v) => applyH(Hinv, u, v);
    // Spielfeldrand
    octx.strokeStyle = 'rgba(255,255,255,0.7)';
    octx.lineWidth = 2 * px;
    octx.beginPath();
    FIELD_CORNERS.forEach(([u, v], i) => {
      const [x, y] = P(u, v);
      i ? octx.lineTo(x, y) : octx.moveTo(x, y);
    });
    octx.closePath();
    octx.stroke();
    // Tore
    const leftTeam = game.leftTeam();
    [[0, leftTeam], [1, 1 - leftTeam]].forEach(([u, team]) => {
      octx.strokeStyle = teamColor(team);
      octx.lineWidth = 6 * px;
      octx.beginPath();
      octx.moveTo(...P(u, 0.25));
      octx.lineTo(...P(u, 0.75));
      octx.stroke();
    });
    // Stangen
    octx.lineWidth = 1 * px;
    ROD_U.forEach((u, i) => {
      octx.strokeStyle = teamColor(game.rodAt(u).team) + '88';
      octx.beginPath();
      octx.moveTo(...P(u, 0));
      octx.lineTo(...P(u, 1));
      octx.stroke();
    });
  }

  // Team-Sticker
  teamBlobs.forEach((blobs, team) => {
    octx.strokeStyle = teamColor(team);
    octx.lineWidth = 2 * px;
    blobs.forEach((b) => {
      octx.beginPath();
      octx.arc(b.x, b.y, 6 * px, 0, Math.PI * 2);
      octx.stroke();
    });
  });

  // Ballspur und Ball
  const trail = game.running ? game.trail : [];
  if (trail.length > 1 && Hinv) {
    octx.strokeStyle = 'rgba(255,214,10,0.8)';
    octx.lineWidth = 3 * px;
    octx.beginPath();
    trail.forEach((p, i) => {
      const [x, y] = applyH(Hinv, p.u, p.v);
      i ? octx.lineTo(x, y) : octx.moveTo(x, y);
    });
    octx.stroke();
  }
  if (lastBall) {
    octx.strokeStyle = '#ffd60a';
    octx.lineWidth = 3 * px;
    octx.beginPath();
    octx.arc(lastBall.x, lastBall.y, 14 * px, 0, Math.PI * 2);
    octx.stroke();
    if (game.running && game.speedKmh > 3) {
      octx.fillStyle = '#fff';
      octx.font = `bold ${15 * px}px system-ui`;
      octx.fillText(`${Math.round(game.speedKmh)} km/h`, lastBall.x + 18 * px, lastBall.y - 14 * px);
    }
  }
}

function drawMask() {
  const mask = tracker.mask(0);
  if (!mask) return;
  const img = mctx.createImageData(maskCanvas.width, maskCanvas.height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 0;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 200;
  }
  mctx.putImageData(img, 0, 0);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(maskCanvas, 0, 0, video.videoWidth, video.videoHeight);
}

function teamColor(team) {
  return TEAM_COLORS_DEFAULT[team];
}

// ——— UI ———
function updateScoreboard() {
  $('name0').textContent = settings.names[0];
  $('name1').textContent = settings.names[1];
  $('score0').textContent = game.score[0];
  $('score1').textContent = game.score[1];
  const s = Math.floor(game.elapsed);
  $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('fps').textContent = `${Math.round(fps)} fps · Ball ${lastBall ? '✓' : '–'}`;
}

let subTimer = null;
function showSubtitle(speaker, text, big) {
  const el = $('subtitle');
  el.innerHTML = `<small>${speaker === 'experte' ? 'Experte' : 'Reporter'}</small>${escapeHtml(text)}`;
  el.dataset.speaker = speaker;
  el.classList.toggle('big', big);
  el.classList.add('show');
  clearTimeout(subTimer);
  subTimer = setTimeout(() => el.classList.remove('show'), 4000 + text.length * 50);
}

function flashGoal() {
  const el = $('goal-flash');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

const EVENT_LABELS = { goal: 'Tor', shot: 'Schuss', save: 'Parade', control: 'Kontrolle', lost: 'Ball weg', restart: 'Ball da', kickoff: 'Anpfiff', resume: 'Weiter', pause: 'Pause', correction: 'Korrektur' };
const eventLog = [];
function logEvents(events) {
  for (const e of events) {
    const who = e.team !== undefined ? ` ${settings.names[e.team]}` : '';
    const extra = e.kmh ? ` · ${e.kmh} km/h` : e.role ? ` · ${e.role}` : '';
    eventLog.unshift(`${$('clock').textContent} ${EVENT_LABELS[e.type] || e.type}${who}${extra}`);
  }
  eventLog.length = Math.min(eventLog.length, 6);
  const el = $('event-log');
  if (el) el.innerHTML = eventLog.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function setStep(s) {
  step = s;
  renderPanel();
}

function renderPanel() {
  const p = $('panel');
  const n = settings.names;
  const swatch = (c) => (c ? `<span class="swatch" style="background:${c.css}"></span>` : '');
  const views = {
    camera: `
      <h2>Kicker-Kommentator</h2>
      <p>Stell das Handy aufs Stativ, möglichst senkrecht über oder schräg über den Tisch, sodass das ganze Spielfeld zu sehen ist.</p>
      <div class="row">
        <button class="primary" data-act="camera">Kamera starten</button>
        <label class="button">Video-Datei<input type="file" accept="video/*" data-act="file" hidden></label>
      </div>`,
    corners: `
      <h2>1 · Spielfeld markieren</h2>
      <p>Tippe die <b>4 Ecken des Spielfelds</b> nacheinander an, im Uhrzeigersinn. Starte an einer Ecke neben dem Tor von <b>${escapeHtml(n[0])}</b> und tippe zuerst entlang der <b>Seitenbande</b>, nicht entlang der Torlinie.</p>
      <p class="hint">Ecke ${calib.corners.length + 1} von 4</p>
      <div class="row"><button data-act="reset-corners">Neu beginnen</button></div>`,
    ball: `
      <h2>2 · Ball antippen</h2>
      <p>Leg den Ball ruhig aufs Spielfeld und tippe ihn an. Die App merkt sich seine Farbe.</p>
      <p class="hint">Farbige Bälle (orange, gelb) werden viel zuverlässiger erkannt als weiße.</p>
      <div class="row"><button data-act="corners">Ecken neu setzen</button></div>`,
    teams: `
      <h2>Team-Sticker (optional)</h2>
      <p>Klebe farbige Sticker auf die Figuren eines Teams (z. B. Köpfe). Dann erkennt die App genauer, wer am Ball ist.</p>
      <div class="row">
        <button data-act="pick-team" data-team="0">${pickTeam === 0 ? 'Jetzt Sticker antippen…' : `Farbe ${escapeHtml(n[0])}`} ${swatch(calib.teams[0])}</button>
        <button data-act="pick-team" data-team="1">${pickTeam === 1 ? 'Jetzt Sticker antippen…' : `Farbe ${escapeHtml(n[1])}`} ${swatch(calib.teams[1])}</button>
        <button data-act="clear-teams">Entfernen</button>
        <button class="primary" data-act="ready">Fertig</button>
      </div>`,
    ready: `
      <h2>Bereit</h2>
      <p>Der gelbe Kreis sollte dem Ball folgen. Wenn nicht: Ball neu antippen oder die Toleranz in den Einstellungen ändern.</p>
      <div class="row">
        <button class="primary big" data-act="kickoff">Anpfiff!</button>
        <button data-act="ball">Ball ${swatch(calib.ball)}</button>
        <button data-act="teams">Team-Sticker</button>
        <button data-act="corners">Ecken</button>
        <button data-act="swap">Seiten tauschen</button>
        <button data-act="debug">${debug ? 'Maske aus' : 'Maske zeigen'}</button>
      </div>`,
    live: `
      ${gameOver ? `<h2>Spiel vorbei: ${escapeHtml(n[game.score[0] > game.score[1] ? 0 : 1])} gewinnt ${game.score[0]}:${game.score[1]}</h2>` : ''}
      <div class="row">
        <button class="team0" data-act="goal" data-team="0">Tor ${escapeHtml(n[0])}</button>
        <button class="team1" data-act="goal" data-team="1">Tor ${escapeHtml(n[1])}</button>
        <button data-act="undo" data-team="0">−1 ${escapeHtml(n[0])}</button>
        <button data-act="undo" data-team="1">−1 ${escapeHtml(n[1])}</button>
      </div>
      <div class="row">
        ${gameOver ? '<button class="primary" data-act="new-game">Neues Spiel</button>' : `<button data-act="pause">${game.running ? 'Pause' : 'Weiter'}</button>`}
        <button data-act="mute">${settings.voice ? 'Stumm' : 'Ton an'}</button>
        <button data-act="debug">${debug ? 'Maske aus' : 'Maske'}</button>
        <button data-act="new-game">Neues Spiel</button>
        <button data-act="calibrate">Kalibrieren</button>
      </div>
      <ul id="event-log"></ul>`,
  };
  p.innerHTML = views[step];
  if (step === 'live') logEvents([]);
}

function act(name, el) {
  const team = Number(el.dataset.team);
  const t = performance.now() / 1000;
  switch (name) {
    case 'camera': return startCamera();
    case 'reset-corners':
    case 'corners':
      calib.corners = [];
      H = Hinv = null;
      return setStep('corners');
    case 'ball': return setStep('ball');
    case 'teams': return setStep('teams');
    case 'ready': return setStep('ready');
    case 'pick-team':
      pickTeam = team;
      return renderPanel();
    case 'clear-teams':
      calib.teams = [null, null];
      save('kicker.calib', calib);
      return renderPanel();
    case 'swap':
      settings.swapped = !settings.swapped;
      game.cfg.swapped = settings.swapped;
      save('kicker.settings', settings);
      return;
    case 'debug':
      debug = !debug;
      return renderPanel();
    case 'kickoff':
      return kickoff();
    case 'pause':
      if (gameOver) return;
      onEvents(game.running ? game.pause() : game.start(t));
      return renderPanel();
    case 'goal': return onEvents([game.addGoal(team, t, { manual: true })]);
    case 'undo': return onEvents([game.removeGoal(team)]);
    case 'mute':
      settings.voice = !settings.voice;
      director.setMuted(!settings.voice);
      save('kicker.settings', settings);
      return renderPanel();
    case 'new-game':
      if (!confirm('Spielstand zurücksetzen?')) return;
      game.reset();
      director.reset();
      gameOver = false;
      eventLog.length = 0;
      return setStep('ready');
    case 'calibrate':
      if (game.running) game.pause();
      return setStep('ready');
  }
}

async function kickoff() {
  // Audio muss aus dem Klick heraus freigeschaltet werden
  await audio.start();
  window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 }));
  director.configure();
  director.setMuted(!settings.voice);
  director.warmUp(settings.names);
  onEvents(game.start(performance.now() / 1000));
  setStep('live');
}

// ——— Einstellungen ———
function openSettings() {
  const f = $('settings-form');
  f.apiKey.value = settings.apiKey;
  f.model.value = settings.model;
  f.name0.value = settings.names[0];
  f.name1.value = settings.names[1];
  f.tableLen.value = settings.tableLen;
  f.tableWid.value = settings.tableWid;
  f.shotKmh.value = settings.shotKmh;
  f.fillerSec.value = settings.fillerSec;
  f.tol.value = settings.tol;
  f.autoGoals.checked = settings.autoGoals;
  f.goalsToWin.value = settings.goalsToWin;
  f.expert.checked = settings.expert;
  f.crowd.value = settings.crowd;
  f.tts.value = settings.tts;
  f.elevenKey.value = settings.elevenKey;
  f.elevenModel.value = settings.elevenModel;
  f.voiceReporter.value = settings.voiceReporter;
  f.voiceExperte.value = settings.voiceExperte;
  $('settings').showModal();
}

function saveSettings() {
  const f = $('settings-form');
  settings.apiKey = f.apiKey.value.trim();
  settings.model = f.model.value;
  settings.names = [f.name0.value.trim() || 'Heim', f.name1.value.trim() || 'Gast'];
  settings.tableLen = Number(f.tableLen.value) || DEFAULTS.tableLen;
  settings.tableWid = Number(f.tableWid.value) || DEFAULTS.tableWid;
  settings.shotKmh = Number(f.shotKmh.value) || DEFAULTS.shotKmh;
  settings.fillerSec = Number(f.fillerSec.value) || DEFAULTS.fillerSec;
  settings.tol = Number(f.tol.value);
  settings.autoGoals = f.autoGoals.checked;
  settings.goalsToWin = Number(f.goalsToWin.value) || DEFAULTS.goalsToWin;
  settings.expert = f.expert.checked;
  settings.crowd = Number(f.crowd.value);
  settings.tts = f.tts.value;
  settings.elevenKey = f.elevenKey.value.trim();
  settings.elevenModel = f.elevenModel.value.trim() || DEFAULTS.elevenModel;
  settings.voiceReporter = f.voiceReporter.value.trim();
  settings.voiceExperte = f.voiceExperte.value.trim();
  Object.assign(game.cfg, settings);
  director.llmDisabledUntil = 0;
  director.configure();
  if (game.running) director.warmUp(settings.names);
  if (audio.ctx && settings.voice) audio.setCrowd(settings.crowd);
  save('kicker.settings', settings);
  renderPanel();
}

// ——— Verdrahtung ———
overlay.addEventListener('pointerdown', onTap);
$('panel').addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (el && el.tagName !== 'INPUT') act(el.dataset.act, el);
});
$('panel').addEventListener('change', (ev) => {
  if (ev.target.dataset.act === 'file' && ev.target.files[0]) startFile(ev.target.files[0]);
});
$('open-settings').addEventListener('click', openSettings);
$('settings-form').addEventListener('submit', (ev) => ev.submitter?.value === 'ok' && saveSettings());
$('tol-live').addEventListener('input', (ev) => {
  settings.tol = Number(ev.target.value);
  save('kicker.settings', settings);
});
$('tol-live').value = settings.tol;
director.onStatus(settings.apiKey ? 'KI bereit' : 'Offline-Vorlagen', settings.apiKey ? 'ok' : 'offline');
renderPanel();
