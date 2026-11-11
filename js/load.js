// 데이터 파일을 읽어 세계와 선택지 정의를 만든다. 게임 화면과 테스트 페이지가 함께 쓴다.

import { createWorld } from './world.js';

export async function loadGame(base = '.') {
  const get = async (name) => {
    const res = await fetch(`${base}/data/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  const [demo, events, defs] = await Promise.all([get('demography.json'), get('life-events.json'), get('choices.json')]);
  return { world: createWorld(demo, events, 'base'), defs };
}
