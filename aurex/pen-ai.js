'use strict';
/*
 * AUREX PENALTY CUP – AI referee and VAR.
 * A deterministic, rule-based decision engine that runs on the SERVER (clients can never influence it) and applies
 * IFAB Law 14 (penalty kicks) / "kicks from the penalty mark":
 *   - goalkeeper must stay on the goal line until the ball is kicked (encroachment): if the kick is missed or saved it is
 *     RETAKEN and the keeper is cautioned; if it is scored the goal stands,
 *   - illegal feinting by the kicker after the run-up is complete: the kick is recorded as missed and the kicker is cautioned,
 *   - both infringe: retake, both cautioned,
 *   - a goal needs the WHOLE ball over the WHOLE line between the posts and under the bar (goal-line technology).
 *
 * The on-field referee only sees clear offences. VAR is called ONLY for suspicious kicks (grey-zone keeper position, grey-zone
 * feint, tight goal-line calls, ball that went partly over the line) and its verdict is what is written to the scoreboard.
 */
const P = require('./pen-physics');
const { C } = P;

const KEEPER_CLEAR = 0.55;      // m in front of the line: obvious even to the on-field referee
const GOAL_TIGHT = 0.03;        // m: goal-line "too close to call by eye"
const GHOST_MIN_Z = 0.03;       // ball centre got this close to the line (or past it) without being fully over

const cm = m => Math.round(m * 100);

