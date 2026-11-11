// 화면: 시작 → 출생 → 삶 → 결말 → 우주 열람. 시간 흐름과 저장도 여기서 다룬다.

import { loadGame } from './load.js';
import { createLife, advance, choose, view } from './engine.js';
import { runOthers, replayPlayer, branchLife, firstDifference, luckOnlyLife, aliveAfter, deathsAt, aggregate, UNIVERSES } from './multiverse.js';
import { yearLines, quietLine, birthLine, summarySentences, timeline, EDU_LABEL, JOB_LABEL, CAUSE_LABEL, WEALTH_LABEL } from './narrative.js';
import * as store from './store.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LENGTHS = [
  { label: '약 8분', ms: 6000 },
  { label: '약 15분', ms: 12000 },
  { label: '약 25분', ms: 20000 },
];
const SPEEDS = [1, 3, 10];

// life: 지금 화면에서 살고 있는 삶. original: 결말을 본 원래 삶. branch: 되감기 중이면 { index, age }.
const G = { world: null, defs: null, seed: null, life: null, original: null, branch: null, branchLife: null, others: [], yearMs: 12000, speed: 1, paused: false, timer: null, lastLi: null };

const branchSave = () => (G.branch ? { base: G.original.choices, index: G.branch.index } : null);
const optionOf = (choiceId, optionId) => G.defs.choices.find((c) => c.id === choiceId).options.find((o) => o.id === optionId);

function newSeed() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

