// 키 기반 난수. 난수 값은 호출 순서가 아니라 키로 정해진다.
// 같은 키는 언제나 같은 값을 낸다. Math.random 과 시계는 쓰지 않는다.

function cyrb53(str) {
  let h1 = 0xdeadbeef ^ 0x9e3779b9;
  let h2 = 0x41c6ce57 ^ 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 0 이상 1 미만의 난수. rand(출생 시드, 우주 번호, 스트림 이름, 나이, ...) */
export function rand(...parts) {
  return cyrb53(parts.join('|')) / 9007199254740992;
}

/** 가중치 배열에서 r(0~1)에 해당하는 인덱스를 고른다. */
export function pickIndex(r, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}
