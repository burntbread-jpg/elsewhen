// 포르투나의 바퀴. 중심이 오늘의 나이고, 거기서 100가닥의 내가 바큇살처럼 뻗는다.
// 한 해는 둘레를 도는 고리 하나로 짜인다. 화면에 그리는 것은 전부 엔진의 값이다:
//   중심의 촘촘한 고리 = 내가 지나온 해 (그해 미국의 실제 사망 확률로 물들인다)
//   살의 굵기 = 그 나이의 운, 살이 끝나는 자리 = 죽은 나이, 불씨 = 지금 답대로라면 끊어질 자리
//   명부 = 끊어진 살이 한 줄씩 적히는 책, 뒷면 = 살마다 반대 답을 건 100가닥
//
// 손: 바퀴를 돌리면 해가 간다. 질문 앞에서는 훑어서 살마다 답을 바꾼다. 다 짜면 뒤집는다.

import * as THREE from '../../vendor/three.module.min.js';
import { loadGame } from '../load.js';
import { CAUSE_LABEL } from '../narrative.js';
import { Sound } from '../loom/audio.js';
import { THREADS, NOW, runThread, runAll, luck, planQuestions, answerOf } from './sim.js';

THREE.ColorManagement.enabled = false;

const N = THREADS;
const END = 101; // 살이 그려지는 마지막 나이
const R0 = 1.55; // 오늘의 고리
const ROUT = 6.6;
const SUB = 2;
const RING = 5;
const YEARS_PER_TURN = 9;
const angleOf = (i) => (i / N) * Math.PI * 2;

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

const flipG = new THREE.Group(); // 뒤집기
scene.add(flipG);
const wheelG = new THREE.Group(); // 바퀴의 회전
flipG.add(wheelG);

const sound = new Sound();

// 살 한 가닥마다 세 줄: [떨림, 들림, -, 질문을 만나는가] / [끝나는 나이, 답에 따라 끝이 달라지는가] / [질문 1·2·3의 답]
const threadData = new Float32Array(N * 4 * 3);
const threadTex = new THREE.DataTexture(threadData, N, 3, THREE.RGBAFormat, THREE.FloatType);
threadTex.magFilter = threadTex.minFilter = THREE.NearestFilter;
const T0 = (i) => i * 4;
const T1 = (i) => N * 4 + i * 4;
const T2 = (i) => N * 8 + i * 4;

// ---------- 셰이더 ----------

const COMMON = /* glsl */ `
  #define AMP 0.03
  uniform float uAge;
  uniform vec3 uAsk;      // 질문 셋을 물은 나이. 아직 묻지 않은 자리는 아주 큰 값이다.
  uniform sampler2D uThread;
  vec4 row(float j, float v) { return texture2D(uThread, vec2((mod(j, 100.0) + 0.5) / 100.0, v)); }
  // 그 나이에서 이 살이 따르는 가장 최근의 답. 0 = 들린 답, 1 = 누른 답, 0.5 = 답한 적 없음
  float ansAt(float j, float age) {
    vec4 a = row(j, 0.8333);
    float r = 0.5;
    if (age >= uAsk.x && abs(a.r - 0.5) > 0.01) r = a.r;
    if (age >= uAsk.y && abs(a.g - 0.5) > 0.01) r = a.g;
    if (age >= uAsk.z && abs(a.b - 0.5) > 0.01) r = a.b;
    return r;
  }
  // 살 j 와 고리 r 이 만나는 자리에서 고리가 위(+1)인가 아래(-1)인가.
  // 답한 적 없는 살은 평직, 답한 살은 능직이고 답에 따라 사선의 방향이 갈린다.
  float over(float j, float r) {
    float a = ansAt(j, r);
    if (abs(a - 0.5) < 0.01) return mod(j + r, 2.0) < 1.0 ? 1.0 : -1.0;
    float dir = a < 0.5 ? 1.0 : -1.0;
    return mod(j + dir * r + 400.0, 4.0) < 2.0 ? 1.0 : -1.0;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 answerTint(float a) {
    if (abs(a - 0.5) < 0.01) return vec3(1.0);
    return mix(vec3(1.16, 0.97, 0.76), vec3(0.80, 0.94, 1.12), a);
  }
`;