function show(html) {
  clearTimeout(G.timer);
  closeOverlay();
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function closeOverlay() {
  overlay.hidden = true;
  overlay.innerHTML = '';
  overlay.onclick = null;
}

const place = (life, country, urban) => `${G.world.name(country)} ${urban ? '도시' : '농촌'}`;

// ---------- 시작 ----------

function renderStart() {
  const saved = store.loadCurrent();
  const past = store.loadFinished().filter((p) => p.v === store.FORMAT);
  show(`
    <section class="start">
      <h1 class="wordmark">ELSE<span>WHEN</span></h1>
      <p class="tagline">같은 날, 같은 집에서 태어난<br>100명의 나. 그중 하나를 삽니다.</p>
      <p class="lead">언제, 어디서, 누구의 아이로 태어날지는 고를 수 없습니다. 삶이 끝나면 100개의 우주에서 내가 어떻게 살았는지를 함께 봅니다.</p>
      <div class="actions">
        <button class="btn primary" data-act="born">태어나기</button>
        ${saved ? '<button class="btn" data-act="resume">살던 삶 이어 살기</button>' : ''}
      </div>
      <fieldset class="field">
        <legend>한 삶의 길이</legend>
        <div class="seg">
          ${LENGTHS.map((l) => `<button data-ms="${l.ms}" aria-pressed="${l.ms === G.yearMs}">${l.label}</button>`).join('')}
        </div>
      </fieldset>
      <p class="notice">죽음, 질병, 가난 같은 무거운 일이 통계대로 일어납니다. 장면은 묘사하지 않습니다. 태어나자마자 끝나는 삶도 있습니다.</p>
      ${past.length ? `<div class="past"><h2>지난 삶</h2>${past.map((p, i) => `<button data-past="${i}">${esc(p.line)}</button>`).join('')}</div>` : ''}
      <p class="foot">사망 확률, 출산율, 출생아 수는 UN 세계인구전망 2024, 도시 비율은 세계은행 자료입니다. 2024년 이후는 UN 중위 전망입니다. 교육, 일, 결혼, 이주와 선택의 효과는 제작자가 정한 가정값입니다. 대상은 12개 나라, 1950~2000년 출생입니다.</p>
    </section>`);
  app.querySelector('[data-act="born"]').onclick = () => begin(newSeed());
  const resume = app.querySelector('[data-act="resume"]');
  if (resume) resume.onclick = () => resumeSaved(saved);
  app.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => {
      G.yearMs = Number(b.dataset.ms);
      app.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  app.querySelectorAll('[data-past]').forEach((b) => {
    b.onclick = () => {
      const p = past[Number(b.dataset.past)];
      const life = replayPlayer(G.world, G.defs, p.seed, p.choices);
      if (!life.death) return;
      G.seed = p.seed;
      G.life = life;
      G.original = life;
      G.branch = null;
      G.branchLife = null;
      G.others = runOthers(G.world, G.defs, p.seed);
      renderEnding();
    };
  });
}

// ---------- 출생 ----------

function begin(seed) {
  G.seed = seed;
  G.life = createLife(G.world, G.defs, { seed, universe: 0 });
  G.original = null;
  G.branch = null;
  G.branchLife = null;
  G.others = runOthers(G.world, G.defs, seed);
  G.speed = 1;
  G.paused = false;
  renderBirth();
}

function renderBirth() {
  const w = G.world;
  const b = G.life.birth;
  show(`
    <section class="birth">
      <p class="year num">${b.year}</p>
      <h1>${esc(place(G.life, b.country, b.urban))}의 ${WEALTH_LABEL[b.wealth - 1]} 집에서<br>${b.sex === 'F' ? '여자아이' : '남자아이'}로 태어났습니다.</h1>
      <ul class="facts">
        <li><span>이 해, 이 나라에서 태어날 확률</span><span class="num">${(b.share * 100).toFixed(2)}%</span></li>
        <li><span>그해 그 나라의 기대수명</span><span class="num">${w.e0(b.country, b.year).toFixed(1)}세</span></li>
        <li><span>다섯 살 전에 죽을 확률</span><span class="num">${(w.q5(b.country, b.year) * 100).toFixed(1)}%</span></li>
        <li><span>집안 형편</span><span>다섯 단계 중 ${b.wealth}번째</span></li>
      </ul>
      <p class="opened">같은 순간, ${UNIVERSES}개의 우주가 열렸습니다.<br>모든 우주의 나는 똑같이 태어났고, 여기서부터 갈라집니다.</p>
      <div class="actions"><button class="btn primary" data-act="live">삶 시작</button></div>
      <p class="small" style="margin-top:14px">확률은 12개 나라의 1950~2000년 출생아 전체를 기준으로 한 값입니다.</p>
    </section>`);
  app.querySelector('[data-act="live"]').onclick = () => {
    renderLife();
    tick();
  };
}

// ---------- 삶 ----------

function renderLife() {
  show(`
    <section class="life">
      <header class="life-head">
        <div class="life-top">
          <div class="age num" id="age">0<small>세</small></div>
          <div class="where" id="where"></div>
        </div>
        <div class="multi">
          <div class="grid" id="grid" aria-hidden="true">${Array.from({ length: UNIVERSES }, (_, i) => `<i${i === 0 ? ' class="me"' : ''}></i>`).join('')}</div>
          <div class="alive-count">살아 있는 나<b class="num" id="alive">${UNIVERSES}</b></div>
        </div>
        <div class="chips" id="chips"></div>
        <div class="controls" id="controls">
          <button data-act="pause" aria-pressed="false">멈춤</button>
          ${SPEEDS.map((s) => `<button data-speed="${s}" aria-pressed="${s === G.speed}">${s}배속</button>`).join('')}
          <button data-act="next">다음 해</button>
        </div>
      </header>
      <ol class="feed" id="feed" aria-live="polite"></ol>
    </section>`);
  const controls = document.getElementById('controls');
  controls.querySelector('[data-act="pause"]').onclick = (e) => {
    G.paused = !G.paused;
    e.currentTarget.setAttribute('aria-pressed', String(G.paused));
    e.currentTarget.textContent = G.paused ? '계속' : '멈춤';
    if (G.paused) clearTimeout(G.timer);
    else schedule();
  };
  controls.querySelectorAll('[data-speed]').forEach((b) => {
    b.onclick = () => {
      G.speed = Number(b.dataset.speed);
      controls.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      schedule();
    };
  });
  controls.querySelector('[data-act="next"]').onclick = () => tick();
}

function updateHead(shownAge = G.life.age, meAlive = G.life.alive) {
  const life = G.life;
  document.getElementById('age').innerHTML = `${Math.max(shownAge, 0)}<small>세</small>`;
  document.getElementById('where').innerHTML = `${life.birth.year + Math.max(shownAge, 0)}년<br>${esc(place(life, life.country, life.urban))}`;
  const cells = document.getElementById('grid').children;
  cells[0].classList.toggle('gone', !meAlive);
  G.others.forEach((o, i) => cells[i + 1].classList.toggle('gone', o.death.age <= shownAge));
  document.getElementById('alive').textContent = aliveAfter(G.others, shownAge) + (meAlive ? 1 : 0);
  const v = view(life);
  const chips = [];
  if (v.inSchool) chips.push('학교 다니는 중');
  else if (life.age >= 7) chips.push(v.eduLevel === 0 ? EDU_LABEL[0] : EDU_LABEL[v.eduLevel] + ' 마침');
  if (v.retired) chips.push('일을 놓음');
  else if (v.jobType) chips.push(JOB_LABEL[v.jobType] + (v.employed || v.jobType === 'home' ? '' : ' (쉬는 중)'));
  if (v.hasPartner) chips.push('배우자와 함께');
  if (v.kids > 0) chips.push(`아이 ${v.kids}명`);
  if (life.grandchildren > 0) chips.push(`손주 ${life.grandchildren}명`);
  if (v.smoking) chips.push('흡연');
  document.getElementById('chips').innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');
}

function yearHtml(entry) {
  const life = G.life;
  const lines = yearLines(life, entry);
  if (entry.age === 0) lines.unshift({ text: birthLine(life), kind: 'event' });
  let html = lines.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('');
  if (!lines.length) html = `<p class="quiet">${esc(quietLine(life, entry))}</p>`;
  const gone = deathsAt(G.others, entry.age);
  if (gone > 0) html += `<p class="else">다른 우주의 나 ${gone}명이 이 나이에 세상을 떠났다.</p>`;
  return `<div class="when"><b class="num">${entry.age}세</b><span class="num">${entry.year}</span></div><div>${html}</div>`;
}

function appendYear(entry, scroll = true) {
  const feed = document.getElementById('feed');
  if (entry.year === G.world.boundaryYear) {
    const note = document.createElement('li');
    note.innerHTML = `<p class="note">여기부터는 전망입니다. ${G.world.boundaryYear}년 이후의 통계는 실제 기록이 아니라 UN의 중위 전망값입니다.</p>`;
    feed.appendChild(note);
  }
  const li = document.createElement('li');
  li.innerHTML = yearHtml(entry);
  feed.appendChild(li);
  G.lastLi = li;
  if (scroll) li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function schedule() {
  clearTimeout(G.timer);
  if (G.paused || !G.life.alive || G.life.pending) return;
  G.timer = setTimeout(tick, G.yearMs / G.speed);
}

function tick() {
  clearTimeout(G.timer);
  const life = G.life;
  if (!life.alive || life.pending) return;
  const r = advance(life);
  appendYear(r.entry);
  updateHead();
  if (r.type === 'dead') return finale();
  store.saveCurrent(life, { yearMs: G.yearMs }, branchSave());
  if (r.type === 'choice') return showChoice(r.choice);
  schedule();
}

function showChoice(c) {
  const prev = G.branch ? G.original.choices.find((x) => x.id === c.id) : null;
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="choice-title">
      <p class="area">${esc(c.area)} · ${G.life.age}세</p>
      <h2 id="choice-title">${esc(c.prompt)}</h2>
      ${c.options.map((o) => `<button class="btn" data-opt="${esc(o.id)}">${esc(o.label)}${prev && prev.option === o.id ? '<span class="prev">원래 삶의 답</span>' : ''}</button>`).join('')}
      ${prev ? '<p class="small hint">원래 삶에서도 만났던 선택입니다. 같은 답을 골라도, 다른 답을 골라도 됩니다.</p>' : ''}
    </div>`;
  overlay.hidden = false;
  overlay.querySelectorAll('[data-opt]').forEach((b) => {
    b.onclick = () => {
      const entry = choose(G.life, b.dataset.opt);
      closeOverlay();
      if (G.lastLi) G.lastLi.innerHTML = yearHtml(entry);
      updateHead();
      store.saveCurrent(G.life, { yearMs: G.yearMs }, branchSave());
      schedule();
    };
  });
  overlay.querySelector('[data-opt]').focus();
}

function resumeSaved(saved) {
  const life = replayPlayer(G.world, G.defs, saved.seed, saved.choices, saved.age);
  G.seed = saved.seed;
  G.life = life;
  G.original = null;
  G.branch = null;
  G.branchLife = null;
  if (saved.branch) {
    G.original = replayPlayer(G.world, G.defs, saved.seed, saved.branch.base);
    G.branch = { index: saved.branch.index, age: saved.branch.base[saved.branch.index].age };
  }
  G.others = runOthers(G.world, G.defs, saved.seed);
  if (saved.settings && saved.settings.yearMs) G.yearMs = saved.settings.yearMs;
  G.speed = 1;
  G.paused = false;
  renderLife();
  for (const entry of life.log) appendYear(entry, false);
  updateHead();
  if (G.lastLi) G.lastLi.scrollIntoView({ block: 'end' });
  if (!life.alive) finale();
  else if (life.pending) showChoice(life.pending);
  else schedule();
}

function finale() {
  const life = G.life;
  store.clearCurrent();
  if (G.branch) return branchFinale();
  G.original = life;
  store.addFinished(life, `${life.birth.year}년 ${G.world.name(life.birth.country)} · ${life.death.age}세`);
  const controls = document.getElementById('controls');
  controls.innerHTML = '<button data-act="end">100개의 삶 보기</button>';
  controls.querySelector('[data-act="end"]').onclick = () => renderEnding();
  const feed = document.getElementById('feed');
  const note = document.createElement('li');
  note.innerHTML = '<p class="note">이 우주의 삶은 여기서 끝났습니다. 남은 우주의 삶이 끝까지 흘러갑니다.</p>';
  feed.appendChild(note);
  note.scrollIntoView({ block: 'end', behavior: 'smooth' });
  const last = Math.max(life.death.age, ...G.others.map((o) => o.death.age));
  let a = life.death.age;
  const step = () => {
    if (!document.getElementById('grid')) return;
    if (a >= last) {
      G.timer = setTimeout(renderEnding, 900);
      return;
    }
    a++;
    updateHead(a, false);
    G.timer = setTimeout(step, 45);
  };
  G.timer = setTimeout(step, 1800);
}

// ---------- 결말 ----------

function dotPlot(lives) {
  const W = 340;
  const left = 8;
  const binW = (W - 2 * left) / 23;
  const bins = new Map();
  lives.forEach((l, u) => {
    const b = Math.min(Math.floor(l.death.age / 5), 22);
    if (!bins.has(b)) bins.set(b, []);
    if (u === 0) bins.get(b).unshift(u);
    else bins.get(b).push(u);
  });
  let maxRows = 1;
  for (const list of bins.values()) maxRows = Math.max(maxRows, Math.ceil(list.length / 2));
  const rowH = 6.6;
  const base = maxRows * rowH + 14;
  const H = base + 26;
  let dots = '';
  for (const [b, list] of bins) {
    list.forEach((u, i) => {
      const x = left + b * binW + (i % 2 ? binW * 0.74 : binW * 0.26);
      const y = base - 6 - Math.floor(i / 2) * rowH;
      const me = u === 0;
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${me ? 4 : 2.7}" fill="${me ? 'var(--me)' : 'var(--alive)'}"${me ? ' stroke="var(--ink)" stroke-width="1"' : ''} data-u="${u}" tabindex="0" role="button" aria-label="${me ? '나' : u + '번 우주'}, ${lives[u].death.age}세"></circle>`;
    });
  }
  let axis = `<line x1="${left}" x2="${W - left}" y1="${base}" y2="${base}" stroke="var(--line)"/>`;
  for (let age = 0; age <= 100; age += 20) {
    const x = left + (age / 5) * binW;
    axis += `<line x1="${x}" x2="${x}" y1="${base}" y2="${base + 4}" stroke="var(--line)"/><text x="${x}" y="${base + 17}" font-size="10" fill="var(--dim)" text-anchor="${age === 0 ? 'start' : 'middle'}">${age}세</text>`;
  }
  return `<svg class="dots" viewBox="0 0 ${W} ${H.toFixed(0)}" role="group" aria-label="100개 우주의 수명 분포">${axis}${dots}</svg>`;
}

