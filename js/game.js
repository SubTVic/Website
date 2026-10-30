// Game logic: turns ball positions into events (goal, shot, save, ball control …)
// and keeps score and stats.

// Rods from u = 0 (left goal) to u = 1 (right goal).
// side 0 = team defending the left goal.
const RODS = [
  { side: 0, role: 'goalie' },
  { side: 0, role: 'defence' },
  { side: 1, role: 'attack' },
  { side: 0, role: 'midfield' },
  { side: 1, role: 'midfield' },
  { side: 0, role: 'attack' },
  { side: 1, role: 'defence' },
  { side: 1, role: 'goalie' },
];
export const ROD_U = RODS.map((_, i) => (i + 0.5) / RODS.length);

const GOAL_MOUTH = [0.25, 0.75]; // v range of the goal mouth
const GOAL_ZONE = 0.08; // how close to the goal line the ball must have last been seen
const LOST_AFTER = 2.5; // seconds without the ball -> 'ball lost'
const MAX_KMH = 110; // faster jumps are false detections

export class Game {
  constructor(cfg) {
    this.cfg = cfg; // { tableLen, tableWid, shotKmh, autoGoals, swapped, goalMissSec }
    this.reset();
  }

  reset() {
    this.score = [0, 0];
    this.stats = { shots: [0, 0], onTarget: [0, 0], saves: [0, 0], half: [0, 0], control: [0, 0], maxKmh: 0, maxKmhTeam: null };
    this.hist = [];
    this.trail = [];
    this.running = false;
    this.elapsed = 0;
    this.lastT = null;
    this.last = null; // last ball observation
    this.state = 'play'; // play | goal | lost
    this.shot = null; // shot in progress (for save detection)
    this.lastShotT = -1;
    this.ctrl = { team: null, role: null, since: 0, announced: null, announcedT: -10 };
    this.speedKmh = 0;
  }

  // Which team defends the left goal?
  leftTeam() {
    return this.cfg.swapped ? 1 : 0;
  }

  rodAt(u) {
    const i = Math.max(0, Math.min(RODS.length - 1, Math.floor(u * RODS.length)));
    const rod = RODS[i];
    return { index: i, role: rod.role, team: rod.side === 0 ? this.leftTeam() : 1 - this.leftTeam() };
  }

  start(t) {
    this.running = true;
    this.lastT = t;
    return [{ type: this.elapsed === 0 ? 'kickoff' : 'resume' }];
  }

  pause() {
    this.running = false;
    return [{ type: 'pause' }];
  }

  addGoal(team, t, info = {}) {
    this.score[team]++;
    this.state = 'goal';
    this.goalT = t;
    this.shot = null;
    return { type: 'goal', team, score: [...this.score], ...info };
  }

  removeGoal(team) {
    if (this.score[team] > 0) this.score[team]--;
    return { type: 'correction', team, score: [...this.score] };
  }

  // ball: { u, v } or null; teamBlobs: [[{u,v}], [{u,v}]]
  update(t, ball, teamBlobs) {
    const events = [];
    if (!this.running) {
      this.lastT = t;
      return events;
    }
    const dt = Math.min(0.2, t - this.lastT);
    this.lastT = t;
    this.elapsed += dt;

    if (ball && this.last && this.state === 'play') {
      // Plausibility check against jumps
      const gap = t - this.last.t;
      const dist = Math.hypot((ball.u - this.last.u) * this.cfg.tableLen, (ball.v - this.last.v) * this.cfg.tableWid);
      if (gap < 0.25 && (dist / gap) * 0.036 > MAX_KMH) ball = null;
    }

    if (ball) this.seeBall(t, dt, ball, teamBlobs, events);
    else this.missBall(t, events);

    this.trail = this.trail.filter((p) => t - p.t < 0.6);
    return events;
  }

  seeBall(t, dt, ball, teamBlobs, events) {
    const { tableLen: L, tableWid: W } = this.cfg;
    if (this.state !== 'play') {
      // Ignore the ball right after a goal (it may still be rolling in the goal tray)
      if (this.state === 'goal' && t - this.goalT < 1.5) return;
      if (this.state === 'goal' && (ball.u < 0.1 || ball.u > 0.9)) return;
      events.push({ type: 'restart' });
      this.state = 'play';
      this.hist = [];
    }

    this.hist.push({ t, x: ball.u * L, y: ball.v * W });
    this.hist = this.hist.filter((p) => t - p.t < 0.4);
    this.trail.push({ t, u: ball.u, v: ball.v });

    // Speed over the last >= 50 ms (short enough not to blur fast shots)
    let vx = 0, vy = 0;
    const cur = this.hist[this.hist.length - 1];
    let ref = this.hist[0];
    for (let i = this.hist.length - 2; i >= 0; i--) {
      if (cur.t - this.hist[i].t >= 0.05) {
        ref = this.hist[i];
        break;
      }
    }
    if (cur.t - ref.t > 0.025) {
      vx = (cur.x - ref.x) / (cur.t - ref.t);
      vy = (cur.y - ref.y) / (cur.t - ref.t);
    }
    const kmh = Math.hypot(vx, vy) * 0.036;
    this.speedKmh = kmh;
    this.last = { t, u: ball.u, v: ball.v, vx, vy, kmh };

    this.stats.half[ball.u < 0.5 ? 0 : 1] += dt;

    // Who has the ball? Nearest rod; team stickers take precedence.
    const rod = this.rodAt(ball.u);
    let team = rod.team;
    const near = nearestTeam(ball, teamBlobs, 0.07);
    if (near !== null) team = near;
    if (kmh < 8) this.stats.control[team] += dt;

    this.detectShot(t, ball, vx, vy, kmh, events);
    this.detectSave(t, ball, vx, kmh, events);
    this.detectControl(t, team, rod.role, kmh, events);
  }

