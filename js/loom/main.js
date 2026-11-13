// 베틀. 날실 100가닥이 100개의 삶이고, 씨실 한 줄이 한 해다.
// 화면에 그리는 것은 전부 엔진의 값이다:
//   실의 굵기 = 그 나이의 운(사망 판정 난수), 씨실의 색 = 그해 그 나라의 사망 확률,
//   끊어지는 자리 = 죽은 나이, 불씨 = 지금 손이 준 답대로라면 끊어질 자리,
//   천의 뒷면 = 같은 운에 실마다 반대 답을 건 100가닥.
//
// 손이 하는 일은 셋이다.
//   길게 누른다 = 짠다. 손을 떼면 시간이 멈춘다.
//   훑는다 = 답한다. 질문을 만나는 실이 들리고, 훑은 실은 눌리거나 다시 들린다. 실마다 답이 다를 수 있다.
//   뒤집는다 = 다 짠 천을 가로로 끌어 반대 답을 본다.

import * as THREE from '../../vendor/three.module.min.js';
import { loadGame } from '../load.js';
import { CAUSE_LABEL } from '../narrative.js';
import { THREADS, weave, luck, pickQuestion } from './sim.js';
import { Sound } from './audio.js';

THREE.ColorManagement.enabled = false;

const N = THREADS;
const AGES = 101;
const SUB = 2; // 한 해를 몇 마디로 나눠 그리는가
const SP = 0.1; // 날실 간격
const ROW = 0.1; // 씨실 간격
const W = N * SP;
const L = AGES * ROW;
const RING = 5;
const xOf = (i) => (i - (N - 1) / 2) * SP;

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
renderer.setClearColor(0x0d0c0a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xfff0d8, 0x2a2018, 1.5));
const key = new THREE.DirectionalLight(0xffe2b8, 2.2);
key.position.set(-3, 5, 8);
scene.add(key);

const tilt = new THREE.Group();
tilt.rotation.x = -0.1;
scene.add(tilt);
const spin = new THREE.Group();
tilt.add(spin);

const sound = new Sound();

// 실 한 가닥마다 넷: [떨림, 들림, 답, 질문을 만나는가]
const threadData = new Float32Array(N * 4);
const threadTex = new THREE.DataTexture(threadData, N, 1, THREE.RGBAFormat, THREE.FloatType);
threadTex.magFilter = threadTex.minFilter = THREE.NearestFilter;

// ---------- 셰이더 ----------

