// 시뮬레이션 엔진. (세계, 출생 시드, 우주 번호, 선택)에서 한 삶을 만든다.
// 화면, 시계, Math.random 에 의존하지 않는다.
// 모든 판정은 "키 기반 난수 < 확률" 한 가지 형태다. 선택은 확률만 바꾸고 난수는 그대로 둔다.

import { rand, pickIndex } from './rng.js';
import { AGE_MAX } from './world.js';

const lerp = (t, pair) => pair[0] + (pair[1] - pair[0]) * t;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** 출생 추첨. 우주 번호와 무관하므로 100개 우주가 같은 조건으로 태어난다. */
export function drawBirth(world, seed) {
  const [yFirst, yLast] = world.demo.birthYears;
  let total = 0;
  for (const c of world.codes) for (let y = yFirst; y <= yLast; y++) total += world.births(c, y);
  let x = rand(seed, 'birth-lottery', 'place') * total;
  let country = world.codes[0];
  let year = yFirst;
  let share = 0;
  outer: for (const c of world.codes) {
    for (let y = yFirst; y <= yLast; y++) {
      const b = world.births(c, y);
      x -= b;
      if (x < 0) {
        country = c;
        year = y;
        share = b / total;
        break outer;
      }
    }
  }
  const srb = world.srb(country, year);
  const sex = rand(seed, 'birth-lottery', 'sex') < srb / (100 + srb) ? 'M' : 'F';
  const urban = rand(seed, 'birth-lottery', 'urban') < world.urban(country, year);
  const wealth = 1 + Math.floor(rand(seed, 'birth-lottery', 'wealth') * 5);
  const motherAge = 18 + Math.floor(rand(seed, 'birth-lottery', 'mother') * 20);
  const fatherAge = motherAge + 2 + Math.floor(rand(seed, 'birth-lottery', 'father') * 6);
  return { country, year, sex, urban, wealth, motherAge, fatherAge, share };
}

export function createLife(world, defs, { seed, universe = 0, birth = null }) {
  const b = birth ? { ...drawBirth(world, seed), ...birth } : drawBirth(world, seed);
  return {
    world,
    defs,
    seed,
    universe,
    birth: b,
    age: -1,
    year: b.year - 1,
    alive: true,
    country: b.country,
    urban: b.urban,
    wealth: b.wealth,
    income: b.wealth,
    health: 100,
    edu: { level: 0, inSchool: false },
    job: { type: null, employed: false, retired: false },
    partner: null,
    marriages: 0,
    children: [],
    grandchildren: 0,
    parents: {
      mother: { age: b.motherAge, alive: true },
      father: { age: b.fatherAge, alive: true },
    },
    habits: { smoking: false, drinking: false, exercise: false },
    mods: [],
    flags: {},
    asked: {},
    migratedAt: null,
    log: [],
    choices: [],
    pending: null,
    death: null,
  };
}

const R = (life, stream, ...k) => rand(life.seed, life.universe, stream, life.age, ...k);

function mod(life, stream) {
  let m = 1;
  for (const x of life.mods) if (x.stream === stream && life.age >= x.from && life.age < x.to) m *= x.mult;
  return m;
}

/** 선택지 조건과 화면이 함께 쓰는 상태 요약 */
export function view(life) {
  const dev = life.world.dev(life.country, life.year);
  return {
    sex: life.birth.sex,
    age: life.age,
    dev,
    smoking: life.habits.smoking,
    drinking: life.habits.drinking,
    exercise: life.habits.exercise,
    inSchool: life.edu.inSchool,
    eduLevel: life.edu.level,
    employed: life.job.employed,
    jobType: life.job.type,
    retired: life.job.retired,
    hasPartner: !!life.partner,
    everMarried: life.marriages > 0,
    kids: life.children.filter((c) => c.alive).length,
    urban: life.urban,
    wealth: life.wealth,
    income: life.income,
    recentIll: life.flags.illAge != null && life.age - life.flags.illAge <= 1,
    parentAlive: life.parents.mother.alive || life.parents.father.alive,
    migrated: life.migratedAt != null && life.country !== life.birth.country,
    yearsAbroad: life.migratedAt != null && life.country !== life.birth.country ? life.age - life.migratedAt : 0,
  };
}

function test(v, [key, op, value]) {
  const x = v[key];
  switch (op) {
    case '==': return x === value;
    case '!=': return x !== value;
    case '<=': return x <= value;
    case '>=': return x >= value;
    case '<': return x < value;
    case '>': return x > value;
    case 'in': return value.includes(x);
    default: throw new Error('unknown op ' + op);
  }
}