const uniforms = {
  uAge: { value: 0 },
  uAsk: { value: new THREE.Vector3(1000, 1000, 1000) },
  uSlot: { value: 0 },
  uTime: { value: 0 },
  uGrow: { value: 0 },
  uHub: { value: 0 },
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
    varying float vAhead;
    varying float vThick;
    varying float vEnd;
    varying float vAns;
    varying float vNow;
    void main() {
      vec4 info = row(aThread, 0.1667);
      vec4 fate = row(aThread, 0.5);
      vec4 answers = row(aThread, 0.8333);
      float d = fate.r + 0.5;
      vec3 p = position;
      float r0 = floor(aAge);
      float o = mix(over(aThread, r0), over(aThread, r0 + 1.0), smoothstep(0.0, 1.0, fract(aAge)));
      float woven = 1.0 - smoothstep(uAge - 0.6, uAge + 0.4, aAge);
      p.z -= AMP * o * woven;
      float ahead = max(aAge - uAge, 0.0);
      p.z += sin(uTime * 1.1 + aThread * 0.9) * 0.012 * clamp(ahead / 30.0, 0.0, 1.0);
      p.z += info.g * 0.34 * (1.0 - woven) * (0.25 + 0.75 * exp(-ahead / 9.0));
      p.z += info.r * 0.05 * sin(uTime * 55.0 + aThread * 1.7) * sin(3.14159 * clamp((aAge - uAge) / 30.0 + 0.2, 0.0, 1.0));
      vBeyond = aAge - d;
      vSnap = uAge - d;
      if (vBeyond > 0.0 && vSnap > 0.0) p.z -= vSnap * vSnap * 0.03 + vBeyond * vSnap * 0.01;
      vN = normalMatrix * normal;
      vAge = aAge;
      vTint = aTint;
      vAng = aAng;
      vDiff = fate.g;
      vAhead = ahead;
      vThick = aThick;
      vEnd = d;
      vAns = ansAt(aThread, aAge);
      // 지금 고르고 있는 질문의 답. 이 질문을 만나지 않는 살은 0.5 다.
      float cur = uSlot < 0.5 ? answers.r : (uSlot < 1.5 ? answers.g : answers.b);
      vNow = info.a > 0.5 ? cur : 0.5;
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
    varying float vNow;
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
      // 답한 살은 답한 자리부터 빛깔이 갈린다. 고르는 동안에는 아직 짜지 않은 부분에 미리 비친다.
      float choosing = uEmber * step(uAge - 0.5, vAge);
      col *= mix(answerTint(vAns), answerTint(vNow), choosing * step(0.01, abs(vNow - 0.5)));
      float future = 1.0 - 0.45 * smoothstep(0.0, 55.0, vAhead);
      col *= (diff + rim) * future * (0.30 + 0.70 * vThick);
      // 고르는 동안, 이 질문과 상관없는 살은 물러난다.
      col *= 1.0 - 0.5 * choosing * (1.0 - step(0.01, abs(vNow - 0.5)));
      col += uReveal * vDiff * vec3(0.95, 0.52, 0.12) * (0.42 + 0.14 * sin(uTime * 1.6));
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
      float o = mix(over(j0, aRow), over(j0 + 1.0, aRow), smoothstep(0.0, 1.0, fract(aX)));
      p.z += AMP * o;
      vN = normalMatrix * normal;
      vCol = aCol;
      vRow = aRow;
      vXn = aX / 100.0;
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
      float fibre = 0.88 + 0.12 * sin(vAng * 3.0 + vXn * 2400.0);
      gl_FragColor = vec4(vCol * diff * fibre, 1.0);
    }
  `,
});

// 중심: 지나온 해. 안쪽부터 한 해씩 감긴다.
const hubMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aYear;
    attribute float aAng;
    attribute vec3 aCol;
    varying vec3 vN;
    varying vec3 vCol;
    varying float vYear;
    varying float vAng;
    void main() {
      vN = normalMatrix * normal;
      vCol = aCol;
      vYear = aYear;
      vAng = aAng;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uHub;
    varying vec3 vN;
    varying vec3 vCol;
    varying float vYear;
    varying float vAng;
    void main() {
      if (vYear > uHub) discard;
      vec3 n = normalize(vN);
      float diff = 0.36 + 0.64 * max(dot(n, normalize(vec3(-0.35, 0.5, 0.8))), 0.0);
      gl_FragColor = vec4(vCol * diff * (0.9 + 0.1 * sin(vAng * 3.0)), 1.0);
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

// ---------- 고정된 물건 ----------

const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.78 });
const rim = new THREE.Mesh(new THREE.TorusGeometry(ROUT + 0.32, 0.11, 10, 160), wood);
wheelG.add(rim);
const brass = new THREE.MeshStandardMaterial({ color: 0xb08a48, roughness: 0.35, metalness: 0.7, emissive: 0xffa040, emissiveIntensity: 0 });
const fell = new THREE.Mesh(new THREE.TorusGeometry(1, 0.011, 6, 160), brass); // 지금 짜고 있는 자리
wheelG.add(fell);
const shuttle = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.5 }));
shuttle.scale.set(0.2, 0.05, 0.06);
wheelG.add(shuttle);

const plateCanvas = document.createElement('canvas');
plateCanvas.width = plateCanvas.height = 512;
const plateTexture = new THREE.CanvasTexture(plateCanvas);
const plate = new THREE.Mesh(new THREE.CircleGeometry(0.4, 64), new THREE.MeshBasicMaterial({ map: plateTexture }));
plate.position.z = 0.06;
flipG.add(plate); // 판은 바퀴와 함께 돌지 않는다.
const plateBack = plate.clone();
plateBack.position.z = -0.06;
plateBack.rotation.y = Math.PI;
flipG.add(plateBack);

function engrave(profile, age) {
  const g = plateCanvas.getContext('2d');
  const grad = g.createRadialGradient(200, 180, 30, 256, 256, 280);
  grad.addColorStop(0, '#c2a566');
  grad.addColorStop(1, '#6f5830');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(40,28,10,0.5)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(256, 256, 236, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = (s, y, size) => {
    g.font = `500 ${size}px Georgia, "Times New Roman", serif`;
    g.fillStyle = 'rgba(255,240,200,0.45)';
    g.fillText(s, 257, y + 2);
    g.fillStyle = '#2a1e0c';
    g.fillText(s, 256, y);
  };
  text(String(profile.birthYear), 205, 104);
  text(`USA · ${profile.sex} · ${age}`, 318, 50);
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
          vec2 p = vUv - vec2(0.47, 0.53);
          float g = exp(-dot(p, p) * 55.0);
          gl_FragColor = vec4(mix(vec3(0.050, 0.046, 0.040), vec3(0.24, 0.16, 0.08), g), 1.0);
        }`,
    })
  );
  glow.position.z = -5;
  glow.renderOrder = -1;
  scene.add(glow);
}