const COMMON = /* glsl */ `
  #define AMP 0.03
  uniform float uAge;
  uniform float uChoiceRow;
  uniform float uBack;
  uniform sampler2D uThread;
  vec4 threadInfo(float j) { return texture2D(uThread, vec2((clamp(j, 0.0, 99.0) + 0.5) / 100.0, 0.5)); }
  // 이 면에서 그 실이 따르는 답. 뒷면은 실마다 반대다.
  float chosen(vec4 info) { return mix(info.b, 1.0 - info.b, uBack); }
  // 날실 j 와 씨실 r 이 만나는 자리에서 씨실이 위(+1)인가 아래(-1)인가.
  // 답을 내리기 전에는 평직, 답을 내린 줄부터는 능직이고 그 실의 답에 따라 사선의 방향이 갈린다.
  float over(float j, float r) {
    if (r < uChoiceRow) return mod(j + r, 2.0) < 1.0 ? 1.0 : -1.0;
    float dir = chosen(threadInfo(j)) < 0.5 ? 1.0 : -1.0;
    return mod(j + dir * r + 400.0, 4.0) < 2.0 ? 1.0 : -1.0;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const uniforms = {
  uAge: { value: 0 },
  uChoiceRow: { value: 1000 },
  uBack: { value: 0 },
  uTime: { value: 0 },
  uGrow: { value: 0 },
  uReveal: { value: 0 },
  uEmber: { value: 0 },
  uThread: { value: threadTex },
};

const warpMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    ${COMMON}
    attribute float aAge;
    attribute float aThread;
    attribute float aTint;
    attribute float aAng;
    attribute float aDiff;
    attribute float aThick;
    attribute vec2 aDeath;
    uniform float uTime;
    varying vec3 vN;
    varying float vAge;
    varying float vTint;
    varying float vAng;
    varying float vDiff;
    varying float vBeyond;
    varying float vSnap;
    varying float vAhead;
    varying float vThick;
    varying float vEnd;
    varying float vAns;
    void main() {
      vec4 info = threadInfo(aThread);
      float sel = chosen(info);
      float d = mix(aDeath.x, aDeath.y, sel) + 0.5;
      vec3 p = position;
      float r0 = floor(aAge);
      float o = mix(over(aThread, r0), over(aThread, r0 + 1.0), smoothstep(0.0, 1.0, fract(aAge)));
      float woven = 1.0 - smoothstep(uAge - 0.6, uAge + 0.4, aAge);
      p.z -= AMP * o * woven;
      float ahead = max(aAge - uAge, 0.0);
      p.z += sin(uTime * 1.1 + aThread * 0.9) * 0.012 * clamp(ahead / 30.0, 0.0, 1.0);
      // 질문을 만나는 실은 앞으로 들리고, 누른 실은 뒤로 물러난다.
      p.z += info.g * 0.34 * (1.0 - woven) * (0.25 + 0.75 * exp(-ahead / 9.0));
      p.z += info.r * 0.05 * sin(uTime * 55.0 + aThread * 1.7) * sin(3.14159 * clamp(aAge / 100.0, 0.0, 1.0));
      vBeyond = aAge - d;
      vSnap = uAge - d;
      if (vBeyond > 0.0 && vSnap > 0.0) {
        p.y -= vSnap * 0.03;
        p.z -= vSnap * vSnap * 0.02;
      }
      vN = normalMatrix * normal;
      vAge = aAge;
      vTint = aTint;
      vAng = aAng;
      vDiff = aDiff;
      vAhead = ahead;
      vThick = aThick;
      vEnd = d;
      vAns = info.a > 0.5 ? sel : 0.5;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform float uGrow;
    uniform float uReveal;
    uniform float uEmber;
    uniform float uTime;
    varying vec3 vN;
    varying float vAge;
    varying float vTint;
    varying float vAng;
    varying float vDiff;
    varying float vBeyond;
    varying float vSnap;
    varying float vAhead;
    varying float vThick;
    varying float vEnd;
    varying float vAns;
    void main() {
      if (vAge > uGrow) discard;
      if (vBeyond > 0.0 && vSnap > 0.0) {
        float fade = 1.0 - smoothstep(0.0, 1.6, vSnap);
        if (hash(floor(gl_FragCoord.xy)) > fade) discard;
      }
      vec3 n = normalize(vN);
      vec3 l = normalize(vec3(-0.35, 0.5, 0.8));
      float diff = 0.30 + 0.70 * max(dot(n, l), 0.0);
      float rim = pow(1.0 - abs(n.z), 3.0) * 0.22;
      float fibre = 0.86 + 0.14 * sin(vAng * 3.0 + vAge * 16.0);
      vec3 col = mix(vec3(0.78, 0.70, 0.56), vec3(0.94, 0.89, 0.77), vTint) * fibre;
      // 답을 받은 실은 답한 줄부터 빛깔이 조금 갈린다: 들린 답은 따뜻하게, 누른 답은 서늘하게.
      // 답을 고르는 동안에는 아직 짜지 않은 부분에 미리 비친다.
      float after = max(step(uChoiceRow, vAge), uEmber * step(uAge - 0.5, vAge));
      col *= mix(vec3(1.0), mix(vec3(1.16, 0.97, 0.76), vec3(0.80, 0.94, 1.12), vAns), after * step(0.01, abs(vAns - 0.5)));
      float future = 1.0 - 0.5 * smoothstep(0.0, 50.0, vAhead);
      // 가는 자리는 빛을 덜 받는다. 멀리서도 운이 보이게 한다.
      col *= (diff + rim) * future * (0.30 + 0.70 * vThick);
      // 답을 고르는 동안, 이 질문과 상관없는 실은 물러난다.
      col *= 1.0 - 0.45 * uEmber * (1.0 - step(0.01, abs(vAns - 0.5))) * step(uAge - 0.5, vAge);
      col += uReveal * vDiff * vec3(0.95, 0.52, 0.12) * (0.42 + 0.14 * sin(uTime * 1.6));
      // 불씨: 손이 준 답대로라면 이 실이 끊어질 자리가 달아오른다.
      float e = exp(-pow((vAge - vEnd) / 1.4, 2.0));
      col += uEmber * vDiff * e * vec3(1.0, 0.42, 0.08) * (1.5 + 0.4 * sin(uTime * 7.0 + vAng));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const weftMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    ${COMMON}
    attribute float aRow;
    attribute float aX;
    attribute float aAng;
    attribute vec3 aCol;
    varying vec3 vN;
    varying vec3 vCol;
    varying float vRow;
    varying float vXn;
    varying float vAng;
    void main() {
      vec3 p = position;
      float j0 = floor(aX);
      float inside = step(0.0, aX) * step(aX, 99.0);
      float o = mix(over(j0, aRow), over(j0 + 1.0, aRow), smoothstep(0.0, 1.0, fract(aX)));
      p.z += AMP * o * inside;
      vN = normalMatrix * normal;
      vCol = aCol;
      vRow = aRow;
      vXn = (aX + 3.0) / 105.0;
      vAng = aAng;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${COMMON}
    varying vec3 vN;
    varying vec3 vCol;
    varying float vRow;
    varying float vXn;
    varying float vAng;
    void main() {
      float t = uAge - vRow;
      if (t < 0.0) discard;
      if (t < 1.0) {
        float xn = mod(vRow, 2.0) < 1.0 ? vXn : 1.0 - vXn;
        if (xn > t) discard;
      }
      vec3 n = normalize(vN);
      vec3 l = normalize(vec3(-0.35, 0.5, 0.8));
      float diff = 0.34 + 0.66 * max(dot(n, l), 0.0);
      float fibre = 0.88 + 0.12 * sin(vAng * 3.0 + vXn * 900.0);
      gl_FragColor = vec4(vCol * diff * fibre, 1.0);
    }
  `,
});

