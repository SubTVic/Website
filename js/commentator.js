// Live commentary director, built like sports video games do it:
//  1. Instant call from the script database (pre-generated audio, zero wait) + crowd reaction
//  2. Meanwhile Claude Haiku picks the best follow-up lines from the database for this exact
//     situation and stitches them together (or the code picks one when offline)
//  3. Two voices: play-by-play (pbp) and analyst (color), who fills the quiet spells
//  4. One speech queue with priorities: big moments interrupt small ones, stale lines are dropped

import { Narrative } from './narrative.js';
import { buildSlots } from './script.js';
import { BrowserVoice, ElevenLabsVoice } from './tts.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';

// Models that support the server-side fallback on refusals
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const ROLE_NAMES = { goalie: 'goalie', defence: 'two-bar (defence)', midfield: 'five-bar (midfield)', attack: 'three-bar (attack)' };

const SYSTEM_PROMPT = `You are the live commentary director for a TV-style broadcast of a real foosball (table football) match that a camera is tracking right now. There are two commentators:
PBP: play-by-play. Energetic, quick, emotional, builds up at goals and tight scorelines.
COLOR: the analyst, a former table football pro. Calmer, puts things in context, uses the stats and the story, dry sense of humour.

Each request gives you the moment, the facts, what was already said and CANDIDATE lines from the broadcast script, already filled in with names and numbers. Decide what is said next:
- Return 1 or 2 lines (up to 3 at kickoff and at full time).
- Build every line from the candidates: use one verbatim, merge two into one, or trim and adjust a few words so it flows and fits the facts exactly. Only write a new line when no candidate fits, and then keep the same style.
- Never state anything that is not in the facts or the candidates. Never invent player names or shot techniques.
- Never repeat or closely paraphrase anything under "Already said".
- PBP lines at most 18 words, COLOR lines at most 25 words. Spoken English only: no emojis, no markdown, no stage directions.
- For each line, list the ids of the candidates it is based on (empty if none).
- intensity: calm, tense, excited or ecstatic (ecstatic only for goals and match-deciding moments).`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['pbp', 'color'] },
          text: { type: 'string' },
          intensity: { type: 'string', enum: ['calm', 'tense', 'excited', 'ecstatic'] },
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['speaker', 'text', 'intensity', 'ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

// ——— Speech queue ———

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

  // item: { prio, clip: Promise<Clip>, speaker, text, intensity, t, maxAge, notBefore?, interrupt? }
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
      // Let a big moment breathe (crowd roar) before the follow-up
      const wait = (item.notBefore ?? 0) - now();
      if (wait > 0) await sleep(wait * 1000);
    } catch (err) {
      console.warn('Speech failed:', err);
    }
    if (this.current !== item) return; // interrupted meanwhile
    const stale = now() - item.t > item.maxAge;
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

// ——— Director ———

