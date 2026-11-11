// 사건 기록을 한국어 문장으로 바꾼다. 어느 문장을 쓸지도 키 기반 난수로 정한다.

import { rand } from './rng.js';

export const WEALTH_LABEL = ['가장 가난한', '가난한', '평범한', '넉넉한', '부유한'];
export const EDU_LABEL = ['학교를 마치지 못함', '초등학교', '중학교', '고등학교', '대학'];
export const JOB_LABEL = {
  farm: '농사',
  labor: '공장·현장 일',
  service: '장사·서비스',
  office: '사무직',
  professional: '전문직',
  business: '자기 가게',
  home: '집안 살림',
};
export const CAUSE_LABEL = {
  infection: '감염병',
  neonatal: '출생 전후의 합병증',
  congenital: '선천성 질환',
  malnutrition: '영양실조',
  accident: '사고',
  violence: '폭력',
  maternal: '출산 합병증',
  heart: '심혈관 질환',
  cancer: '암',
  respiratory: '호흡기 질환',
  diabetes: '당뇨와 신장 질환',
  dementia: '노환',
  other: '그 밖의 병',
};

const ORDINAL = ['', '첫', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

/** 받침에 따라 조사를 고른다. josa('인도', '로') → '인도로', josa('일본', '로') → '일본으로' */
export function josa(word, kind) {
  const code = word.charCodeAt(word.length - 1);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const jong = isHangul ? (code - 0xac00) % 28 : 0;
  const has = jong !== 0;
  if (kind === '로') return word + (has && jong !== 8 ? '으로' : '로');
  if (kind === '을') return word + (has ? '을' : '를');
  if (kind === '은') return word + (has ? '은' : '는');
  if (kind === '이') return word + (has ? '이' : '가');
  return word;
}

const T = {
  school_start: ['학교에 들어갔다. 처음으로 제 이름을 써 보았다.', '학교에 다니기 시작했다.', '새 공책을 들고 학교에 갔다.'],
  no_school: ['학교에 가지 못했다. 집에는 일손이 필요했다.', '또래들이 학교에 갈 때 집에 남았다.', '학교는 먼 곳의 이야기였다.'],
  school_up_1: ['초등학교를 마치고 중학교에 올라갔다.', '중학생이 되었다.', '초등 과정을 마치고 공부를 이어 갔다.'],
  school_up_2: ['고등학교에 진학했다.', '중학교를 마치고 고등학교에 들어갔다.', '고등학생이 되었다.'],
  school_leave_0: ['초등학교를 다 마치지 못하고 학교를 떠났다.', '학교를 그만두었다.', '교실에 다시 가지 않았다.'],
  school_leave_1: ['초등학교까지만 다니고 학교를 떠났다.', '초등학교를 마친 것으로 공부는 끝났다.', '중학교에는 가지 못했다.'],
  school_leave_2: ['중학교를 마치고 학교를 떠났다.', '중학교 졸업으로 학업을 끝냈다.', '고등학교에는 가지 않았다.'],
  school_leave_3: ['고등학교를 마치고 학업을 끝냈다.', '고등학교를 졸업했다. 대학에는 가지 않았다.', '졸업과 함께 학교를 떠났다.'],
  university: ['대학에 들어갔다.', '대학생이 되었다.', '대학 입학 통지를 받았다.'],
  graduate: ['대학을 졸업했다.', '대학 과정을 마쳤다.', '졸업장을 받았다.'],
  job_farm: ['집안의 밭일을 맡기 시작했다.', '농사일을 시작했다.', '해가 뜨면 밭으로 나가는 날들이 시작되었다.'],
  job_labor: ['공장에서 일을 시작했다.', '현장 일을 시작했다.', '몸을 쓰는 일로 돈을 벌기 시작했다.'],
  job_service: ['가게에서 일을 시작했다.', '시장에서 장사를 시작했다.', '손님을 맞는 일을 시작했다.'],
  job_office: ['사무실에 첫 출근을 했다.', '책상 앞에서 하는 일을 얻었다.', '사무직으로 일을 시작했다.'],
  job_professional: ['전문직으로 첫 일을 시작했다.', '배운 것을 쓰는 일을 얻었다.', '자격을 얻어 일을 시작했다.'],
  job_home: ['집안 살림을 맡게 되었다.', '집안일이 하루의 전부가 되었다.', '살림과 돌봄을 맡았다.'],
  unemployed: ['일자리를 잃었다.', '다니던 곳이 문을 닫았다.', '일이 끊겼다.'],
  rehired: ['다시 일을 구했다.', '새 일자리를 얻었다.', '다시 일터로 나갔다.'],
  raise: ['벌이가 조금 나아졌다.', '일터에서 자리가 올랐다.', '살림이 전보다 폈다.'],
  setback: ['살림이 전보다 빠듯해졌다.', '벌이가 줄었다.', '허리띠를 졸라매야 했다.'],
  retire: ['일을 내려놓았다.', '오랜 일을 그만두었다.', '일터를 떠났다.'],
  marry_1: ['결혼했다.', '식을 올리고 함께 살기 시작했다.', '한 사람과 살림을 차렸다.'],
  marry_n: ['다시 결혼했다.', '새 사람과 함께 살기 시작했다.', '다시 가정을 꾸렸다.'],
  parent_died_mother: ['어머니가 세상을 떠났다.', '어머니를 떠나보냈다.', '어머니의 장례를 치렀다.'],
  parent_died_father: ['아버지가 세상을 떠났다.', '아버지를 떠나보냈다.', '아버지의 장례를 치렀다.'],
  illness_child: ['크게 앓아누웠다. 열이 며칠이나 내리지 않았다.', '심하게 앓았다.', '병으로 오래 누워 지냈다.'],
  illness_adult: ['큰 병을 앓았다.', '몸에 탈이 나서 한동안 일을 쉬었다.', '병을 얻었다.'],
  illness_old: ['병이 찾아왔다. 전처럼 움직이기 어려워졌다.', '몸 곳곳이 말을 듣지 않기 시작했다.', '오래 가는 병을 얻었다.'],
  accident: ['사고로 다쳤다.', '크게 다쳐 한동안 누워 지냈다.', '사고를 당했다.'],
  recover: ['몸이 조금씩 회복되었다.', '기운을 되찾았다.', '앓던 것이 나아졌다.'],
  move_city: ['도시로 옮겨 갔다.', '마을을 떠나 도시에 자리를 잡았다.', '도시 사람이 되었다.'],
  migrate_failed: ['떠나려 했지만 길이 열리지 않았다.', '떠날 방법을 찾지 못했다.'],
  business_ok: ['가게를 열었고, 장사가 자리를 잡았다.', '내 가게를 열었다. 손님이 끊이지 않았다.'],
  business_hard: ['가게를 열었지만 장사는 쉽지 않았다.', '내 가게를 열었다. 빚이 조금 생겼다.'],
  quiet_baby: ['걸음이 늘고 말이 늘었다.', '별 탈 없이 자랐다.', '하루가 다르게 컸다.', '잘 먹고 잘 잤다.'],
  quiet_child: ['또래들과 어울려 지냈다.', '키가 한 뼘 자랐다.', '별일 없이 한 해가 갔다.', '해 질 때까지 밖에서 놀았다.', '어른들의 일을 어깨너머로 보았다.'],
  quiet_adult: ['큰일 없이 한 해가 갔다.', '일하고, 먹고, 잠드는 날들이 이어졌다.', '어제와 비슷한 날들이었다.', '바쁘게 지나간 한 해였다.', '달력을 한 번 더 넘겼다.', '몸도 살림도 그럭저럭 버텼다.'],
  quiet_old: ['조용한 한 해였다.', '계절이 한 바퀴 돌았다.', '느리게 한 해가 갔다.', '아침이 일찍 오고 저녁이 길었다.', '오래된 것들을 자주 떠올렸다.', '찾아오는 사람이 반가운 해였다.'],
  grandchild_1: ['첫 손주가 태어났다.', '할머니, 할아버지라고 불릴 날이 생겼다. 첫 손주를 보았다.'],
  grandchild_n: ['손주가 또 태어났다.', '손주가 하나 더 늘었다.', '새 손주를 품에 안았다.'],
};

function variant(life, age, key, tag) {
  const list = T[key];
  return list[Math.floor(rand(life.seed, life.universe, 'text', age, tag || key) * list.length)];
}

/** 사건 하나를 문장으로. */
export function eventText(life, entry, ev) {
  const name = (c) => life.world.name(c);
  const v = (key) => variant(life, entry.age, key, ev.t);
  switch (ev.t) {
    case 'born':
      return null;
    case 'school_up':
      return v('school_up_' + ev.level);
    case 'school_leave':
      return v('school_leave_' + Math.min(ev.level, 3));
    case 'job':
      return v('job_' + ev.job);
    case 'marry':
      return v(ev.n > 1 ? 'marry_n' : 'marry_1');
    case 'divorce':
      return `${ev.years}년을 함께 산 배우자와 헤어졌다.`;
    case 'widowed':
      return `${ev.years}년을 함께한 배우자를 먼저 떠나보냈다.`;
    case 'child':
      return `${ORDINAL[ev.n] || ev.n + '번째'} 아이가 태어났다.`;
    case 'child_died':
      return ev.childAge === 0 ? '아이가 첫돌을 넘기지 못하고 세상을 떠났다.' : `${ev.childAge}살 된 아이를 먼저 떠나보냈다.`;
    case 'parent_died':
      return v('parent_died_' + ev.who);
    case 'grandchild':
      return v(ev.n === 1 ? 'grandchild_1' : 'grandchild_n');
    case 'illness':
      return v('illness_' + ev.stage);
    case 'migrate':
      return `${josa(name(ev.from), '을')} 떠나 ${josa(name(ev.to), '로')} 건너갔다.`;
    case 'return_home':
      return `${josa(name(ev.to), '로')} 돌아갔다.`;
    case 'death':
      return entry.age === 0
        ? `첫돌을 맞기 전에 ${josa(CAUSE_LABEL[ev.cause], '로')} 세상을 떠났다.`
        : `${josa(CAUSE_LABEL[ev.cause], '로')} 세상을 떠났다.`;
    default:
      if (T[ev.t]) return v(ev.t);
      return null;
  }
}

/** 한 해의 문장들. 선택 결과 문장을 포함한다. */
export function yearLines(life, entry) {
  const lines = [];
  const at = entry.choice ? entry.choice.at : Infinity;
  const pushEvent = (ev) => {
    const text = eventText(life, entry, ev);
    if (text) lines.push({ text, kind: ev.t === 'death' ? 'death' : 'event' });
  };
  // 선택 전에 일어난 일 → 선택 → 선택이 낳은 일 순서로 적는다.
  entry.events.forEach((ev, i) => {
    if (i < at) pushEvent(ev);
  });
  if (entry.choice) {
    const def = life.defs.choices.find((c) => c.id === entry.choice.id);
    const opt = def && def.options.find((o) => o.id === entry.choice.option);
    if (opt) {
      lines.push({ text: `${def.prompt} — ${opt.label}.`, kind: 'choice' });
      if (opt.result) lines.push({ text: opt.result, kind: 'event' });
    }
    entry.events.forEach((ev, i) => {
      if (i >= at) pushEvent(ev);
    });
  }
  return lines;
}

const quietKey = (a) => (a < 6 ? 'quiet_baby' : a < 16 ? 'quiet_child' : a < 65 ? 'quiet_adult' : 'quiet_old');

// 바로 앞 나이와 같은 문장이 나오지 않도록 한 칸 민다.
function quietIndex(life, a) {
  const key = quietKey(a);
  const n = T[key].length;
  const raw = Math.floor(rand(life.seed, life.universe, 'text', a, key) * n);
  if (a === 0 || quietKey(a - 1) !== key) return raw;
  return raw === quietIndex(life, a - 1) ? (raw + 1) % n : raw;
}

export function quietLine(life, entry) {
  return T[quietKey(entry.age)][quietIndex(life, entry.age)];
}

export function birthLine(life) {
  const b = life.birth;
  return `${b.year}년, ${life.world.name(b.country)} ${b.urban ? '도시' : '농촌'}의 ${WEALTH_LABEL[b.wealth - 1]} 집에서 ${b.sex === 'F' ? '여자아이' : '남자아이'}로 태어났다.`;
}

/** 끝난 삶의 요약 문장 목록 */
export function summarySentences(life) {
  const out = [birthLine(life)];
  const d = life.death;
  if (!d) return out;
  const everSchool = life.log.some((e) => e.events.some((ev) => ev.t === 'school_start'));
  if (d.age >= 7) {
    if (!everSchool) out.push('학교는 다니지 못했다.');
    else if (life.edu.inSchool) out.push('학교에 다니던 중이었다.');
    else out.push(['초등학교를 다 마치지 못했다.', '초등학교를 마쳤다.', '중학교를 마쳤다.', '고등학교를 마쳤다.', '대학을 졸업했다.'][life.edu.level]);
  }
  const jobLine = {
    farm: '농사를 지으며 살았다.',
    labor: '공장과 현장에서 일하며 살았다.',
    service: '장사와 서비스 일을 하며 살았다.',
    office: '사무직으로 일했다.',
    professional: '전문직으로 일했다.',
    business: '자기 가게를 꾸리며 살았다.',
    home: '집안 살림을 맡아 살았다.',
  }[life.job.type];
  if (jobLine) out.push(jobLine);
  if (life.marriages > 0) {
    const first = life.log.find((e) => e.events.some((ev) => ev.t === 'marry'));
    out.push(`${first.age}세에 결혼했다.`);
  } else if (d.age >= 30) {
    out.push('결혼하지 않았다.');
  }
  if (life.children.length) {
    const lost = life.children.filter((c) => !c.alive).length;
    out.push(`아이 ${life.children.length}명을 낳았${lost ? `고, 그중 ${lost}명을 먼저 떠나보냈다.` : '다.'}`);
  }
  if (life.grandchildren) out.push(`손주 ${life.grandchildren}명을 보았다.`);
  if (d.country !== life.birth.country) out.push(`${josa(life.world.name(d.country), '로')} 삶의 터전을 옮겼다.`);
  out.push(
    d.age === 0
      ? `첫돌을 맞기 전에 ${josa(CAUSE_LABEL[d.cause], '로')} 세상을 떠났다.`
      : `${d.age}세에 ${josa(CAUSE_LABEL[d.cause], '로')} 세상을 떠났다.`
  );
  return out;
}

/** 연표: 사건이 있었던 해만 */
export function timeline(life) {
  const rows = [];
  for (const entry of life.log) {
    const lines = yearLines(life, entry);
    if (lines.length) rows.push({ age: entry.age, year: entry.year, lines });
  }
  return rows;
}
