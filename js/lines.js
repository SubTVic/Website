// Sofort-Ausrufe („Barks“) wie in Fußballspielen: kurze Sätze, die ohne Wartezeit
// kommen, während die KI im Hintergrund den ausführlichen Kommentar schreibt.
// {team} wird durch den Teamnamen ersetzt. Format: [Text, Intensität]

export const BARKS = {
  goal: [
    ['Toooor!', 'ekstatisch'],
    ['Tor! Tor! Tor!', 'ekstatisch'],
    ['Und drin ist das Ding!', 'ekstatisch'],
    ['Jaaa! Da ist er drin!', 'ekstatisch'],
    ['Toooor für {team}!', 'ekstatisch'],
    ['Eingeschlagen! {team} trifft!', 'ekstatisch'],
  ],
  shot: [
    ['Schuss!', 'aufgeregt'],
    ['Der zieht ab!', 'aufgeregt'],
    ['Da kommt der Hammer!', 'aufgeregt'],
    ['Und der Abschluss!', 'aufgeregt'],
    ['{team} schießt!', 'aufgeregt'],
  ],
  save: [
    ['Gehalten!', 'aufgeregt'],
    ['Was für eine Parade!', 'aufgeregt'],
    ['Abgewehrt!', 'aufgeregt'],
    ['Geblockt! Stark von {team}!', 'aufgeregt'],
    ['Da ist die Abwehr zur Stelle!', 'aufgeregt'],
  ],
  danger: [
    ['Jetzt wird es gefährlich!', 'gespannt'],
    ['Ball an der Dreierreihe!', 'gespannt'],
    ['{team} lauert vorne!', 'gespannt'],
    ['Achtung, hier brennt es!', 'gespannt'],
    ['{team} macht Druck!', 'gespannt'],
  ],
  build: [
    ['Ruhiger Aufbau im Mittelfeld.', 'ruhig'],
    ['Die Fünferreihe sortiert sich.', 'ruhig'],
    ['{team} lässt den Ball laufen.', 'ruhig'],
    ['Geduldig über die Mitte.', 'ruhig'],
  ],
  defense: [
    ['Hinten wird aufgebaut.', 'ruhig'],
    ['Ruhe in der Abwehr von {team}.', 'ruhig'],
    ['Der Torwart hat den Ball.', 'ruhig'],
  ],
  lost: [
    ['Wo ist der Ball?', 'ruhig'],
    ['Ball aus dem Spiel.', 'ruhig'],
  ],
  restart: [
    ['Und weiter geht es!', 'gespannt'],
    ['Der Ball rollt wieder.', 'gespannt'],
    ['Neuer Angriff!', 'gespannt'],
  ],
  correction: [
    ['Moment, Kommando zurück!', 'gespannt'],
  ],
};

// Ersatz-Kommentare ohne KI. tags: Story-Tags aus narrative.js
export function offlineFollowUp(kind, { names, score, team, tags = [], stats }) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const s = `${score[0]} zu ${score[1]}`;
  const n = team !== undefined ? names[team] : '';
  const has = (word) => tags.some((t) => t.includes(word));
  switch (kind) {
    case 'goal':
      if (has('SIEGTOR')) return [['reporter', `Das ist die Entscheidung! ${n} gewinnt mit ${s}!`, 'ekstatisch'], ['experte', 'Verdienter Sieg, am Ende war das eine klare Sache.', 'gespannt']];
      if (has('Führungswechsel')) return [['reporter', `Das Spiel ist gedreht! ${n} führt jetzt, ${s}!`, 'aufgeregt']];
      if (has('Ausgleich')) return [['reporter', `Der Ausgleich! Alles wieder offen beim ${s}.`, 'aufgeregt']];
      if (has('Matchball')) return [['reporter', `${s}, und ${n} hat jetzt Matchball!`, 'aufgeregt']];
      return [['reporter', pick([`${n} erhöht auf ${s}.`, `Neuer Spielstand: ${s}.`, `Da jubelt ${n}, es steht ${s}.`]), 'aufgeregt']];
    case 'kickoff':
      return [['reporter', `Herzlich willkommen zum Duell ${names[0]} gegen ${names[1]}! Der Ball rollt!`, 'aufgeregt'], ['experte', 'Ich bin gespannt, wer hier die ruhigere Hand am Griff hat.', 'ruhig']];
    case 'save':
      return [['experte', pick(['Das war Reflex pur.', 'Starke Antizipation, genau richtig gestanden.', 'Da hat er die Stange perfekt hingestellt.']), 'ruhig']];
    case 'analysis': {
      const opts = [['reporter', `Es steht ${s}.`, 'ruhig']];
      if (stats.shots[0] + stats.shots[1] > 0) opts.push(['experte', `Schüsse bisher: ${names[0]} ${stats.shots[0]}, ${names[1]} ${stats.shots[1]}.`, 'ruhig']);
      if (stats.possession) opts.push(['experte', `Ballbesitz ${stats.possession[0]} zu ${stats.possession[1]} Prozent, das sagt einiges.`, 'ruhig']);
      if (stats.maxKmh > 0) opts.push(['experte', `Härtester Schuss bisher: ${stats.maxKmh} Kilometer pro Stunde.`, 'ruhig']);
      return [pick(opts)];
    }
    case 'correction':
      return [['reporter', `Das Tor zählt nicht. Es steht ${s}.`, 'ruhig']];
    default:
      return [];
  }
}
