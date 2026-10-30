import { words, spokenDuration } from './script.js';

// Story memory: tracks the storylines of a match the way a real commentator does
// (equaliser, comeback, streaks, match point …) and maps them to script situations.

export class Narrative {
  constructor(goalsToWin, hardKmh = 36) {
    this.goalsToWin = goalsToWin;
    this.hardKmh = hardKmh;
    this.reset();
  }

  reset() {
    this.goals = []; // { team, t, score }
    this.maxDeficit = [0, 0]; // biggest deficit each team has faced
    this.lastGoalT = 0;
    this.lastRestartT = 0;
    this.fastest = 0;
    this.over = false;
  }

  restart(t) {
    this.lastRestartT = t;
  }

  // Returns the goal situations (most interesting first), the bark situation and story facts
  onGoal(team, score, t, kmh) {
    const before = [...score];
    before[team]--;
    const diffBefore = before[team] - before[1 - team];
    const diffAfter = score[team] - score[1 - team];
    const deficit = this.maxDeficit[team];
    const streak = this.streak(team) + 1;
    const drought = t - this.lastGoalT;
    const g = this.goalsToWin;
    const situations = [];

    if (score[team] >= g) {
      this.over = true;
      if (deficit >= 2) situations.push('winner_comeback');
      if (diffAfter === 1) situations.push('winner_close');
      if (diffAfter >= Math.max(3, Math.ceil(g / 2))) situations.push('winner_dominant');
      situations.push('winner');
    } else {
      if (deficit >= 2 && diffBefore === 0 && diffAfter > 0) situations.push('comeback_lead');
      if (deficit >= 2 && diffAfter === 0) situations.push('comeback');
      if (g > 1 && score[1 - team] === g - 1) situations.push('stay_alive');
      if (g > 1 && score[team] === g - 1) situations.push('match_point');
    }
    if (streak >= 3) situations.push('streak');
    if (this.goals.length && t - this.lastRestartT < 6) situations.push('quick');
    if (kmh && this.fastest > 0 && kmh > this.fastest) situations.push('record_speed');
    if (drought > 90) situations.push('drought_over');
    if (kmh && kmh >= this.hardKmh) situations.push('rocket');
    if (score[0] + score[1] === 1) situations.push('opener');
    else if (diffAfter === 0) situations.push('equalizer');
    else if (diffBefore === 0) situations.push('go_ahead');
    else if (diffBefore > 0) situations.push('extend_lead');
    else situations.push('pull_back');
    situations.push('generic');

    let bark = 'generic';
    if (this.over) bark = 'winner';
    else if (Math.random() < 0.6) {
      if (diffAfter === 0 && score[team] > 0) bark = 'equalizer';
      else if (streak >= 2) bark = 'again';
      else if (diffBefore === 0) bark = 'go_ahead';
    }

    if (kmh) this.fastest = Math.max(this.fastest, kmh);
    this.goals.push({ team, t, score: [...score] });
    this.lastGoalT = t;
    this.lastRestartT = t;
    for (const k of [0, 1]) this.maxDeficit[k] = Math.max(this.maxDeficit[k], score[1 - k] - score[k]);

    return {
      situations,
      bark,
      story: { deficit: deficit >= 2 ? deficit : null, streak: streak >= 2 ? streak : null, drought: drought > 90 ? drought : null, kmh: kmh || null },
    };
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

  // Situations for a quiet spell, most interesting first, plus their extra slots
  analysis(score, names, snapshot, t) {
    const situations = [];
    const extra = {};
    const [a, b] = score;
    const g = this.goalsToWin;
    const mp = [0, 1].find((k) => g > 1 && score[k] === g - 1);
    if (mp !== undefined && !this.over) {
      situations.push('match_point');
      extra.mp_team = names[mp];
    }
    const last = this.goals.at(-1);
    if (last && this.streak(last.team) >= 2) {
      situations.push('momentum');
      extra.hot_team = names[last.team];
      extra.hot_streak = words(this.streak(last.team));
    }
    if (Math.abs(a - b) >= 3) situations.push('big_lead');
    if (a === 0 && b === 0) situations.push('early');
    else if (a === b) situations.push('level');
    else situations.push('leading');
    situations.push('keeper_busy', 'shots', 'possession', 'record');
    const sinceGoal = t - this.lastGoalT;
    if (this.goals.length && sinceGoal > 45) {
      situations.push('drought');
      extra.drought = spokenDuration(sinceGoal);
    }
    situations.push('general');
    return { situations, extra };
  }
}
