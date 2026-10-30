// Live-Kommentar: wandelt Spielereignisse in Kommentatoren-Sätze um —
// mit Claude (API-Key nötig) oder offline mit Satzvorlagen.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';

// Modelle mit serverseitigem Fallback bei Ablehnungen
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const ROLE_NAMES = {
  Torwart: 'den Torwart',
  Abwehr: 'die Zweierreihe der Abwehr',
  Mittelfeld: 'die Fünferreihe im Mittelfeld',
  Sturm: 'die Dreierreihe im Sturm',
};

// Höhere Priorität darf niedrigere verdrängen; maxAge = wie alt ein Kommentar sein darf, bevor er verworfen wird
const PRIORITY = {
  goal: { p: 5, maxAge: 15 },
  kickoff: { p: 4, maxAge: 10 },
  save: { p: 3, maxAge: 4 },
  shot: { p: 3, maxAge: 3.5 },
  correction: { p: 3, maxAge: 6 },
  restart: { p: 2, maxAge: 4 },
  lost: { p: 2, maxAge: 5 },
  resume: { p: 2, maxAge: 5 },
  pause: { p: 2, maxAge: 5 },
  control: { p: 1, maxAge: 3 },
  filler: { p: 0, maxAge: 6 },
};

const SYSTEM_PROMPT = `Du bist ein leidenschaftlicher deutscher Live-Kommentator wie im Sportfernsehen und kommentierst ein echtes Tischkicker-Spiel (Tischfußball), das eine Kamera gerade filmt.

Du bekommst bei jedem Aufruf ein einzelnes Ereignis aus dem Spiel sowie Spielstand und Statistik. Antworte mit genau dem Text, der sofort laut vorgelesen wird:
- Ein Satz, höchstens zwei. Maximal 25 Wörter, bei Toren bis 35 Wörter.
- Bei Toren voller Emotion, bei ruhigen Phasen locker, mit Witz, Statistik oder Spannung.
- Nutze Kicker-Begriffe: Torwart, Zweierreihe (Abwehr), Fünferreihe (Mittelfeld), Dreierreihe (Sturm), Bande, Ballkontrolle, Schuss, Parade.
- Nenne Teams nur mit den angegebenen Namen. Erfinde keine Spielernamen und keine Ereignisse, die nicht gemeldet wurden.
- Wiederhole keine Formulierungen aus deinen letzten Kommentaren.
- Nur gesprochener Text: keine Emojis, kein Markdown, keine Anführungszeichen, keine Regieanweisungen.`;

export class Commentator {
  constructor({ speaker, onText, onStatus, getSettings }) {
    this.speaker = speaker;
    this.onText = onText;
    this.onStatus = onStatus;
    this.getSettings = getSettings;
    this.inflight = false;
    this.pending = null;
    this.history = [];
    this.lastActivity = performance.now() / 1000;
    this.client = null;
    this.clientKey = null;
    this.llmDisabledUntil = 0;
  }

  handle(events, names, snapshot) {
    for (const e of events) {
      const job = { event: e, names, snapshot: { ...snapshot, score: e.score || snapshot.score }, t: performance.now() / 1000 };
      // Tore unterbrechen eine laufende Ansage sofort
      if (!this.inflight && (!this.speaker.speaking || e.type === 'goal')) this.run(job);
      else if (!this.pending || prio(e) >= prio(this.pending.event)) this.pending = job;
    }
  }

  // Füllkommentare in ruhigen Phasen
  tick(running, names, snapshot) {
    const now = performance.now() / 1000;
    if (!running || this.inflight || this.speaker.speaking || this.pending) return;
    if (now - this.lastActivity < this.getSettings().fillerSec) return;
    this.run({ event: { type: 'filler' }, names, snapshot, t: now });
  }

  async run(job) {
    if (isStale(job)) return this.next();
    this.inflight = true;
    let text = null;
    try {
      text = await this.generate(job);
    } finally {
      this.inflight = false;
    }
    const stale = isStale(job);
    // Wichtigeres wartet schon? Dann diesen Kommentar überspringen.
    const outranked = this.pending && prio(this.pending.event) > prio(job.event);
    if (text && !stale && !outranked) {
      this.remember(text);
      this.onText(text, job.event);
      const big = job.event.type === 'goal';
      await this.speaker.speak(text, { interrupt: big, excited: big });
    }
    this.lastActivity = performance.now() / 1000;
    this.next();
  }