// 불씨의 빛무리
const emberUniforms = { uEmber: uniforms.uEmber, uTime: uniforms.uTime, uPx: { value: 600 } };
const emberMaterial = new THREE.ShaderMaterial({
  uniforms: emberUniforms,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    attribute float aOn;
    uniform float uPx;
    uniform float uTime;
    varying float vOn;
    void main() {
      vOn = aOn * (0.8 + 0.2 * sin(uTime * 6.0 + position.x * 40.0));
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 0.5 * uPx / -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uEmber;
    varying float vOn;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = exp(-r * r * 5.0) * vOn * uEmber;
      gl_FragColor = vec4(vec3(1.0, 0.46, 0.12) * a, a);
    }
  `,
});

// ---------- 고정된 물건: 틀, 바디, 북, 놋쇠 판 ----------

const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.78 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.88 });
const loomFrame = new THREE.Group();
spin.add(loomFrame);
const beamTop = new THREE.Mesh(new THREE.BoxGeometry(W + 1.5, 0.3, 0.34), wood);
beamTop.position.set(0, 0.32, -0.05);
const beamBottom = new THREE.Mesh(new THREE.BoxGeometry(W + 1.5, 0.3, 0.34), wood);
beamBottom.position.set(0, -L - 0.3, -0.05);
loomFrame.add(beamTop, beamBottom);
for (const side of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, L + 1.1, 0.24), darkWood);
  post.position.set(side * (W / 2 + 0.62), -L / 2, -0.12);
  loomFrame.add(post);
}
const reedMaterial = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.6, emissive: 0xffa040, emissiveIntensity: 0 });
const reed = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.05, 0.1), reedMaterial);
spin.add(reed);
const shuttle = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.5 }));
shuttle.scale.set(0.3, 0.045, 0.07);
spin.add(shuttle);

const plateCanvas = document.createElement('canvas');
plateCanvas.width = 1024;
plateCanvas.height = 112;
const plateTexture = new THREE.CanvasTexture(plateCanvas);
const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.2844), new THREE.MeshBasicMaterial({ map: plateTexture }));
plate.position.set(0, 0.32, 0.125);
spin.add(plate);

function engrave(text) {
  const g = plateCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 112);
  grad.addColorStop(0, '#8f7440');
  grad.addColorStop(0.5, '#b89a5a');
  grad.addColorStop(1, '#6f5830');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 112);
  g.strokeStyle = 'rgba(40,28,10,0.55)';
  g.lineWidth = 3;
  g.strokeRect(8, 8, 1008, 96);
  g.font = '500 50px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,240,200,0.45)';
  g.fillText(text, 513, 59);
  g.fillStyle = '#2a1e0c';
  g.fillText(text, 512, 57);
  plateTexture.needsUpdate = true;
}

// 뒤에서 드는 낮은 빛
{
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.ShaderMaterial({
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - vec2(0.44, 0.60)) * vec2(1.0, 1.25);
          float g = exp(-dot(p, p) * 60.0);
          vec3 col = mix(vec3(0.050, 0.046, 0.040), vec3(0.26, 0.17, 0.08), g);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  glow.position.set(0, -L / 2, -5);
  glow.renderOrder = -1;
  scene.add(glow);
}

// 공기 중의 먼지
const dust = (() => {
  const pos = new Float32Array(140 * 3);
  for (let i = 0; i < 140; i++) {
    pos[i * 3] = (Math.random() - 0.5) * (W + 4);
    pos[i * 3 + 1] = -Math.random() * (L + 2) + 1;
    pos[i * 3 + 2] = 0.4 + Math.random() * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe6b8, size: 0.022, transparent: true, opacity: 0.32, depthWrite: false }));
  scene.add(points);
  return points;
})();

// ---------- 한 필의 천 ----------

const G = {
  world: null,
  defs: null,
  seed: null,
  lives: [null, null], // [첫째 답을 따른 100가닥, 둘째 답을 따른 100가닥]
  deaths: [null, null],
  question: null,
  askAge: 200,
  meets: new Uint8Array(N), // 그 실이 질문을 만나는가
  differs: new Uint8Array(N), // 답에 따라 끝이 달라지는 실인가
  ans: new Uint8Array(N), // 실마다의 답 (0 = 들린 실, 1 = 누른 실)
  back: false,
  cloth: null,
  knots: null,
  embers: null,
  pick: null,
  state: 'load',
  age: 0,
  grow: 0,
  speed: 0,
  holding: false,
  everHeld: false,
  yaw: 0,
  yawTarget: 0,
  flipped: false,
  rowSounded: -1,
  dist: 30,
};

/** 지금 보이는 면에서 그 실이 따르는 답 */
const pickOf = (i) => (G.back ? 1 - G.ans[i] : G.ans[i]);
const deathOf = (i) => G.deaths[pickOf(i)][i];
const lifeOf = (i) => G.lives[pickOf(i)][i];
const aliveAt = (i, age) => deathOf(i) + 0.5 > age;

function newSeed() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

function build(seed) {
  const { world, defs } = G;
  G.seed = seed;
  const baseline = weave(world, defs, seed);
  const q = pickQuestion(defs, baseline, 12, 19);
  G.question = q;
  if (q) {
    G.lives = [weave(world, defs, seed, { [q.def.id]: q.def.options[0].id }), weave(world, defs, seed, { [q.def.id]: q.def.options[1].id })];
    G.askAge = q.def.ages[0];
  } else {
    G.lives = [baseline, baseline];
    G.askAge = 200;
  }
  G.deaths = G.lives.map((lives) => lives.map((l) => l.death.age));
  for (let i = 0; i < N; i++) {
    const met = q ? baseline[i].choices.find((c) => c.id === q.def.id) : null;
    G.meets[i] = met ? 1 : 0;
    // 처음에는 통계가 고른 대로 놓인다. 손이 그것을 바꾼다.
    G.ans[i] = met && met.option === q.def.options[1].id ? 1 : 0;
    G.differs[i] = G.deaths[0][i] !== G.deaths[1][i] ? 1 : 0;
    threadData[i * 4] = 0;
    threadData[i * 4 + 1] = 0;
    threadData[i * 4 + 2] = G.ans[i];
    threadData[i * 4 + 3] = G.meets[i];
  }
  threadTex.needsUpdate = true;
  const birth = baseline[0].birth;

  if (G.cloth) {
    spin.remove(G.cloth);
    G.cloth.traverse((o) => o.geometry && o.geometry.dispose());
  }
  const cloth = new THREE.Group();
  G.cloth = cloth;
  spin.add(cloth);

  // 날실: 굵기는 그 나이의 운이다.
  {
    const steps = AGES * SUB + 1;
    const count = N * steps * RING;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const aAge = new Float32Array(count);
    const aThread = new Float32Array(count);
    const aTint = new Float32Array(count);
    const aAng = new Float32Array(count);
    const aDiff = new Float32Array(count);
    const aThick = new Float32Array(count);
    const aDeath = new Float32Array(count * 2);
    const index = new Uint32Array(N * (steps - 1) * RING * 6);
    let v = 0;
    let t = 0;
    for (let i = 0; i < N; i++) {
      const thick = new Float32Array(AGES + 2);
      for (let a = 0; a < AGES + 2; a++) {
        const s = luck(seed, i, a);
        thick[a] = 0.3 + 0.7 * Math.min(Math.max((Math.log10(s) + 2.5) / 2.5, 0), 1);
      }
      const tint = luck(seed, i, 'tint');
      for (let k = 0; k < steps; k++) {
        const age = k / SUB;
        const a0 = Math.floor(age);
        const th = thick[a0] + (thick[a0 + 1] - thick[a0]) * (age - a0);
        const r = 0.03 * th;
        for (let s = 0; s < RING; s++) {
          const ang = (s / RING) * Math.PI * 2;
          position[v * 3] = xOf(i) + Math.cos(ang) * r;
          position[v * 3 + 1] = -age * ROW;
          position[v * 3 + 2] = Math.sin(ang) * r;
          normal[v * 3] = Math.cos(ang);
          normal[v * 3 + 2] = Math.sin(ang);
          aAge[v] = age;
          aThread[v] = i;
          aTint[v] = tint;
          aAng[v] = ang;
          aDiff[v] = G.differs[i];
          aThick[v] = (th - 0.3) / 0.7;
          aDeath[v * 2] = G.deaths[0][i];
          aDeath[v * 2 + 1] = G.deaths[1][i];
          if (k < steps - 1) {
            const a = v;
            const b = i * steps * RING + k * RING + ((s + 1) % RING);
            const c = a + RING;
            const d = b + RING;
            index[t++] = a; index[t++] = c; index[t++] = b;
            index[t++] = b; index[t++] = c; index[t++] = d;
          }
          v++;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(aAge, 1));
    g.setAttribute('aThread', new THREE.BufferAttribute(aThread, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(aTint, 1));
    g.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    g.setAttribute('aDiff', new THREE.BufferAttribute(aDiff, 1));
    g.setAttribute('aThick', new THREE.BufferAttribute(aThick, 1));
    g.setAttribute('aDeath', new THREE.BufferAttribute(aDeath, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(g, warpMaterial);
    mesh.frustumCulled = false;
    cloth.add(mesh);
  }

  // 씨실: 색은 그해 그 나라의 사망 확률이다. 2024년부터는 염색하지 않은 가는 생사다.
  {
    const XS = 210;
    const RW = 4;
    const count = AGES * (XS + 1) * RW;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const aRow = new Float32Array(count);
    const aX = new Float32Array(count);
    const aAng = new Float32Array(count);
    const aCol = new Float32Array(count * 3);
    const index = new Uint32Array(AGES * XS * RW * 6);
    const pale = [0.80, 0.74, 0.60];
    const deep = [0.09, 0.15, 0.31];
    const raw = [0.90, 0.89, 0.85];
    let v = 0;
    let t = 0;
    for (let r = 0; r < AGES; r++) {
      const q0 = world.q(birth.country, birth.sex, birth.year + r, r);
      const load = Math.pow(Math.min(Math.max((Math.log10(q0) + 3.3) / 2.3, 0), 1), 0.8);
      const proj = birth.year + r >= world.boundaryYear;
      const wr = proj ? 0.012 : 0.027;
      const col = [0, 1, 2].map((c) => {
        const dyed = pale[c] + (deep[c] - pale[c]) * load;
        return proj ? (dyed + (raw[c] - dyed) * 0.7) * 0.82 : dyed;
      });
      for (let k = 0; k <= XS; k++) {
        const xi = -3 + (k / XS) * 105;
        for (let s = 0; s < RW; s++) {
          const ang = (s / RW) * Math.PI * 2;
          position[v * 3] = (xi - (N - 1) / 2) * SP;
          position[v * 3 + 1] = -(r + 0.5) * ROW + Math.cos(ang) * wr;
          position[v * 3 + 2] = Math.sin(ang) * wr;
          normal[v * 3 + 1] = Math.cos(ang);
          normal[v * 3 + 2] = Math.sin(ang);
          aRow[v] = r;
          aX[v] = xi;
          aAng[v] = ang;
          aCol[v * 3] = col[0];
          aCol[v * 3 + 1] = col[1];
          aCol[v * 3 + 2] = col[2];
          if (k < XS) {
            const a = v;
            const b = r * (XS + 1) * RW + k * RW + ((s + 1) % RW);
            const c = a + RW;
            const d = b + RW;
            index[t++] = a; index[t++] = b; index[t++] = c;
            index[t++] = b; index[t++] = d; index[t++] = c;
          }
          v++;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('aRow', new THREE.BufferAttribute(aRow, 1));
    g.setAttribute('aX', new THREE.BufferAttribute(aX, 1));
    g.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(g, weftMaterial);
    mesh.frustumCulled = false;
    cloth.add(mesh);
  }

  // 끊어진 자리의 매듭
  G.knots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.036, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a22, roughness: 0.6 }), N);
  G.knots.frustumCulled = false;
  cloth.add(G.knots);

  // 불씨: 답에 따라 끝이 달라지는 실에만 있다.
  {
    const pos = new Float32Array(N * 3);
    const on = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = xOf(i);
      pos[i * 3 + 1] = -(G.deaths[G.ans[i]][i] + 0.5) * ROW;
      pos[i * 3 + 2] = 0.08;
      on[i] = G.differs[i];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOn', new THREE.BufferAttribute(on, 1));
    G.embers = new THREE.Points(g, emberMaterial);
    G.embers.frustumCulled = false;
    cloth.add(G.embers);
  }

  // 손가락이 닿는 면
  G.pick = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, L + 0.4), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  G.pick.position.set(0, -L / 2, 0);
  cloth.add(G.pick);

  engrave(`${birth.year} · ${birth.country} · ${birth.urban ? 'URBAN' : 'RURAL'} · Q${birth.wealth} · ${birth.sex}`);

  G.age = 0;
  G.grow = 0;
  G.speed = 0;
  G.holding = false;
  G.yaw = G.yawTarget = 0;
  G.back = false;
  G.flipped = false;
  G.rowSounded = -1;
  uniforms.uChoiceRow.value = 1000;
  uniforms.uReveal.value = 0;
  uniforms.uEmber.value = 0;
  uniforms.uBack.value = 0;
  $('ask').classList.remove('show');
  $('face').classList.remove('show');
  if (q) $('qword').textContent = q.def.short || q.def.prompt;
}

// ---------- 진행 ----------

const M4 = new THREE.Matrix4();
function updateKnots() {
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    const s = G.age >= d ? Math.min(1, 0.3 + (G.age - d) * 1.4) : 0;
    M4.makeScale(s, s, s);
    M4.setPosition(xOf(i), -d * ROW, 0);
    G.knots.setMatrixAt(i, M4);
  }
  G.knots.instanceMatrix.needsUpdate = true;
}

function pluckThread(i, gain = 0.5) {
  if (i < 0 || i >= N) return;
  threadData[i * 4] = 1;
  sound.pluck(i, N, gain);
}

/** 이번 프레임에 지나간 나이 구간에서 일어난 일: 씨실 한 줄, 끊어진 실 */
function passed(from, to) {
  const row = Math.floor(to);
  if (row !== G.rowSounded && to < AGES) {
    G.rowSounded = row;
    if (G.speed < 4.5 || row % 2 === 0) sound.slice('loom', luck(G.seed, 'row', row), { gain: G.speed > 4 ? 0.32 : 0.5, rate: 0.94 + luck(G.seed, 'rate', row) * 0.14, max: 0.7 });
  }
  let n = 0;
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    if (d > from && d <= to) {
      threadData[i * 4] = 0.7;
      if (n++ < 3) {
        const pan = (i / N) * 1.4 - 0.7;
        if (luck(G.seed, i, 'snd') < 0.75) sound.slice('snap', luck(G.seed, i, 'snap'), { gain: 0.5, pan, max: 0.9, rate: 0.95 + luck(G.seed, i, 'sr') * 0.2 });
        else sound.play('twig', { gain: 0.45, pan, rate: 0.9 + luck(G.seed, i, 'sr') * 0.3 });
      }
    }
  }
}

function aliveCount() {
  let n = 0;
  for (let i = 0; i < N; i++) if (aliveAt(i, G.age)) n++;
  return n;
}

/** 질문 앞에 선 실들의 수: [들린 실, 누른 실] */
function tally() {
  const t = [0, 0];
  for (let i = 0; i < N; i++) if (G.meets[i] && G.deaths[0][i] >= G.askAge) t[G.ans[i]]++;
  return t;
}

function showAsk() {
  const q = G.question.def;
  const t = tally();
  $('optA').textContent = `들린 실 ${t[0]} · ${q.options[0].label}`;
  $('optB').textContent = `누른 실 ${t[1]} · ${q.options[1].label}`;
}

function setAnswer(i, value) {
  if (G.ans[i] === value) return;
  G.ans[i] = value;
  threadData[i * 4 + 2] = value;
  threadTex.needsUpdate = true;
  pluckThread(i, 0.34);
  showAsk();
}

/** 답을 그대로 두고 다시 짜기 시작한다. */
function commit() {
  uniforms.uChoiceRow.value = G.askAge;
  $('ask').classList.remove('show');
  sound.slice('loom', 0.5, { gain: 0.8, max: 0.9 });
  sound.play('gayageum_a2', { gain: 0.5, rate: 1.5, duration: 4 });
  G.state = 'weave';
  G.speed = 0;
}

function totals() {
  let years = 0;
  let other = 0;
  let changed = 0;
  for (let i = 0; i < N; i++) {
    years += G.deaths[pickOf(i)][i];
    other += G.deaths[1 - pickOf(i)][i];
    if (G.differs[i]) changed++;
  }
  return { years, other, changed };
}

function showFace() {
  const q = G.question;
  const t = totals();
  if (!q) {
    $('faceLine').textContent = '뒤집어도 같다';
    $('faceSub').textContent = '';
  } else {
    $('faceLine').textContent = G.back ? '뒤 · 실마다 반대로 답했다면' : '앞 · 내 손이 짠 천';
    $('faceSub').textContent = G.flipped
      ? `100가닥의 햇수 ${t.years.toLocaleString('ko-KR')} · 끝이 달라진 실 ${t.changed}`
      : '↔ 천을 뒤집으면 반대 답이 보인다';
  }
  $('face').classList.add('show');
}

function hint(text) {
  const el = $('hint2');
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('show', !!text);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const before = G.age;
  uniforms.uTime.value = now / 1000;

  switch (G.state) {
    case 'birth':
      G.grow += dt * 42;
      if (G.grow >= AGES + 2) G.state = 'child';
      break;
    case 'child': // 침묵의 8초. 아무것도 할 수 없다.
      G.age += dt * 1.5;
      if (G.age >= 12) {
        G.state = 'weave';
        G.speed = 0;
      }
      break;
    case 'weave': {
      // 길게 누르는 동안만 짠다. 누르고 있을수록 빨라진다.
      if (G.holding) G.speed = Math.min(9, Math.max(G.speed, 1.6) + dt * 1.3);
      else G.speed = Math.max(0, G.speed - dt * 14);
      G.age += dt * G.speed;
      const asking = G.question && uniforms.uChoiceRow.value > 999;
      if (asking && G.age >= G.askAge) {
        G.age = G.askAge;
        G.state = 'ask';
        G.holding = false;
        G.speed = 0;
        showAsk();
        $('ask').classList.add('show');
        sound.play('gayageum_a2', { gain: 0.55, duration: 5 });
      } else if (G.age >= AGES) {
        G.age = AGES;
        G.state = 'flip';
        G.holding = false;
        showFace();
      }
      break;
    }
    default:
      break;
  }
  if (G.age > before) passed(before, G.age);

  // 뒤집기
  G.yaw += (G.yawTarget - G.yaw) * Math.min(1, dt * 9);
  const back = G.state === 'flip' && Math.cos(G.yaw) < 0;
  if (back !== G.back) {
    G.back = back;
    uniforms.uBack.value = back ? 1 : 0;
    G.flipped = true;
    sound.play('cloth', { gain: 0.7, offset: 1 + Math.random() * 8, duration: 1.3, fade: 0.1 });
    showFace();
  }
  if (G.flipped) uniforms.uReveal.value += (1 - uniforms.uReveal.value) * dt * 1.5;

  // 실마다: 떨림은 잦아들고, 들림은 제자리를 찾아간다.
  const asking = G.state === 'ask';
  for (let i = 0; i < N; i++) {
    const k = i * 4;
    threadData[k] = threadData[k] > 0.002 ? threadData[k] * Math.pow(0.04, dt) : 0;
    const involved = asking && G.meets[i] && aliveAt(i, G.age);
    const target = involved ? (G.ans[i] === 0 ? 1 : -0.4) : 0;
    threadData[k + 1] += (target - threadData[k + 1]) * Math.min(1, dt * (asking ? 9 : 2.2));
  }
  threadTex.needsUpdate = true;

  // 불씨는 답을 고르는 동안만 보인다. 손이 답을 바꾸면 그 실의 불씨가 자리를 옮긴다.
  uniforms.uEmber.value += ((asking ? 1 : 0) - uniforms.uEmber.value) * Math.min(1, dt * (asking ? 3 : 1.2));
  if (G.embers && uniforms.uEmber.value > 0.01) {
    const pos = G.embers.geometry.attributes.position;
    for (let i = 0; i < N; i++) {
      const y = -(G.deaths[G.ans[i]][i] + 0.5) * ROW;
      pos.array[i * 3 + 1] += (y - pos.array[i * 3 + 1]) * Math.min(1, dt * 7);
    }
    pos.needsUpdate = true;
  }

  uniforms.uAge.value = G.age;
  uniforms.uGrow.value = G.state === 'load' || G.state === 'title' ? 0 : G.grow;
  if (G.knots) updateKnots();

  const fellY = -G.age * ROW;
  reed.position.set(0, fellY - 0.07, 0.07);
  reed.visible = G.state !== 'flip' && G.state !== 'title' && G.state !== 'load';
  reedMaterial.emissiveIntensity += ((hold.arming ? 0.9 : 0) - reedMaterial.emissiveIntensity) * Math.min(1, dt * 6);
  const row = Math.floor(G.age);
  const prog = G.age - row;
  shuttle.visible = (G.state === 'child' || G.state === 'weave') && G.age < AGES;
  shuttle.position.set((row % 2 === 0 ? prog * 2 - 1 : 1 - prog * 2) * (W / 2 + 0.3), -(row + 0.5) * ROW, 0.09);

  spin.rotation.y = G.yaw + Math.sin(now / 5200) * 0.025;
  dust.rotation.y = Math.sin(now / 9000) * 0.05;

  // 카메라: 답을 고를 때와 다 짠 뒤에는 천 전체를, 짜는 동안에는 짜는 자리를 본다.
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const fitW = (W + 0.9) / 2 / (tan * camera.aspect);
  const fitH = (L + 2.2) / 2 / tan;
  const whole = G.state === 'flip' || G.state === 'ask';
  const wantDist = whole ? Math.max(fitW, fitH) : fitW;
  G.dist += (wantDist - G.dist) * Math.min(1, dt * 1.6);
  const visH = 2 * G.dist * tan;
  let camY = -L / 2 + 0.05;
  if (visH < L + 2) camY = Math.min(0.75 - visH / 2, Math.max(-L - 0.75 + visH / 2, fellY - visH * 0.12));
  camera.position.y += (camY - camera.position.y) * Math.min(1, dt * 2.5);
  camera.position.z = G.dist;
  camera.lookAt(0, camera.position.y, 0);
  emberUniforms.uPx.value = renderer.domElement.height / (2 * tan);

  const el = $('alive');
  if (G.state === 'child' || G.state === 'weave' || G.state === 'ask' || G.state === 'flip') {
    el.classList.add('show');
    el.textContent = `${aliveCount()} / ${N}`;
  } else {
    el.classList.remove('show');
  }
  if (G.state === 'weave' && !G.everHeld) hint('길게 눌러 짠다');
  else if (G.state === 'ask') hint('훑어서 실을 누르거나 든다 · 가만히 눌러 계속 짠다');
  else hint('');

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- 손 ----------

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const drag = { on: false, x: 0, y: 0, moved: 0, lastThread: -1, paint: -1 };
const hold = { timer: 0, arming: false };

function threadAt(e) {
  if (!G.pick) return -1;
  ptr.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObject(G.pick)[0];
  if (!hit) return -1;
  const local = G.pick.worldToLocal(hit.point.clone());
  const i = Math.round(local.x / SP + (N - 1) / 2);
  return i >= 0 && i < N ? i : -1;
}

function cancelHold() {
  clearTimeout(hold.timer);
  hold.arming = false;
}

/** 훑기: 처음 닿은 실의 답을 뒤집고, 같은 획으로 지나는 실에 그 답을 칠한다. */
function brush(e) {
  const i = threadAt(e);
  if (i < 0 || i === drag.lastThread) return;
  // 손가락이 빠르게 지나가도 사이의 실을 빠뜨리지 않는다.
  const from = drag.lastThread < 0 ? i : drag.lastThread;
  const step = i >= from ? 1 : -1;
  for (let j = from; j !== i + step; j += step) {
    if (!G.meets[j] || !aliveAt(j, G.age)) continue;
    if (drag.paint < 0) drag.paint = 1 - G.ans[j];
    setAnswer(j, drag.paint);
  }
  drag.lastThread = i;
}

canvas.addEventListener('pointerdown', (e) => {
  if (G.state === 'title') {
    sound.start().then(() => sound.play('gayageum_a2', { gain: 0.4, rate: 0.75, duration: 6 }));
    $('title').style.opacity = 0;
    G.state = 'birth';
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  drag.on = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  drag.lastThread = -1;
  drag.paint = -1;
  if (G.state === 'weave') {
    G.holding = true;
    G.everHeld = true;
  } else if (G.state === 'ask') {
    // 움직이지 않고 누르고 있으면 답을 그대로 두고 다시 짠다.
    hold.arming = true;
    hold.timer = setTimeout(() => {
      hold.arming = false;
      if (G.state === 'ask' && drag.on) {
        commit();
        G.holding = true;
        G.everHeld = true;
      }
    }, 650);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag.on) drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  if (G.state === 'ask') {
    if (!drag.on) return;
    if (drag.moved > 10) {
      cancelHold();
      brush(e);
    }
    return;
  }
  if (G.state === 'flip' && drag.on) {
    G.yawTarget += (e.movementX || 0) * 0.011;
    return;
  }
  // 스치기: 살아 있는 실을 훑으면 그 실이 울린다.
  if (G.state === 'title' || G.state === 'load' || G.state === 'birth') return;
  if (e.pointerType !== 'mouse' && !drag.on) return;
  const i = threadAt(e);
  if (i >= 0 && i !== drag.lastThread) {
    drag.lastThread = i;
    if (aliveAt(i, G.age) || G.state === 'flip') pluckThread(i, 0.42);
  }
});

function release(e) {
  if (!drag.on) return;
  drag.on = false;
  G.holding = false;
  cancelHold();
  if (G.state !== 'flip') return;
  if (drag.moved < 8) {
    const i = threadAt(e);
    if (i >= 0) {
      pluckThread(i, 0.5);
      const life = lifeOf(i);
      const tag = $('tag');
      tag.textContent = `№${i + 1} · ${life.death.age}세 · ${CAUSE_LABEL[life.death.cause]}`;
      tag.style.left = `${Math.min(Math.max(e.clientX, 90), window.innerWidth - 90)}px`;
      tag.style.top = `${e.clientY}px`;
      tag.classList.add('show');
      clearTimeout(tag.timer);
      tag.timer = setTimeout(() => tag.classList.remove('show'), 2600);
    }
  } else {
    G.yawTarget = Math.round(G.yawTarget / Math.PI) * Math.PI; // 가장 가까운 면으로 붙는다.
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// 자판: 스페이스를 누르고 있어도 짠다.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  if (G.state === 'weave') {
    G.holding = true;
    G.everHeld = true;
  } else if (G.state === 'ask') {
    commit();
    G.holding = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') G.holding = false;
});

$('again').addEventListener('click', () => {
  build(newSeed());
  G.state = 'birth';
  sound.play('gayageum_a2', { gain: 0.4, rate: 0.75, duration: 6 });
});

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 확인용: 화면 밖에서 상태를 읽고 넘길 수 있게 한다.
window.__loom = { G, build, commit, setAnswer, uniforms, sound, totals };

loadGame('.')
  .then(({ world, defs }) => {
    G.world = world;
    G.defs = defs;
    const seed = new URLSearchParams(location.search).get('seed') || newSeed();
    build(seed);
    G.state = 'title';
    $('hint').textContent = '눌러서 짜기 시작';
    camera.position.set(0, -L / 2, 40);
    requestAnimationFrame(frame);
  })
  .catch((e) => {
    $('hint').textContent = '불러오지 못했습니다: ' + e.message;
  });
