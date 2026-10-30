// Commentary script database: loads data/commentary.json, fills slots and picks
// lines that fit the current situation, avoiding recent repeats.

const NUMBERS = ['nil', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

// Spoken number; 'nil' only makes sense for scores
export function words(n, { score = false } = {}) {
  if (n === 0 && !score) return 'zero';
  return NUMBERS[n] ?? String(n);
}

export function spokenDuration(sec) {
  const s = Math.round(sec);
  if (s < 90) return `${s} seconds`;
  const m = Math.round(s / 60);
  return m === 1 ? 'a minute' : `${m} minutes`;
}

const REPEAT_WINDOW = 600; // seconds before a line may be used again

export class Script {
  constructor(data) {
    this.data = data;
    this.used = new Map(); // id -> time used
  }

  static async load(url = 'data/commentary.json') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Could not load ${url}: ${resp.status}`);
    return new Script(await resp.json());
  }

  reset() {
    this.used.clear();
  }

  markUsed(id) {
    this.used.set(id, now());
  }

  // All entries of one section/event/situation as { id, speaker, intensity, template }
  entries(section, event, situation) {
    const s = this.data[section]?.[event]?.[situation];
    if (!s) return [];
    const out = [];
    if (section === 'barks') {
      s.lines.forEach((template, i) => out.push({ id: `b.${event}.${situation}.${i}`, speaker: 'pbp', intensity: s.intensity, template }));
    } else {
      for (const speaker of ['pbp', 'color']) {
        (s[speaker] || []).forEach((template, i) => out.push({ id: `l.${event}.${situation}.${speaker}.${i}`, speaker, intensity: s.intensity, template }));
      }
    }
    return out;
  }

  situations(section, event) {
    return Object.keys(this.data[section]?.[event] || {});
  }

  // Lines whose slots can all be filled, least recently used first, with some randomness
  candidates(section, event, situation, slots, { speaker, limit = 6 } = {}) {
    const t = now();
    const list = this.entries(section, event, situation)
      .filter((e) => !speaker || e.speaker === speaker)
      .map((e) => ({ ...e, text: fill(e.template, slots) }))
      .filter((e) => e.text !== null);
    const fresh = list.filter((e) => !this.used.has(e.id) || t - this.used.get(e.id) > REPEAT_WINDOW);
    if (fresh.length) return shuffle(fresh).slice(0, limit);
    // Everything was used recently: fall back to the least recently used third
    const oldest = [...list].sort((a, b) => this.used.get(a.id) - this.used.get(b.id));
    return shuffle(oldest.slice(0, Math.max(1, Math.ceil(oldest.length / 3)))).slice(0, limit);
  }

  // Every bark text for a pair of team names (used to pre-generate audio)
  allBarks(names) {
    const out = [];
    for (const event of Object.keys(this.data.barks)) {
      for (const situation of this.situations('barks', event)) {
        for (const e of this.entries('barks', event, situation)) {
          const variants = /\{(team|opponent)\}/.test(e.template)
            ? [0, 1].map((k) => fill(e.template, { team: names[k], opponent: names[1 - k] }))
            : [e.template];
          for (const text of variants) out.push({ event, situation, text, intensity: e.intensity });
        }
      }
    }
    return out;
  }
}

export function fill(template, slots) {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = slots[key];
    if (v === undefined || v === null || v === '') missing = true;
    return v ?? '';
  });
  // Slots like {score_line} can start a sentence: capitalise sentence starts
  return missing ? null : text.replace(/(^|[.!?]\s+)([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
}

// ——— Slot values from game state ———

// score: [left team, right team]; team: acting team index or null
export function buildSlots({ names, score, team = null, snapshot, story = {}, goalsToWin, extra = {} }) {
  const [a, b] = score;
  const lead = Math.abs(a - b);
  const leader = a === b ? null : a > b ? 0 : 1;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const scoreWords = a === b ? `${words(a, { score: true })}-all` : `${words(hi, { score: true })}-${words(lo, { score: true })}`;
  const slots = {
    score: a === 0 && b === 0 ? 'nil-nil' : scoreWords,
    score_line: a === b ? (a === 0 ? 'nil-nil' : `all square at ${scoreWords}`) : `${scoreWords} to ${names[leader]}`,
    goals_to_win: words(goalsToWin),
    lead: leader !== null ? words(lead) : null,
    leader: leader !== null ? names[leader] : null,
    trailer: leader !== null ? names[1 - leader] : null,
  };
  if (team !== null) {
    slots.team = names[team];
    slots.opponent = names[1 - team];
    slots.team_goals = words(score[team]);
    const behind = score[1 - team] - score[team];
    slots.trail_by = behind > 0 ? words(behind) : null;
    if (snapshot) slots.saves_team = snapshot.saves[team] > 0 ? words(snapshot.saves[team]) : null;
  }
  if (story.deficit) slots.deficit = words(story.deficit);
  if (story.streak) slots.streak = words(story.streak);
  if (story.drought) slots.drought = spokenDuration(story.drought);
  if (story.kmh) slots.speed = `${story.kmh} kilometres per hour`;

  if (snapshot) {
    const s = snapshot;
    if (s.maxKmh > 0) slots.record = `${s.maxKmh} kilometres per hour`;
    if (s.possession) {
      const k = s.possession[0] >= s.possession[1] ? 0 : 1;
      if (s.possession[k] >= 58) {
        slots.poss_leader = names[k];
        slots.poss_pct = String(s.possession[k]);
      }
    }
    if (s.shots[0] !== s.shots[1] && s.shots[0] + s.shots[1] >= 3) {
      const k = s.shots[0] > s.shots[1] ? 0 : 1;
      slots.shots_leader = names[k];
      slots.shots_more = words(s.shots[k]);
      slots.shots_fewer = words(s.shots[1 - k]);
    }
    const busy = s.saves[0] >= s.saves[1] ? 0 : 1;
    if (s.saves[busy] >= 3) {
      slots.busy_team = names[busy];
      slots.busy_saves = words(s.saves[busy]);
    }
  }
  Object.assign(slots, extra);
  return slots;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function now() {
  return performance.now() / 1000;
}
