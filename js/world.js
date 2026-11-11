// 세계: 통계표를 읽어 엔진에 값을 건넨다.
// 엔진은 통계 파일을 직접 읽지 않고 이 모듈만 거친다.
// 3차(다른 지구)에서는 adjust() 가 세계별 보정 계수를 곱한다. 지금은 값을 그대로 돌려준다.

export const AGE_MAX = 110;

export function createWorld(demo, events, worldId = 'base') {
  const years = demo.years;
  const y0 = years[0];
  const step = years[1] - years[0];
  const last = years.length - 1;
  const codes = Object.keys(demo.countries);
  const qCache = new Map();

  // 세계 보정 자리. base 세계는 아무것도 바꾸지 않는다.
  const adjust = (table, value) => value;

  function pos(year) {
    const t = Math.min(Math.max((year - y0) / step, 0), last);
    const i = Math.min(Math.floor(t), last - 1);
    return [i, t - i];
  }

  function series(country, field, year) {
    const a = demo.countries[country][field];
    const [i, f] = pos(year);
    return a[i] + (a[i + 1] - a[i]) * f;
  }

  // 기준점(영아 사망, 5세 미만 사망, 15·40·50·60세 생존율, 60세 이후 곰페르츠)에서
  // 한 살 단위 사망 확률을 복원한다.
  function qTable(country, sex, i) {
    const key = country + sex + i;
    let t = qCache.get(key);
    if (t) return t;
    const [imr, q5, l15, l40, l50, l60, A, B] = demo.countries[country].mort[sex][i];
    t = new Float64Array(AGE_MAX + 1);
    t[0] = imr;
    const h14 = Math.max(-Math.log((1 - q5) / (1 - imr)), 0);
    const w14 = [0.5, 0.25, 0.15, 0.1];
    for (let a = 1; a <= 4; a++) t[a] = 1 - Math.exp(-h14 * w14[a - 1]);
    const seg = (a0, a1, hazard, tilt) => {
      const ws = [];
      let sum = 0;
      for (let a = a0; a < a1; a++) {
        const w = Math.exp(tilt * (a - a0));
        ws.push(w);
        sum += w;
      }
      for (let a = a0; a < a1; a++) t[a] = 1 - Math.exp((-Math.max(hazard, 0) * ws[a - a0]) / sum);
    };
    seg(5, 15, Math.log((1 - q5) / l15), 0);
    seg(15, 40, Math.log(l15 / l40), 0.03);
    seg(40, 50, Math.log(l40 / l50), 0.08);
    seg(50, 60, Math.log(l50 / l60), 0.08);
    for (let a = 60; a < AGE_MAX; a++) {
      t[a] = 1 - Math.exp((-A / B) * (Math.exp(B * (a + 1 - 60)) - Math.exp(B * (a - 60))));
    }
    t[AGE_MAX] = 1;
    qCache.set(key, t);
    return t;
  }

  /** 그 나라, 그 성별, 그해, 그 나이의 연간 사망 확률 */
  function q(country, sex, year, age) {
    const a = Math.min(Math.max(age, 0), AGE_MAX);
    const [i, f] = pos(year);
    const q0 = qTable(country, sex, i)[a];
    const q1 = qTable(country, sex, i + 1)[a];
    return adjust('mortality', q0 + (q1 - q0) * f);
  }

  /** 그해 태어난 아이가 다섯 살 전에 죽을 확률 */
  function q5(country, year) {
    const m = demo.countries[country].mort.M;
    const [i, f] = pos(year);
    return adjust('mortality', m[i][1] + (m[i + 1][1] - m[i][1]) * f);
  }

  const e0 = (country, year) => series(country, 'e0', year);
  const tfr = (country, year) => adjust('fertility', series(country, 'tfr', year));
  const urban = (country, year) => series(country, 'urban', year);
  const srb = (country, year) => series(country, 'srb', year);

  /** 발전 수준 0~1. 그해 기대수명 35세를 0, 85세를 1로 둔 값. 교육·일·가족 가정값의 축으로 쓴다. */
  const dev = (country, year) => Math.min(Math.max((e0(country, year) - 35) / 50, 0), 1);

  /** 그해 태어난 사람이 평생 그 나라에 살 때, 만 나이로 센 기대 수명 */
  function cohortLife(country, sex, birthYear) {
    let s = 1;
    let total = 0;
    for (let a = 0; a <= AGE_MAX; a++) {
      s *= 1 - q(country, sex, birthYear + a, a);
      total += s;
    }
    return total;
  }

  // 형편(5분위)에 따른 사망 위험 배수. 가난한 쪽이 먼저 줄어들어 생존자 구성이 바뀌므로,
  // 나이마다 생존자 평균 배수로 나눠 전체 평균이 통계표와 같게 맞춘다.
  const normCache = new Map();
  function wealthFactor(country, sex, birthYear, age, wealth) {
    const key = country + sex + birthYear;
    let norm = normCache.get(key);
    const m = events.wealthMortality;
    if (!norm) {
      norm = new Float64Array(AGE_MAX + 1);
      const s = m.map(() => 1);
      for (let a = 0; a <= AGE_MAX; a++) {
        const qa = q(country, sex, birthYear + a, a);
        let tot = 0;
        let acc = 0;
        for (let k = 0; k < m.length; k++) {
          tot += s[k];
          acc += s[k] * m[k];
        }
        norm[a] = tot > 0 ? acc / tot : 1;
        for (let k = 0; k < m.length; k++) s[k] *= 1 - Math.min((qa * m[k]) / norm[a], 0.999);
      }
      normCache.set(key, norm);
    }
    return m[wealth - 1] / norm[Math.min(age, AGE_MAX)];
  }

  return {
    wealthFactor,
    id: worldId,
    demo,
    events,
    codes,
    boundaryYear: demo.boundaryYear,
    name: (country) => demo.countries[country].name,
    births: (country, year) => demo.countries[country].births[year - demo.birthYears[0]],
    q,
    q5,
    e0,
    tfr,
    urban,
    srb,
    dev,
    cohortLife,
  };
}