// ---------- 사건 ----------

function drawCause(life, dev) {
  const C = life.world.events.causes;
  let band = C.bands[0];
  for (const b of C.bands) if (life.age >= b) band = b;
  const low = C.low[band];
  const high = C.high[band];
  const names = [...new Set([...Object.keys(low), ...Object.keys(high)])];
  const weights = names.map((n) => {
    let w = (low[n] || 0) + ((high[n] || 0) - (low[n] || 0)) * dev;
    if (n === 'maternal' && life.birth.sex !== 'F') w = 0;
    if (life.habits.smoking && C.smokingBoost[n]) w *= C.smokingBoost[n];
    return w;
  });
  return names[pickIndex(R(life, 'cause'), weights)];
}

function chooseJob(life, dev) {
  const W = life.world.events.work;
  if (life.birth.sex === 'F' && life.age >= 15) {
    if (R(life, 'home') < lerp(dev, W.homemaker)) return 'home';
  }
  const lv = life.edu.level;
  const names = ['farm', 'labor', 'service', 'office', 'professional'];
  const weights = [
    life.urban ? 0.1 : 3 * (1 - dev) + 0.3,
    1 + (life.urban ? 1 : 0),
    1 + dev,
    lv >= 3 ? 1 + 2 * dev : lv === 2 ? 0.3 : 0.05,
    lv === 4 ? 2.5 : 0,
  ];
  return names[pickIndex(R(life, 'job'), weights)];
}

function startJob(life, entry, type) {
  life.job.type = type;
  life.job.employed = type !== 'home';
  entry.events.push({ t: 'job', job: type });
}

function marry(life, entry) {
  const spouseAge = life.birth.sex === 'F' ? life.age + 3 : Math.max(15, life.age - 3);
  life.partner = { since: life.age, age: spouseAge };
  life.marriages++;
  entry.events.push({ t: 'marry', n: life.marriages });
}

function migrate(life, entry) {
  const M = life.world.events.migration;
  const here = life.world.e0(life.country, life.year);
  const cands = life.world.codes.filter((c) => c !== life.country && life.world.e0(c, life.year) > here + M.gap);
  if (!cands.length) return false;
  const to = cands[pickIndex(R(life, 'dest'), cands.map((c) => M.dest[c] || 0.3))];
  entry.events.push({ t: 'migrate', from: life.country, to });
  life.country = to;
  life.urban = true;
  life.migratedAt = life.age;
  return true;
}

function leaveSchool(life, entry) {
  if (!life.edu.inSchool) return;
  life.edu.inSchool = false;
  entry.events.push({ t: 'school_leave', level: life.edu.level });
}

function eduChance(life, dev, pair) {
  const E = life.world.events.education;
  // 형편과 성별은 로짓(odds) 축에서 더한다. 기본 비율이 높은 사회에서는 차이가 작아진다.
  const base = clamp(pair[0] + (pair[1] - pair[0]) * Math.pow(Math.min(1, dev / pair[2]), E.curve), 0.01, 0.995);
  let z = Math.log(base / (1 - base)) + E.wealthShift[life.wealth - 1] + 2 * Math.log(mod(life, 'edu'));
  if (life.birth.sex === 'F') z -= E.girlPenalty * (1 - dev);
  return clamp(1 / (1 + Math.exp(-z)), 0, 0.995);
}

function schooling(life, entry, dev) {
  const E = life.world.events.education;
  const age = life.age;
  const edu = life.edu;
  if (age === 6 && !edu.inSchool && edu.level === 0) {
    if (R(life, 'school') < eduChance(life, dev, E.enter)) {
      edu.inSchool = true;
      entry.events.push({ t: 'school_start' });
    } else {
      entry.events.push({ t: 'no_school' });
    }
    return;
  }
  if (!edu.inSchool) return;
  if (age === 12 || age === 15) {
    edu.level = age === 12 ? 1 : 2;
    const pair = age === 12 ? E.lower : E.upper;
    if (R(life, 'school') < eduChance(life, dev, pair)) entry.events.push({ t: 'school_up', level: edu.level });
    else leaveSchool(life, entry);
  } else if (age === 18) {
    edu.level = 3;
    let p = eduChance(life, dev, E.tertiary);
    if (life.flags.tertiary === 'go') p = clamp(p * 2.5, 0, 0.95);
    if (life.flags.tertiary === 'work') p = 0;
    if (R(life, 'school') < p) entry.events.push({ t: 'university' });
    else leaveSchool(life, entry);
  } else if (age === 22) {
    edu.level = 4;
    edu.inSchool = false;
    entry.events.push({ t: 'graduate' });
  }
}

