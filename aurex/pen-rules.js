'use strict';
/*
 * AUREX PENALTY CUP – rules of the shootout and league maths.
 * Pure functions only (no I/O, no timers) so every rule can be unit-tested.
 *
 * Format (IFAB "kicks from the penalty mark", adapted to a 1-vs-1 online duel):
 *   - the first kicker is decided by a coin toss, kickers then alternate,
 *   - 5 kicks each; the shootout stops early as soon as one side can no longer be caught,
 *   - level after 5 each -> sudden death, one more kick each per round, decided after EQUAL kicks,
 *   - AUREX cap: if it is still level after 10 kicks each, the match is a DRAW.
 */
const REG_KICKS = 5;
const CAP_KICKS = 10;
const POINTS = { win: 3, draw: 1, loss: 0 };

function newShootout(first) {
  if (first !== 0 && first !== 1) throw new Error('first must be 0 or 1');
  return { first, kicks: [0, 0], goals: [0, 0], log: [[], []] };
}

/** Who takes the next kick (0 or 1): alternating, starting with `first`. */
function shooterOf(s) { return (s.first + s.kicks[0] + s.kicks[1]) % 2; }

/** Round label of the kick that is about to be taken by `side`. */
function roundOf(s, side) {
  const n = s.kicks[side];            // kicks that side has already taken
  return n < REG_KICKS ? { sudden: false, number: n + 1, of: REG_KICKS } : { sudden: true, number: n + 1 - REG_KICKS, of: CAP_KICKS - REG_KICKS };
}

/** Is the shootout decided? -> { over, winner (0|1|null), reason } */
function decide(kicks, goals) {
  const [ka, kb] = kicks, [ga, gb] = goals;
  if (ka <= REG_KICKS && kb <= REG_KICKS && !(ka === REG_KICKS && kb === REG_KICKS)) {
    if (ga > gb + (REG_KICKS - kb)) return { over: true, winner: 0, reason: 'normal' };
    if (gb > ga + (REG_KICKS - ka)) return { over: true, winner: 1, reason: 'normal' };
    return { over: false, winner: null, reason: null };
  }
  if (ka === kb) {                    // sudden death is only judged after EQUAL numbers of kicks
    if (ga !== gb) return { over: true, winner: ga > gb ? 0 : 1, reason: ka === REG_KICKS ? 'normal' : 'sudden_death' };
    if (ka >= CAP_KICKS) return { over: true, winner: null, reason: 'cap_draw' };
  }
  return { over: false, winner: null, reason: null };
}

/** Record a completed kick (never call it for a retake). entry = { res:'goal'|'save'|'post'|'miss', var?:bool, card?:string } */
function applyKick(s, side, entry) {
  if (side !== shooterOf(s)) throw new Error('wrong kicker');
  const e = { res: entry.res, var: !!entry.var, card: entry.card || null };
  s.kicks[side]++; if (e.res === 'goal') s.goals[side]++;
  s.log[side].push(e);
  return decide(s.kicks, s.goals);
}

/** Final outcome in table terms. winner null = draw. */
function outcomeOf(winner) { return winner === 0 ? 'A' : winner === 1 ? 'B' : 'DRAW'; }

/* ---------------------------------------------------------------- league table */
/**
 * teams:   [{ id, name, teamCode, hasLogo, status }]  (every team that should appear in the table)
 * matches: league matches only: [{ id, teamA, teamB, goalsA, goalsB, result:'A'|'B'|'DRAW', finishedAt }]
 * Ranking: points, goal difference, goals for, then team name (deterministic).
 */
function computeStandings(teams, matches) {
  const rows = new Map();
  const row = t => { let r = rows.get(t.id); if (!r) { r = { teamId: t.id, name: t.name, teamCode: t.teamCode || null, hasLogo: !!t.hasLogo, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, form: [] }; rows.set(t.id, r); } return r; };
  const byId = new Map(teams.map(t => [t.id, t]));
  for (const t of teams) row(t);
  const sorted = matches.slice().sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)) || String(a.id).localeCompare(String(b.id)));
  const seen = new Set();
  for (const m of sorted) {
    if (seen.has(m.id)) continue; seen.add(m.id);              // a match can never be counted twice
    const ta = byId.get(m.teamA), tb = byId.get(m.teamB); if (!ta || !tb) continue;
    const a = row(ta), b = row(tb);
    a.played++; b.played++; a.gf += m.goalsA; a.ga += m.goalsB; b.gf += m.goalsB; b.ga += m.goalsA;
    if (m.result === 'A') { a.won++; b.lost++; a.points += POINTS.win; a.form.push('W'); b.form.push('L'); }
    else if (m.result === 'B') { b.won++; a.lost++; b.points += POINTS.win; a.form.push('L'); b.form.push('W'); }
    else { a.drawn++; b.drawn++; a.points += POINTS.draw; b.points += POINTS.draw; a.form.push('D'); b.form.push('D'); }
  }
  const list = [...rows.values()];
  for (const r of list) { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); }
  list.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name) || x.teamId - y.teamId);
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

module.exports = { REG_KICKS, CAP_KICKS, POINTS, newShootout, shooterOf, roundOf, decide, applyKick, outcomeOf, computeStandings };