function bars(rows, total, mineKey) {
  return `<ul class="bars">${rows
    .map(([key, label, n]) => `<li class="${key === mineKey ? 'mine' : ''}"><span>${esc(label)}</span><span class="track"><span class="fill" style="display:block;width:${((n / total) * 100).toFixed(1)}%"></span></span><span class="n num">${n}</span></li>`)
    .join('')}</ul>`;
}

function timelineHtml(life, rewindable = false) {
  return `<ol class="timeline">${timeline(life)
    .map((row) => {
      const k = rewindable && row.choice ? life.choices.findIndex((c) => c.id === row.choice) : -1;
      const button = k >= 0 ? `<button class="rewind" data-rewind="${k}">이 선택 바꾸기</button>` : '';
      return `<li><div class="when num">${row.age}세 · ${row.year}${row.year >= G.world.boundaryYear ? '<br><span class="proj">전망</span>' : ''}</div><div>${row.lines.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('')}${button}</div></li>`;
    })
    .join('')}</ol>`;
}

function renderEnding() {
  const w = G.world;
  const life = G.original;
  G.life = life;
  G.branch = null;
  const record = store.findFinished(G.seed);
  const rewound = !!(record && record.rewind);
  const canRewind = !rewound && life.choices.length > 0;
  const lives = [life, ...G.others];
  const agg = aggregate(lives, life);
  const luck = luckOnlyLife(w, G.defs, G.seed);
  const diff = life.death.age - luck.death.age;
  const expected = w.cohortLife(life.birth.country, life.birth.sex, life.birth.year);
  let shareText;
  if (!life.choices.length) shareText = '선택할 기회가 오기 전에 삶이 끝났습니다. 이 삶의 길이는 운이 정했습니다.';
  else if (diff > 0) shareText = `같은 운으로 통계대로 골랐다면 ${luck.death.age}세까지 살았습니다. 당신의 선택이 ${diff}년을 더했습니다.`;
  else if (diff < 0) shareText = `같은 운으로 통계대로 골랐다면 ${luck.death.age}세까지 살았습니다. 당신의 선택이 ${-diff}년을 덜어 냈습니다.`;
  else shareText = `같은 운으로 통계대로 골랐어도 ${luck.death.age}세였습니다. 선택은 이 삶의 길이를 바꾸지 못했습니다.`;

  const callouts = [`100명 중 <b>${agg.earlier}명</b>이 당신보다 일찍 떠났고, <b>${agg.later}명</b>이 더 오래 살았습니다.`];
  if (agg.underFive) callouts.push(`<b>${agg.underFive}명</b>은 다섯 살을 넘기지 못했습니다.`);
  callouts.push(`가운데 삶은 ${agg.median}세, 가장 긴 삶은 ${agg.oldest}세였습니다.`);
  callouts.push(`UN 생명표로 본 이 출생의 기대 수명은 약 ${Math.round(expected)}세입니다.`);

  const family = [];
  if (agg.adults) {
    family.push(`스물다섯을 넘긴 ${agg.adults}명 중 <b>${agg.married}명</b>이 결혼했고, <b>${agg.parents}명</b>이 아이를 낳았습니다. 평균 ${agg.avgChildren.toFixed(1)}명입니다.`);
  }
  if (agg.lostChild) family.push(`<b>${agg.lostChild}명</b>은 아이를 먼저 떠나보냈습니다.`);
  family.push(agg.abroad ? `<b>${agg.abroad}명</b>은 태어난 나라가 아닌 곳에서 삶을 마쳤습니다.` : '모두가 태어난 나라에서 삶을 마쳤습니다.');

  const causeRows = agg.causes.slice(0, 6).map(([k, n]) => [k, CAUSE_LABEL[k], n]);
  const eduTotal = agg.edu.reduce((s, [, n]) => s + n, 0);
  const eduRows = [4, 3, 2, 1, 0].map((lv) => [lv, lv === 0 ? '마치지 못함' : EDU_LABEL[lv], (agg.edu.find(([k]) => k === lv) || [0, 0])[1]]).filter((r) => r[2] > 0);
  const jobTotal = agg.jobs.reduce((s, [, n]) => s + n, 0);
  const jobRows = agg.jobs.map(([k, n]) => [k, JOB_LABEL[k], n]);

  show(`
    <section class="ending">
      <p class="kicker">${UNIVERSES}개의 우주 가운데 하나</p>
      <h1>${life.death.age}세, ${esc(w.name(life.death.country))}에서.</h1>
      <p class="story">${summarySentences(life).map(esc).join(' ')}</p>

      <div class="section">
        <h2>운의 몫, 선택의 몫</h2>
        <p>${shareText}</p>
        <div class="shares">
          <div class="share"><b class="num">${luck.death.age}세</b><span>같은 운, 통계대로의 선택</span></div>
          <div class="share choice"><b class="num">${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)}년</b><span>당신의 선택이 바꾼 길이</span></div>
        </div>
      </div>

      <div class="section">
        <h2>100명의 나는 얼마나 살았나</h2>
        <p class="small">점 하나가 한 우주의 나입니다. 노란 점이 당신입니다. 점을 누르면 그 삶을 볼 수 있습니다.</p>
        ${dotPlot(lives)}
        <ul class="callouts">${callouts.map((c) => `<li>${c}</li>`).join('')}</ul>
      </div>

      <div class="section">
        <h2>무엇으로 떠났나</h2>
        ${bars(causeRows, UNIVERSES, life.death.cause)}
      </div>

      ${eduRows.length ? `<div class="section"><h2>어디까지 배웠나</h2><p class="small">열다섯을 넘긴 ${eduTotal}명 기준</p>${bars(eduRows, eduTotal, life.death.age >= 15 ? life.edu.level : null)}</div>` : ''}
      ${jobRows.length ? `<div class="section"><h2>무슨 일을 했나</h2><p class="small">스물다섯을 넘긴 ${jobTotal}명 기준</p>${bars(jobRows, jobTotal, life.death.age >= 25 ? life.job.type : null)}</div>` : ''}

      <div class="section">
        <h2>가족과 떠남</h2>
        <ul class="callouts">${family.map((c) => `<li>${c}</li>`).join('')}</ul>
      </div>

      <div class="section">
        <h2>내 삶의 연표</h2>
        ${canRewind ? '<p class="small">선택 하나를 골라 바꾸고, 그 나이부터 다시 살 수 있습니다. 운은 그대로입니다. 한 삶에 한 번뿐입니다.</p>' : ''}
        ${rewound ? '<p class="small">이 삶은 이미 한 번 되감았습니다.</p><button class="btn" data-act="compare" style="margin:0 0 14px">바꿔 산 삶과 비교 보기</button>' : ''}
        ${timelineHtml(life, canRewind)}
      </div>

      <div class="section">
        <button class="btn primary" data-act="again">다시 태어나기</button>
        <button class="btn" data-act="random">아무 우주나 들여다보기</button>
        <button class="btn ghost" data-act="home">처음으로</button>
      </div>
    </section>`);
  app.querySelectorAll('[data-rewind]').forEach((b) => {
    b.onclick = () => askRewind(Number(b.dataset.rewind));
  });
  const compare = app.querySelector('[data-act="compare"]');
  if (compare) {
    compare.onclick = () => {
      const other = replayPlayer(w, G.defs, G.seed, record.rewind.choices);
      const index = firstDifference(life.choices, other.choices);
      if (!other.death || index < 0) return;
      G.branchLife = other;
      G.branch = { index, age: life.choices[index].age };
      renderCompare();
    };
  }
  app.querySelector('[data-act="again"]').onclick = () => begin(newSeed());
  app.querySelector('[data-act="home"]').onclick = renderStart;
  app.querySelector('[data-act="random"]').onclick = () => showUniverse(1 + Math.floor(Math.random() * (UNIVERSES - 1)));
  app.querySelectorAll('.dots circle').forEach((c) => {
    const open = () => showUniverse(Number(c.dataset.u));
    c.onclick = open;
    c.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
  });
}

