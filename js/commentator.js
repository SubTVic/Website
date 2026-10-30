// Regie des Live-Kommentars, aufgebaut wie in Fußball-Videospielen:
//  1. Sofort-Ausruf (vorab erzeugt, ohne Wartezeit) + Publikumsreaktion
//  2. Claude schreibt parallel den Anschluss-Kommentar mit Spielkontext und Story
//  3. Zwei Stimmen: Reporter (Play-by-Play) und Experte (Analyse in ruhigen Phasen)
//  4. Eine Sprechwarteschlange mit Prioritäten: Wichtiges unterbricht Unwichtiges,
//     veraltete Sätze werden verworfen.

import { BARKS, offlineFollowUp } from './lines.js';
import { Narrative } from './narrative.js';
import { BrowserVoice, ElevenLabsVoice } from './tts.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';

// Modelle mit serverseitigem Fallback bei Ablehnungen
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const ROLE_NAMES = {
  Torwart: 'Torwart',
  Abwehr: 'Zweierreihe (Abwehr)',
  Mittelfeld: 'Fünferreihe (Mittelfeld)',
  Sturm: 'Dreierreihe (Sturm)',
};

const SYSTEM_PROMPT = `Ihr seid das Kommentatoren-Duo einer TV-Liveübertragung, wie in einem Fußball-Videospiel, und kommentiert ein echtes Tischkicker-Spiel, das gerade von einer Kamera erfasst wird.

REPORTER: macht das Play-by-Play. Energiegeladen, schnell, emotional, steigert sich bei Toren und knappen Spielständen.
EXPERTE: ehemaliger Profi am Kickertisch. Ordnet ein, analysiert Spielverlauf und Statistik, hat trockenen Humor, spricht ruhiger.

Du bekommst den Anlass des Kommentars, die Story des Spiels, Statistik und was bereits gesagt wurde. Antworte mit 1 bis 2 Sprechzeilen (beim Anpfiff und Spielende bis zu 3):
- Reporter höchstens 18 Wörter pro Zeile, Experte höchstens 25.
- Die Zeilen werden sofort vorgelesen: natürliche gesprochene Sprache, keine Emojis, kein Markdown, keine Regieanweisungen, Zahlen so schreiben, wie man sie spricht.
- Greife die Story auf (Ausgleich, Führungswechsel, Aufholjagd, Serie, Matchball, Rekordschuss), denn das macht den Kommentar lebendig.
- Nutze Kicker-Begriffe: Torwart, Zweierreihe, Fünferreihe, Dreierreihe, Stange, Bande, Ballkontrolle, Parade.
- Nenne Teams nur mit den angegebenen Namen. Erfinde keine Spielernamen, keine Schusstechniken und keine Ereignisse, die nicht in den Daten stehen.
- Wiederhole nichts, was unter "Bereits gesagt" steht, auch nicht sinngemäß.
- intensity: ruhig, gespannt, aufgeregt oder ekstatisch (ekstatisch nur bei Toren und Spielentscheidungen).`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['reporter', 'experte'] },
          text: { type: 'string' },
          intensity: { type: 'string', enum: ['ruhig', 'gespannt', 'aufgeregt', 'ekstatisch'] },
        },
        required: ['speaker', 'text', 'intensity'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

// ——— Sprechwarteschlange ———

class Channel {
  constructor({ onStart, onIdle, isMuted }) {
    this.onStart = onStart;
    this.onIdle = onIdle;
    this.isMuted = isMuted;
    this.current = null;
    this.queue = [];
    this.seq = 0;
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  // item: { prio, clip: Promise<Clip>, speaker, text, intensity, t, maxAge, interrupt }
  say(item) {
    if (this.isMuted()) return;
    item.seq = this.seq++;
    if (!this.current) return this.start(item);
    if (item.interrupt && item.prio > this.current.prio) {
      this.current.handle?.stop();
      this.current = null;
      this.queue = this.queue.filter((q) => q.prio >= item.prio);
      return this.start(item);
    }
    this.queue.push(item);
    this.queue.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
    if (this.queue.length > 4) this.queue.length = 4;
  }

  async start(item) {
    this.current = item;
    let clip = null;
    try {
      clip = await item.clip;
    } catch (err) {
      console.warn('Sprachausgabe fehlgeschlagen:', err);
    }
    if (this.current !== item) return; // in der Zwischenzeit unterbrochen
    const stale = performance.now() / 1000 - item.t > item.maxAge;
    if (clip && !stale) {
      item.handle = clip.play();
      this.onStart(item);
      await item.handle.done;
      if (this.current !== item) return;
    }
    this.current = null;
    this.next();
  }

  next() {
    const item = this.queue.shift();
    if (item) this.start(item);
    else this.onIdle();
  }

  stopAll() {
    this.queue = [];
    this.current?.handle?.stop();
    this.current = null;
  }
}

// ——— Regie ———

export class Director {
  constructor({ audio, getSettings, onLine, onStatus, onGameOver }) {
    this.audio = audio;
    this.getSettings = getSettings;
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.onGameOver = onGameOver;
    this.narrative = new Narrative(10);
    this.browserVoices = { reporter: new BrowserVoice('reporter'), experte: new BrowserVoice('experte') };
    this.voices = this.browserVoices;
    this.ttsDisabled = false;
    this.barkClips = new Map();
    this.lastBark = {};
    this.lastBarkT = {};
    this.recentEvents = [];
    this.said = [];
    this.llmInflight = 0;
    this.llmDisabledUntil = 0;
    this.lastTalk = now();
    this.muted = false;
    this.channel = new Channel({
      isMuted: () => this.muted,
      onStart: (item) => {
        this.audio.duck(true);
        this.remember(item.speaker, item.text);
        this.onLine(item.speaker, item.text, item.intensity === 'ekstatisch');
      },
      onIdle: () => {
        this.audio.duck(false);
        this.lastTalk = now();
      },
    });
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.channel.stopAll();
    this.audio.setCrowd(muted ? 0 : this.getSettings().crowd);
  }

  reset() {
    this.channel.stopAll();
    this.narrative.reset();
    this.recentEvents = [];
    this.said = [];
  }

  // Stimmen gemäß Einstellungen aufbauen
  configure() {
    const s = this.getSettings();
    this.narrative.goalsToWin = s.goalsToWin;
    this.barkClips.clear();
    this.ttsDisabled = false;
    if (s.tts === 'elevenlabs' && s.elevenKey && s.voiceReporter) {
      const make = (voiceId) => new ElevenLabsVoice({ apiKey: s.elevenKey, voiceId, modelId: s.elevenModel }, this.audio);
      this.voices = { reporter: make(s.voiceReporter), experte: make(s.voiceExperte || s.voiceReporter) };
    } else {
      this.voices = this.browserVoices;
    }
  }

  // Vor dem Anpfiff: alle Sofort-Ausrufe vorab erzeugen, damit sie ohne Verzögerung kommen
  async warmUp(names) {
    if (this.voices === this.browserVoices) return;
    const jobs = [];
    for (const [type, lines] of Object.entries(BARKS)) {
      for (const [template, intensity] of lines) {
        const texts = template.includes('{team}') ? names.map((n) => template.replaceAll('{team}', n)) : [template];
        for (const text of texts) jobs.push({ type, text, intensity });
      }
    }
    // Torschreie zuerst, sie sind am wichtigsten
    jobs.sort((a, b) => (b.type === 'goal') - (a.type === 'goal'));
    let done = 0;
    const worker = async () => {
      while (jobs.length && !this.ttsDisabled) {
        const j = jobs.shift();
        const clip = this.prepare('reporter', j.text, j.intensity);
        this.barkClips.set(j.text, clip);
        await clip.catch(() => {});
        done++;
        this.onStatus(`Stimmen laden ${done}…`, 'offline');
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.onStatus(this.llmStatus(), 'ok');
  }

  prepare(speaker, text, intensity) {
    const voice = this.ttsDisabled ? this.browserVoices[speaker] : this.voices[speaker];
    return voice.prepare(text, intensity).catch((err) => {
      this.onStatus(err.userMessage || 'Sprachfehler', 'error');
      if (err.status === 401 || err.status === 404) this.ttsDisabled = true;
      return this.browserVoices[speaker].prepare(text, intensity);
    });
  }

  llmStatus() {
    return this.getSettings().apiKey ? 'KI-Kommentar' : 'Offline-Vorlagen';
  }

  remember(speaker, text) {
    this.said.push(`${speaker === 'experte' ? 'Experte' : 'Reporter'}: ${text}`);
    if (this.said.length > 10) this.said.shift();
  }

  // ctx: { names, snapshot, gameTime }
  handle(events, ctx) {
    for (const e of events) {
      this.logEvent(e, ctx);
      this.react(e, ctx);
    }
  }

  react(e, ctx) {
    const { names, gameTime } = ctx;
    switch (e.type) {
      case 'kickoff':
        this.narrative.reset();
        this.narrative.restart(gameTime);
        this.audio.whistle([0.6]);
        this.followUp('kickoff', ctx, {}, { prio: 4, maxAge: 12 });
        break;
      case 'resume':
        this.audio.whistle([0.3]);
        this.bark('restart', null, names, { prio: 2, maxAge: 3 });
        break;
      case 'pause':
        this.audio.whistle([0.25, 0.25]);
        break;
      case 'shot':
        this.audio.rise();
        this.bark('shot', e.team, names, { prio: 3, maxAge: 1.2, interrupt: true });
        break;
      case 'save':
        this.audio.ooh();
        this.bark('save', e.team, names, { prio: 4, maxAge: 1.8, interrupt: true });
        if (Math.random() < 0.6) this.followUp('save', ctx, { event: e }, { prio: 2, maxAge: 7 });
        break;
      case 'goal': {
        this.audio.roar();
        const tags = this.narrative.onGoal(e.team, e.score, gameTime, e.kmh);
        const bark = this.bark('goal', e.team, names, { prio: 6, maxAge: 4, interrupt: true });
        this.followUp('goal', ctx, { event: e, tags, bark }, { prio: 5, maxAge: 20 });
        if (this.narrative.over) {
          setTimeout(() => this.audio.whistle([0.3, 0.3, 0.9]), 1800);
          this.onGameOver(e.team);
        }
        break;
      }
      case 'correction':
        this.narrative.onCorrection();
        this.bark('correction', e.team, names, { prio: 4, maxAge: 3, interrupt: true });
        this.followUp('correction', ctx, { event: e }, { prio: 4, maxAge: 8 }, true);
        break;
      case 'control': {
        const type = e.role === 'Sturm' ? 'danger' : e.role === 'Mittelfeld' ? 'build' : 'defense';
        const chance = type === 'danger' ? 0.8 : 0.3;
        const cooldown = type === 'danger' ? 4 : 9;
        if (!this.channel.busy && Math.random() < chance && now() - (this.lastBarkT[type] || 0) > cooldown) {
          this.bark(type, e.team, names, { prio: 1, maxAge: 1.5 });
        }
        break;
      }
      case 'restart':
        this.narrative.restart(gameTime);
        if (!this.channel.busy && Math.random() < 0.5) this.bark('restart', null, names, { prio: 1, maxAge: 2 });
        break;
      case 'lost':
        if (!this.channel.busy) this.bark('lost', null, names, { prio: 1, maxAge: 3 });
        break;
    }
  }

  // Ruhige Phase? Dann übernimmt der Experte (oder der Reporter fasst zusammen).
  tick(running, ctx) {
    const s = this.getSettings();
    if (!running || this.channel.busy || this.llmInflight) return;
    if (now() - this.lastTalk < s.fillerSec) return;
    this.lastTalk = now();
    this.followUp('analysis', ctx, {}, { prio: 0, maxAge: 10 });
  }

  bark(type, team, names, opts) {
    const options = BARKS[type].filter(([tpl]) => team !== null || !tpl.includes('{team}'));
    // Nicht zweimal hintereinander denselben Ausruf
    const pool = options.length > 1 ? options.filter(([tpl]) => tpl !== this.lastBark[type]) : options;
    const [tpl, intensity] = pool[Math.floor(Math.random() * pool.length)];
    this.lastBark[type] = tpl;
    this.lastBarkT[type] = now();
    const text = team !== null ? tpl.replaceAll('{team}', names[team]) : tpl;
    const clip = this.barkClips.get(text) || this.prepare('reporter', text, intensity);
    this.channel.say({ ...opts, clip, speaker: 'reporter', text, intensity, t: now() });
    return text;
  }

  // Anschluss-Kommentar: Claude (oder Vorlagen) mit Kontext
  async followUp(kind, ctx, extra, opts, offlineOnly = false) {
    const t = now();
    const s = this.getSettings();
    let lines = null;
    if (!offlineOnly && s.apiKey && t > this.llmDisabledUntil) {
      this.llmInflight++;
      try {
        lines = await this.askClaude(kind, ctx, extra, s);
        this.onStatus(this.llmStatus(), 'ok');
      } catch (err) {
        this.onStatus(err.userMessage || 'KI-Fehler, nutze Vorlagen', 'error');
        console.warn('Claude-Anfrage fehlgeschlagen:', err);
        this.llmDisabledUntil = now() + (err.retryAfter ?? 5);
      } finally {
        this.llmInflight--;
      }
    }
    if (!lines) {
      const said = (l) => this.said.some((x) => x.endsWith(l[1]));
      const args = { names: ctx.names, score: ctx.snapshot.score, team: extra.event?.team, tags: extra.tags, stats: ctx.snapshot };
      let offline = offlineFollowUp(kind, args);
      // Vorlagen sind begrenzt: nicht direkt dasselbe nochmal sagen
      for (let i = 0; i < 4 && offline.some(said); i++) offline = offlineFollowUp(kind, args);
      if (kind === 'analysis' && offline.some(said)) return;
      lines = offline.map(([speaker, text, intensity]) => ({ speaker, text, intensity }));
    }
    if (!s.expert) lines = lines.filter((l) => l.speaker === 'reporter');
    lines.forEach((l, i) => {
      // Alle Zeilen sofort synthetisieren, abgespielt wird nacheinander
      const clip = this.prepare(l.speaker, l.text, l.intensity);
      this.channel.say({ prio: opts.prio - i * 0.01, maxAge: opts.maxAge, clip, speaker: l.speaker, text: l.text, intensity: l.intensity, t });
    });
  }

  logEvent(e, { names, gameTime }) {
    const who = e.team !== undefined ? ` ${names[e.team]}` : '';
    const labels = {
      goal: `TOR${who}${e.kmh ? `, ${e.kmh} km/h` : ''}${e.manual ? ' (manuell)' : ''}`,
      shot: `Schuss${who}${e.role ? ` aus der ${ROLE_NAMES[e.role]}` : ''}, ${e.kmh} km/h, ${e.onTarget ? 'aufs Tor' : 'eher vorbei'}`,
      save: `Parade${who} (${ROLE_NAMES[e.role] || e.role}) gegen ${e.shotKmh} km/h`,
      control: `Ballkontrolle${who} an der ${ROLE_NAMES[e.role]}`,
      lost: 'Ball nicht zu sehen',
      restart: 'Ball wieder im Spiel',
      correction: `Tor für${who} zurückgenommen`,
      kickoff: 'Anpfiff',
      pause: 'Unterbrechung',
      resume: 'Weiter',
    };
    this.recentEvents.push(`${clock(gameTime)} ${labels[e.type] || e.type}`);
    if (this.recentEvents.length > 8) this.recentEvents.shift();
  }

  buildPrompt(kind, { names, snapshot: s, gameTime }, extra) {
    const goalsToWin = this.getSettings().goalsToWin;
    const reasons = {
      kickoff: `ANPFIFF. Begrüßt die Zuschauer zum Spiel ${names[0]} gegen ${names[1]} (gespielt wird bis ${goalsToWin} Tore). Reporter eröffnet, Experte gibt eine kurze Einschätzung.`,
      goal: `TOR für ${names[extra.event?.team]}. Der Reporter hat schon "${extra.bark}" gerufen. Nicht noch einmal den Torschrei wiederholen, sondern direkt anknüpfen: Spielstand, Story, Emotion. Danach optional ein kurzer Satz des Experten.${this.narrative.over ? ' Das Spiel ist damit VORBEI: Reporter verkündet den Sieger, Experte zieht ein kurzes Fazit.' : ''}`,
      save: `PARADE von ${names[extra.event?.team]} gegen einen Schuss mit ${extra.event?.shotKmh} km/h. Der Reporter hat schon reagiert. Ein kurzer Satz, am besten vom Experten, warum das stark war.`,
      correction: `KORREKTUR: Ein Tor für ${names[extra.event?.team]} wurde zurückgenommen.`,
      analysis: 'RUHIGE PHASE ohne besondere Aktion. Der Experte analysiert kurz die Lage, die Statistik oder die Spannung, gern als kurzer Wechsel mit dem Reporter.',
    };
    const lines = [
      `Anlass: ${reasons[kind]}`,
      `Spielstand: ${names[0]} ${s.score[0]} : ${s.score[1]} ${names[1]} (gespielt wird bis ${goalsToWin}), Spielzeit ${clock(gameTime)}.`,
    ];
    if (extra.tags?.length) lines.push(`Story dieses Tors: ${extra.tags.join('; ')}.`);
    const situation = this.narrative.situation(s.score, names, gameTime);
    if (situation.length) lines.push(`Lage: ${situation.join('; ')}.`);
    lines.push(`Schüsse: ${names[0]} ${s.shots[0]} (${s.onTarget[0]} aufs Tor), ${names[1]} ${s.shots[1]} (${s.onTarget[1]} aufs Tor). Paraden: ${names[0]} ${s.saves[0]}, ${names[1]} ${s.saves[1]}.`);
    if (s.possession) lines.push(`Ballbesitz: ${names[0]} ${s.possession[0]} %, ${names[1]} ${s.possession[1]} %.`);
    if (s.maxKmh > 0 && s.maxKmhTeam !== null) lines.push(`Härtester Schuss: ${s.maxKmh} km/h von ${names[s.maxKmhTeam]}.`);
    if (this.recentEvents.length) lines.push(`Letzte Ereignisse:\n${this.recentEvents.join('\n')}`);
    if (this.said.length) lines.push(`Bereits gesagt:\n${this.said.slice(-6).join('\n')}`);
    if (!this.getSettings().expert) lines.push('Heute kommentiert nur der Reporter, keine Expertenzeilen.');
    return lines.join('\n');
  }

  async getClient(apiKey) {
    if (this.client && this.clientKey === apiKey) return this.client;
    const mod = await import(SDK_URL);
    this.Anthropic = mod.default;
    // Der Key bleibt auf diesem Gerät; die App spricht direkt mit der Claude API.
    this.client = new this.Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15000 });
    this.clientKey = apiKey;
    return this.client;
  }

  async askClaude(kind, ctx, extra, s) {
    const client = await this.getClient(s.apiKey);
    const A = this.Anthropic;
    const params = {
      model: s.model,
      max_tokens: 1024,
      // Niedriger Aufwand = schnelle Antwort; das Format erzwingt sauberes JSON
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: this.buildPrompt(kind, ctx, extra) }],
    };
    let resp;
    try {
      resp = FALLBACK_MODELS.has(s.model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof A.AuthenticationError) throw tagged(err, 'Claude-Key ungültig', 60);
      if (err instanceof A.PermissionDeniedError) throw tagged(err, 'Kein Zugriff auf dieses Modell', 60);
      if (err instanceof A.NotFoundError) throw tagged(err, 'Modell nicht gefunden', 60);
      if (err instanceof A.RateLimitError) throw tagged(err, 'Rate-Limit erreicht, kurz Pause', 15);
      if (err instanceof A.BadRequestError) throw tagged(err, 'Ungültige Anfrage', 30);
      if (err instanceof A.APIError && err.status >= 500) throw tagged(err, 'Claude überlastet', 5);
      if (err instanceof A.APIConnectionError) throw tagged(err, 'Keine Verbindung zur KI', 5);
      throw err;
    }
    if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') return null;
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    return parsed.lines
      .filter((l) => l.text?.trim())
      .slice(0, 3)
      .map((l) => ({ ...l, text: l.text.replace(/[*_#"„“]/g, '').trim() }));
  }
}

function tagged(err, userMessage, retryAfter) {
  err.userMessage = userMessage;
  err.retryAfter = retryAfter;
  return err;
}

function now() {
  return performance.now() / 1000;
}

function clock(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
