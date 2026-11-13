// 삶의 나무. 지금의 나는 하나이므로 줄기도 하나다.
// 큰일(병, 실직, 결혼, 이별, 사별, 아이, 은퇴, 이주, 답)이 처음 달라지는 해에 줄기가 갈라진다.
// 같은 일을 같은 해에 겪어 온 나들은 한 다발로 묶여 함께 간다. 다발의 굵기가 그 수다.

const MAJOR = {
  illness: '병을 얻었다',
  unemployed: '일을 잃었다',
  marry: '결혼했다',
  divorce: '헤어졌다',
  widowed: '혼자가 되었다',
  child: '아이가 태어났다',
  retire: '일을 놓았다',
  migrate: '떠났다',
  death: '세상을 떠났다',
};

/** 나이마다, 그때까지 겪은 큰일의 누적 서명과 그해의 일 */
function history(life, A0, K, defs, asked) {
  const sig = new Array(K + 1);
  const what = new Array(K + 1).fill(null);
  const byAge = new Map(life.log.map((e) => [e.age, e]));
  let s = '';
  for (let k = 0; k <= K; k++) {
    const e = byAge.get(A0 + k);
    if (e && k > 0) {
      // 통계가 대신 고른 선택은 갈림으로 세지 않는다. 플레이어가 답하는 질문만 센다.
      if (e.choice && asked.has(e.choice.id)) {
        s += `|${k}c${e.choice.id}=${e.choice.option}`;
        const def = defs.choices.find((c) => c.id === e.choice.id);
        const opt = def && def.options.find((o) => o.id === e.choice.option);
        if (opt) what[k] = null;
      }
      for (const ev of e.events) {
        if (!MAJOR[ev.t]) continue;
        s += `|${k}${ev.t}`;
        what[k] = MAJOR[ev.t];
      }
    }
    sig[k] = s;
  }
  return { sig, what };
}

/**
 * 가지의 자리.
 * 반환: ang[i][k] 각도, offT[i][k] 다발 안에서 옆으로 비킨 거리, offZ[i][k] 앞뒤로 비킨 거리,
 *       splits: 갈라진 자리의 꼬리표 { k, i, size, text }
 */
export function layout(lives, defs, A0, END, fan, asked = new Set()) {
  const N = lives.length;
  const K = END - A0;
  const H = lives.map((l) => history(l, A0, K, defs, asked));

  // 가지가 서로 엇갈리지 않도록 잎의 순서를 정한다: 먼저 갈라진 무리끼리 붙여 놓는다.
  const order = [];
  (function place(members, k) {
    if (members.length <= 1 || k > K) {
      order.push(...members);
      return;
    }
    const groups = new Map();
    for (const i of members) {
      const key = H[i].sig[k];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    if (groups.size === 1) return place(members, k + 1);
    // 가장 큰 무리를 가운데에 두고 작은 무리를 양옆으로 번갈아 놓는다.
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    const row = [];
    sorted.forEach((g, n) => (n % 2 ? row.unshift(g) : row.push(g)));
    for (const g of row) place(g, k + 1);
  })([...Array(N).keys()], 0);

  const pos = new Array(N);
  order.forEach((i, p) => (pos[i] = p));
  const leaf = (i) => Math.PI / 2 + fan / 2 - ((pos[i] + 0.5) / N) * fan;

  const ang = Array.from({ length: N }, () => new Float32Array(K + 1));
  const offT = Array.from({ length: N }, () => new Float32Array(K + 1));
  const offZ = Array.from({ length: N }, () => new Float32Array(K + 1));
  const size = Array.from({ length: N }, () => new Uint8Array(K + 1));
  const splits = [];
  let prev = null;
  for (let k = 0; k <= K; k++) {
    const groups = new Map();
    for (let i = 0; i < N; i++) {
      const key = H[i].sig[k];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const members of groups.values()) {
      members.sort((a, b) => pos[a] - pos[b]);
      let c = 0;
      for (const i of members) c += leaf(i);
      c /= members.length;
      members.forEach((i, rank) => {
        // 다발의 단면: 해바라기 씨처럼 채워 넣는다.
        const rho = members.length === 1 ? 0 : 0.036 * Math.sqrt(rank + 0.5);
        const phi = rank * 2.39996;
        ang[i][k] = c;
        offT[i][k] = rho * Math.cos(phi);
        offZ[i][k] = rho * Math.sin(phi);
        size[i][k] = members.length;
      });
      // 이 해에 큰 무리에서 떨어져 나온 가지에 꼬리표를 붙인다.
      if (prev && k > 0) {
        const first = members[0];
        const parent = prev.get(H[first].sig[k - 1]);
        const text = H[first].what[k];
        if (parent && parent.length > members.length && text) splits.push({ k, i: first, size: members.length, text });
      }
    }
    prev = groups;
  }

  // 갈라지는 자리가 꺾이지 않게 나이 방향으로 부드럽게 다듬는다.
  const smooth = (rows) => {
    for (const a of rows) {
      for (let pass = 0; pass < 2; pass++) {
        let before = a[0];
        for (let k = 1; k < K; k++) {
          const cur = a[k];
          a[k] = 0.25 * before + 0.5 * cur + 0.25 * a[k + 1];
          before = cur;
        }
      }
    }
  };
  smooth(ang);
  smooth(offT);
  smooth(offZ);

  return { ang, offT, offZ, size, splits, K };
}
