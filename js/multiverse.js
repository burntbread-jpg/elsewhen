// 100개 우주: 0번은 플레이어, 1~99번은 정책 함수로 자동 진행한다.

import { createLife, runToEnd, policyDecide, replayDecider } from './engine.js';

export const UNIVERSES = 100;

/** 자동 우주 1~99번을 끝까지 계산한다. */
export function runOthers(world, defs, seed, n = UNIVERSES) {
  const lives = [];
  for (let u = 1; u < n; u++) lives.push(runToEnd(createLife(world, defs, { seed, universe: u }), policyDecide));
  return lives;
}

/** 플레이어의 삶(0번 우주)을 선택 기록으로 재생한다. 기록에 없는 선택지에서 멈춘다. */
export function replayPlayer(world, defs, seed, choices, untilAge = Infinity) {
  return runToEnd(createLife(world, defs, { seed, universe: 0 }), replayDecider(choices), untilAge);
}

/** 운의 몫: 0번 우주의 운은 그대로 두고 선택만 통계대로 골랐을 때의 삶 */
export function luckOnlyLife(world, defs, seed) {
  return runToEnd(createLife(world, defs, { seed, universe: 0 }), policyDecide);
}

/** 그 나이를 넘겨 살아 있는 우주의 수 */
export function aliveAfter(lives, age) {
  let n = 0;
  for (const l of lives) if (!l.death || l.death.age > age) n++;
  return n;
}

export function deathsAt(lives, age) {
  let n = 0;
  for (const l of lives) if (l.death && l.death.age === age) n++;
  return n;
}

function tally(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 결말 화면의 분포. lives 는 플레이어를 포함한 100개 삶이다. */
export function aggregate(lives, player) {
  const ages = lives.map((l) => l.death.age);
  const sorted = [...ages].sort((a, b) => a - b);
  const adults = lives.filter((l) => l.death.age >= 25);
  return {
    total: lives.length,
    earlier: lives.filter((l) => l !== player && l.death.age < player.death.age).length,
    later: lives.filter((l) => l !== player && l.death.age > player.death.age).length,
    underFive: lives.filter((l) => l.death.age < 5).length,
    median: sorted[Math.floor(sorted.length / 2)],
    oldest: sorted[sorted.length - 1],
    causes: tally(lives.map((l) => l.death.cause)),
    edu: tally(lives.filter((l) => l.death.age >= 15).map((l) => l.edu.level)),
    jobs: tally(adults.filter((l) => l.job.type).map((l) => l.job.type)),
    adults: adults.length,
    married: adults.filter((l) => l.marriages > 0).length,
    parents: adults.filter((l) => l.children.length > 0).length,
    lostChild: lives.filter((l) => l.children.some((c) => !c.alive)).length,
    avgChildren: adults.length ? adults.reduce((s, l) => s + l.children.length, 0) / adults.length : 0,
    abroad: lives.filter((l) => l.death.country !== l.birth.country).length,
  };
}
