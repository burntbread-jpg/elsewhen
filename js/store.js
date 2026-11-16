// 저장. 삶 전체가 아니라 다시 계산하는 데 필요한 값만 둔다.

export const FORMAT = 1;
const CURRENT = 'elsewhen.current';
const FINISHED = 'elsewhen.finished';
const KEEP = 20;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 저장이 막힌 환경에서도 게임은 계속된다.
  }
}

export function saveCurrent(life, settings, branch = null) {
  write(CURRENT, { v: FORMAT, world: life.world.id, seed: life.seed, choices: life.choices, age: life.age, settings, branch });
}

export function loadCurrent() {
  const s = read(CURRENT);
  return s && s.v === FORMAT ? s : null;
}

export function clearCurrent() {
  try {
    localStorage.removeItem(CURRENT);
  } catch (e) {
    // 무시
  }
}

export function addFinished(life, line) {
  const list = loadFinished();
  list.unshift({ v: FORMAT, world: life.world.id, seed: life.seed, choices: life.choices, line });
  write(FINISHED, list.slice(0, KEEP));
}

export function findFinished(seed) {
  return loadFinished().find((x) => x.seed === seed) || null;
}

/** 되감아 산 삶을 원래 삶의 기록에 분기로 붙인다. 한 삶에 한 번뿐이다. */
export function setRewind(seed, choices) {
  const list = loadFinished();
  const rec = list.find((x) => x.seed === seed);
  if (!rec) return;
  rec.rewind = { choices };
  write(FINISHED, list);
}

export function loadFinished() {
  const list = read(FINISHED);
  return Array.isArray(list) ? list : [];
}