const dust = (() => {
  const pos = new Float32Array(140 * 3);
  for (let i = 0; i < 140; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 18;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 2] = 0.4 + Math.random() * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe6b8, size: 0.022, transparent: true, opacity: 0.3, depthWrite: false }));
  scene.add(points);
  return points;
})();

// ---------- 상태 ----------

const profile = { country: 'USA', birthYear: 1986, sex: 'F', wealth: 3, edu: 3, job: 'office', partner: 1, children: 0, smoking: 0, drinking: 0, exercise: 0, conscientiousness: 'mid' };

const G = {
  world: null,
  defs: null,
  seed: null,
  A0: 40, // 지금 나이
  DR: 0.08,
  lives: [], // 지금 보이는 면의 100가닥
  front: null, // 뒤집었을 때 돌아올 앞면
  rules: [], // 살마다의 답
  alt: [], // 지금 묻는 질문에 반대로 답했을 때의 삶
  questions: [],
  qi: 0,
  meets: new Uint8Array(N),
  ans: new Int8Array(N),
  cloth: null,
  knots: null,
  embers: null,
  pick: null,
  state: 'load',
  age: 0,
  grow: 0,
  hub: 0,
  omega: 0, // 바퀴의 각속도 (앞으로 도는 쪽이 양수)
  wheel: 0,
  yaw: 0,
  yawTarget: 0,
  back: false,
  flipped: false,
  rowSounded: -1,
  dist: 40,
  spun: false,
  prevEnds: null,
  passedTo: 0,
  other: null,
};

const rOf = (age) => R0 + (age - G.A0) * G.DR;
const deathOf = (i) => G.lives[i].death.age;
const aliveAt = (i, age) => deathOf(i) + 0.5 > age;

function newSeed() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

function writeFates() {
  for (let i = 0; i < N; i++) {
    threadData[T1(i)] = deathOf(i);
    threadData[T1(i) + 1] = G.alt[i] && G.alt[i].death.age !== deathOf(i) ? 1 : 0;
  }
  threadTex.needsUpdate = true;
}

// ---------- 천을 다시 건다 ----------