function showUniverse(u) {
  const life = u === 0 ? G.original : G.others[u - 1];
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="uni-title">
      <p class="area">${u === 0 ? '나' : u + '번 우주의 나'}</p>
      <h2 id="uni-title">${life.death.age}세까지 살았다.</h2>
      <p class="story" style="margin-top:0">${summarySentences(life).map(esc).join(' ')}</p>
      <div class="section" style="margin-top:22px">${timelineHtml(life)}</div>
      <button class="btn close" data-act="close">닫기</button>
    </div>`;
  overlay.hidden = false;
  overlay.querySelector('[data-act="close"]').onclick = closeOverlay;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeOverlay();
  };
  overlay.querySelector('[data-act="close"]').focus();
}

// ---------- 한 번의 선택 (되감기) ----------

function askRewind(k) {
  const life = G.original;
  const ch = life.choices[k];
  const def = G.defs.choices.find((c) => c.id === ch.id);
  const cur = def.options.find((o) => o.id === ch.option);
  const other = def.options.find((o) => o.id !== ch.option);
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rewind-title">
      <p class="area">${ch.age}세의 선택</p>
      <h2 id="rewind-title">${esc(def.prompt)}</h2>
      <p>그때의 답: ${esc(cur.label)}</p>
      <p class="small" style="margin:10px 0 18px">이 결정 하나만 바꾸고 ${ch.age}세부터 다시 삽니다. 운은 그대로이고, 그 뒤의 선택은 다시 고릅니다. 되감기는 한 삶에 한 번뿐입니다.</p>
      <button class="btn primary" data-act="go">바꿔서 다시 산다: ${esc(other.label)}</button>
      <button class="btn ghost" data-act="close">그만둔다</button>
    </div>`;
  overlay.hidden = false;
  overlay.querySelector('[data-act="close"]').onclick = closeOverlay;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeOverlay();
  };
  overlay.querySelector('[data-act="go"]').onclick = () => startBranch(k, other.id);
  overlay.querySelector('[data-act="go"]').focus();
}