  next() {
    if (!this.pending) return;
    const job = this.pending;
    this.pending = null;
    this.run(job);
  }

  remember(text) {
    this.history.push(text);
    if (this.history.length > 8) this.history.shift();
  }

  async generate(job) {
    const s = this.getSettings();
    const now = performance.now() / 1000;
    if (s.apiKey && now > this.llmDisabledUntil) {
      try {
        const text = await this.askClaude(job, s);
        if (text) {
          this.onStatus('KI', 'ok');
          return text;
        }
      } catch (err) {
        this.onStatus(err.userMessage || 'KI-Fehler, nutze Vorlagen', 'error');
        console.warn('Claude-Anfrage fehlgeschlagen:', err);
        this.llmDisabledUntil = now + (err.retryAfter ?? 5);
      }
    } else if (!s.apiKey) {
      this.onStatus('Offline-Vorlagen', 'offline');
    }
    return offlineLine(job);
  }

  async getClient(apiKey) {
    if (this.client && this.clientKey === apiKey) return this.client;
    const mod = await import(SDK_URL);
    this.Anthropic = mod.default;
    // Der Key bleibt auf diesem Gerät; die App spricht direkt mit der Claude API.
    this.client = new this.Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 12000 });
    this.clientKey = apiKey;
    return this.client;
  }

  async askClaude(job, s) {
    const client = await this.getClient(s.apiKey);
    const A = this.Anthropic;
    const params = {
      model: s.model,
      max_tokens: 1024,
      // Kurze Antworten, möglichst geringe Verzögerung
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(job, this.history) }],
    };
    let resp;
    try {
      resp = FALLBACK_MODELS.has(s.model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof A.AuthenticationError) throw tagged(err, 'API-Key ungültig', 60);
      if (err instanceof A.PermissionDeniedError) throw tagged(err, 'Kein Zugriff auf dieses Modell', 60);
      if (err instanceof A.NotFoundError) throw tagged(err, 'Modell nicht gefunden', 60);
      if (err instanceof A.RateLimitError) throw tagged(err, 'Rate-Limit erreicht, kurz Pause', 15);
      if (err instanceof A.BadRequestError) throw tagged(err, 'Ungültige Anfrage', 30);
      if (err instanceof A.APIError && err.status >= 500) throw tagged(err, 'Claude überlastet', 5);
      if (err instanceof A.APIConnectionError) throw tagged(err, 'Keine Verbindung zur KI', 5);
      throw err;
    }
    if (resp.stop_reason === 'refusal') return null;
    return resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .replace(/[*_#"„“]/g, '')
      .trim();
  }
}

function tagged(err, userMessage, retryAfter) {
  err.userMessage = userMessage;
  err.retryAfter = retryAfter;
  return err;
}

function isStale(job) {
  return performance.now() / 1000 - job.t > (PRIORITY[job.event.type]?.maxAge ?? 4);
}

function prio(e) {
  return PRIORITY[e.type]?.p ?? 1;
}

function describe(e, names) {
  const n = (t) => names[t];
  const role = (r) => ROLE_NAMES[r] || r;
  switch (e.type) {
    case 'kickoff': return `Anpfiff! ${names[0]} gegen ${names[1]}, das Spiel beginnt gerade.`;
    case 'resume': return 'Das Spiel geht nach einer Unterbrechung weiter.';
    case 'pause': return 'Das Spiel wird unterbrochen.';
    case 'goal': return `TOR für ${n(e.team)}!${e.kmh ? ` Der Ball war zuletzt mit etwa ${e.kmh} km/h unterwegs.` : ''}${e.manual ? ' (manuell eingetragen)' : ''}`;
    case 'correction': return `Korrektur: Ein Tor für ${n(e.team)} wird zurückgenommen.`;
    case 'shot': return `Schuss von ${n(e.team)}${e.role ? ` über ${role(e.role)}` : ''}, etwa ${e.kmh} km/h, ${e.onTarget ? 'aufs Tor' : 'eher vorbei'}.`;
    case 'save': return `Parade! ${n(e.team)} wehrt mit ${role(e.role)} einen Schuss mit ${e.shotKmh} km/h ab.`;
    case 'control': return `${n(e.team)} hat den Ball unter Kontrolle, an ${role(e.role)}.`;
    case 'lost': return 'Der Ball ist gerade nicht zu sehen, vielleicht im Aus oder verdeckt.';
    case 'restart': return 'Der Ball ist wieder im Spiel.';
    case 'filler': return 'Gerade passiert nichts Besonderes. Überbrücke mit einem lockeren Kommentar zu Spielstand, Statistik oder Stimmung.';
    default: return e.type;
  }
}