function build() {
  const { world, defs } = G;
  G.A0 = NOW - profile.birthYear;
  G.DR = (ROUT - R0) / (END - G.A0);
  G.rules = Array.from({ length: N }, () => ({}));
  G.lives = runAll(world, defs, G.seed, profile);
  G.alt = new Array(N).fill(null);
  G.front = null;
  threadData.fill(0);
  for (let i = 0; i < N; i++) {
    threadData[T2(i)] = threadData[T2(i) + 1] = threadData[T2(i) + 2] = 0.5;
  }
  writeFates();

  if (G.cloth) {
    wheelG.remove(G.cloth);
    G.cloth.traverse((o) => o.geometry && o.geometry.dispose());
  }
  const cloth = new THREE.Group();
  G.cloth = cloth;
  wheelG.add(cloth);
  const rows = END - G.A0;

  // 살: 굵기는 그 나이의 운이다.
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
      const th0 = angleOf(i);
      const cx = Math.cos(th0);
      const cy = Math.sin(th0);
      const tint = luck(G.seed, i, 'tint');
      const thickAt = (a) => 0.3 + 0.7 * Math.min(Math.max((Math.log10(luck(G.seed, i, a)) + 2.5) / 2.5, 0), 1);
      for (let k = 0; k < steps; k++) {
        const age = G.A0 + k / SUB;
        const a0 = Math.floor(age);
        const th = thickAt(a0) + (thickAt(a0 + 1) - thickAt(a0)) * (age - a0);
        const rad = 0.03 * th;
        const r = rOf(age);
        for (let s = 0; s < RING; s++) {
          const ang = (s / RING) * Math.PI * 2;
          const ct = Math.cos(ang);
          const sz = Math.sin(ang);
          // 살의 단면: 접선 방향과 z 방향으로 편 원
          position[v * 3] = r * cx - cy * ct * rad;
          position[v * 3 + 1] = r * cy + cx * ct * rad;
          position[v * 3 + 2] = sz * rad;
          normal[v * 3] = -cy * ct;
          normal[v * 3 + 1] = cx * ct;
          normal[v * 3 + 2] = sz;
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
    const mesh = new THREE.Mesh(g, warpMaterial);
    mesh.frustumCulled = false;
    cloth.add(mesh);
  }

  const loadColor = (age) => {
    const q0 = world.q('USA', profile.sex, profile.birthYear + age, age);
    const load = Math.pow(Math.min(Math.max((Math.log10(q0) + 3.3) / 2.3, 0), 1), 0.8);
    return [0.80 + (0.09 - 0.80) * load, 0.74 + (0.15 - 0.74) * load, 0.60 + (0.31 - 0.60) * load];
  };

  // 고리: 앞으로 올 해. 색은 그해의 사망 확률(전망)이다.
  {
    const XS = 300;
    const RW = 4;
    const count = rows * (XS + 1) * RW;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const aRow = new Float32Array(count);
    const aX = new Float32Array(count);
    const aAng = new Float32Array(count);
    const aCol = new Float32Array(count * 3);
    const index = new Uint32Array(rows * XS * RW * 6);
    let v = 0;
    let t = 0;
    for (let k = 0; k < rows; k++) {
      const age = G.A0 + k;
      const r = rOf(age + 0.5);
      const wr = Math.min(0.024, G.DR * 0.26);
      const col = loadColor(age).map((c) => c * 0.92 + 0.06);
      for (let x = 0; x <= XS; x++) {
        const xi = (x / XS) * 100;
        const th0 = (xi / N) * Math.PI * 2;
        const cx = Math.cos(th0);
        const cy = Math.sin(th0);
        for (let s = 0; s < RW; s++) {
          const ang = (s / RW) * Math.PI * 2;
          const cr = Math.cos(ang);
          const sz = Math.sin(ang);
          // 고리의 단면: 반지름 방향과 z 방향으로 편 원
          position[v * 3] = (r + cr * wr) * cx;
          position[v * 3 + 1] = (r + cr * wr) * cy;
          position[v * 3 + 2] = sz * wr;
          normal[v * 3] = cx * cr;
          normal[v * 3 + 1] = cy * cr;
          normal[v * 3 + 2] = sz;
          aRow[v] = age;
          aX[v] = xi;
          aAng[v] = ang;
          aCol[v * 3] = col[0];
          aCol[v * 3 + 1] = col[1];
          aCol[v * 3 + 2] = col[2];
          if (x < XS) {
            const a = v;
            const b = k * (XS + 1) * RW + x * RW + ((s + 1) % RW);
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
    g.setAttribute('aRow', new THREE.BufferAttribute(aRow, 1));
    g.setAttribute('aX', new THREE.BufferAttribute(aX, 1));
    g.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(g, weftMaterial);
    mesh.frustumCulled = false;
    cloth.add(mesh);
  }

  // 중심: 지나온 해. 한 해에 고리 하나, 실제 값으로 물들인다.
  {
    const years = G.A0;
    const XS = 96;
    const RW = 4;
    const inner = 0.46;
    const gap = (R0 - 0.1 - inner) / Math.max(years, 1);
    const count = years * (XS + 1) * RW;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const aYear = new Float32Array(count);
    const aAng = new Float32Array(count);
    const aCol = new Float32Array(count * 3);
    const index = new Uint32Array(years * XS * RW * 6);
    let v = 0;
    let t = 0;
    for (let y = 0; y < years; y++) {
      const r = inner + (y + 0.5) * gap;
      const wr = Math.min(0.02, gap * 0.42);
      const col = loadColor(y);
      for (let x = 0; x <= XS; x++) {
        const th0 = (x / XS) * Math.PI * 2;
        const cx = Math.cos(th0);
        const cy = Math.sin(th0);
        for (let s = 0; s < RW; s++) {
          const ang = (s / RW) * Math.PI * 2;
          const cr = Math.cos(ang);
          const sz = Math.sin(ang);
          position[v * 3] = (r + cr * wr) * cx;
          position[v * 3 + 1] = (r + cr * wr) * cy;
          position[v * 3 + 2] = sz * wr;
          normal[v * 3] = cx * cr;
          normal[v * 3 + 1] = cy * cr;
          normal[v * 3 + 2] = sz;
          aYear[v] = y;
          aAng[v] = ang;
          aCol[v * 3] = col[0];
          aCol[v * 3 + 1] = col[1];
          aCol[v * 3 + 2] = col[2];
          if (x < XS) {
            const a = v;
            const b = y * (XS + 1) * RW + x * RW + ((s + 1) % RW);
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
    g.setAttribute('aYear', new THREE.BufferAttribute(aYear, 1));
    g.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(g, hubMaterial);
    mesh.frustumCulled = false;
    cloth.add(mesh);
  }

  G.knots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.036, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a22, roughness: 0.6 }), N);
  G.knots.frustumCulled = false;
  cloth.add(G.knots);

  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(N), 1));
    G.embers = new THREE.Points(g, emberMaterial);
    G.embers.frustumCulled = false;
    cloth.add(G.embers);
  }

  G.pick = new THREE.Mesh(new THREE.CircleGeometry(ROUT + 0.4, 48), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  cloth.add(G.pick);

  engrave(profile, G.A0);
  G.age = G.A0;
  G.passedTo = G.A0;
  uniforms.uAsk.value.set(1000, 1000, 1000);
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
  build();
  const ends = G.lives.map((l) => l.death.age);
  if (before && before.length === N) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      if (before[i] !== ends[i]) {
        changed++;
        threadData[T0(i)] = 1;
      }
    }
    $('react').textContent = changed ? `이 정보로 100가닥 중 ${changed}가닥의 끝이 달라졌다` : '이 정보는 어느 살의 끝도 바꾸지 않았다';
    if (changed && sound.ready) sound.pluck(Math.floor(Math.random() * N), N, 0.3);
  }
  G.prevEnds = ends;
}

document.querySelectorAll('#form .seg button').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.parentElement.dataset.key;
    const v = b.dataset.v;
    profile[k] = /^\d+$/.test(v) ? Number(v) : v;
    sound.start();
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

$('begin').addEventListener('click', () => {
  sound.start().then(() => sound.play('gayageum_a2', { gain: 0.4, rate: 0.75, duration: 6 }));
  $('form').classList.add('gone');
  G.questions = planQuestions(G.defs, G.lives, G.A0);
  G.qi = 0;
  G.hub = 0;
  G.grow = G.A0;
  G.state = 'intro';
  $('ledgerList').innerHTML = '';
  $('ledgerCount').textContent = '0';
  $('ledger').classList.add('show');
});

// ---------- 명부 ----------

function inscribe(i, top = true) {
  const life = G.lives[i];
  const li = document.createElement('li');
  li.innerHTML = `<b>${life.death.year}</b>${life.death.age}세 · ${CAUSE_LABEL[life.death.cause]}`;
  li.title = `№${i + 1}`;
  li.onclick = () => pluckThread(i, 0.5);
  const list = $('ledgerList');
  if (top) list.prepend(li);
  else list.append(li);
  while (list.children.length > 40) list.lastChild.remove();
}

function rewriteLedger() {
  const list = $('ledgerList');
  list.innerHTML = '';
  const order = [...Array(N).keys()].filter((i) => !aliveAt(i, G.age)).sort((a, b) => deathOf(b) - deathOf(a));
  order.slice(0, 40).forEach((i) => inscribe(i, false));
  $('ledgerCount').textContent = String(order.length);
}

// ---------- 진행 ----------

const M4 = new THREE.Matrix4();
function updateKnots() {
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    const s = G.age >= d && G.state !== 'form' ? Math.min(1, 0.3 + (G.age - d) * 1.4) : 0;
    const r = rOf(d);
    M4.makeScale(s, s, s);
    M4.setPosition(r * Math.cos(angleOf(i)), r * Math.sin(angleOf(i)), 0);
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
    if (G.omega < 1.6 || row % 2 === 0) sound.slice('loom', luck(G.seed, 'row', row), { gain: G.omega > 1.6 ? 0.3 : 0.5, rate: 0.94 + luck(G.seed, 'rate', row) * 0.14, max: 0.7 });
  }
  let n = 0;
  let wrote = false;
  for (let i = 0; i < N; i++) {
    const d = deathOf(i) + 0.5;
    if (d > from && d <= to) {
      threadData[T0(i)] = 0.7;
      inscribe(i);
      wrote = true;
      if (n++ < 3) {
        const pan = Math.cos(angleOf(i) + G.wheel) * 0.7;
        if (luck(G.seed, i, 'snd') < 0.75) sound.slice('snap', luck(G.seed, i, 'snap'), { gain: 0.5, pan, max: 0.9, rate: 0.95 + luck(G.seed, i, 'sr') * 0.2 });
        else sound.play('twig', { gain: 0.45, pan, rate: 0.9 + luck(G.seed, i, 'sr') * 0.3 });
      }
    }
  }
  if (wrote) $('ledgerCount').textContent = String(N - aliveCount());
}

function aliveCount() {
  let n = 0;
  for (let i = 0; i < N; i++) if (aliveAt(i, G.age)) n++;
  return n;
}

/** 질문 앞에 선다. 살마다 지금의 답과, 반대로 답했을 때의 삶을 구한다. */
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
    G.alt[i] = runThread(G.world, G.defs, G.seed, i, profile, { ...G.rules[i], [q.def.id]: q.def.options[1 - G.ans[i]].id });
  }
  writeFates();
  uniforms.uSlot.value = slot;
  $('qword').textContent = q.def.short || q.def.prompt;
  showTally();
  $('ask').classList.add('show');
  sound.play('gayageum_a2', { gain: 0.55, duration: 5 });
  return true;
}

