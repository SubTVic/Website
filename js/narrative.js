// Story-Gedächtnis: erkennt die Geschichten eines Spiels, so wie ein echter
// Kommentator sie im Kopf hat (Ausgleich, Führungswechsel, Aufholjagd, Serie …).

export class Narrative {
  constructor(goalsToWin) {
    this.goalsToWin = goalsToWin;
    this.reset();
  }

  reset() {
    this.goals = []; // { team, t, score }
    this.maxDeficit = [0, 0]; // größter Rückstand je Team
    this.lastGoalT = 0;
    this.lastRestartT = 0;
    this.fastest = 0;
    this.over = false;
  }

  restart(t) {
    this.lastRestartT = t;
  }

  // Liefert Story-Tags für ein Tor (t = Spielzeit in Sekunden)
  onGoal(team, score, t, kmh) {
    const before = [...score];
    before[team]--;
    const tags = [];
    const diffBefore = before[team] - before[1 - team];
    const diffAfter = score[team] - score[1 - team];

    if (score[0] + score[1] === 1) tags.push('erstes Tor des Spiels');
    if (diffAfter === 0) tags.push('Ausgleich');
    else if (diffBefore === 0) tags.push(score[team] + score[1 - team] === 1 ? 'Führung' : 'erneute Führung');
    else if (diffBefore < 0 && diffAfter > 0) tags.push('Führungswechsel');
    else if (diffBefore > 0) tags.push(`baut Führung aus auf +${diffAfter}`);
    else if (diffAfter < 0) tags.push(`Anschlusstreffer, noch ${-diffAfter} hinten`);

    const deficit = Math.max(this.maxDeficit[team], 0);
    if (deficit >= 2 && diffAfter >= 0) tags.push(`Aufholjagd nach ${deficit} Toren Rückstand`);

    const streak = this.streak(team) + 1;
    if (streak >= 3) tags.push(`${streak}. Tor in Folge`);
    if (this.goals.length && t - this.lastGoalT > 90) tags.push(`Torflaute nach ${Math.round(t - this.lastGoalT)} Sekunden beendet`);
    if (t - this.lastRestartT < 6 && this.goals.length) tags.push('Blitztor direkt nach dem Anstoß');
    if (kmh && kmh > this.fastest && kmh > 15) {
      if (this.fastest > 0) tags.push(`neuer Geschwindigkeitsrekord: ${kmh} km/h`);
      this.fastest = kmh;
    }

    if (score[team] >= this.goalsToWin) {
      tags.push('SIEGTOR, Spiel vorbei');
      this.over = true;
    } else if (this.goalsToWin > 1) {
      if (score[team] === this.goalsToWin - 1) tags.push(`Matchball für dieses Team (noch 1 Tor bis ${this.goalsToWin})`);
      if (score[1 - team] === this.goalsToWin - 1) tags.push('Matchball abgewehrt, der Gegner bleibt bei einem Tor vor dem Sieg');
    }

    this.goals.push({ team, t, score: [...score] });
    this.lastGoalT = t;
    this.lastRestartT = t;
    for (const k of [0, 1]) this.maxDeficit[k] = Math.max(this.maxDeficit[k], score[1 - k] - score[k]);
    return tags;
  }

  onCorrection() {
    this.goals.pop();
    this.over = false;
  }

  streak(team) {
    let n = 0;
    for (let i = this.goals.length - 1; i >= 0 && this.goals[i].team === team; i--) n++;
    return n;
  }

  // Kurze Lage des Spiels für Füll- und Expertenkommentare
  situation(score, names, t) {
    const out = [];
    const [a, b] = score;
    if (a === b) out.push(a === 0 ? 'Noch keine Tore' : 'Unentschieden');
    else out.push(`${names[a > b ? 0 : 1]} führt mit ${Math.abs(a - b)}`);
    for (const k of [0, 1]) {
      if (this.goalsToWin > 1 && score[k] === this.goalsToWin - 1 && !this.over) out.push(`${names[k]} hat Matchball`);
      const s = this.streak(k);
      if (s >= 2 && this.goals.at(-1)?.team === k) out.push(`${names[k]} hat die letzten ${s} Tore geschossen`);
    }
    if (this.goals.length && t - this.lastGoalT > 45) out.push(`seit ${Math.round(t - this.lastGoalT)} Sekunden kein Tor`);
    return out;
  }
}
