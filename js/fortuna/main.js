// 포르투나의 명부.
// 통계가 써 놓은 나의 죽음 100줄을, 갈라지는 삶의 나무를 기르며 고쳐 쓴다.
//
//   책이 먼저 나온다: 지금의 나에서 뻗는 100개의 삶이 어떻게 끝나는지가 이미 적혀 있다.
//   내기를 건다: 통계가 적은 수보다 몇 명을 더 그 나이 너머로 데려갈 것인가.
//   나무를 기른다: 지금의 나는 한 줄기다. 삶이 달라지는 해마다 줄기가 갈라진다.
//   질문 앞에서 가지를 훑어 답을 바꾸면, 명부의 줄이 다시 적힌다.
//
// 그리는 것은 전부 엔진의 값이다. 다발의 굵기 = 같은 일을 겪어 온 나의 수,
// 실의 굵기 = 그 나이의 운, 가지 끝의 매듭 = 죽은 나이, 불씨 = 지금 답대로라면 끊어질 자리.

import * as THREE from '../../vendor/three.module.min.js';
import { loadGame } from '../load.js';
import { CAUSE_LABEL } from '../narrative.js';
import { Sound } from '../loom/audio.js';
import { THREADS, NOW, runThread, runAll, luck, planQuestions, answerOf } from '../wheel/sim.js';
import { layout } from './layout.js';
import { rand } from '../rng.js';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { createLake } from './lake.js';

THREE.ColorManagement.enabled = false;

const N = THREADS;
const END = 101;
const R0 = 1.0; // 그루터기의 가장자리 = 오늘
const ROUT = 6.6;
const FAN = 3.7; // 나무가 펼쳐지는 각 (약 212도)
const SUB = 2;
const RING = 5;
// 나무의 몸: 오늘까지는 줄기, 오늘부터는 수관(樹冠). 호수의 수면이 y = 0 이다.
const TRUNK = 1.7;
const CROWN = 5.6;
const SPREAD = 3.2;
const AZ = Math.PI * 0.9; // 부채꼴의 양 끝이 나무 뒤에서 거의 만난다
// 가지는 곧게 솟다가 옆으로 퍼지고, 늙으면 물 쪽으로 늘어진다.
const crownY = (u) => TRUNK + CROWN * (1 - Math.pow(1 - u, 2.0)) - 1.5 * Math.pow(Math.max(0, (u - 0.6) / 0.4), 2);
const crownR = (u) => SPREAD * Math.pow(Math.sin(Math.min(Math.max(u, 0) * 1.15, 1) * Math.PI / 2), 0.85);
const trunkR = (h) => 0.34 + 0.1 * (1 - h) + 0.3 * Math.exp(-h * 6); // h: 0 = 물가, 1 = 오늘
const ringR = (u) => crownR(u) + 0.55 + 0.35 * u;

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setClearColor(0x05060a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xc8d6ff, 0x141820, 1.1));
const key = new THREE.DirectionalLight(0xd8e4ff, 1.8);
key.position.set(-6, 5, -14);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffd2a0, 1.1);
fill.position.set(4, 3, 10);
scene.add(fill);
const treeG = new THREE.Group();
scene.add(treeG);
const lake = createLake(THREE, scene, renderer);

// 빛 번짐: 불씨, 등불, 달이 공기 속으로 번진다.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.86);
composer.addPass(bloom);

const sound = new Sound();

// 실 한 가닥마다 세 줄: [떨림, 들림, -, 질문을 만나는가] / [끝나는 나이, 끝이 달라지는가] / [질문 1·2·3의 답]
const threadData = new Float32Array(N * 4 * 3);
const threadTex = new THREE.DataTexture(threadData, N, 3, THREE.RGBAFormat, THREE.FloatType);
threadTex.magFilter = threadTex.minFilter = THREE.NearestFilter;
const T0 = (i) => i * 4;
const T1 = (i) => N * 4 + i * 4;
const T2 = (i) => N * 8 + i * 4;

// ---------- 셰이더 ----------

const COMMON = /* glsl */ `
  uniform float uAge;
  uniform vec3 uAsk;
  uniform sampler2D uThread;
  vec4 row(float j, float v) { return texture2D(uThread, vec2((j + 0.5) / 100.0, v)); }
  // 그 나이에서 이 실이 따르는 가장 최근의 답. 0 = 들린 답, 1 = 누른 답, 0.5 = 답한 적 없음
  float ansAt(float j, float age) {
    vec4 a = row(j, 0.8333);
    float r = 0.5;
    if (age >= uAsk.x && abs(a.r - 0.5) > 0.01) r = a.r;
    if (age >= uAsk.y && abs(a.g - 0.5) > 0.01) r = a.g;
    if (age >= uAsk.z && abs(a.b - 0.5) > 0.01) r = a.b;
    return r;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 answerTint(float a) {
    if (abs(a - 0.5) < 0.01) return vec3(1.0);
    return mix(vec3(1.18, 0.96, 0.72), vec3(0.78, 0.94, 1.14), a);
  }
`;

const uniforms = {
  uAge: { value: 0 },
  uAsk: { value: new THREE.Vector3(1000, 1000, 1000) },
  uSlot: { value: 0 },
  uTime: { value: 0 },
  uHub: { value: 0 },
  uForesee: { value: 1 }, // 아직 자라지 않은 가지가 비쳐 보이는 정도
  uEmber: { value: 0 },
  uGoal: { value: 70 },
  uThread: { value: threadTex },
};

const threadMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    ${COMMON}
    attribute float aAge;
    attribute float aThread;
    attribute float aTint;
    attribute float aAng;
    attribute float aThick;
    uniform float uTime;
    uniform float uSlot;
    varying vec3 vN;
    varying float vAge;
    varying float vTint;
    varying float vAng;
    varying float vDiff;
    varying float vBeyond;
    varying float vSnap;
    varying float vThick;
    varying float vEnd;
    varying float vAns;
    varying float vNow;
    varying float vWarn;
    varying float vVow;
    void main() {
      vec4 info = row(aThread, 0.1667);
      vec4 fate = row(aThread, 0.5);
      vec4 answers = row(aThread, 0.8333);
      float d = fate.r + 0.5;
      vec3 p = position;
      vec3 outw = vec3(p.x, 0.0, p.z);
      float ol = length(outw);
      outw = ol > 0.001 ? outw / ol : vec3(0.0, 0.0, 1.0);
      float ahead = max(aAge - uAge, 0.0);
      p += outw * info.g * 0.3 * step(uAge - 0.5, aAge) * (0.3 + 0.7 * exp(-ahead / 12.0));
      p += outw * info.r * 0.05 * sin(uTime * 55.0 + aThread * 1.7);
      // 곧 끊어질 가지는 자라는 끝이 떤다.
      p += outw * fate.b * 0.05 * sin(uTime * (14.0 + 40.0 * fate.b) + aThread * 2.1) * exp(-pow((aAge - uAge) / 2.5, 2.0));
      vWarn = fate.b;
      vVow = fate.a;
      vBeyond = aAge - d;
      vSnap = uAge - d;
      if (vBeyond > 0.0 && vSnap > 0.0) p.y -= vSnap * vSnap * 0.05 + vBeyond * vSnap * 0.02; // 끝난 가지는 물 쪽으로 처진다
      vN = normalMatrix * normal;
      vAge = aAge;
      vTint = aTint;
      vAng = aAng;
      vDiff = fate.g;
      vThick = aThick;
      vEnd = d;
      vAns = ansAt(aThread, aAge);
      float cur = uSlot < 0.5 ? answers.r : (uSlot < 1.5 ? answers.g : answers.b);
      vNow = info.a > 0.5 ? cur : 0.5;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform float uForesee;
    uniform float uEmber;
    uniform float uTime;
    varying vec3 vN;
    varying float vAge;
    varying float vTint;
    varying float vAng;
    varying float vDiff;
    varying float vBeyond;
    varying float vSnap;
    varying float vThick;
    varying float vEnd;
    varying float vAns;
    varying float vNow;
    varying float vWarn;
    varying float vVow;
    void main() {
      // 끝난 삶의 그 뒤는 없다.
      if (vBeyond > 0.0) {
        float fade = vSnap > 0.0 ? 1.0 - smoothstep(0.0, 1.6, vSnap) : 0.0;
        if (hash(floor(gl_FragCoord.xy)) > fade) discard;
      }
      // 아직 자라지 않은 가지는 보이지 않는다. 포르투나가 내다볼 때만 흐리게 비친다.
      float ahead = vAge - uAge - 0.2;
      float seen = 1.0;
      if (ahead > 0.0) {
        if (uForesee < 0.02) discard;
        seen = 0.62 * uForesee;
        if (hash(floor(gl_FragCoord.xy) + 3.0) > uForesee * 2.0) discard;
      }
      vec3 n = normalize(vN);
      float diff = 0.30 + 0.70 * max(dot(n, normalize(vec3(-0.35, 0.5, 0.8))), 0.0);
      float rim = pow(1.0 - abs(n.z), 3.0) * 0.32;
      float fibre = 0.86 + 0.14 * sin(vAng * 3.0 + vAge * 16.0);
      vec3 col = mix(vec3(0.78, 0.70, 0.56), vec3(0.94, 0.89, 0.77), vTint) * fibre;
      float choosing = uEmber * step(0.0, ahead);
      col *= mix(answerTint(vAns), answerTint(vNow), choosing * step(0.01, abs(vNow - 0.5)));
      col *= (diff + rim) * (0.30 + 0.70 * vThick) * seen;
      col *= 1.0 - 0.5 * choosing * (1.0 - step(0.01, abs(vNow - 0.5)));
      // 서원을 건 가지는 금빛이 돈다. 곧 끊어질 가지는 자라는 끝이 달아오른다.
      col = mix(col, col * vec3(1.35, 1.05, 0.55) + vec3(0.10, 0.06, 0.0), 0.6 * vVow * step(vAge, uAge + 0.2));
      // 잔잔한 금빛 = 아슬아슬하게 모자란 운, 거친 붉은빛 = 가망 없는 운
      float tip = step(0.01, vWarn) * exp(-pow((vAge - uAge) / 1.3, 2.0));
      col += tip * mix(vec3(1.0, 0.78, 0.30), vec3(1.0, 0.16, 0.06), vWarn) * (1.0 + 0.8 * vWarn * sin(uTime * (5.0 + 24.0 * vWarn) + vAng));
      float e = exp(-pow((vAge - vEnd) / 1.4, 2.0));
      col += uEmber * vDiff * e * vec3(1.0, 0.42, 0.08) * (1.5 + 0.4 * sin(uTime * 7.0 + vAng));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

// 나이의 눈금: 한 해에 호 하나. 지나온 해는 그해의 사망 확률로 물든다.
const arcMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aRow;
    attribute float aKind;
    attribute vec3 aCol;
    varying vec3 vCol;
    varying float vRow;
    varying float vKind;
    void main() {
      vCol = aCol;
      vRow = aRow;
      vKind = aKind;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uAge;
    uniform float uTime;
    varying vec3 vCol;
    varying float vRow;
    varying float vKind;
    void main() {
      float past = step(vRow, uAge);
      vec3 col = vCol;
      float a = 0.0;
      if (vKind > 1.5) { col = vec3(1.25, 0.86, 0.38) * (0.85 + 0.15 * sin(uTime * 1.3)); a = 1.0; }  // 내기의 선
      else if (vKind > 0.5) { col = mix(vec3(0.16, 0.17, 0.20), vCol * 0.8, past); a = 1.0; }               // 십 년 눈금
      else { a = past; col = vCol * 0.2; }
      if (a < 0.5) discard;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const hubMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aYear;
    attribute float aBand;
    attribute vec3 aCol;
    varying vec3 vN;
    varying vec3 vCol;
    varying float vYear;
    varying float vBand;
    void main() {
      vN = normalMatrix * normal;
      vCol = aCol;
      vYear = aYear;
      vBand = aBand;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uHub;
    varying vec3 vN;
    varying vec3 vCol;
    varying float vYear;
    varying float vBand;
    void main() {
      if (vYear > uHub) discard;
      vec3 n = normalize(vN);
      float diff = 0.30 + 0.70 * max(dot(n, normalize(vec3(-0.35, 0.5, 0.8))), 0.0);
      float rim = pow(1.0 - abs(n.z), 3.0) * 0.25;
      vec3 col = vCol * (diff + rim);
      if (vBand > 0.5) {
        // 껍질 위로 한 해에 한 줄씩 금이 간다. 그해가 위험했을수록 짙다.
        float f = fract(vYear);
        col *= 0.62 + 0.38 * smoothstep(0.0, 0.16, min(f, 1.0 - f));
        col *= vec3(0.66, 0.56, 0.44);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

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
      vOn = aOn * (0.8 + 0.2 * sin(uTime * 6.0 + position.x * 40.0 + position.y * 31.0));
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

// 달아오른 끝의 빛무리: 금빛으로 잔잔하면 붙잡을 만하고, 붉게 거칠면 가망이 없다.
const warnMaterial = new THREE.ShaderMaterial({
  uniforms: emberUniforms,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    attribute float aOn;
    uniform float uPx;
    varying float vOn;
    void main() {
      vOn = aOn;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = (0.55 + 0.35 * aOn) * step(0.01, aOn) * uPx / -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying float vOn;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float pulse = 0.72 + 0.28 * sin(uTime * (3.0 + 28.0 * vOn));
      float a = exp(-r * r * 4.5) * pulse;
      gl_FragColor = vec4(mix(vec3(1.0, 0.80, 0.34), vec3(1.0, 0.14, 0.05), vOn) * a, a);
    }
  `,
});

// ---------- 고정된 물건 ----------

const gold = new THREE.MeshStandardMaterial({ color: 0xe2a04a, emissive: 0xe2a04a, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide });
const M4 = new THREE.Matrix4();

const plateCanvas = document.createElement('canvas');
plateCanvas.width = plateCanvas.height = 512;
const plateTexture = new THREE.CanvasTexture(plateCanvas);
const plate = new THREE.Mesh(new THREE.CircleGeometry(0.13, 64), new THREE.MeshBasicMaterial({ map: plateTexture, side: THREE.DoubleSide }));
// 이름패는 줄기 앞에 박혀 있다.
plate.position.set(0, TRUNK * 0.52, trunkR(0.52) + 0.02);
treeG.add(plate);

function engrave(profile, age) {
  const g = plateCanvas.getContext('2d');
  const grad = g.createRadialGradient(200, 180, 30, 256, 256, 280);
  grad.addColorStop(0, '#c2a566');
  grad.addColorStop(1, '#6f5830');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = (s, y, size) => {
    g.font = `500 ${size}px Georgia, "Times New Roman", serif`;
    g.fillStyle = 'rgba(255,240,200,0.45)';
    g.fillText(s, 257, y + 2);
    g.fillStyle = '#2a1e0c';
    g.fillText(s, 256, y);
  };
  text(String(profile.birthYear), 215, 120);
  text(`${age}`, 335, 76);
  plateTexture.needsUpdate = true;
}

// ---------- 상태 ----------

const profile = { country: 'USA', birthYear: 1986, sex: 'F', wealth: 3, edu: 3, job: 'office', partner: 1, children: 0, smoking: 0, drinking: 0, exercise: 0, conscientiousness: 'mid' };

const G = {
  world: null,
  defs: null,
  seed: null,
  A0: 40,
  DR: 0.08,
  goal: 70, // 내기의 나이
  target: 0, // 내기로 건 수
  base: [], // 통계가 써 놓은 100개의 삶
  lives: [],
  rules: [],
  alt: [],
  questions: [],
  qi: 0,
  meets: new Uint8Array(N),
  ans: new Int8Array(N),
  lay: null,
  tree: null,
  knots: null,
  embers: null,
  pick: null,
  labels: [],
  state: 'load',
  age: 0,
  passedTo: 0,
  hub: 0,
  speed: 0,
  holding: false,
  everHeld: false,
  dirty: false,
  rowSounded: -1,
  dist: 40,
  prevEnds: null,
  graces: [], // 가지마다 받은 은총
  graceLeft: 3,
  answered: false, // 지금 질문에 답했는가
  answers: [], // 플레이어가 쓴 답의 기록
  autoNext: 0,
  warnSeen: new Set(), // 이미 달아올라 한 번 느려졌던 가지
  slowUntil: 0,
  vows: [], // { i, target, at, text, state }
  lastVow: -99,
  vowShown: '',
  best: 0,
};

const rOf = (age) => R0 + (age - G.A0) * G.DR;
const deathOf = (i) => G.lives[i].death.age;
const aliveAt = (i, age) => deathOf(i) + 0.5 > age;
const GOAL_NAME = { 70: '일흔', 75: '일흔다섯', 80: '여든', 85: '여든다섯', 90: '아흔', 95: '아흔다섯' };
const goalName = () => GOAL_NAME[G.goal] || `${G.goal}세`;
const reached = (lives) => lives.filter((l) => l.death.age >= G.goal).length;
const lineOf = (life) => `${life.death.year} · ${life.death.age}세 · ${CAUSE_LABEL[life.death.cause]}`;

function newSeed() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

/** 부채꼴의 각 th 와 나이 u(0~1) 를 수관 위의 자리로 옮긴다. oT·oZ 는 다발 안에서 비킨 거리. */
function place(th, u, oT = 0, oZ = 0, lead = 0, depth = 1, rise = 1) {
  const phi = ((th - Math.PI / 2) / (FAN / 2)) * AZ + 0.55 * u; // 자라면서 조금씩 감긴다
  const sx = Math.sin(phi);
  const cz = Math.cos(phi);
  // 큰 다발은 가운데로 높이 솟고(원줄기), 떨어져 나온 작은 가지는 옆으로 낮게 퍼진다.
  // 혼자가 된 가지일수록 제 깊이와 높이를 찾아간다. 그래서 수관이 속까지 찬다.
  const spread = (1.2 - 0.62 * lead) * (depth + (1 - depth) * lead);
  const lift = (0.86 + 0.36 * lead) * (rise + (1 - rise) * lead);
  const rho = crownR(u) * spread;
  const y = TRUNK + (crownY(u) - TRUNK) * lift;
  // 가지가 뻗는 방향에 수직인 쪽(수직면 안)으로 다발의 두께를 준다.
  const du = 0.01;
  const u2 = Math.min(u + du, 1);
  const u1 = u2 - du;
  const dy = crownY(u2) - crownY(u1);
  const dr = crownR(u2) - crownR(u1) + 1e-5;
  const len = Math.hypot(dy, dr);
  const bo = dy / len;
  const bu = -dr / len;
  const k = 1.15;
  return {
    x: sx * rho + cz * oT * k + sx * oZ * k * bo,
    y: y + oZ * k * bu,
    z: cz * rho - sx * oT * k + cz * oZ * k * bo,
    phi,
  };
}

/** 가지 위의 한 점. 나이는 소수여도 된다. */
function pointAt(i, age) {
  const L = G.lay;
  const kf = Math.min(Math.max(age - G.A0, 0), L.K);
  const k0 = Math.min(Math.floor(kf), L.K - 1);
  const f = kf - k0;
  const th = L.ang[i][k0] + (L.ang[i][k0 + 1] - L.ang[i][k0]) * f;
  const oT = L.offT[i][k0] + (L.offT[i][k0 + 1] - L.offT[i][k0]) * f;
  const oZ = L.offZ[i][k0] + (L.offZ[i][k0 + 1] - L.offZ[i][k0]) * f;
  const lead = L.lsz[i][k0] + (L.lsz[i][k0 + 1] - L.lsz[i][k0]) * f;
  const p = place(th, kf / L.K, oT, oZ, lead, 0.3 + 0.85 * luck(G.seed, i, 'depth'), 0.78 + 0.5 * luck(G.seed, i, 'rise'));
  p.th = th;
  return p;
}

function writeFates() {
  for (let i = 0; i < N; i++) {
    threadData[T1(i)] = deathOf(i);
    threadData[T1(i) + 1] = G.alt[i] && G.alt[i].death.age !== deathOf(i) ? 1 : 0;
  }
  threadTex.needsUpdate = true;
}

// ---------- 나무를 세운다 ----------

function setup() {
  const { world, defs } = G;
  G.A0 = NOW - profile.birthYear;
  G.DR = (ROUT - R0) / (END - G.A0);
  G.rules = Array.from({ length: N }, () => ({}));
  G.questions = [];
  G.lives = runAll(world, defs, G.seed, profile);
  // 내기의 선: 통계대로라면 열에 여섯쯤이 넘기는 나이. 너무 쉬워도, 불가능해도 내기가 아니다.
  G.goal = [70, 75, 80, 85, 90, 95]
    .filter((a) => a >= G.A0 + 8)
    .reduce((best, a) => (Math.abs(G.lives.filter((l) => l.death.age >= a).length - 60) < Math.abs(G.lives.filter((l) => l.death.age >= best).length - 60) ? a : best), Math.max(70, Math.min(95, G.A0 + 8)));
  uniforms.uGoal.value = G.goal;
  G.base = G.lives.slice();
  G.alt = new Array(N).fill(null);
  G.graces = Array.from({ length: N }, () => []);
  G.graceLeft = world.events.grace.count;
  G.answers = [];
  G.warnSeen = new Set();
  G.slowUntil = 0;
  perilCache.clear();
  G.vows = [];
  G.lastVow = -99;
  G.vowShown = '';
  $('vows').innerHTML = '';
  threadData.fill(0);
  for (let i = 0; i < N; i++) threadData[T2(i)] = threadData[T2(i) + 1] = threadData[T2(i) + 2] = 0.5;
  uniforms.uAsk.value.set(1000, 1000, 1000);
  G.age = G.passedTo = G.A0;
  lake.reset();
  engrave(profile, G.A0);
  buildTree();
}

function buildTree() {
  const { world, defs } = G;
  G.lay = layout(G.lives, defs, G.A0, END, FAN, new Set(G.questions.map((q) => q.def.id)));
  writeFates();
  if (G.tree) {
    treeG.remove(G.tree);
    G.tree.traverse((o) => o.geometry && o.geometry.dispose());
  }
  const tree = new THREE.Group();
  G.tree = tree;
  treeG.add(tree);
  const rows = END - G.A0;

  // 가지: 실 100가닥. 같은 삶을 사는 동안에는 한 다발로 간다.
  {
    const steps = rows * SUB + 1;
    const count = N * steps * RING;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const aAge = new Float32Array(count);
    const aThread = new Float32Array(count);
    const aTint = new Float32Array(count);
    const aAng = new Float32Array(count);
    const aThick = new Float32Array(count);
    const index = new Uint32Array(N * (steps - 1) * RING * 6);
    let v = 0;
    let t = 0;
    for (let i = 0; i < N; i++) {
      const tint = luck(G.seed, i, 'tint');
      const thickAt = (a) => 0.3 + 0.7 * Math.min(Math.max((Math.log10(luck(G.seed, i, a)) + 2.5) / 2.5, 0), 1);
      for (let k = 0; k < steps; k++) {
        const age = G.A0 + k / SUB;
        const a0 = Math.floor(age);
        const th = thickAt(a0) + (thickAt(a0 + 1) - thickAt(a0)) * (age - a0);
        const rad = 0.026 * th;
        const p = pointAt(i, age);
        const pa = pointAt(i, age - 0.3);
        const pb = pointAt(i, age + 0.3);
        TV.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z).normalize();
        N1.crossVectors(TV, Math.abs(TV.y) > 0.98 ? XA : YA).normalize();
        N2.crossVectors(N1, TV);
        for (let s = 0; s < RING; s++) {
          const ang = (s / RING) * Math.PI * 2;
          const ct = Math.cos(ang);
          const sz = Math.sin(ang);
          const nx = N1.x * ct + N2.x * sz;
          const ny = N1.y * ct + N2.y * sz;
          const nz = N1.z * ct + N2.z * sz;
          position[v * 3] = p.x + nx * rad;
          position[v * 3 + 1] = p.y + ny * rad;
          position[v * 3 + 2] = p.z + nz * rad;
          normal[v * 3] = nx;
          normal[v * 3 + 1] = ny;
          normal[v * 3 + 2] = nz;
          aAge[v] = age;
          aThread[v] = i;
          aTint[v] = tint;
          aAng[v] = ang;
          aThick[v] = (th - 0.3) / 0.7;
          if (k < steps - 1) {
            const a = v;
            const b = i * steps * RING + k * RING + ((s + 1) % RING);
            index[t++] = a; index[t++] = a + RING; index[t++] = b;
            index[t++] = b; index[t++] = a + RING; index[t++] = b + RING;
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
    g.setAttribute('aThick', new THREE.BufferAttribute(aThick, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(g, threadMaterial);
    mesh.frustumCulled = false;
    tree.add(mesh);
  }

  const loadColor = (age) => {
    const q0 = world.q('USA', profile.sex, profile.birthYear + age, age);
    const load = Math.pow(Math.min(Math.max((Math.log10(q0) + 3.3) / 2.3, 0), 1), 0.8);
    return [0.80 + (0.09 - 0.80) * load, 0.74 + (0.15 - 0.74) * load, 0.60 + (0.31 - 0.60) * load];
  };

  // 호와 고리를 만드는 공통 함수: 반지름 r, 각 a0~a1 의 가는 관
  const tubes = (list, material, extra) => {
    const RW = 4;
    let verts = 0;
    let tris = 0;
    for (const it of list) {
      verts += (it.seg + 1) * RW;
      tris += it.seg * RW * 6;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const aCol = new Float32Array(verts * 3);
    const aA = new Float32Array(verts);
    const aB = new Float32Array(verts);
    const index = new Uint32Array(tris);
    let v = 0;
    let t = 0;
    for (const it of list) {
      const start = v;
      for (let x = 0; x <= it.seg; x++) {
        const th = it.a0 + (it.a1 - it.a0) * (x / it.seg);
        const cx = Math.cos(th);
        const cy = Math.sin(th);
        for (let s = 0; s < RW; s++) {
          const ang = (s / RW) * Math.PI * 2;
          const cr = Math.cos(ang);
          const sz = Math.sin(ang);
          position[v * 3] = (it.r + cr * it.w) * cy;
          position[v * 3 + 1] = it.y + sz * it.w;
          position[v * 3 + 2] = (it.r + cr * it.w) * cx;
          normal[v * 3] = cy * cr;
          normal[v * 3 + 1] = sz;
          normal[v * 3 + 2] = cx * cr;
          aCol[v * 3] = it.col[0];
          aCol[v * 3 + 1] = it.col[1];
          aCol[v * 3 + 2] = it.col[2];
          aA[v] = it.a;
          aB[v] = it.b;
          if (x < it.seg) {
            const a = v;
            const b = start + x * RW + ((s + 1) % RW);
            index[t++] = a; index[t++] = b; index[t++] = a + RW;
            index[t++] = b; index[t++] = b + RW; index[t++] = a + RW;
          }
          v++;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
    g.setAttribute(extra[0], new THREE.BufferAttribute(aA, 1));
    if (extra[1]) g.setAttribute(extra[1], new THREE.BufferAttribute(aB, 1));
    const mesh = new THREE.Mesh(g, material);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    mesh.frustumCulled = false;
    tree.add(mesh);
  };

  // 앞으로 올 해의 고리: 나무를 두른 혼천의. 해마다의 고리는 그해가 지나야 생긴다.
  {
    const list = [];
    for (let age = G.A0 + 1; age <= 100; age++) {
      const u = (age - G.A0) / (END - G.A0);
      const kind = age === G.goal ? 2 : age % 10 === 0 ? 1 : 0;
      list.push({ r: ringR(u), a0: -Math.PI, a1: Math.PI, seg: 160, w: kind === 2 ? 0.014 : kind === 1 ? 0.006 : 0.0025, y: crownY(u), col: loadColor(age), a: age, b: kind });
    }
    tubes(list, arcMaterial, ['aRow', 'aKind']);
  }

  // 그루터기 위의 나이테
  {
    const years = G.A0;
    const inner = 0.05;
    const top = trunkR(1) - 0.02;
    const gap = (top - inner) / Math.max(years, 1);
    const list = [];
    for (let y = 0; y < years; y++) list.push({ r: inner + (y + 0.5) * gap, a0: -Math.PI, a1: Math.PI, seg: 72, w: Math.min(0.008, gap * 0.4), y: TRUNK, col: loadColor(y), a: y, b: 0 });
    tubes(list, hubMaterial, ['aYear', 'aBand']);
  }

  // 줄기: 태어난 해가 물가에, 올해가 꼭대기에 있다. 껍질의 빛깔은 그해의 사망 확률이다.
  {
    const RS = 72;
    const years = Math.max(G.A0, 1);
    const rowsN = years * 4 + 1;
    const position = new Float32Array(rowsN * (RS + 1) * 3);
    const normal = new Float32Array(rowsN * (RS + 1) * 3);
    const aCol = new Float32Array(rowsN * (RS + 1) * 3);
    const aYear = new Float32Array(rowsN * (RS + 1));
    const aBand = new Float32Array(rowsN * (RS + 1)).fill(1);
    const index = [];
    let v = 0;
    for (let r = 0; r < rowsN; r++) {
      const h = r / (rowsN - 1);
      const year = h * years;
      const col = loadColor(Math.min(Math.floor(year), years - 1));
      for (let s = 0; s <= RS; s++) {
        const a = (s / RS) * Math.PI * 2;
        // 껍질의 골: 뿌리 쪽은 깊고 위로 갈수록 얕다.
        // 실을 꼬아 올린 듯 나선으로 감긴 껍질
        const bark = 0.055 * Math.sin(a * 7 + h * 13 + Math.sin(a * 3 + h * 2) * 1.2) + 0.018 * Math.sin(a * 19 - h * 23);
        const rr = trunkR(h) * (1 + bark * (1.3 - 0.5 * h));
        position[v * 3] = Math.sin(a) * rr;
        position[v * 3 + 1] = h * TRUNK - 0.25 * (1 - h) * (1 - h);
        position[v * 3 + 2] = Math.cos(a) * rr;
        normal[v * 3] = Math.sin(a);
        normal[v * 3 + 1] = 0.25 * Math.exp(-h * 5.5);
        normal[v * 3 + 2] = Math.cos(a);
        const shade = 0.9 + 3.2 * bark;
        aCol[v * 3] = col[0] * shade;
        aCol[v * 3 + 1] = col[1] * shade;
        aCol[v * 3 + 2] = col[2] * shade;
        aYear[v] = year;
        if (r < rowsN - 1 && s < RS) {
          const p = v;
          const q = v + RS + 1;
          index.push(p, q, p + 1, p + 1, q, q + 1);
        }
        v++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
    g.setAttribute('aYear', new THREE.BufferAttribute(aYear, 1));
    g.setAttribute('aBand', new THREE.BufferAttribute(aBand, 1));
    g.setIndex(index);
    const mesh = new THREE.Mesh(g, hubMaterial);
    mesh.frustumCulled = false;
    tree.add(mesh);
  }

  // 뿌리: 물속으로 내려간다.
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * Math.PI * 2 + 0.3 * Math.sin(k * 7.1);
    const reach = 0.7 + 0.6 * ((k * 37) % 10) / 10;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const rr = 0.45 + reach * Math.pow(t, 0.8);
      const wob = 0.18 * Math.sin(t * 5 + k);
      pts.push(new THREE.Vector3(Math.sin(a + wob * t) * rr, 0.22 - 0.8 * Math.pow(t, 0.9), Math.cos(a + wob * t) * rr));
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 1, 7, false);
    const pos = g.attributes.position;
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let n = 0; n < pos.count; n++) {
      const seg = Math.floor(n / 8);
      const t = seg / 24;
      const c = curve.getPointAt(Math.min(t, 1));
      const w = 0.075 * Math.pow(1 - t, 1.5) + 0.008;
      pos.setXYZ(n, c.x + (pos.getX(n) - c.x) * w, c.y + (pos.getY(n) - c.y) * w, c.z + (pos.getZ(n) - c.z) * w);
    }
    g.computeVertexNormals();
    const yearA = new Float32Array(pos.count).fill(0);
    const colA = new Float32Array(pos.count * 3);
    const c0 = loadColor(0);
    for (let n = 0; n < pos.count; n++) {
      colA[n * 3] = c0[0] * 0.42;
      colA[n * 3 + 1] = c0[1] * 0.38;
      colA[n * 3 + 2] = c0[2] * 0.34;
    }
    g.setAttribute('aYear', new THREE.BufferAttribute(yearA, 1));
    g.setAttribute('aBand', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(colA, 3));
    tree.add(new THREE.Mesh(g, hubMaterial));
  }

  G.knots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a22, roughness: 0.6, side: THREE.DoubleSide }), N);
  G.knots.frustumCulled = false;
  tree.add(G.knots);

  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(N), 1));
    G.embers = new THREE.Points(g, emberMaterial);
    G.embers.frustumCulled = false;
    tree.add(G.embers);
  }

  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(N), 1));
    G.warns = new THREE.Points(g, warnMaterial);
    G.warns.frustumCulled = false;
    tree.add(G.warns);
  }

  // 서원의 자리(고리)와 붙잡은 자리(구슬)
  G.vowMarks = new THREE.InstancedMesh(new THREE.TorusGeometry(0.1, 0.016, 6, 24), gold, 3);
  G.graceMarks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), gold, 3);
  G.vowMarks.frustumCulled = G.graceMarks.frustumCulled = false;
  tree.add(G.vowMarks, G.graceMarks);
  const graced = [];
  for (let i = 0; i < N; i++) for (const g of G.graces[i]) graced.push({ i, age: g.from });
  for (let k = 0; k < 3; k++) {
    const v = G.vows[k];
    const pv = v ? pointAt(v.i, v.target) : null;
    M4.makeScale(v ? 1 : 0, v ? 1 : 0, v ? 1 : 0);
    if (pv) M4.setPosition(pv.x, pv.y, pv.z + 0.05);
    G.vowMarks.setMatrixAt(k, M4);
    const c = graced[k];
    const pg = c ? pointAt(c.i, c.age) : null;
    M4.makeScale(c ? 1 : 0, c ? 1 : 0, c ? 1 : 0);
    if (pg) M4.setPosition(pg.x, pg.y, pg.z + 0.05);
    G.graceMarks.setMatrixAt(k, M4);
  }


  // 꼬리표: 나이 눈금, 내기의 선, 가지가 갈라진 까닭
  const box = $('labels');
  box.innerHTML = '';
  G.labels = [];
  const add = (text, cls, at, fromAge) => {
    const el = document.createElement('span');
    el.textContent = text;
    el.className = cls;
    box.appendChild(el);
    G.labels.push({ el, at, fromAge });
  };
  // 나이는 고리의 왼쪽 앞에 적는다.
  const edge = (age) => {
    const u = (age - G.A0) / (END - G.A0);
    const a = -1.05;
    return new THREE.Vector3(Math.sin(a) * ringR(u), crownY(u), Math.cos(a) * ringR(u));
  };
  for (let age = Math.ceil((G.A0 + 1) / 10) * 10; age <= 100; age += 10) if (age !== G.goal) add(String(age), 'age', edge(age), 0);
  if (G.goal <= 100) add(`${G.goal} · 내기`, 'goal', edge(G.goal), 0);
  for (const v of G.vows) {
    const pv = pointAt(v.i, v.target);
    add(`№${v.i + 1}의 서원`, 'vow', new THREE.Vector3(pv.x, pv.y + 0.22, pv.z + 0.12), v.at);
  }
  // 갈라진 까닭: 가지를 조금 따라간 자리에 적고, 서로 겹치는 것은 큰 가지의 것만 남긴다.
  const placed = [];
  for (const s of [...G.lay.splits].sort((a, b) => b.size - a.size || a.k - b.k)) {
    if (placed.length >= 14) break;
    const p = pointAt(s.i, Math.min(G.A0 + s.k + 7, END - 1));
    if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 1.05)) continue;
    placed.push(p);
    add(s.size > 1 ? `${s.text} · ${s.size}` : s.text, '', new THREE.Vector3(p.x, p.y, p.z + 0.1), G.A0 + s.k + 1);
  }
}

// ---------- 입력 화면 ----------

function readForm() {
  document.querySelectorAll('#form .seg').forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(String(profile[k]) === b.dataset.v)));
  });
}

function formChanged() {
  const before = G.prevEnds;
  setup();
  const ends = G.lives.map((l) => l.death.age);
  if (before) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      if (before[i] !== ends[i]) {
        changed++;
        threadData[T0(i)] = 1;
      }
    }
    $('react').textContent = changed ? `이 정보로 명부 100줄 가운데 ${changed}줄이 다시 적혔다` : '이 정보는 명부의 어느 줄도 바꾸지 않았다';
    if (changed && sound.ready) sound.pluck(Math.floor(Math.random() * N), N, 0.3);
  }
  G.prevEnds = ends;
}

document.querySelectorAll('#form .seg button').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.parentElement.dataset.key;
    const v = b.dataset.v;
    profile[k] = /^\d+$/.test(v) ? Number(v) : v;
    sound.start().then(() => sound.bed('night', 0.42));
    readForm();
    formChanged();
  });
});
$('year').addEventListener('change', () => {
  const y = Math.min(2008, Math.max(1936, Number($('year').value) || 1986));
  $('year').value = y;
  profile.birthYear = y;
  formChanged();
});

// ---------- 책 ----------

/** 지금 명부에서 통계보다 끝이 늦춰진 줄과 앞당겨진 줄의 수 */
function rewritten() {
  let later = 0;
  let earlier = 0;
  for (let i = 0; i < N; i++) {
    if (G.lives[i].death.age > G.base[i].death.age) later++;
    else if (G.lives[i].death.age < G.base[i].death.age) earlier++;
  }
  return { later, earlier };
}

/** 가지마다 답의 모든 조합을 살아 보고, 끝을 늦출 수 있는 줄이 최대 몇 줄인지 센다. */
function bestRewrite() {
  const qs = G.questions;
  let best = 0;
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < 1 << qs.length; m++) {
      const rules = {};
      qs.forEach((q, k) => (rules[q.def.id] = q.def.options[(m >> k) & 1].id));
      if (runThread(G.world, G.defs, G.seed, i, profile, rules).death.age > G.base[i].death.age) {
        best++;
        break;
      }
    }
  }
  return best;
}

function openBook() {
  G.questions = planQuestions(G.defs, G.lives, G.A0);
  G.best = bestRewrite();
  const ages = G.base.map((l) => l.death.age).sort((a, b) => a - b);
  $('bookKicker').textContent = `${profile.birthYear}년생 · 미국 · ${profile.sex === 'F' ? '여성' : '남성'} · ${G.A0}세`;
  $('bookTitle').textContent = '포르투나의 명부';
  $('bookSay').innerHTML = `통계는 지금의 너에게서 뻗어 나갈 100개의 삶이 어떻게 끝나는지를 이미 적어 두었다. 가장 이른 끝은 <b>${ages[0]}세</b>, 절반은 <b>${ages[50]}세</b> 전에 끝난다.`;
  const order = [...Array(N).keys()].sort((a, b) => G.base[a].death.age - G.base[b].death.age);
  $('bookList').innerHTML = order.map((i) => `<li><i>№${i + 1}</i>${lineOf(G.base[i])}</li>`).join('');
  $('bookAsk').textContent = '너는 이 책을 고쳐 쓸 수 있다. 몇 줄의 끝을 더 늦게 고쳐 쓰겠는가.';
  // 내기는 닿을 수 있는 범위 안에서만 건다.
  const room = Math.max(1, G.best);
  const options = [...new Set([0.4, 0.7, 1].map((f) => Math.max(1, Math.ceil(room * f))))];
  G.target = 0;
  $('bookWager').hidden = false;
  $('bookWager').innerHTML = options.map((n, k) => `<button type="button" data-n="${n}" aria-pressed="false">${n}줄${k === options.length - 1 ? ' · 닿을 수 있는 끝' : ''}</button>`).join('');
  $('bookWager').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      G.target = Number(b.dataset.n);
      $('bookWager').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('bookGo').disabled = false;
    };
  });
  $('bookGo').textContent = '나무를 기른다';
  $('bookGo').disabled = true;
  $('bookGo').onclick = startGrowing;
  $('bookAgain').hidden = true;
  $('book').classList.add('show');
}

function startGrowing() {
  $('book').classList.remove('show');
  buildTree(); // 질문의 자리에서 줄기가 갈라지도록 다시 세운다.
  G.qi = 0;
  G.hub = 0;
  G.speed = 0;
  G.state = 'intro';
  $('ledgerList').innerHTML = '';
  $('ledgerCount').textContent = '0';
  $('ledger').classList.add('show');
  $('count').classList.add('show');
  $('grace').classList.add('show');
  $('vows').classList.add('show');
  sound.play('gayageum_a2', { gain: 0.4, rate: 0.75, duration: 6 });
}

function closeBook() {
  const changed = [];
  for (let i = 0; i < N; i++) if (G.base[i].death.age !== G.lives[i].death.age || G.base[i].death.cause !== G.lives[i].death.cause) changed.push(i);
  const later = changed.filter((i) => G.lives[i].death.age > G.base[i].death.age).length;
  const earlier = changed.filter((i) => G.lives[i].death.age < G.base[i].death.age).length;
  $('bookKicker').textContent = '고쳐 쓴 명부';
  const score = later - earlier;
  const used = G.graces.filter((g) => g.length).length;
  const held = G.graces.filter((g, i) => g.length && G.lives[i].death.age > G.base[i].death.age).length;
  const kept = G.vows.filter((v) => v.state === 'kept').length;
  const graceLine = `<br>붙잡은 가지 <b>${used}</b>, 그 가운데 더 산 가지 <b>${held}</b>. 지킨 서원 <b>${kept}</b>, 지키지 못한 서원 <b>${G.vows.length - kept}</b>.`;
  const years = changed.reduce((sum, i) => sum + G.lives[i].death.age - G.base[i].death.age, 0);
  $('bookTitle').textContent = score >= G.target ? '내기를 지켰다' : `${G.target - score}줄이 모자랐다`;
  $('bookSay').innerHTML = `더 늦게 고쳐 쓴 줄 <b>${later}</b>, 더 일찍 끝나게 한 줄 <b>${earlier}</b> · 내기 ${G.target}줄.<br>네 손이 100개의 삶에 ${years >= 0 ? '더한' : '덜어 낸'} 햇수는 <b>${Math.abs(years)}년</b>이다. 나머지 ${N - changed.length}줄은 그대로다.${graceLine}`;
  changed.sort((a, b) => G.base[a].death.age - G.base[b].death.age);
  $('bookList').innerHTML = changed.length
    ? changed.map((i) => `<li class="${G.lives[i].death.age < G.base[i].death.age ? 'late' : ''}"><i>№${i + 1}</i><s>${lineOf(G.base[i])}</s><br><em>${lineOf(G.lives[i])}</em></li>`).join('')
    : '<li>한 줄도 달라지지 않았다. 통계가 쓴 그대로다.</li>';
  $('bookAsk').innerHTML = G.answers.length
    ? '<b>네가 고른 답</b><br>' +
      G.answers
        .map((a) => `${a.age}세 · ${escapeHtml(a.prompt)} → ${escapeHtml(a.options[a.counts[0] >= a.counts[1] ? 0 : 1])}${a.text ? `<br><em>“${escapeHtml(a.text)}”</em>` : ''}`)
        .join('<br>')
    : '';
  $('bookWager').hidden = true;
  $('bookGo').textContent = '나무를 본다';
  $('bookGo').disabled = false;
  $('bookGo').onclick = () => $('book').classList.remove('show');
  $('bookAgain').hidden = false;
  $('book').classList.add('show');
}

$('begin').addEventListener('click', () => {
  sound.start().then(() => sound.bed('night', 0.42));
  $('form').classList.add('gone');
  G.state = 'book';
  openBook();
});

$('bookAgain').addEventListener('click', () => {
  $('book').classList.remove('show');
  $('ledger').classList.remove('show');
  $('count').classList.remove('show');
  $('grace').classList.remove('show');
  $('vows').classList.remove('show');
  $('form').classList.remove('gone');
  $('react').textContent = '';
  G.seed = newSeed();
  G.prevEnds = null;
  G.state = 'form';
  setup();
});

// ---------- 명부 (곁의 줄) ----------

function inscribe(i) {
  const li = document.createElement('li');
  const mark = (G.graces[i].length ? ' · 붙잡았던 가지' : '') + (G.vows.some((v) => v.i === i) ? ' · 서원' : '');
  li.innerHTML = `<b>${G.lives[i].death.year}</b>${G.lives[i].death.age}세 · ${CAUSE_LABEL[G.lives[i].death.cause]}${mark}`;
  li.onclick = () => pluckThread(i, 0.5);
  const list = $('ledgerList');
  list.prepend(li);
  while (list.children.length > 40) list.lastChild.remove();
}

// ---------- 은총과 서원 ----------

/**
 * 붙잡는 손. 그 가지의 삶이 몇 해 동안 덜 위태로워진다. 한 판에 세 번뿐이다.
 * 운(난수)은 그대로이므로, 그 자리가 너무 가늘면 붙잡아도 끊어진다.
 */
function grant(i) {
  if (G.graceLeft <= 0 || !aliveAt(i, G.age) || G.graces[i].length) return false;
  const g = G.world.events.grace;
  const from = Math.floor(G.age);
  G.graces[i].push({ from, to: from + g.years + 1, mult: g.mult }); // 달아오르기 시작한 해부터 끊어질 해까지 덮는다
  G.graceLeft--;
  G.lives[i] = runThread(G.world, G.defs, G.seed, i, profile, G.rules[i], G.graces[i]);
  G.alt[i] = null;
  G.dirty = true;
  regrow();
  threadData[T0(i)] = 1;
  sound.play('gayageum_a2', { gain: 0.5, rate: 2, duration: 3 });
  return true;
}

/**
 * 그 가지가 얼마나 가망 없는가 (0.15 = 아슬아슬하게 모자란 운 … 1 = 가망 없음).
 * 사망 위험을 0.9배, 0.7배, 0.5배, 0.3배로 낮춰 살아 보고, 처음 살아남는 자리를 본다.
 * 은총은 0.7배이므로 앞의 두 단계만 붙잡아서 살릴 수 있다. 화면에는 떨림의 세기로만 드러난다.
 */
const perilCache = new Map();
function peril(i) {
  const d = deathOf(i);
  const key = `${i}:${d}:${G.lives[i].choices.length}`;
  if (perilCache.has(key)) return perilCache.get(key);
  const from = Math.floor(G.age);
  const years = G.world.events.grace.years;
  let level = 4;
  [0.9, 0.7, 0.5, 0.3].some((mult, n) => {
    const life = runThread(G.world, G.defs, G.seed, i, profile, G.rules[i], [{ from, to: from + years + 1, mult }]);
    if (life.death.age > d) level = n;
    return life.death.age > d;
  });
  const value = [0.15, 0.4, 0.65, 0.85, 1][level];
  perilCache.set(key, value);
  return value;
}

/**
 * 서원. 아이가 태어나거나 병을 얻은 해에, 지금대로라면 그 바람에 닿지 못할 가지가 바람을 건다.
 * 바람의 내용은 그 가지에 실제로 일어난 일에서 나온다. 한 판에 세 번까지다.
 */
function seekVows(from, to) {
  for (let a = Math.floor(from) + 1; a <= Math.floor(to); a++) {
    if (G.vows.length >= 3 || a - G.lastVow < 4) continue;
    for (let i = 0; i < N; i++) {
      if (!aliveAt(i, a) || G.vows.some((v) => v.i === i)) continue;
      const entry = G.lives[i].log.find((e) => e.age === a);
      const ev = entry && entry.events.find((e) => e.t === 'child' || e.t === 'illness');
      if (!ev) continue;
      const target = ev.t === 'child' ? a + 20 : a + 10;
      const d = deathOf(i);
      if (d >= target || target - d > 7 || target > 100) continue;
      G.vows.push({ i, target, at: a, text: ev.t === 'child' ? '아이가 스무 살이 될 때까지' : '이 병을 넘기고 십 년만', state: 'open' });
      G.lastVow = a;
      G.dirty = true;
      sound.play('harp_c5', { gain: 0.5, rate: 0.75, duration: 3 });
      break;
    }
  }
  if (G.dirty && G.state !== 'ask') regrow();
}

function updateVows() {
  for (const v of G.vows) {
    if (v.state !== 'open') continue;
    const d = deathOf(v.i);
    if (d < v.target && d + 0.5 <= G.age) v.state = 'broken';
    else if (d >= v.target && G.age >= v.target) v.state = 'kept';
  }
  const shown = G.vows.map((v) => v.i + v.state).join() + '|' + G.graceLeft;
  if (shown === G.vowShown) return;
  G.vowShown = shown;
  $('vows').innerHTML = G.vows.map((v) => `<li class="${v.state}"><b>№${v.i + 1}</b>${v.text} · ${v.target}세</li>`).join('');
  const total = G.world.events.grace.count;
  $('grace').innerHTML = '은총' + Array.from({ length: total }, (_, k) => `<i class="${k < G.graceLeft ? 'on' : ''}"></i>`).join('');
}

// ---------- 진행 ----------

function updateKnots() {
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    const shown = G.age >= d && G.state !== 'form' && G.state !== 'book';
    const s = shown ? Math.min(1, 0.3 + (G.age - d) * 1.4) : 0;
    const p = pointAt(i, d);
    M4.makeScale(s, s, s);
    M4.setPosition(p.x, p.y, p.z);
    G.knots.setMatrixAt(i, M4);
  }
  G.knots.instanceMatrix.needsUpdate = true;
}

function pluckThread(i, gain = 0.5) {
  if (i < 0 || i >= N) return;
  threadData[T0(i)] = 1;
  sound.pluck(i, N, gain);
}

function passed(from, to) {
  const row = Math.floor(to);
  if (row !== G.rowSounded && to < END) {
    G.rowSounded = row;
    if (G.speed < 4.5 || row % 2 === 0) sound.slice('loom', luck(G.seed, 'row', row), { gain: G.speed > 4 ? 0.3 : 0.48, rate: 0.94 + luck(G.seed, 'rate', row) * 0.14, max: 0.7 });
  }
  let n = 0;
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    if (d > from && d <= to) {
      threadData[T0(i)] = 0.7;
      inscribe(i);
      const pd = pointAt(i, d);
      lake.fall(i, pd.x, pd.y, pd.z, G.lives[i].death.age >= G.goal);
      if (n++ < 3) {
        const pan = Math.sin(pd.phi) * 0.7;
        if (luck(G.seed, i, 'snd') < 0.75) sound.slice('snap', luck(G.seed, i, 'snap'), { gain: 0.5, pan, max: 0.9, rate: 0.95 + luck(G.seed, i, 'sr') * 0.2 });
        else sound.play('twig', { gain: 0.45, pan, rate: 0.9 + luck(G.seed, i, 'sr') * 0.3 });
      }
    }
  }
  if (n) $('ledgerCount').textContent = String(N - aliveCount());
  seekVows(from, to);
}

function aliveCount() {
  let n = 0;
  for (let i = 0; i < N; i++) if (aliveAt(i, G.age)) n++;
  return n;
}

function openQuestion() {
  const q = G.questions[G.qi];
  const slot = G.qi;
  let met = 0;
  for (let i = 0; i < N; i++) {
    const a = aliveAt(i, G.age) ? answerOf(G.lives[i], q) : -1;
    G.meets[i] = a >= 0 ? 1 : 0;
    G.ans[i] = a;
    G.alt[i] = null;
    if (a >= 0) met++;
  }
  if (met < 5) return false;
  for (let i = 0; i < N; i++) {
    threadData[T0(i) + 3] = G.meets[i];
    threadData[T2(i) + slot] = G.meets[i] ? G.ans[i] : 0.5;
    if (!G.meets[i]) continue;
    G.rules[i][q.def.id] = q.def.options[G.ans[i]].id;
    G.alt[i] = runThread(G.world, G.defs, G.seed, i, profile, { ...G.rules[i], [q.def.id]: q.def.options[1 - G.ans[i]].id }, G.graces[i]);
  }
  writeFates();
  uniforms.uSlot.value = slot;
  G.answered = false;
  $('qword').textContent = `${G.questions[G.qi].askAge}세`;
  $('qprompt').textContent = q.def.prompt;
  $('reading').textContent = '';
  $('answerText').value = '';
  $('answerForm').classList.remove('wait');
  $('answerForm').hidden = false;
  const box = $('choiceButtons');
  box.querySelectorAll('button').forEach((b) => {
    b.textContent = q.def.options[Number(b.dataset.o)].label;
    b.onclick = () => applyShare(b.dataset.o === '0' ? 1 : 0, null, $('answerText').value.trim());
  });
  box.hidden = false;
  showTally();
  $('ask').classList.add('show', 'asking');
  sound.play('gayageum_a2', { gain: 0.55, duration: 5 });
  return true;
}

function showTally() {
  const q = G.questions[G.qi].def;
  const t = [0, 0];
  for (let i = 0; i < N; i++) if (G.meets[i]) t[G.ans[i]]++;
  $('optA').innerHTML = `<i class="dot warm"></i>${q.options[0].label} · ${t[0]}`;
  $('optB').innerHTML = `<i class="dot cool"></i>${q.options[1].label} · ${t[1]}`;
}

function setAnswer(i, value) {
  if (!G.meets[i] || G.ans[i] === value || !G.alt[i]) return;
  const q = G.questions[G.qi];
  [G.lives[i], G.alt[i]] = [G.alt[i], G.lives[i]];
  G.ans[i] = value;
  G.rules[i][q.def.id] = q.def.options[value].id;
  threadData[T2(i) + G.qi] = value;
  threadData[T1(i)] = deathOf(i);
  threadTex.needsUpdate = true;
  G.dirty = true;
  pluckThread(i, 0.34);
  showTally();
}

// ---------- 주관식 답 ----------

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** share 만큼의 나는 첫째 답을, 나머지는 둘째 답을 따른다. (선택지로 고르면 share 는 1 또는 0 이다.) */
function applyShare(share, reading, text) {
  const q = G.questions[G.qi];
  if (G.state !== 'ask' || G.answered) return;
  for (let i = 0; i < N; i++) {
    if (!G.meets[i]) continue;
    setAnswer(i, rand(G.seed, i, 'answer', q.def.id) < share ? 0 : 1);
  }
  regrow();
  G.answered = true;
  const t = [0, 0];
  for (let i = 0; i < N; i++) if (G.meets[i]) t[G.ans[i]]++;
  G.answers.push({ age: q.askAge, prompt: q.def.prompt, text, reading, options: q.def.options.map((o) => o.label), counts: t });
  $('answerForm').classList.remove('wait');
  $('answerForm').hidden = true;
  $('choiceButtons').hidden = true;
  $('ask').classList.remove('asking');
  $('reading').textContent = reading ? `“${reading}”` : '';
  sound.play('harp_c5', { gain: 0.45, rate: 0.84, duration: 3 });
  clearTimeout(G.autoNext);
  G.autoNext = setTimeout(() => G.state === 'ask' && G.answered && commit(), 6000);
}

// 한 줄을 적고 Enter 를 눌러도 아무 일도 일어나지 않는다. 고르는 것은 버튼이다.
$('answerForm').addEventListener('submit', (e) => e.preventDefault());

/** 답이 바뀌면 그 뒤의 가지 모양도 달라진다. */
function regrow() {
  if (!G.dirty) return;
  G.dirty = false;
  buildTree();
}

function commit() {
  // 자동 진행과 손이 겹쳐도 한 번만 넘어간다.
  if (G.state !== 'ask' || !G.answered) return;
  clearTimeout(G.autoNext);
  $('answerText').blur();
  regrow();
  const v = uniforms.uAsk.value;
  const ages = [v.x, v.y, v.z];
  ages[G.qi] = G.questions[G.qi].askAge;
  v.set(ages[0], ages[1], ages[2]);
  for (let i = 0; i < N; i++) threadData[T0(i) + 3] = 0;
  $('ask').classList.remove('show');
  sound.slice('loom', 0.5, { gain: 0.8, max: 0.9 });
  sound.play('gayageum_a2', { gain: 0.5, rate: 1.5, duration: 4 });
  G.qi++;
  G.state = 'grow';
  G.speed = 0;
}

function hint(text) {
  const el = $('hint2');
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('show', !!text);
}

const V = new THREE.Vector3();
const TV = new THREE.Vector3();
const N1 = new THREE.Vector3();
const N2 = new THREE.Vector3();
const XA = new THREE.Vector3(1, 0, 0);
const YA = new THREE.Vector3(0, 1, 0);
let last = performance.now();
function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  uniforms.uTime.value = now / 1000;

  switch (G.state) {
    case 'form':
      G.hub = G.A0;
      break;
    case 'intro': // 지나온 해의 나이테가 안쪽부터 감긴다.
      G.hub = Math.min(G.A0, G.hub + dt * Math.max(14, G.A0 / 2));
      if (G.hub >= G.A0) G.state = 'grow';
      break;
    case 'grow': {
      // 나무는 저절로 자란다. 누르고 있으면 빨라지고, 붙잡을 만한 가지가 달아오르면 느려진다.
      let want = G.holding ? 6.5 : 2.4;
      // 붙잡을 만한 가지가 처음 달아오를 때만 잠깐 느려진다.
      if (!G.holding && G.graceLeft > 0) {
        for (let i = 0; i < N; i++) {
          const w = threadData[T1(i) + 2];
          if (w > 0.01 && w < 0.45 && !G.warnSeen.has(i)) {
            G.warnSeen.add(i);
            if (now > G.slowUntil + 5000) G.slowUntil = now + 1400; // 한 번 느려진 뒤 5초는 쉬어 간다
          }
        }
        if (now < G.slowUntil) want = 0.5;
      }
      G.speed += (want - G.speed) * Math.min(1, dt * 3);
      G.age += dt * G.speed;
      const q = G.questions[G.qi];
      if (q && G.age >= q.askAge) {
        G.age = q.askAge;
        G.speed = 0;
        G.holding = false;
        if (openQuestion()) G.state = 'ask';
        else G.qi++;
      } else if (G.age >= END) {
        G.age = END;
        G.speed = 0;
        G.holding = false;
        G.state = 'end';
        setTimeout(closeBook, 1800);
      }
      break;
    }
    default:
      break;
  }
  if (G.age > G.passedTo) {
    passed(G.passedTo, G.age);
    G.passedTo = G.age;
  }

  const asking = G.state === 'ask';
  for (let i = 0; i < N; i++) {
    const k = T0(i);
    threadData[k] = threadData[k] > 0.002 ? threadData[k] * Math.pow(0.04, dt) : 0;
    const target = asking && G.meets[i] ? (G.ans[i] === 0 ? 1 : -0.4) : 0;
    threadData[k + 1] += (target - threadData[k + 1]) * Math.min(1, dt * (asking ? 9 : 2.2));
    const left = deathOf(i) + 0.5 - G.age;
    threadData[T1(i) + 2] = G.state === 'grow' && left > 0 && left < 3 && !G.graces[i].length ? peril(i) : 0;
    threadData[T1(i) + 3] = 0;
  }
  for (const v of G.vows) if (v.state !== 'broken') threadData[T1(v.i) + 3] = 1;
  threadTex.needsUpdate = true;
  updateVows();

  uniforms.uEmber.value += ((asking && G.answered ? 1 : 0) - uniforms.uEmber.value) * Math.min(1, dt * (asking ? 3 : 1.2));
  const foresee = G.state === 'form' ? 1 : asking ? 1 : 0;
  uniforms.uForesee.value += (foresee - uniforms.uForesee.value) * Math.min(1, dt * 2.5);
  if (G.embers && uniforms.uEmber.value > 0.01) {
    const pos = G.embers.geometry.attributes.position;
    const on = G.embers.geometry.attributes.aOn;
    for (let i = 0; i < N; i++) {
      on.array[i] = G.meets[i] && G.alt[i] && G.alt[i].death.age !== deathOf(i) ? 1 : 0;
      const p = pointAt(i, deathOf(i) + 0.5);
      pos.array[i * 3] += (p.x - pos.array[i * 3]) * Math.min(1, dt * 7);
      pos.array[i * 3 + 1] += (p.y - pos.array[i * 3 + 1]) * Math.min(1, dt * 7);
      pos.array[i * 3 + 2] = p.z + 0.08;
    }
    pos.needsUpdate = true;
    on.needsUpdate = true;
  }

  if (G.warns) {
    const pos = G.warns.geometry.attributes.position;
    const on = G.warns.geometry.attributes.aOn;
    for (let i = 0; i < N; i++) {
      const w = threadData[T1(i) + 2];
      on.array[i] = w;
      if (w > 0.01) {
        const p = pointAt(i, G.age);
        pos.array[i * 3] = p.x;
        pos.array[i * 3 + 1] = p.y;
        pos.array[i * 3 + 2] = p.z + 0.1;
      }
    }
    pos.needsUpdate = true;
    on.needsUpdate = true;
  }

  // 입력 화면에서는 다 자란 나무를 보여 준다.
  uniforms.uAge.value = G.state === 'form' ? END : G.age;
  uniforms.uHub.value = G.hub;
  if (G.knots) updateKnots();

  // 카메라: 물가에 서서 나무를 올려다본다. 천천히 나무 둘레를 돈다.
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const top = TRUNK + CROWN * 1.22 + 0.5;
  const bottom = -1.4; // 물에 비친 나무가 조금 보이게
  const cy = (top + bottom) / 2;
  const halfH = (top - bottom) / 2;
  const halfW = SPREAD + 1.4;
  const wide = camera.aspect > 1.15;
  const fit = Math.max(halfH / tan, halfW / (tan * camera.aspect));
  if (!Number.isFinite(G.dist)) G.dist = fit;
  if (!Number.isFinite(G.shift)) G.shift = 0;
  G.dist += (fit * (G.state === 'form' && wide ? 1.25 : 1) - G.dist) * Math.min(1, dt * 2);
  const shift = G.state === 'form' && wide ? -G.dist * tan * camera.aspect * 0.3 : 0;
  G.shift = (G.shift || 0) + (shift - (G.shift || 0)) * Math.min(1, dt * 2.5);
  const az = 0.2 * Math.sin(now / 1000 * 0.045) + (G.state === 'end' ? 0.12 * Math.sin(now / 1000 * 0.11) : 0);
  const rx = Math.cos(az);
  const rz = -Math.sin(az);
  camera.position.set(Math.sin(az) * G.dist + rx * G.shift, cy - 0.9, Math.cos(az) * G.dist + rz * G.shift);
  camera.lookAt(rx * G.shift, cy, rz * G.shift);
  camera.updateMatrixWorld();
  emberUniforms.uPx.value = renderer.domElement.height / (2 * tan);
  treeG.updateMatrixWorld();
  lake.update(dt, now / 1000, G.age, (x, z, big) => {
    const pan = Math.max(-0.8, Math.min(0.8, (x * rx + z * rz) / 5));
    sound.play(big ? 'drop_a' : 'drop_b', { gain: big ? 0.5 : 0.38, pan, rate: 0.82 + Math.random() * 0.36 });
  }, G.state === 'form');

  // 꼬리표
  const playing = G.state === 'intro' || G.state === 'grow' || G.state === 'ask' || G.state === 'end';
  const bookOpen = $('book').classList.contains('show');
  for (const lb of G.labels) {
    const on = playing && !bookOpen && G.age >= lb.fromAge;
    if (on) {
      V.copy(lb.at).applyMatrix4(treeG.matrixWorld).project(camera);
      lb.el.style.left = `${(V.x * 0.5 + 0.5) * window.innerWidth}px`;
      lb.el.style.top = `${(-V.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
    lb.el.style.opacity = on ? (lb.fromAge === 0 ? 1 : G.age - lb.fromAge < 14 ? 0.95 : 0.4) : 0;
  }

  const el = $('alive');
  el.classList.toggle('show', playing && !bookOpen);
  if (playing) el.textContent = `${Math.min(Math.floor(G.age), 100)}세 · 살아 있는 나 ${aliveCount()}`;
  if (playing) {
    const w = rewritten();
    $('count').innerHTML = `늦춘 줄<b>${w.later}</b>${w.earlier ? `앞당긴 줄 ${w.earlier} · ` : ''}내기 ${G.target}`;
  }
  if (G.state === 'grow' && G.graceLeft > 0 && !G.holding && threadData.some((x, n) => n >= N * 4 && n < N * 8 && n % 4 === 2 && x > 0.01)) hint('끝이 달아오른 가지를 누르면 붙잡는다 · 잔잔히 떠는 가지일수록 버틴다 · 세 번뿐이다');
  else if (asking && G.answered) hint('불씨는 그 삶이 끝날 자리다 · 눌러서 계속');
  else if (G.state === 'grow' && G.age - G.A0 < 4) hint('나무가 자란다 · 누르고 있으면 빨라진다');
  else hint('');

  lake.render(scene, camera, treeG);
  composer.render();
  requestAnimationFrame(frame);
}

// ---------- 손 ----------

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const drag = { on: false, x: 0, y: 0, moved: 0, last: -1, paint: -1, t0: 0 };
const hold = { timer: 0 };

/** 손가락 아래의 실. only 가 있으면 그 조건에 맞는 실 가운데서 고른다. */
function threadAt(e, only = () => true) {
  if (!G.lay) return -1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const top = G.state === 'end' || G.state === 'form' ? END : G.age;
  let best = -1;
  let bestD = 26;
  for (let i = 0; i < N; i++) {
    if (!only(i)) continue;
    const to = Math.min(top, deathOf(i) + 0.5);
    for (let a = G.A0 + 0.5; a <= to + 0.01; a += 1) {
      const p = pointAt(i, Math.min(a, to));
      V.set(p.x, p.y, p.z).applyMatrix4(treeG.matrixWorld).project(camera);
      const d = Math.hypot((V.x * 0.5 + 0.5) * W - e.clientX, (-V.y * 0.5 + 0.5) * H - e.clientY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

function brush(e) {
  const i = threadAt(e, (j) => G.meets[j] === 1);
  if (i < 0 || i === drag.last) return;
  if (drag.paint < 0) drag.paint = 1 - G.ans[i];
  setAnswer(i, drag.paint);
  drag.last = i;
}

canvas.addEventListener('pointerdown', (e) => {
  if (G.state !== 'grow' && G.state !== 'ask' && G.state !== 'end') return;
  canvas.setPointerCapture(e.pointerId);
  drag.on = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  drag.last = -1;
  drag.paint = -1;
  drag.t0 = performance.now();
  if (G.state === 'grow') {
    G.holding = true;
    G.everHeld = true;
  } else if (G.state === 'ask' && G.answered) {
    commit();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag.on) drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  if (G.state === 'ask') return;
  if (G.state !== 'grow' && G.state !== 'end') return;
  if (e.pointerType !== 'mouse' && !drag.on) return;
  const i = threadAt(e, (j) => aliveAt(j, G.age) || G.state === 'end');
  if (i >= 0 && i !== drag.last) {
    drag.last = i;
    pluckThread(i, 0.4);
  }
});

function release(e) {
  if (!drag.on) return;
  drag.on = false;
  G.holding = false;
  clearTimeout(hold.timer);
  // 짧게 누르면 붙잡는다. 달아오른 가지가 가까이 있으면 그 가지를 먼저 잡는다.
  if (G.state === 'grow' && drag.moved < 8 && performance.now() - drag.t0 < 300 && G.graceLeft > 0) {
    let i = threadAt(e, (j) => aliveAt(j, G.age) && threadData[T1(j) + 2] > 0.01);
    if (i < 0) i = threadAt(e, (j) => aliveAt(j, G.age));
    if (i >= 0) grant(i);
  }
  if (G.state === 'ask') regrow();
  if (G.state === 'end' && drag.moved < 8) {
    const i = threadAt(e);
    if (i >= 0) {
      pluckThread(i, 0.5);
      const tag = $('tag');
      tag.textContent = `№${i + 1} · ${lineOf(G.lives[i])}`;
      tag.style.left = `${Math.min(Math.max(e.clientX, 120), window.innerWidth - 120)}px`;
      tag.style.top = `${e.clientY}px`;
      tag.classList.add('show');
      clearTimeout(tag.timer);
      tag.timer = setTimeout(() => tag.classList.remove('show'), 2600);
    }
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return; // 답을 쓰는 중
  if (G.state === 'grow') {
    e.preventDefault();
    G.holding = true;
    G.everHeld = true;
  } else if (G.state === 'ask' && G.answered) {
    e.preventDefault();
    commit();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') G.holding = false;
});

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  lake.resize();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 확인용
window.__fortuna = { G, profile, setup, commit, setAnswer, regrow, closeBook, grant, applyShare, uniforms, sound, frame, lake, camera, scene, bloom, composer, renderer };

loadGame('.')
  .then(({ world, defs }) => {
    G.world = world;
    G.defs = defs;
    G.seed = new URLSearchParams(location.search).get('seed') || newSeed();
    readForm();
    formChanged();
    G.state = 'form';
    requestAnimationFrame(frame);
  })
  .catch((e) => {
    $('react').textContent = '불러오지 못했습니다: ' + e.message;
  });