export class Director {
  constructor({ audio, script, getSettings, onLine, onStatus, onGameOver }) {
    this.audio = audio;
    this.script = script;
    this.getSettings = getSettings;
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.onGameOver = onGameOver;
    this.narrative = new Narrative(10);
    this.browserVoices = { pbp: new BrowserVoice('pbp'), color: new BrowserVoice('color') };
    this.voices = this.browserVoices;
    this.ttsDisabled = false;
    this.barkClips = new Map(); // text -> Promise<Clip>
    this.recentEvents = [];
    this.said = [];
    this.lastBarkT = {};
    this.llmInflight = 0;
    this.llmDisabledUntil = 0;
    this.lastTalk = now();
    this.muted = false;
    this.channel = new Channel({
      isMuted: () => this.muted,
      onStart: (item) => {
        this.audio.duck(true);
        this.remember(item.speaker, item.text);
        this.onLine(item.speaker, item.text, item.intensity === 'ecstatic');
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

  // Whistle, crowd and both voices, so the sound can be checked before kickoff
  // Tests every part of the sound on its own and reports each result
  async soundCheck(report) {
    const s = this.getSettings();
    const say = (speaker, text, clip) => this.channel.say({ prio: 9, maxAge: 60, clip, speaker, text, intensity: 'excited', t: now() });

    report(`Web Audio (crowd, whistle, ElevenLabs): ${this.audio.ctx ? this.audio.ctx.state : 'not available'}`);
    this.audio.whistle([0.4]);
    this.audio.roar();

    const bv = this.browserVoices.pbp;
    report(`Browser voice: ${bv.synth ? bv.voice?.name || 'default voice' : 'not available'}`);

    if (s.tts !== 'elevenlabs') return report('ElevenLabs: off (Speech is set to Browser voice)'), say('pbp', 'Sound check with the browser voice.', bv.prepare('Sound check with the browser voice.', 'excited'));
    if (!s.elevenKey) return report('ElevenLabs: no API key entered');
    if (!s.voicePbp) return report('ElevenLabs: no play-by-play voice ID entered');

    for (const [speaker, text] of [['pbp', 'Sound check! This is your play-by-play commentator.'], ['color', 'And this is the analyst. If you can hear us both, we are ready.']]) {
      const t0 = performance.now();
      try {
        const clip = await this.voices[speaker].prepare(text, 'excited');
        report(`ElevenLabs ${speaker === 'pbp' ? 'play-by-play' : 'analyst'}: OK, ${Math.round(performance.now() - t0)} ms`);
        say(speaker, text, Promise.resolve(clip));
      } catch (err) {
        const why = err.status ? `${err.status} ${err.userMessage}: ${err.message.replace(/^ElevenLabs \d+: /, '').slice(0, 160)}`
          : err.name === 'EncodingError' ? 'audio could not be decoded'
          : `request blocked or offline (${err.message})`;
        report(`ElevenLabs ${speaker === 'pbp' ? 'play-by-play' : 'analyst'}: FAILED, ${why}`);
      }
    }
  }

  reset() {
    this.channel.stopAll();
    this.narrative.reset();
    this.script?.reset();
    this.recentEvents = [];
    this.said = [];
  }

  // Build the voices from the settings
  configure() {
    const s = this.getSettings();
    this.narrative.goalsToWin = s.goalsToWin;
    this.narrative.hardKmh = s.shotKmh * 2;
    this.barkClips.clear();
    this.ttsDisabled = false;
    if (s.tts === 'elevenlabs' && s.elevenKey && s.voicePbp) {
      const make = (voiceId) => new ElevenLabsVoice({ apiKey: s.elevenKey, voiceId, modelId: s.elevenModel }, this.audio);
      this.voices = { pbp: make(s.voicePbp), color: make(s.voiceColor || s.voicePbp) };
    } else {
      this.voices = this.browserVoices;
    }
  }

  get premiumVoice() {
    return this.voices !== this.browserVoices && !this.ttsDisabled;
  }

  // Before kickoff: pre-generate instant calls so they play without delay.
  // Per situation, lines that are already cached come first, then a few new ones,
  // so variety grows from match to match while the cost per match stays small.
  async warmUp(names) {
    if (!this.premiumVoice || !this.script) return;
    const perSituation = 6;
    const groups = new Map();
    for (const b of this.script.allBarks(names)) {
      const key = `${b.event}.${b.situation}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    const jobs = [];
    for (const [key, list] of groups) {
      const shuffled = list.sort(() => Math.random() - 0.5);
      const cached = [];
      const fresh = [];
      for (const b of shuffled) ((await this.voices.pbp.isCached(b.text, b.intensity)) ? cached : fresh).push(b);
      const keep = key.startsWith('goal.') ? perSituation * 2 : perSituation;
      jobs.push(...cached, ...fresh.slice(0, Math.max(0, keep - cached.length)));
    }
    // Goal calls first, they matter most
    jobs.sort((a, b) => (b.event === 'goal') - (a.event === 'goal'));
    let done = 0;
    const worker = async () => {
      while (jobs.length && this.premiumVoice) {
        const j = jobs.shift();
        const clip = this.prepare('pbp', j.text, j.intensity);
        this.barkClips.set(j.text, clip);
        await clip.catch(() => {});
        done++;
        if (done % 5 === 0 || !jobs.length) this.onStatus(`Voices ${done}…`, 'offline');
      }
    };
    // Two at a time, so live lines still fit within the plan's concurrency limit
    await Promise.all([worker(), worker()]);
    this.onStatus(this.llmStatus(), 'ok');
  }

  prepare(speaker, text, intensity) {
    const voice = this.ttsDisabled ? this.browserVoices[speaker] : this.voices[speaker];
    return voice.prepare(text, intensity).catch((err) => {
      this.onStatus(err.userMessage || 'Voice error', 'error');
      if (err.status === 401 || err.status === 404) this.ttsDisabled = true;
      return this.browserVoices[speaker].prepare(text, intensity);
    });
  }

  llmStatus() {
    return this.getSettings().apiKey ? 'AI commentary' : 'Script only';
  }

  remember(speaker, text) {
    this.said.push(`${speaker === 'color' ? 'COLOR' : 'PBP'}: ${text}`);
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
    const { names, gameTime, snapshot } = ctx;
    const s = this.getSettings();
    const hard = s.shotKmh * 2;
    const slotsFor = (team, story, extra) =>
      buildSlots({ names, score: e.score || snapshot.score, team, snapshot, story, goalsToWin: s.goalsToWin, extra });

    switch (e.type) {
      case 'kickoff':
        this.narrative.reset();
        this.narrative.restart(gameTime);
        this.audio.whistle([0.6]);
        this.followUp('kickoff', ['opening'], slotsFor(0), ctx, 'Kickoff. Welcome the viewers; PBP opens, COLOR gives a short preview.', { prio: 4, maxAge: 12, lines: 2 });
        break;
      case 'resume':
        this.audio.whistle([0.3]);
        this.bark('resume', 'generic', null, names, { prio: 2, maxAge: 3 });
        break;
      case 'pause':
        this.audio.whistle([0.25, 0.25]);
        this.bark('pause', 'generic', null, names, { prio: 2, maxAge: 3 });
        break;
      case 'shot': {
        this.audio.rise();
        const situation = e.kmh >= hard ? 'hard' : (e.role === 'defence' || e.role === 'midfield') && Math.random() < 0.6 ? 'long_range' : 'generic';
        this.bark('shot', situation, e.team, names, { prio: 3, maxAge: 1.2, interrupt: true });
        break;
      }
      case 'save': {
        this.audio.ooh();
        const big = e.shotKmh >= hard;
        const situation = big ? 'big' : e.role === 'goalie' ? 'keeper' : e.role === 'defence' ? 'defense' : 'generic';
        this.bark('save', situation, e.team, names, { prio: 4, maxAge: 1.8, interrupt: true });
        if (Math.random() < 0.6) {
          const slots = slotsFor(e.team, {}, { shot_speed: `${e.shotKmh} kilometres per hour` });
          const sits = [snapshot.saves[e.team] >= 3 && 'busy', big && 'big', 'generic'].filter(Boolean);
          this.followUp('save', sits, slots, ctx, `Save by ${names[e.team]} against a shot at ${e.shotKmh} km/h. PBP already reacted; one short line, ideally COLOR, on why it was good.`, { prio: 2, maxAge: 7, lines: 1 });
        }
        break;
      }
      case 'goal': {
        this.audio.roar();
        const g = this.narrative.onGoal(e.team, e.score, gameTime, e.kmh);
        const call = this.bark('goal', g.bark, e.team, names, { prio: 6, maxAge: 4, interrupt: true });
        const over = this.narrative.over;
        const moment = `GOAL by ${names[e.team]}. The instant call "${call}" was already shouted: continue from it without repeating the call.${over ? ' That goal WINS THE MATCH: PBP announces the winner, COLOR gives a short verdict.' : ''}`;
        this.followUp('goal', g.situations, slotsFor(e.team, g.story), ctx, moment, { prio: 5, maxAge: 20, notBefore: now() + 1.4, lines: over ? 3 : 2 });
        if (over) {
          setTimeout(() => this.audio.whistle([0.3, 0.3, 0.9]), 1800);
          this.onGameOver(e.team);
        }
        break;
      }
      case 'correction':
        this.narrative.onCorrection();
        this.bark('correction', 'generic', e.team, names, { prio: 4, maxAge: 3, interrupt: true });
        this.followUp('correction', ['generic'], slotsFor(e.team), ctx, `A goal for ${names[e.team]} was taken off.`, { prio: 4, maxAge: 8, lines: 1 }, true);
        break;
      case 'control': {
        const type = e.role === 'attack' ? 'danger' : e.role === 'midfield' ? 'build' : 'defense';
        const chance = type === 'danger' ? 0.8 : 0.3;
        const cooldown = type === 'danger' ? 4 : 9;
        if (!this.channel.busy && Math.random() < chance && now() - (this.lastBarkT[type] || 0) > cooldown) {
          this.bark(type, 'generic', e.team, names, { prio: 1, maxAge: 1.5 });
        }
        break;
      }
      case 'restart':
        this.narrative.restart(gameTime);
        if (!this.channel.busy && Math.random() < 0.5) this.bark('restart', 'generic', null, names, { prio: 1, maxAge: 2 });
        break;
      case 'lost':
        if (!this.channel.busy) this.bark('lost', 'generic', null, names, { prio: 1, maxAge: 3 });
        break;
    }
  }

  // Quiet spell? The analyst takes over (or play-by-play sums up).
  tick(running, ctx) {
    const s = this.getSettings();
    if (!running || this.channel.busy || this.llmInflight) return;
    if (now() - this.lastTalk < s.fillerSec) return;
    this.lastTalk = now();
    const { situations, extra } = this.narrative.analysis(ctx.snapshot.score, ctx.names, ctx.snapshot, ctx.gameTime);
    const slots = buildSlots({ names: ctx.names, score: ctx.snapshot.score, snapshot: ctx.snapshot, goalsToWin: s.goalsToWin, extra });
    this.followUp('analysis', situations, slots, ctx, 'A quiet spell with no big action. COLOR offers a short insight on the state of the match, the stats or the tension, possibly as a quick exchange with PBP.', { prio: 0, maxAge: 10, lines: 1, preferColor: true });
  }

  bark(event, situation, team, names, opts) {
    const slots = team !== null ? { team: names[team], opponent: names[1 - team] } : {};
    let cands = this.script.candidates('barks', event, situation, slots, { limit: 20 });
    if (!cands.length && situation !== 'generic') cands = this.script.candidates('barks', event, 'generic', slots, { limit: 20 });
    if (!cands.length) return '';
    // With a premium voice, prefer calls whose audio is already generated
    const ready = this.premiumVoice ? cands.filter((c) => this.barkClips.has(c.text)) : [];
    const pick = (ready.length ? ready : cands)[0];
    this.script.markUsed(pick.id);
    this.lastBarkT[event] = now();
    const clip = this.barkClips.get(pick.text) || this.prepare('pbp', pick.text, pick.intensity);
    this.channel.say({ ...opts, clip, speaker: 'pbp', text: pick.text, intensity: pick.intensity, t: now() });
    return pick.text;
  }

  // Candidate lines for the most interesting situations that have any
  gather(event, situations, slots, preferColor) {
    const out = [];
    let used = 0;
    for (const situation of situations) {
      const pbp = this.script.candidates('lines', event, situation, slots, { speaker: 'pbp', limit: 3 });
      const color = this.script.candidates('lines', event, situation, slots, { speaker: 'color', limit: 3 });
      if (!pbp.length && !color.length) continue;
      out.push(...[...pbp, ...color].map((c) => ({ ...c, situation })));
      if (++used >= (preferColor ? 4 : 3)) break;
    }
    return out;
  }

  async followUp(event, situations, slots, ctx, moment, opts, offlineOnly = false) {
    const t = now();
    const s = this.getSettings();
    const cands = this.gather(event, situations, slots, opts.preferColor);
    let lines = null;
    if (!offlineOnly && s.apiKey && t > this.llmDisabledUntil) {
      this.llmInflight++;
      try {
        lines = await this.askClaude(moment, cands, ctx, opts.lines, s);
        this.onStatus(this.llmStatus(), 'ok');
      } catch (err) {
        this.onStatus(err.userMessage || 'AI error, using script', 'error');
        console.warn('Claude request failed:', err);
        this.llmDisabledUntil = now() + (err.retryAfter ?? 5);
      } finally {
        this.llmInflight--;
      }
    }
    if (!lines) lines = this.pickOffline(cands, opts);
    if (!s.expert) lines = lines.filter((l) => l.speaker === 'pbp');
    lines.forEach((l, i) => {
      (l.ids || []).forEach((id) => this.script.markUsed(id));
      // Synthesize all lines right away; they still play one after another
      const clip = this.prepare(l.speaker, l.text, l.intensity);
      this.channel.say({ prio: opts.prio - i * 0.01, maxAge: opts.maxAge, notBefore: opts.notBefore, clip, speaker: l.speaker, text: l.text, intensity: l.intensity, t });
    });
  }

  // Without AI: the most fitting situation's lines, straight from the script
  pickOffline(cands, opts) {
    if (!cands.length) return [];
    const first = cands[0].situation;
    const top = cands.filter((c) => c.situation === first);
    const pbp = top.find((c) => c.speaker === 'pbp') || cands.find((c) => c.speaker === 'pbp');
    const color = top.find((c) => c.speaker === 'color') || cands.find((c) => c.speaker === 'color');
    let picked;
    if (opts.preferColor) picked = [color || pbp];
    else if (opts.lines >= 2 && color && Math.random() < 0.7) picked = [pbp || color, color].filter((x, i, a) => x && a.indexOf(x) === i);
    else picked = [pbp || color];
    return picked.filter(Boolean).map((c) => ({ speaker: c.speaker, text: c.text, intensity: c.intensity, ids: [c.id] }));
  }

  logEvent(e, { names, gameTime }) {
    const who = e.team !== undefined ? ` ${names[e.team]}` : '';
    const labels = {
      goal: `GOAL${who}${e.kmh ? `, ${e.kmh} km/h` : ''}${e.manual ? ' (entered by hand)' : ''}`,
      shot: `Shot${who}${e.role ? ` from the ${ROLE_NAMES[e.role]}` : ''}, ${e.kmh} km/h, ${e.onTarget ? 'on target' : 'probably wide'}`,
      save: `Save${who} (${ROLE_NAMES[e.role] || e.role}) against ${e.shotKmh} km/h`,
      control: `${who.trim()} in control on the ${ROLE_NAMES[e.role]}`,
      lost: 'Ball out of sight',
      restart: 'Ball back in play',
      correction: `Goal for${who} taken off`,
      kickoff: 'Kickoff',
      pause: 'Paused',
      resume: 'Resumed',
    };
    this.recentEvents.push(`${clock(gameTime)} ${labels[e.type] || e.type}`);
    if (this.recentEvents.length > 8) this.recentEvents.shift();
  }

  buildPrompt(moment, cands, { names, snapshot: s, gameTime }, maxLines) {
    const g = this.getSettings().goalsToWin;
    const out = [
      `Moment: ${moment}`,
      `Return at most ${maxLines} line${maxLines > 1 ? 's' : ''}.`,
      `Score: ${names[0]} ${s.score[0]}, ${names[1]} ${s.score[1]} (first to ${g} wins). Match time ${clock(gameTime)}.`,
      `Shots: ${names[0]} ${s.shots[0]} (${s.onTarget[0]} on target), ${names[1]} ${s.shots[1]} (${s.onTarget[1]} on target). Saves: ${names[0]} ${s.saves[0]}, ${names[1]} ${s.saves[1]}.`,
    ];
    if (s.possession) out.push(`Possession: ${names[0]} ${s.possession[0]}%, ${names[1]} ${s.possession[1]}%.`);
    if (s.maxKmh > 0 && s.maxKmhTeam !== null) out.push(`Fastest shot: ${s.maxKmh} km/h by ${names[s.maxKmhTeam]}.`);
    if (this.recentEvents.length) out.push(`Recent events:\n${this.recentEvents.join('\n')}`);
    if (this.said.length) out.push(`Already said:\n${this.said.slice(-6).join('\n')}`);
    if (!this.getSettings().expert) out.push('Only PBP is on air today: no COLOR lines.');
    out.push(`Candidates:\n${cands.map((c) => `[${c.id}] (${c.speaker}, ${c.situation}) ${c.text}`).join('\n') || '(none)'}`);
    return out.join('\n');
  }

  async getClient(apiKey) {
    if (this.client && this.clientKey === apiKey) return this.client;
    const mod = await import(SDK_URL);
    this.Anthropic = mod.default;
    // The key stays on this device; the app talks to the Claude API directly.
    this.client = new this.Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15000 });
    this.clientKey = apiKey;
    return this.client;
  }

  async askClaude(moment, cands, ctx, maxLines, s) {
    const client = await this.getClient(s.apiKey);
    const A = this.Anthropic;
    const params = {
      model: s.model,
      max_tokens: 1024,
      // Low effort = fast answer; the schema guarantees clean JSON
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: this.buildPrompt(moment, cands, ctx, maxLines) }],
    };
    let resp;
    try {
      resp = FALLBACK_MODELS.has(s.model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof A.AuthenticationError) throw tagged(err, 'Claude key invalid', 60);
      if (err instanceof A.PermissionDeniedError) throw tagged(err, 'No access to this model', 60);
      if (err instanceof A.NotFoundError) throw tagged(err, 'Model not found', 60);
      if (err instanceof A.RateLimitError) throw tagged(err, 'Rate limit, pausing AI', 15);
      if (err instanceof A.BadRequestError) throw tagged(err, 'Invalid AI request', 30);
      if (err instanceof A.APIError && err.status >= 500) throw tagged(err, 'Claude overloaded', 5);
      if (err instanceof A.APIConnectionError) throw tagged(err, 'No connection to the AI', 5);
      throw err;
    }
    if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') return null;
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const known = new Set(cands.map((c) => c.id));
    return JSON.parse(text)
      .lines.filter((l) => l.text?.trim())
      .slice(0, maxLines)
      .map((l) => ({ ...l, text: l.text.replace(/[*_#"“”]/g, '').trim(), ids: (l.ids || []).filter((id) => known.has(id)) }));
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clock(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
