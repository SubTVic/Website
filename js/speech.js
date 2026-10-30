// Sprachausgabe über die im Browser eingebaute Text-to-Speech-Funktion.

export class Speaker {
  constructor() {
    this.enabled = true;
    this.speaking = false;
    this.voice = null;
    this.synth = window.speechSynthesis || null;
    if (!this.synth) return;
    const pick = () => {
      const voices = this.synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('de'));
      // Bevorzugt hochwertige Stimmen, sonst irgendeine deutsche
      this.voice = voices.find((v) => /premium|enhanced|neural|natural|google/i.test(v.name)) || voices[0] || null;
    };
    pick();
    this.synth.addEventListener?.('voiceschanged', pick);
  }

  get available() {
    return !!this.synth;
  }

  // Muss einmal aus einem Klick heraus aufgerufen werden (iOS/Android sperren sonst den Ton)
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  speak(text, { interrupt = false, excited = false } = {}) {
    if (!this.synth || !this.enabled) return Promise.resolve();
    if (interrupt) this.synth.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      if (this.voice) u.voice = this.voice;
      u.rate = excited ? 1.15 : 1.05;
      u.pitch = excited ? 1.15 : 1;
      const done = () => {
        this.speaking = false;
        clearTimeout(guard);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      // Manche Browser feuern onend nicht zuverlässig
      const guard = setTimeout(done, 1500 + text.length * 90);
      this.speaking = true;
      // Kurze Pause nach cancel(), sonst verschluckt Chrome die nächste Ansage
      setTimeout(() => this.synth.speak(u), interrupt ? 60 : 0);
    });
  }

  cancel() {
    this.synth?.cancel();
    this.speaking = false;
  }
}
