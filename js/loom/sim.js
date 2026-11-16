// 베틀과 엔진을 잇는다. 100가닥 모두가 플레이어의 답(규칙)을 따른다.

import { rand } from '../rng.js';
import { createLife, runToEnd, policyDecide } from '../engine.js';

export const THREADS = 100;

/** 답 목록에 있으면 그 답, 없으면 통계 비율대로 */
export const ruleDecider = (rules) => (life, c) => (c.id in rules ? rules[c.id] : policyDecide(life, c));

/** 100가닥을 끝까지 짠다. 우주 번호가 곧 실의 자리다. */
export function weave(world, defs, seed, rules = {}, n = THREADS) {
  const decide = ruleDecider(rules);
  const lives = [];
  for (let u = 0; u < n; u++) lives.push(runToEnd(createLife(world, defs, { seed, universe: u }), decide));
  return lives;
}

/**
 * 실의 굵기가 되는 운. 엔진의 사망 판정은 "이 난수 < 사망 확률"이므로,
 * 이 값이 작은 나이가 실이 가는 자리이고, 어떤 답을 내려도 그 자리는 변하지 않는다.
 */
export const luck = (seed, universe, age) => rand(seed, universe, 'death', age);

/** 그 나이 구간에서 가장 많은 실이 마주치는 질문. 수명에 영향이 있는 질문을 먼저 고른다. */
export function pickQuestion(defs, baseline, fromAge, toAge) {
  let best = null;
  for (const def of defs.choices) {
    if (def.ages[0] < fromAge || def.ages[0] > toAge) continue;
    const met = baseline.filter((l) => l.choices.some((c) => c.id === def.id)).length;
    if (met < 10) continue;
    const score = met + (def.risk ? 1000 : 0);
    if (!best || score > best.score) best = { def, met, score };
  }
  return best;
}

/** 두 면(두 답)의 차이 */
export function compare(a, b) {
  let changed = 0;
  let yearsA = 0;
  let yearsB = 0;
  for (let i = 0; i < a.length; i++) {
    yearsA += a[i].death.age;
    yearsB += b[i].death.age;
    if (a[i].death.age !== b[i].death.age) changed++;
  }
  return { changed, yearsA, yearsB };
}