function work(life, entry, dev) {
  const W = life.world.events.work;
  const job = life.job;
  const age = life.age;
  if (job.retired || life.edu.inSchool) return;
  if (!job.type) {
    if (age >= (life.edu.level === 0 ? 12 : 15)) startJob(life, entry, chooseJob(life, dev));
    return;
  }
  if (job.type === 'home') return;
  if (!job.employed) {
    if (R(life, 'rehire') < W.rehire) {
      job.employed = true;
      entry.events.push({ t: 'rehired' });
    }
    return;
  }
  const waged = job.type !== 'farm' && job.type !== 'business';
  const retireAge = !waged || life.flags.workLonger ? 70 : 60 + Math.round(5 * dev);
  if (age >= retireAge) {
    job.retired = true;
    job.employed = false;
    entry.events.push({ t: 'retire' });
    return;
  }
  if (waged && R(life, 'unemploy') < W.unemployment * mod(life, 'unemploy')) {
    job.employed = false;
    entry.events.push({ t: 'unemployed' });
    return;
  }
  if (life.income < 5 && R(life, 'raise') < W.raise * (1 + 0.25 * life.edu.level) * mod(life, 'promotion')) {
    life.income++;
    entry.events.push({ t: 'raise' });
  } else if (life.income > 1 && R(life, 'setback') < W.setback) {
    life.income--;
    entry.events.push({ t: 'setback' });
  }
}

function family(life, entry, dev) {
  const w = life.world;
  const Mg = w.events.marriage;
  const age = life.age;
  const sex = life.birth.sex;

  // 부모
  for (const who of ['mother', 'father']) {
    const p = life.parents[who];
    if (!p.alive) continue;
    p.age++;
    if (R(life, 'parent', who) < w.q(life.birth.country, who === 'mother' ? 'F' : 'M', life.year, p.age)) {
      p.alive = false;
      entry.events.push({ t: 'parent_died', who });
    }
  }

  // 배우자
  if (life.partner) {
    const p = life.partner;
    p.age++;
    if (R(life, 'spouse') < w.q(life.country, sex === 'F' ? 'M' : 'F', life.year, p.age)) {
      entry.events.push({ t: 'widowed', years: age - p.since });
      life.partner = null;
    } else if (age - p.since > 1 && R(life, 'divorce') < lerp(dev, Mg.divorce) * Mg.divorceByDuration[Math.min(Math.floor((age - p.since) / 10), 2)]) {
      entry.events.push({ t: 'divorce', years: age - p.since });
      life.partner = null;
    }
  } else if (!life.edu.inSchool || age >= 22) {
    const minAge = dev < 0.4 ? (sex === 'F' ? 15 : 18) : 18;
    if (age >= minAge && age < 60) {
      let h;
      if (life.marriages > 0) {
        h = age < 55 ? Mg.remarry : 0;
      } else {
        const peak = (sex === 'F' ? 19 : 23) + 9 * dev;
        const sd = 5 + 3 * dev;
        h = Mg.base * (1 - Mg.devDamp * dev * dev) * Math.exp(-0.5 * ((age - peak) / sd) ** 2) + (age > peak ? lerp(dev, Mg.late) : 0);
      }
      if (R(life, 'marry') < h * mod(life, 'marriage')) marry(life, entry);
    }
  }

  // 아이
  if (life.partner) {
    const womanAge = sex === 'F' ? age : life.partner.age;
    if (womanAge >= 15 && womanAge <= 45) {
      const shape = womanAge < 20 ? 0.7 : womanAge <= 32 ? 1.35 : womanAge <= 38 ? 0.9 : 0.35;
      // 출산율이 낮은 사회는 결혼이 늦어 노출 기간이 짧다. 그만큼 연간 확률을 올려 합계를 맞춘다.
      const tfr = w.tfr(life.country, life.year);
      const F = w.events.fertility;
      const boost = 1 + F.lowFertilityBoost * clamp((4 - tfr) / 2, 0, 1);
      const p = Math.min(0.5, (tfr / F.exposureYears) * shape * boost) * mod(life, 'birth');
      if (R(life, 'birth') < p) {
        const child = { bornAge: age, alive: true, dieAt: null };
        if (R(life, 'child-fate') < w.q5(life.country, life.year)) {
          child.dieAt = R(life, 'child-fate', 'when') < 0.6 ? age : age + 1 + Math.floor(R(life, 'child-fate', 'year') * 4);
        }
        life.children.push(child);
        entry.events.push({ t: 'child', n: life.children.length });
      }
    }
  }
  life.children.forEach((c, i) => {
    if (c.alive && c.dieAt === age) {
      c.alive = false;
      entry.events.push({ t: 'child_died', childAge: age - c.bornAge });
    }
    const childAge = age - c.bornAge;
    if (c.alive && childAge >= 20 && childAge <= 40) {
      if (R(life, 'grandchild', i) < Math.min(0.3, w.tfr(life.country, life.year) / w.events.fertility.exposureYears)) {
        life.grandchildren++;
        entry.events.push({ t: 'grandchild', n: life.grandchildren });
      }
    }
  });
}

