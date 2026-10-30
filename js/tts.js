// Voices for the two commentators.
// Every voice offers prepare(text, intensity) -> Promise<Clip>, Clip = { play() -> { done, stop } }.
// prepare() starts synthesis immediately, so the audio is ready when the line's turn comes.

export const INTENSITIES = ['calm', 'tense', 'excited', 'ecstatic'];

// ——— Browser voice (free, offline, rather flat) ———

export class BrowserVoice {
  constructor(role) {
    this.role = role; // 'pbp' | 'color'
    this.synth = window.speechSynthesis || null;
    this.voice = null;
    this.pickVoice();
    this.synth?.addEventListener?.('voiceschanged', () => this.pickVoice());
  }

  pickVoice() {
    if (!this.synth) return;
    const en = this.synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('en'));
    const rank = (v) => (/premium|enhanced|neural|natural|google|online/i.test(v.name) ? 2 : 0) + (/en-gb/i.test(v.lang) ? 1 : 0);
    const pool = en.sort((a, b) => rank(b) - rank(a));
    // The analyst gets a different voice than play-by-play when possible
    this.voice = (this.role === 'color' ? pool[1] : pool[0]) || pool[0] || null;
  }

  async isCached() {
    return true;
  }

  async prepare(text, intensity = 'calm') {
    const level = Math.max(0, INTENSITIES.indexOf(intensity));
    const base = this.role === 'color' ? { rate: 0.98, pitch: 0.85 } : { rate: 1.05, pitch: 1.0 };
    return {
      play: () => {
        if (!this.synth) return { done: Promise.resolve(), stop() {} };
        const u = new SpeechSynthesisUtterance(text);
        u.lang = this.voice?.lang || 'en-GB';
        if (this.voice) u.voice = this.voice;
        u.rate = base.rate + level * 0.07;
        u.pitch = base.pitch + level * 0.08;
        let resolve;
        const done = new Promise((r) => (resolve = r));
        // Some browsers do not fire onend reliably
        const guard = setTimeout(resolve, 1500 + text.length * 90);
        u.onend = u.onerror = () => {
          clearTimeout(guard);
          resolve();
        };
        this.synth.speak(u);
        return { done, stop: () => this.synth.cancel() };
      },
    };
  }
}

// ——— ElevenLabs (very natural, emotional voices) ———

const V3_FAMILY = /^eleven_v[34]/;
const LANGUAGE_CODE_MODELS = /^eleven_(flash|turbo)_v2_5|^eleven_v[34]/;

export class ElevenLabsVoice {
  constructor({ apiKey, voiceId, modelId }, audio) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.modelId = modelId;
    this.audio = audio;
  }

  cacheKey(text, intensity) {
    return `el/${this.modelId}/${this.voiceId}/${intensity}/${text}`;
  }

  async isCached(text, intensity) {
    return (await cacheGet(this.cacheKey(text, intensity))) !== null;
  }

  async prepare(text, intensity = 'calm') {
    const buffer = await this.synthesize(text, intensity);
    return { play: () => this.audio.play(buffer) };
  }

  async synthesize(text, intensity) {
    const level = Math.max(0, INTENSITIES.indexOf(intensity));
    const v3 = V3_FAMILY.test(this.modelId);
    // v3/v4 (incl. v4 Turbo) understand audio tags in square brackets
    const spoken = v3 && level >= 2 ? `[excited] ${text}` : text;
    const key = this.cacheKey(text, intensity);
    let bytes = await cacheGet(key);
    if (!bytes) {
      const body = {
        text: spoken,
        model_id: this.modelId,
        voice_settings: v3
          ? { stability: level >= 2 ? 0 : 0.5, similarity_boost: 0.75 } // v3: 0 = creative/expressive, 0.5 = natural
          : { stability: 0.55 - level * 0.1, similarity_boost: 0.75, style: level * 0.2, use_speaker_boost: true, speed: 1 + level * 0.05 },
      };
      if (LANGUAGE_CODE_MODELS.test(this.modelId)) body.language_code = 'en';
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new TtsError(resp.status, await resp.text().catch(() => ''));
      bytes = await resp.arrayBuffer();
      cachePut(key, bytes);
    }
    // decodeAudioData consumes the buffer, so decode a copy
    return this.audio.decode(bytes.slice(0));
  }
}

export class TtsError extends Error {
  constructor(status, detail) {
    super(`ElevenLabs ${status}: ${detail.slice(0, 200)}`);
    this.status = status;
    this.userMessage =
      status === 401 ? 'ElevenLabs key invalid' :
      status === 404 ? 'ElevenLabs voice not found' :
      status === 429 ? 'ElevenLabs limit reached' :
      status === 422 || status === 400 ? 'ElevenLabs rejected the settings' :
      'ElevenLabs error';
  }
}

// ——— Cache for generated clips (saves cost and waiting time) ———

const CACHE_NAME = 'kicker-tts-v1';

async function cacheGet(key) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheUrl(key));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function cachePut(key, bytes) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheUrl(key), new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }));
  } catch {}
}

function cacheUrl(key) {
  return `${location.origin}/__tts-cache/${encodeURIComponent(key)}`;
}