  detectShot(t, ball, vx, vy, kmh, events) {
    if (kmh < this.cfg.shotKmh || t - this.lastShotT < 0.9) return;
    if (Math.abs(vx) < Math.abs(vy) * 0.8) return; // more of a sideways pass / wall bounce
    const towardLeft = vx < 0;
    const defending = towardLeft ? this.leftTeam() : 1 - this.leftTeam();
    const team = 1 - defending;
    const start = this.hist[0];
    const shooter = this.rodAt(start.x / this.cfg.tableLen);
    // Where does the ball cross the goal line?
    const goalX = towardLeft ? 0 : this.cfg.tableLen;
    const tt = (goalX - ball.u * this.cfg.tableLen) / vx;
    const vAtGoal = (ball.v * this.cfg.tableWid + vy * tt) / this.cfg.tableWid;
    const onTarget = vAtGoal > GOAL_MOUTH[0] && vAtGoal < GOAL_MOUTH[1];

    this.lastShotT = t;
    this.shot = { t, team, towardLeft, kmh, onTarget };
    this.stats.shots[team]++;
    if (onTarget) this.stats.onTarget[team]++;
    if (kmh > this.stats.maxKmh) {
      this.stats.maxKmh = kmh;
      this.stats.maxKmhTeam = team;
    }
    events.push({ type: 'shot', team, role: shooter.team === team ? shooter.role : null, kmh: Math.round(kmh), onTarget });
  }

  detectSave(t, ball, vx, kmh, events) {
    const s = this.shot;
    if (!s) return;
    if (t - s.t > 0.8) {
      this.shot = null;
      return;
    }
    const reversed = s.towardLeft ? vx > 30 : vx < -30;
    const inDefThird = s.towardLeft ? ball.u < 0.35 : ball.u > 0.65;
    // Saved = the ball bounces back, or a shot on target is stopped in front of goal
    const stopped = s.onTarget && kmh < 3 && t - s.t > 0.15;
    if (inDefThird && ((reversed && kmh > 2) || stopped)) {
      const defending = 1 - s.team;
      this.stats.saves[defending]++;
      this.shot = null;
      events.push({ type: 'save', team: defending, role: this.rodAt(ball.u).role, shotKmh: Math.round(s.kmh) });
    }
  }

  detectControl(t, team, role, kmh, events) {
    const c = this.ctrl;
    if (kmh > 8) {
      c.team = null;
      return;
    }
    if (c.team !== team || c.role !== role) {
      c.team = team;
      c.role = role;
      c.since = t;
      return;
    }
    const key = `${team}:${role}`;
    if (t - c.since > 0.8 && c.announced !== key && t - c.announcedT > 3) {
      c.announced = key;
      c.announcedT = t;
      events.push({ type: 'control', team, role });
    }
  }

  missBall(t, events) {
    const l = this.last;
    if (!l || this.state !== 'play') return;
    const miss = t - l.t;
    const inMouth = l.v > GOAL_MOUTH[0] && l.v < GOAL_MOUTH[1];
    const nearLeft = l.u < GOAL_ZONE;
    const nearRight = l.u > 1 - GOAL_ZONE;
    const headingIn = (nearLeft && l.vx < -5) || (nearRight && l.vx > 5) || l.u < 0.03 || l.u > 0.97;
    if (this.cfg.autoGoals && miss > this.cfg.goalMissSec && inMouth && (nearLeft || nearRight) && headingIn) {
      const intoLeft = nearLeft;
      const team = intoLeft ? 1 - this.leftTeam() : this.leftTeam();
      events.push(this.addGoal(team, t, { kmh: Math.round(Math.max(l.kmh, this.shot?.kmh || 0)) }));
    } else if (miss > LOST_AFTER) {
      this.state = 'lost';
      events.push({ type: 'lost' });
    }
  }

  snapshot() {
    const s = this.stats;
    const ctrlTotal = s.control[0] + s.control[1];
    return {
      score: [...this.score],
      minute: Math.floor(this.elapsed / 60),
      seconds: Math.floor(this.elapsed),
      shots: [...s.shots],
      onTarget: [...s.onTarget],
      saves: [...s.saves],
      possession: ctrlTotal > 2 ? [Math.round((100 * s.control[0]) / ctrlTotal), Math.round((100 * s.control[1]) / ctrlTotal)] : null,
      maxKmh: Math.round(s.maxKmh),
      maxKmhTeam: s.maxKmhTeam,
      ballHalf: this.last ? (this.last.u < 0.5 ? this.leftTeam() : 1 - this.leftTeam()) : null, // whose half the ball is in
      state: this.state,
    };
  }
}

function nearestTeam(ball, teamBlobs, maxDist) {
  let best = null;
  let bestD = maxDist;
  teamBlobs.forEach((blobs, team) => {
    for (const b of blobs) {
      const d = Math.hypot(b.u - ball.u, b.v - ball.v);
      if (d < bestD) {
        bestD = d;
        best = team;
      }
    }
  });
  return best;
}
