// 바퀴와 엔진을 잇는다. 지금의 나 한 사람에서 100가닥이 뻗어 나간다.
// 실마다 답이 다를 수 있으므로, 실 하나의 답이 바뀌면 그 실만 다시 계산한다.

import { rand } from '../rng.js';
import { createLifeFrom, runToEnd, policyDecide } from '../engine.js';

export const THREADS = 100;
export const NOW = 2026; // 프로토타입의 "올해". 엔진은 시계를 보지 않는다.

/** 실 하나를 끝까지. rules 에 있는 질문은 그 답을, 없는 질문은 통계 비율대로 고른다. */
export function runThread(world, defs, seed, universe, profile, rules = {}) {
  const life = createLifeFrom(world, defs, { seed, universe, profile, nowYear: NOW });
  return runToEnd(life, (l, c) => (c.id in rules ? rules[c.id] : policyDecide(l, c)));
}

export function runAll(world, defs, seed, profile, rulesOf = () => ({})) {
  const lives = [];
  for (let u = 0; u < THREADS; u++) lives.push(runThread(world, defs, seed, u, profile, rulesOf(u)));
  return lives;
}

/** 실의 굵기가 되는 운. 사망 판정에 쓰는 바로 그 난수다. */
export const luck = (seed, universe, age) => rand(seed, universe, 'death', age);

/**
 * 앞으로 물을 질문들. 많은 실이 마주치는 순서로 최대 max 개를 고르고, 나이 순으로 늘어놓는다.
 * 묻는 나이는 그 질문이 열리는 나이와 지금 나이 중 늦은 쪽이다.
 */
export function planQuestions(defs, lives, fromAge, max = 3) {
  const cands = [];
  for (const def of defs.choices) {
    if (def.ages[1] <= fromAge) continue;
    const askAge = Math.max(def.ages[0], fromAge + 3);
    const met = lives.filter((l) => l.choices.some((c) => c.id === def.id && c.age >= askAge)).length;
    if (met < 12) continue;
    // 수명에 영향이 있는 질문을 먼저 고른다. 영향이 없는 질문만 물으면 명부를 고칠 수 없다.
    cands.push({ def, askAge, met, score: def.risk ? met + 100 : met * 0.5 });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.askAge - c.askAge) < 2)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.askAge - b.askAge);
}

/** 그 실이 이 질문을 묻는 나이 이후에 마주치는가, 마주친다면 어떤 답을 골랐는가 (옵션 번호) */
export function answerOf(life, question) {
  const c = life.choices.find((x) => x.id === question.def.id && x.age >= question.askAge);
  if (!c) return -1;
  return c.option === question.def.options[0].id ? 0 : 1;
}