function moving(life, entry, dev) {
  const M = life.world.events.migration;
  const age = life.age;
  if (!life.urban && age >= 15 && age <= 35 && !life.edu.inSchool) {
    if (R(life, 'city') < lerp(dev, M.city) * mod(life, 'city')) {
      life.urban = true;
      entry.events.push({ t: 'move_city' });
    }
  }
  if (life.migratedAt == null && age >= 18 && age <= 45) {
    const p = lerp(dev, M.annual) * (life.edu.level >= 3 ? 1.6 : 1) * mod(life, 'migrate');
    if (R(life, 'migrate') < p) migrate(life, entry);
  }
}

function health(life, entry, dev) {
  const H = life.world.events.health;
  const age = life.age;
  const pIll = (H.illnessBase + H.illnessPerAge * age + (age < 5 ? H.childIllnessLowDev * (1 - dev) : 0)) * mod(life, 'illness');
  if (R(life, 'illness') < pIll) {
    life.health = clamp(life.health - 15, 5, 100);
    life.flags.illAge = age;
    entry.events.push({ t: 'illness', stage: age < 15 ? 'child' : age < 50 ? 'adult' : 'old' });
  } else if (age >= 3 && R(life, 'accident') < H.accident) {
    life.health = clamp(life.health - 8, 5, 100);
    entry.events.push({ t: 'accident' });
  } else if (life.flags.illAge != null && age - life.flags.illAge === 2) {
    life.health = clamp(life.health + 8, 5, 100);
    entry.events.push({ t: 'recover' });
  }
  if (age > 60) life.health = clamp(life.health - 1, 5, 100);
}

// ---------- 선택 ----------

function policyProb(life, c) {
  const p = c.policy;
  if (typeof p === 'number') return p;
  if (p.dev) return lerp(life.world.dev(life.country, life.year), p.dev);
  if (p.tfr) return clamp(life.world.tfr(life.country, life.year) / p.tfr, 0.05, 0.95);
  return p[life.birth.sex];
}

/** 자동 우주의 정책: 통계 비율대로 고른다. */
export function policyDecide(life, c) {
  return rand(life.seed, life.universe, 'policy', c.id, life.age) < policyProb(life, c) ? c.options[0].id : c.options[1].id;
}

/** 저장된 선택 기록을 재생하는 결정 함수. 기록에 없는 선택지는 fallback 이 고른다. */
export function replayDecider(choices, fallback = null) {
  const map = new Map(choices.map((c) => [c.id, c.option]));
  return (life, c) => (map.has(c.id) ? map.get(c.id) : fallback ? fallback(life, c) : null);
}