function showTally() {
  const q = G.questions[G.qi].def;
  const t = [0, 0];
  for (let i = 0; i < N; i++) if (G.meets[i]) t[G.ans[i]]++;
  $('optA').textContent = `들린 살 ${t[0]} · ${q.options[0].label}`;
  $('optB').textContent = `누른 살 ${t[1]} · ${q.options[1].label}`;
}

/** 살 하나의 답을 바꾼다. 그 살의 삶이 반대 답의 삶과 자리를 바꾼다. */
function setAnswer(i, value) {
  if (!G.meets[i] || G.ans[i] === value || !G.alt[i]) return;
  const q = G.questions[G.qi];
  [G.lives[i], G.alt[i]] = [G.alt[i], G.lives[i]];
  G.ans[i] = value;
  G.rules[i][q.def.id] = q.def.options[value].id;
  threadData[T2(i) + G.qi] = value;
  threadData[T1(i)] = deathOf(i);
  threadTex.needsUpdate = true;
  pluckThread(i, 0.34);
  showTally();
}

function commit() {
  const v = uniforms.uAsk.value;
  const ages = [v.x, v.y, v.z];
  ages[G.qi] = G.questions[G.qi].askAge;
  v.set(ages[0], ages[1], ages[2]);
  for (let i = 0; i < N; i++) threadData[T0(i) + 3] = 0;
  $('ask').classList.remove('show');
  sound.slice('loom', 0.5, { gain: 0.8, max: 0.9 });
  sound.play('gayageum_a2', { gain: 0.5, rate: 1.5, duration: 4 });
  G.qi++;
  G.state = 'weave';
}