function startBranch(k, option) {
  const ch = G.original.choices[k];
  G.branch = { index: k, age: ch.age };
  G.branchLife = null;
  G.life = branchLife(G.world, G.defs, G.seed, G.original.choices, k, option);
  G.speed = 1;
  G.paused = false;
  renderLife();
  for (const entry of G.life.log) appendYear(entry, false);
  const note = document.createElement('li');
  note.innerHTML = `<p class="note fork">여기서 갈라집니다. ${ch.age}세의 선택을 바꿨습니다: ${esc(optionOf(ch.id, option).label)}. 이 앞의 삶은 원래와 같고, 운도 그대로입니다.</p>`;
  document.getElementById('feed').appendChild(note);
  updateHead();
  note.scrollIntoView({ block: 'end' });
  store.saveCurrent(G.life, { yearMs: G.yearMs }, branchSave());
  schedule();
}

function branchFinale() {
  G.branchLife = G.life;
  store.setRewind(G.seed, G.life.choices);
  const controls = document.getElementById('controls');
  controls.innerHTML = '<button data-act="compare">두 삶 비교 보기</button>';
  controls.querySelector('[data-act="compare"]').onclick = () => renderCompare();
  const note = document.createElement('li');
  note.innerHTML = '<p class="note">바꿔 산 삶이 끝났습니다. 원래 삶과 나란히 놓아 봅니다.</p>';
  document.getElementById('feed').appendChild(note);
  note.scrollIntoView({ block: 'end', behavior: 'smooth' });
  G.timer = setTimeout(renderCompare, 2600);
}