function judge(ctx) {
  const { sim, kz = 0, feintProgress = null, keeperYellows = 0, retakes = 0 } = ctx;
  const base = sim.outcome;
  const out = { final: base, retake: false, cards: [], call: null, var: null, awardedGoal: false,
    measures: { keeperKz: +kz.toFixed(3), limit: C.ENCROACH_LIMIT, feintProgress: feintProgress == null ? null : +feintProgress.toFixed(3), clearance: sim.clearance, minZ: sim.minZ } };

  const keeperOff = kz > C.ENCROACH_LIMIT ? (kz > KEEPER_CLEAR ? 'clear' : 'grey') : null;
  const feintOff = feintProgress != null && feintProgress >= C.FEINT_LEGAL_BELOW ? (feintProgress >= C.FEINT_GREY_BELOW ? 'clear' : 'grey') : null;
  const reasons = [], steps = []; let verdict = null;

  // ---- 1. kicker: feint after the run-up is complete
  let kickerIllegal = false;
  if (feintOff === 'clear') kickerIllegal = true;
  if (feintOff === 'grey') {
    reasons.push('FEINT');
    kickerIllegal = feintProgress >= C.FEINT_VAR_SPLIT;
    steps.push({ text: 'Reviewing the kicker\'s run-up and stride pattern', ms: 1100 });
    steps.push({ text: `Feint at ${Math.round(feintProgress * 100)}% of the run-up · legal until ${Math.round(C.FEINT_VAR_SPLIT * 100)}%`, ms: 1300 });
  }
  // ---- 2. goalkeeper: off his line when the ball was kicked
  const keeperMatters = keeperOff && (base !== 'goal' || kickerIllegal);
  if (keeperOff === 'grey' && keeperMatters) {
    reasons.push('KEEPER_POSITION');
    steps.push({ text: 'Checking the goalkeeper\'s feet at the moment of the kick', ms: 1200 });
    steps.push({ text: `Measured ${cm(kz)} cm in front of the goal line · limit ${cm(C.ENCROACH_LIMIT)} cm`, ms: 1300 });
  }

  // ---- 3. apply Law 14
  if (kickerIllegal && keeperOff) {                    // both infringed
    out.retake = true; out.final = 'retake'; out.cards.push({ who: 'shooter', color: 'yellow' }, { who: 'keeper', color: 'yellow' });
    verdict = { code: 'BOTH_OFFENCES', headline: 'BOTH PLAYERS INFRINGED — RETAKE', detail: 'Illegal feint and goalkeeper off his line. Kick retaken, both players cautioned.' };
  } else if (kickerIllegal) {
    out.final = 'miss'; out.cards.push({ who: 'shooter', color: 'yellow' });
    verdict = { code: 'ILLEGAL_FEINT', headline: base === 'goal' ? 'ILLEGAL FEINT — GOAL DISALLOWED' : 'ILLEGAL FEINT — KICK MISSED', detail: 'Feinting once the run-up is complete is not allowed. Kick recorded as missed, kicker cautioned.' };
  } else if (keeperMatters) {
    const second = keeperYellows >= 1;
    out.cards.push({ who: 'keeper', color: 'yellow' });
    if (second || retakes >= 2) {
      out.final = 'goal'; out.awardedGoal = true;
      verdict = { code: 'KEEPER_SECOND_CAUTION', headline: 'GOALKEEPER OFF HIS LINE — GOAL AWARDED', detail: second ? 'Second caution for the goalkeeper. With no substitute keeper in a duel, the kick is awarded as a goal.' : 'Repeated infringement. The kick is awarded as a goal.' };
    } else {
      out.retake = true; out.final = 'retake';
      verdict = { code: 'KEEPER_OFF_LINE', headline: base === 'save' ? 'GOALKEEPER OFF HIS LINE — SAVE CANCELLED · RETAKE' : 'GOALKEEPER OFF HIS LINE — RETAKE', detail: 'The goalkeeper left the line before the ball was kicked. Kick retaken, goalkeeper cautioned.' };
    }
  }

  // ---- 4. goal-line technology (only when it is really close)
  if (!out.retake && !verdict) {
    if (base === 'goal' && sim.clearance != null && sim.clearance < GOAL_TIGHT) {
      reasons.push('GOAL_LINE');
      steps.push({ text: 'Goal-line technology: tracking the ball against the line, posts and bar', ms: 1300 });
      steps.push({ text: `Whole ball over the whole line · margin ${Math.max(0, Math.round(sim.clearance * 1000))} mm`, ms: 1200 });
      verdict = { code: 'GOAL_CONFIRMED', headline: 'GOAL CONFIRMED', detail: 'The whole ball crossed the line between the posts and under the bar.' };
    } else if (base !== 'goal' && sim.minZ < GHOST_MIN_Z && sim.minZ > -C.BR) {
      reasons.push('GOAL_LINE');
      steps.push({ text: 'Goal-line technology: was the whole ball over the line?', ms: 1300 });
      steps.push({ text: `Closest the ball got: ${Math.round((sim.minZ + C.BR) * 100)} cm short of being fully over`, ms: 1200 });
      verdict = { code: 'NO_GOAL_LINE', headline: 'NO GOAL', detail: 'The ball did not fully cross the goal line. The kick counts as ' + (base === 'save' ? 'saved.' : 'missed.') };
    }
  }

  if (verdict && !reasons.length && !feintOff) {
    // clear (non-VAR) referee call
    out.call = { code: verdict.code, headline: verdict.headline, detail: verdict.detail };
  } else if (feintOff === 'clear' || (keeperOff === 'clear' && keeperMatters)) {
    out.call = { code: verdict.code, headline: verdict.headline, detail: verdict.detail };
  }
  if (reasons.length) {
    // the VAR verdict is what ends up on the scoreboard
    if (!steps.length || steps[steps.length - 1].final !== true) steps.push({ text: 'Decision confirmed', ms: 700, final: true });
    out.var = { reasons, steps, verdict: verdict || { code: 'CHECK_COMPLETE', headline: 'CHECK COMPLETE — NO CHANGE', detail: 'The on-field decision stands.' }, ms: steps.reduce((s, x) => s + x.ms, 0) };
    out.call = null;
  }
  return out;
}

module.exports = { judge, KEEPER_CLEAR, GOAL_TIGHT, GHOST_MIN_Z };