/** 뒷면: 살마다, 답한 모든 질문에 반대로 답한 삶 */
function backLives() {
  return G.rules.map((rules, i) => {
    const flipped = {};
    for (const q of G.questions.slice(0, G.qi)) {
      if (!(q.def.id in rules)) continue;
      flipped[q.def.id] = q.def.options.find((o) => o.id !== rules[q.def.id]).id;
    }
    return runThread(G.world, G.defs, G.seed, i, profile, flipped);
  });
}

function showFace() {
  const years = G.lives.reduce((s, l) => s + (l.death.age - G.A0), 0);
  const changed = G.front && G.other ? G.front.filter((l, i) => l.death.age !== G.other[i].death.age).length : 0;
  $('faceLine').textContent = G.back ? '뒤 · 살마다 반대로 답했다면' : '앞 · 내 손이 짠 바퀴';
  $('faceSub').textContent = G.flipped ? `100가닥이 더 산 햇수 ${years.toLocaleString('ko-KR')} · 끝이 달라진 살 ${changed}` : '↔ 바퀴를 뒤집으면 반대 답이 보인다';
  $('face').classList.add('show');
}

function setFace(back) {
  G.back = back;
  G.lives = back ? G.other : G.front;
  for (let i = 0; i < N; i++) {
    for (let s = 0; s < 3; s++) {
      const a = threadData[T2(i) + s];
      if (Math.abs(a - 0.5) > 0.01) threadData[T2(i) + s] = 1 - a;
    }
    threadData[T1(i)] = deathOf(i);
    threadData[T1(i) + 1] = G.front[i].death.age !== G.other[i].death.age ? 1 : 0;
  }
  threadTex.needsUpdate = true;
  rewriteLedger();
  showFace();
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
  uniforms.uTime.value = now / 1000;

  switch (G.state) {
    case 'form':
      G.hub = G.A0;
      G.grow = END + 1;
      break;
    case 'intro': // 지나온 해가 안쪽부터 감기고, 오늘에서 100가닥이 뻗는다.
      if (G.hub < G.A0) G.hub = Math.min(G.A0, G.hub + dt * Math.max(14, G.A0 / 2.2));
      else if (G.grow < END + 1) G.grow += dt * 34;
      else G.state = 'weave';
      break;
    case 'weave': {
      if (keys.space) G.omega = Math.max(G.omega, 1.1);
      else if (!drag.on) G.omega *= Math.exp(-1.5 * dt);
      G.omega = Math.min(G.omega, 3.2);
      if (!drag.on || keys.space) {
        G.wheel -= G.omega * dt;
        G.age += ((G.omega * dt) / (Math.PI * 2)) * YEARS_PER_TURN;
      }
      const q = G.questions[G.qi];
      if (q && G.age >= q.askAge) {
        G.age = q.askAge;
        G.omega = 0;
        if (openQuestion()) G.state = 'ask';
        else G.qi++;
      } else if (G.age >= END) {
        G.age = END;
        G.omega = 0;
        G.state = 'flip';
        G.front = G.lives;
        G.other = backLives();
        showFace();
      }
      break;
    }
    default:
      break;
  }
  // 손으로 돌린 해는 프레임 사이에 지나가므로, 어디까지 적었는지를 따로 기억한다.
  if (G.age > G.passedTo) {
    passed(G.passedTo, G.age);
    G.passedTo = G.age;
  }

  // 뒤집기
  G.yaw += (G.yawTarget - G.yaw) * Math.min(1, dt * 9);
  const back = G.state === 'flip' && Math.cos(G.yaw) < 0;
  if (back !== G.back) {
    G.flipped = true;
    sound.play('cloth', { gain: 0.7, offset: 1 + Math.random() * 8, duration: 1.3, fade: 0.1 });
    setFace(back);
  }
  if (G.flipped) uniforms.uReveal.value += (1 - uniforms.uReveal.value) * dt * 1.5;

  const asking = G.state === 'ask';
  for (let i = 0; i < N; i++) {
    const k = T0(i);
    threadData[k] = threadData[k] > 0.002 ? threadData[k] * Math.pow(0.04, dt) : 0;
    const target = asking && G.meets[i] ? (G.ans[i] === 0 ? 1 : -0.4) : 0;
    threadData[k + 1] += (target - threadData[k + 1]) * Math.min(1, dt * (asking ? 9 : 2.2));
  }
  threadTex.needsUpdate = true;

  uniforms.uEmber.value += ((asking ? 1 : 0) - uniforms.uEmber.value) * Math.min(1, dt * (asking ? 3 : 1.2));
  if (G.embers && uniforms.uEmber.value > 0.01) {
    const pos = G.embers.geometry.attributes.position;
    const on = G.embers.geometry.attributes.aOn;
    for (let i = 0; i < N; i++) {
      const differs = G.meets[i] && G.alt[i] && G.alt[i].death.age !== deathOf(i);
      on.array[i] = differs ? 1 : 0;
      const r = rOf(deathOf(i) + 0.5);
      const x = r * Math.cos(angleOf(i));
      const y = r * Math.sin(angleOf(i));
      pos.array[i * 3] += (x - pos.array[i * 3]) * Math.min(1, dt * 7);
      pos.array[i * 3 + 1] += (y - pos.array[i * 3 + 1]) * Math.min(1, dt * 7);
      pos.array[i * 3 + 2] = 0.08;
    }
    pos.needsUpdate = true;
    on.needsUpdate = true;
  }

  uniforms.uAge.value = G.state === 'form' || G.state === 'intro' ? G.A0 : G.age;
  uniforms.uGrow.value = G.grow;
  uniforms.uHub.value = G.hub;
  if (G.knots) updateKnots();

  const fellR = rOf(G.age);
  fell.scale.set(fellR, fellR, 1);
  fell.position.z = 0.05;
  fell.visible = G.state === 'weave' || G.state === 'ask';
  brass.emissiveIntensity += ((hold.arming ? 0.9 : 0) - brass.emissiveIntensity) * Math.min(1, dt * 6);
  const rowN = Math.floor(G.age);
  const prog = G.age - rowN;
  shuttle.visible = G.state === 'weave' && G.age < END && G.omega > 0.02;
  const sa = (rowN % 2 === 0 ? prog : 1 - prog) * Math.PI * 2;
  const sr = rOf(rowN + 0.5);
  shuttle.position.set(sr * Math.cos(sa), sr * Math.sin(sa), 0.08);
  shuttle.rotation.z = sa + Math.PI / 2;

  wheelG.rotation.z = G.wheel;
  flipG.rotation.y = G.yaw + Math.sin(now / 5200) * 0.02;
  flipG.rotation.x = -0.08;
  dust.rotation.z = Math.sin(now / 9000) * 0.05;

  // 카메라: 바퀴 전체가 보이게. 입력 화면에서는 입력란 옆으로 비켜 준다.
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const wide = camera.aspect > 1.15;
  const fit = (ROUT + 0.75) / (tan * Math.min(1, camera.aspect));
  G.dist += (fit * (G.state === 'form' && wide ? 1.18 : 1) - G.dist) * Math.min(1, dt * 2);
  const shift = G.state === 'form' && wide ? -G.dist * tan * camera.aspect * 0.3 : 0;
  camera.position.x += (shift - camera.position.x) * Math.min(1, dt * 2.5);
  camera.position.z = G.dist;
  camera.lookAt(camera.position.x, 0, 0);
  emberUniforms.uPx.value = renderer.domElement.height / (2 * tan);

  const el = $('alive');
  const playing = G.state === 'weave' || G.state === 'ask' || G.state === 'flip';
  el.classList.toggle('show', playing);
  if (playing) el.textContent = `${Math.min(Math.floor(G.age), 100)}세 · ${aliveCount()} / ${N}`;
  if (G.state === 'weave' && !G.spun) hint('바퀴를 돌린다');
  else if (G.state === 'ask') hint('훑어서 살을 누르거나 든다 · 가만히 눌러 계속 돌린다');
  else hint('');

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- 손 ----------

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const drag = { on: false, x: 0, y: 0, moved: 0, lastThread: -1, paint: -1, angle: 0, time: 0 };
const hold = { timer: 0, arming: false };
const keys = { space: false };

function threadAt(e) {
  if (!G.pick) return -1;
  ptr.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObject(G.pick)[0];
  if (!hit) return -1;
  const local = G.pick.worldToLocal(hit.point.clone());
  if (Math.hypot(local.x, local.y) < 0.5) return -1;
  let a = Math.atan2(local.y, local.x);
  if (a < 0) a += Math.PI * 2;
  return Math.round((a / (Math.PI * 2)) * N) % N;
}

/** 바퀴 중심에서 본 손가락의 방향 (화면 기준) */
function pointerAngle(e) {
  const c = new THREE.Vector3(0, 0, 0).project(camera);
  const cx = (c.x * 0.5 + 0.5) * window.innerWidth;
  const cy = (-c.y * 0.5 + 0.5) * window.innerHeight;
  return Math.atan2(e.clientY - cy, e.clientX - cx);
}

function cancelHold() {
  clearTimeout(hold.timer);
  hold.arming = false;
}

/** 훑기: 처음 닿은 살의 답을 뒤집고, 같은 획으로 지나는 살에 그 답을 칠한다. */
function brush(e) {
  const i = threadAt(e);
  if (i < 0 || i === drag.lastThread) return;
  let from = drag.lastThread < 0 ? i : drag.lastThread;
  // 둘레를 따라 짧은 쪽으로 지나간 살을 모두 칠한다.
  let d = ((i - from + N + N / 2) % N) - N / 2;
  const step = d >= 0 ? 1 : -1;
  for (let n = 0; n <= Math.abs(d); n++) {
    const j = (from + n * step + N) % N;
    if (!G.meets[j]) continue;
    if (drag.paint < 0) drag.paint = 1 - G.ans[j];
    setAnswer(j, drag.paint);
  }
  drag.lastThread = i;
}

canvas.addEventListener('pointerdown', (e) => {
  if (G.state === 'form' || G.state === 'intro' || G.state === 'load') return;
  canvas.setPointerCapture(e.pointerId);
  drag.on = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.moved = 0;
  drag.lastThread = -1;
  drag.paint = -1;
  drag.angle = pointerAngle(e);
  drag.time = performance.now();
  if (G.state === 'ask') {
    hold.arming = true;
    hold.timer = setTimeout(() => {
      hold.arming = false;
      if (G.state === 'ask' && drag.on) commit();
    }, 650);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag.on) drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
  if (G.state === 'ask') {
    if (drag.on && drag.moved > 10) {
      cancelHold();
      brush(e);
    }
    return;
  }
  if (G.state === 'flip') {
    if (drag.on) G.yawTarget += (e.movementX || 0) * 0.011;
    return;
  }
  if (G.state !== 'weave' || !drag.on) return;
  // 바퀴 돌리기: 시계 방향으로 돌린 만큼 해가 간다. 거꾸로는 돌지 않는다.
  const a = pointerAngle(e);
  let d = a - drag.angle;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  drag.angle = a;
  const t = performance.now();
  const dt = Math.max((t - drag.time) / 1000, 0.004);
  drag.time = t;
  if (d > 0) {
    G.spun = true;
    G.wheel -= d;
    G.age += (d / (Math.PI * 2)) * YEARS_PER_TURN;
    G.omega = G.omega * 0.6 + Math.min(d / dt, 3.2) * 0.4;
  } else {
    G.omega *= 0.8;
  }
});

function release(e) {
  if (!drag.on) return;
  drag.on = false;
  cancelHold();
  if (G.state !== 'flip') return;
  if (drag.moved < 8) {
    const i = threadAt(e);
    if (i >= 0) {
      pluckThread(i, 0.5);
      const life = G.lives[i];
      const tag = $('tag');
      tag.textContent = `№${i + 1} · ${life.death.year} · ${life.death.age}세 · ${CAUSE_LABEL[life.death.cause]}`;
      tag.style.left = `${Math.min(Math.max(e.clientX, 110), window.innerWidth - 110)}px`;
      tag.style.top = `${e.clientY}px`;
      tag.classList.add('show');
      clearTimeout(tag.timer);
      tag.timer = setTimeout(() => tag.classList.remove('show'), 2600);
    }
  } else {
    G.yawTarget = Math.round(G.yawTarget / Math.PI) * Math.PI;
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || G.state === 'form') return;
  e.preventDefault();
  if (G.state === 'ask') commit();
  keys.space = true;
  G.spun = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') keys.space = false;
});

$('again').addEventListener('click', () => {
  G.seed = newSeed();
  G.state = 'form';
  G.back = false;
  G.flipped = false;
  G.yaw = G.yawTarget = 0;
  G.omega = 0;
  G.prevEnds = null;
  uniforms.uReveal.value = 0;
  $('face').classList.remove('show');
  $('ledger').classList.remove('show');
  $('form').classList.remove('gone');
  $('react').textContent = '';
  build();
});

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 확인용
window.__wheel = { G, profile, build, commit, setAnswer, uniforms, sound, formChanged };

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