function lifeBar(label, life, max, accent, y) {
  const x0 = 62;
  const W = 340 - x0 - 34;
  const w = Math.max((life.death.age / max) * W, 2);
  return `<text x="0" y="${y + 10}" font-size="11" fill="var(--soft)">${label}</text><rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="12" rx="3" fill="${accent ? 'var(--me)' : 'var(--alive)'}"/><text x="${(x0 + w + 5).toFixed(1)}" y="${y + 10}" font-size="11" fill="var(--ink)">${life.death.age}세</text>`;
}

function renderCompare() {
  const a = G.original;
  const b = G.branchLife;
  const k = G.branch.index;
  const ch = a.choices[k];
  const def = G.defs.choices.find((c) => c.id === ch.id);
  const optA = optionOf(ch.id, ch.option);
  const optB = optionOf(ch.id, b.choices[k].option);
  const diff = b.death.age - a.death.age;

  const linesAt = (life) => {
    const m = new Map();
    for (const entry of life.log) if (entry.age >= ch.age) m.set(entry.age, yearLines(life, entry));
    return m;
  };
  const la = linesAt(a);
  const lb = linesAt(b);
  const last = Math.max(a.death.age, b.death.age);
  let changedYears = 0;
  let rows = '';
  for (let age = ch.age; age <= last; age++) {
    const xa = la.get(age) || [];
    const xb = lb.get(age) || [];
    if (!xa.length && !xb.length) continue;
    const ta = new Set(xa.map((l) => l.text));
    const tb = new Set(xb.map((l) => l.text));
    const cell = (list, other) => list.map((l) => `<p class="${other.has(l.text) ? 'same' : 'diff'}${l.kind === 'death' ? ' death' : ''}">${esc(l.text)}</p>`).join('');
    if (age > ch.age && (xa.some((l) => !tb.has(l.text)) || xb.some((l) => !ta.has(l.text)))) changedYears++;
    rows += `<li${age === ch.age ? ' class="fork"' : ''}><div class="when num">${age}세</div><div>${cell(xa, tb)}</div><div>${cell(xb, ta)}</div></li>`;
  }
  const sameStory = changedYears === 0;

  let headline;
  if (diff > 0) headline = `${ch.age}세의 그 선택은 ${diff}년을 더했습니다.`;
  else if (diff < 0) headline = `${ch.age}세의 그 선택은 ${-diff}년을 덜어 냈습니다.`;
  else if (sameStory) headline = '아무것도 달라지지 않았습니다.';
  else headline = '삶의 길이는 같았지만, 삶은 달라졌습니다.';
  const sub = sameStory ? '선택 하나를 바꿨지만 그 뒤의 삶은 같은 길로 흘렀습니다. 바뀌지 않는 삶도 있습니다.' : `갈라진 뒤 ${changedYears}개의 해가 서로 달랐습니다.`;

  const max = Math.max(last, 1);
  const fx = 62 + (ch.age / max) * (340 - 62 - 34);
  const bars = `<svg class="dots" viewBox="0 0 340 76" role="img" aria-label="원래 삶 ${a.death.age}세, 바꾼 삶 ${b.death.age}세, ${ch.age}세에 갈라짐">${lifeBar('원래 삶', a, max, false, 16)}${lifeBar('바꾼 삶', b, max, true, 38)}<line x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="8" y2="58" stroke="var(--ink)" stroke-dasharray="3 3"/><text x="${fx.toFixed(1)}" y="71" font-size="10" fill="var(--soft)" text-anchor="${fx > 250 ? 'end' : 'start'}">${ch.age}세에 갈라짐</text></svg>`;

  show(`
    <section class="ending compare">
      <p class="kicker">한 번의 선택</p>
      <h1>${headline}</h1>
      <p class="story">${esc(def.prompt)} 원래 삶의 답은 “${esc(optA.label)}”, 바꾼 삶의 답은 “${esc(optB.label)}”였습니다. ${sub}</p>
      ${bars}
      <div class="shares">
        <div class="share"><b class="num">${a.death.age}세</b><span>원래 삶 · ${esc(CAUSE_LABEL[a.death.cause])}</span></div>
        <div class="share choice"><b class="num">${b.death.age}세</b><span>바꾼 삶 · ${esc(CAUSE_LABEL[b.death.cause])}</span></div>
      </div>

      <div class="section">
        <h2>갈라진 뒤의 두 삶</h2>
        <p class="small">${ch.age > 0 ? `${ch.age}세 전까지는 두 삶이 같습니다. ` : ''}밝게 표시한 문장이 한쪽 삶에만 있는 일입니다.</p>
        <ol class="pair">
          <li class="head"><div></div><div>원래 삶</div><div>바꾼 삶</div></li>
          ${rows}
        </ol>
      </div>

      <div class="section">
        <h2>바꾼 삶</h2>
        <p class="story" style="margin-top:0">${summarySentences(b).map(esc).join(' ')}</p>
      </div>

      <div class="section">
        <button class="btn primary" data-act="again">다시 태어나기</button>
        <button class="btn" data-act="ending">원래 삶의 결말로</button>
        <button class="btn ghost" data-act="home">처음으로</button>
      </div>
    </section>`);
  app.querySelector('[data-act="again"]').onclick = () => begin(newSeed());
  app.querySelector('[data-act="ending"]').onclick = renderEnding;
  app.querySelector('[data-act="home"]').onclick = renderStart;
}

// ---------- 시작 ----------

loadGame('.')
  .then(({ world, defs }) => {
    G.world = world;
    G.defs = defs;
    renderStart();
  })
  .catch((e) => {
    app.innerHTML = `<p class="loading">데이터를 불러오지 못했습니다. ${esc(e.message)}</p>`;
  });