function pickChoice(life) {
  const v = view(life);
  for (const c of life.defs.choices) {
    if (life.asked[c.id]) continue;
    if (life.age < c.ages[0] || life.age > c.ages[1]) continue;
    if (!c.when.every((cond) => test(v, cond))) continue;
    if (R(life, 'choice:' + c.id) < c.chance) return c;
  }
  return null;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function applyEffect(life, entry, e) {
  const dev = life.world.dev(life.country, life.year);
  if (e.set) for (const k of Object.keys(e.set)) setPath(life, k, e.set[k]);
  if (e.flag) Object.assign(life.flags, e.flag);
  if (e.income) life.income = clamp(life.income + e.income, 1, 5);
  if (e.health) life.health = clamp(life.health + e.health, 5, 100);
  if (e.mod) life.mods.push({ stream: e.mod.stream, mult: e.mod.mult, from: life.age, to: life.age + (e.mod.years || 999) });
  switch (e.do) {
    case 'marry':
      if (!life.partner) marry(life, entry);
      break;
    case 'migrate':
      if (!migrate(life, entry)) entry.events.push({ t: 'migrate_failed' });
      break;
    case 'returnHome':
      entry.events.push({ t: 'return_home', from: life.country, to: life.birth.country });
      life.country = life.birth.country;
      break;
    case 'leaveSchool':
      leaveSchool(life, entry);
      break;
    case 'moveCity':
      life.urban = true;
      entry.events.push({ t: 'move_city' });
      if (life.job.type === 'farm' || !life.job.type) startJob(life, entry, 'labor');
      break;
    case 'business':
      life.job.type = 'business';
      life.job.employed = true;
      if (R(life, 'business') < 0.45) {
        life.income = clamp(life.income + 2, 1, 5);
        entry.events.push({ t: 'business_ok' });
      } else {
        life.income = clamp(life.income - 1, 1, 5);
        entry.events.push({ t: 'business_hard' });
      }
      break;
    case 'retire':
      life.job.retired = true;
      life.job.employed = false;
      entry.events.push({ t: 'retire' });
      break;
    case 'eduUp':
      life.edu.level = Math.min(life.edu.level + 1, 3);
      break;
    default:
      if (e.do) throw new Error('unknown effect ' + e.do + ' (dev ' + dev + ')');
  }
}

/** 대기 중인 선택지에 답한다. */
export function choose(life, optionId) {
  const c = life.pending;
  if (!c) throw new Error('no pending choice');
  const opt = c.options.find((o) => o.id === optionId);
  if (!opt) throw new Error('unknown option ' + optionId);
  const entry = life.log[life.log.length - 1];
  if (c.risk) {
    // 고른 사람의 위험이 rr 배가 되되, 전체 평균은 1로 유지한다.
    const first = c.options[0].id;
    const pFirst = policyProb(life, c);
    const p = c.risk.option === first ? pFirst : 1 - pFirst;
    const base = 1 / (1 + p * (c.risk.rr - 1));
    const from = Math.max(life.age, c.risk.fromAge || 0);
    life.mods.push({
      stream: 'death',
      mult: (optionId === c.risk.option ? c.risk.rr : 1) * base,
      from,
      to: c.risk.years ? from + c.risk.years : 999,
    });
  }
  life.asked[c.id] = true;
  life.choices.push({ age: life.age, id: c.id, option: optionId });
  entry.choice = { id: c.id, option: optionId, at: entry.events.length };
  for (const e of opt.effects || []) applyEffect(life, entry, e);
  life.pending = null;
  return entry;
}

// ---------- 연 단위 틱 ----------

/**
 * 한 해를 진행한다. 순서는 고정이다: 나이 → 사망 판정 → 건강 → 생애 사건 → 선택지.
 * 반환: { type: 'year' | 'choice' | 'dead', entry, choice? }
 */
export function advance(life) {
  if (!life.alive) return { type: 'dead', entry: life.log[life.log.length - 1] };
  if (life.pending) throw new Error('choice pending');
  life.age++;
  life.year++;
  const w = life.world;
  const entry = { age: life.age, year: life.year, country: life.country, events: [] };
  life.log.push(entry);
  if (life.age === 0) entry.events.push({ t: 'born' });
  const dev = w.dev(life.country, life.year);

  const q =
    w.q(life.country, life.birth.sex, life.year, life.age) *
    w.wealthFactor(life.birth.country, life.birth.sex, life.birth.year, life.age, life.wealth) *
    mod(life, 'death');
  if (life.age >= AGE_MAX || R(life, 'death') < Math.min(q, 0.999)) {
    const cause = drawCause(life, dev);
    life.alive = false;
    life.death = { age: life.age, year: life.year, cause, country: life.country };
    entry.events.push({ t: 'death', cause });
    return { type: 'dead', entry };
  }

  health(life, entry, dev);
  schooling(life, entry, dev);
  work(life, entry, dev);
  family(life, entry, dev);
  moving(life, entry, dev);

  const c = pickChoice(life);
  if (c) {
    life.pending = c;
    return { type: 'choice', entry, choice: c };
  }
  return { type: 'year', entry };
}

/** 삶을 끝까지 진행한다. decide(life, choice) 가 null 을 돌려주면 그 선택지에서 멈춘다. */
export function runToEnd(life, decide, untilAge = Infinity) {
  while (life.alive && life.age < untilAge) {
    if (life.pending) {
      const opt = decide(life, life.pending);
      if (opt == null) return life;
      choose(life, opt);
      continue;
    }
    const r = advance(life);
    if (r.type === 'choice') {
      const opt = decide(life, r.choice);
      if (opt == null) return life;
      choose(life, opt);
    }
  }
  return life;
}