function buildPrompt({ event, names, snapshot: s }, history) {
  const lines = [
    `Ereignis: ${describe(event, names)}`,
    `Spielstand: ${names[0]} ${s.score[0]} : ${s.score[1]} ${names[1]}, Spielzeit ${s.minute}:${String(s.seconds % 60).padStart(2, '0')} Minuten.`,
    `Schüsse: ${names[0]} ${s.shots[0]}, ${names[1]} ${s.shots[1]}. Paraden: ${names[0]} ${s.saves[0]}, ${names[1]} ${s.saves[1]}.`,
  ];
  if (s.possession) lines.push(`Ballbesitz: ${names[0]} ${s.possession[0]} %, ${names[1]} ${s.possession[1]} %.`);
  if (s.maxKmh > 0 && s.maxKmhTeam !== null) lines.push(`Härtester Schuss bisher: ${s.maxKmh} km/h von ${names[s.maxKmhTeam]}.`);
  if (history.length) lines.push(`Deine letzten Kommentare (nicht wiederholen):\n- ${history.slice(-5).join('\n- ')}`);
  return lines.join('\n');
}

// ——— Offline-Vorlagen (ohne API-Key) ———

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function offlineLine({ event: e, names, snapshot: s }) {
  const n = (t) => names[t];
  const score = `${s.score[0]} zu ${s.score[1]}`;
  const role = (r) => ROLE_NAMES[r] || r;
  switch (e.type) {
    case 'kickoff': return pick([`Herzlich willkommen! ${names[0]} gegen ${names[1]}, der Ball rollt!`, `Anpfiff! ${names[0]} und ${names[1]} legen los, das wird spannend.`]);
    case 'resume': return pick(['Weiter geht es!', 'Und das Spiel läuft wieder.']);
    case 'pause': return pick(['Kurze Unterbrechung.', 'Das Spiel ruht für einen Moment.']);
    case 'goal': return pick([
      `Toooor! ${n(e.team)} trifft! Es steht ${score}!`,
      `Drin ist das Ding! ${n(e.team)} jubelt, ${score}!`,
      `Was für ein Treffer von ${n(e.team)}${e.kmh ? ` mit ${e.kmh} Sachen` : ''}! Neuer Spielstand: ${score}.`,
    ]);
    case 'correction': return `Kommando zurück, das Tor für ${n(e.team)} zählt nicht. Es steht ${score}.`;
    case 'shot': return e.onTarget
      ? pick([`Schuss von ${n(e.team)}, ${e.kmh} km/h!`, `${n(e.team)} zieht ab, gefährlich!`, `Da kommt der Hammer von ${n(e.team)}!`])
      : pick([`${n(e.team)} versucht es, aber das geht vorbei.`, `Abschluss ${n(e.team)}, knapp daneben.`]);
    case 'save': return pick([`Glänzende Parade von ${n(e.team)}!`, `${n(e.team)} hält, ${role(e.role)} ist zur Stelle!`, `Abgewehrt! Stark von ${n(e.team)}.`]);
    case 'control': return pick([`${n(e.team)} sortiert sich an ${role(e.role)}.`, `Ballkontrolle ${n(e.team)}, ${role(e.role)} hat das Leder.`, `${n(e.team)} lässt den Ball zirkulieren.`]);
    case 'lost': return pick(['Wo ist der Ball? Kurz nicht zu sehen.', 'Der Ball ist aus dem Blick geraten.']);
    case 'restart': return pick(['Der Ball ist wieder im Spiel.', 'Und weiter geht die wilde Fahrt.']);
    case 'filler': {
      const options = [`Es steht ${score} zwischen ${names[0]} und ${names[1]}.`];
      if (s.shots[0] + s.shots[1] > 0) options.push(`Schüsse bisher: ${names[0]} ${s.shots[0]}, ${names[1]} ${s.shots[1]}.`);
      if (s.possession) options.push(`Ballbesitz: ${s.possession[0]} zu ${s.possession[1]} Prozent.`);
      if (s.maxKmh > 0 && s.maxKmhTeam !== null) options.push(`Der härteste Schuss bisher: ${s.maxKmh} km/h von ${names[s.maxKmhTeam]}.`);
      return pick(options);
    }
    default: return null;
  }
}
