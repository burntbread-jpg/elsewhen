// 밤의 호수. 나무는 검은 물 위에 서 있고, 물은 나무를 거꾸로 비춘다.
// 하늘에는 달이 있고, 달 둘레에는 22도 달무리가 바퀴처럼 걸려 있다. 운명의 수레바퀴다.
// 나이가 한 해 흐를 때마다 바퀴가 조금씩 돈다.
// 삶 하나가 끝나면 그 가지 끝에서 씨앗 하나가 떨어져 물에 닿고, 물결이 번지고, 등불이 되어 떠간다.

const MAX_RIPPLES = 16;

export function createLake(THREE, scene, renderer) {
  const N = 100;
  const MOON = new THREE.Vector3(-0.32, 0.2, -0.93).normalize();
  const HORIZON = new THREE.Color(0.05, 0.058, 0.085);
  const shared = {
    uTime: { value: 0 },
    uAge: { value: 0 },
    uMoon: { value: MOON },
    uHorizon: { value: new THREE.Vector3(HORIZON.r, HORIZON.g, HORIZON.b) },
  };

  const NOISE = /* glsl */ `
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  `;

  // ---------- 하늘 ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: shared,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAge;
        uniform vec3 uMoon;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        ${NOISE}
        float stars(vec3 d, float scale, float keep) {
          vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * scale;
          vec2 cell = floor(sp);
          vec2 f = fract(sp) - 0.5 - (vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5) * 0.6;
          float r = h21(cell);
          float tw = 0.65 + 0.35 * sin(uTime * (0.7 + r * 2.6) + r * 61.0);
          return step(keep, r) * exp(-dot(f, f) * 90.0) * tw * (0.4 + 0.6 * fract(r * 13.7));
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zen = vec3(0.006, 0.008, 0.02);
          vec3 col = mix(uHorizon, zen, smoothstep(-0.02, 0.55, h));
          float up = smoothstep(0.0, 0.18, h);
          // 은하수 같은 흐린 띠
          vec3 bandAxis = normalize(vec3(0.55, 0.35, -0.75));
          float band = exp(-pow(dot(d, bandAxis) * 3.2, 2.0));
          float cloud = fbm(vec2(atan(d.z, d.x) * 3.0, d.y * 6.0) + 4.0);
          col += vec3(0.05, 0.05, 0.075) * band * cloud * up * 1.4;
          col += vec3(0.85, 0.9, 1.0) * (stars(d, 110.0, 0.975) * 1.6 + stars(d, 260.0, 0.985) * 0.7) * up * (1.0 - band * 0.3);
          // 달
          float c = dot(d, uMoon);
          float ang = acos(clamp(c, -1.0, 1.0));
          float disc = smoothstep(0.0165, 0.0150, ang);
          vec3 bx = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
          vec3 by = cross(bx, uMoon);
          vec2 mp = vec2(dot(d, bx), dot(d, by)) / 0.0165;
          float maria = fbm(mp * 2.2 + 3.0);
          vec3 moon = vec3(1.3, 1.26, 1.16) * (0.78 + 0.3 * smoothstep(0.35, 0.75, maria)) * (1.0 - 0.25 * dot(mp, mp));
          col = mix(col, moon, disc);
          col += vec3(0.35, 0.38, 0.48) * exp(-ang * 40.0) * 0.4 + vec3(0.1, 0.11, 0.15) * exp(-ang * 5.0) * 0.3;
          // 22도 달무리, 그리고 바퀴살. 나이를 먹을수록 돈다.
          float R = 0.3840;
          float ring = exp(-pow((ang - R) / 0.0055, 2.0)) * 0.16 + exp(-pow((ang - R - 0.012) / 0.02, 2.0)) * 0.05;
          float theta = atan(dot(d, by), dot(d, bx)) + uAge * 0.06;
          float spoke = pow(abs(cos(theta * 4.0)), 260.0) * smoothstep(R, R - 0.02, ang) * smoothstep(0.05, 0.12, ang) * 0.07;
          float hub = exp(-pow((ang - 0.075) / 0.004, 2.0)) * 0.06;
          vec3 halo = vec3(0.78, 0.82, 1.0) * (ring + spoke + hub);
          halo.r += exp(-pow((ang - R + 0.006) / 0.004, 2.0)) * 0.04; // 안쪽 가장자리는 붉게
          col += halo * up;
          if (h < 0.0) col = uHorizon * 0.7;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // ---------- 물 ----------
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const res = new THREE.Vector2(1, 1);
  const waterU = {
    ...shared,
    uRefl: { value: rt.texture },
    uRes: { value: res },
    uRipples: { value: ripples },
    uCam: { value: new THREE.Vector3() },
  };
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(80, 96),
    new THREE.ShaderMaterial({
      uniforms: waterU,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uRefl;
        uniform vec2 uRes;
        uniform float uTime;
        uniform vec3 uMoon;
        uniform vec3 uHorizon;
        uniform vec3 uCam;
        uniform vec4 uRipples[${MAX_RIPPLES}];
        varying vec3 vW;
        ${NOISE}
        void main() {
          vec2 p = vW.xz;
          // 바람 없는 밤의 잔물결
          vec2 g = vec2(0.0);
          g += 0.005 * vec2(sin(p.x * 2.1 + uTime * 0.55 + sin(p.y * 1.3)), cos(p.y * 1.9 - uTime * 0.5 + sin(p.x * 1.7)));
          g += 0.0025 * vec2(sin(p.y * 6.3 + uTime * 1.1), cos(p.x * 5.7 - uTime * 0.9));
          g += 0.006 * (vec2(fbm(p * 0.6 + uTime * 0.05), fbm(p * 0.6 + 9.0 - uTime * 0.04)) - 0.5);
          // 씨앗이 닿은 자리마다 동그란 물결
          for (int k = 0; k < ${MAX_RIPPLES}; k++) {
            vec4 r = uRipples[k];
            float age = uTime - r.z;
            if (age < 0.0 || age > 10.0) continue;
            vec2 dv = p - r.xy;
            float d = length(dv) + 0.0001;
            float front = age * 0.6;
            float width = 0.16 + age * 0.1;
            float env = exp(-pow((d - front) / width, 2.0)) * exp(-age * 0.42) * r.w / (1.0 + d * 1.2);
            g += dv / d * env * cos(d * 24.0 - age * 13.0) * 0.12;
          }
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(uCam - vW);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec2 uv = gl_FragCoord.xy / uRes + g * vec2(0.5, 0.9);
          vec3 refl = min(texture2D(uRefl, uv).rgb, vec3(0.75));
          vec3 col = vec3(0.004, 0.006, 0.01) + refl * (0.42 + 0.55 * fres);
          vec3 H = normalize(uMoon + V);
          // 달빛이 잔물결 위에서 부서져 반짝이는 길
          float glit = pow(vnoise(p * vec2(9.0, 26.0) + vec2(uTime * 0.6, -uTime * 0.9)), 4.0);
          col += vec3(0.8, 0.86, 1.0) * pow(max(dot(n, H), 0.0), 2600.0) * (0.25 + 5.0 * glit);
          float far = smoothstep(14.0, 70.0, length(p));
          col = mix(col, uHorizon * 0.9, far);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // ---------- 물안개: 수면 위에 낮게 깔린 세 겹 ----------
  const mists = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uLayer: { value: k } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uLayer;
          varying vec3 vW;
          ${NOISE}
          void main() {
            vec2 p = vW.xz * 0.22 + vec2(uTime * 0.012 * (1.0 + uLayer), uLayer * 5.3);
            float n = fbm(p + fbm(p * 1.7 - uTime * 0.01));
            float r = length(vW.xz);
            float a = smoothstep(0.42, 0.85, n) * smoothstep(30.0, 9.0, r) * smoothstep(0.6, 2.2, r) * (0.10 - uLayer * 0.025);
            gl_FragColor = vec4(vec3(0.56, 0.62, 0.74), a);
          }`,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.06 + k * 0.17;
    m.renderOrder = 5;
    scene.add(m);
    mists.push(m);
  }

  // ---------- 반딧불: 아직 오지 않은 나들의 기척 ----------
  const FLY = 140;
  {
    const pos = new Float32Array(FLY * 3);
    const seed = new Float32Array(FLY);
    for (let k = 0; k < FLY; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.2 + Math.pow(Math.random(), 0.7) * 7;
      pos[k * 3] = Math.sin(a) * r;
      pos[k * 3 + 1] = 0.25 + Math.random() * 4.5;
      pos[k * 3 + 2] = Math.cos(a) * r;
      seed[k] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const flies = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uPx: { value: 600 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          uniform float uPx;
          varying float vA;
          void main() {
            float t = uTime * (0.15 + aSeed * 0.2) + aSeed * 40.0;
            vec3 p = position + vec3(sin(t * 1.3) * 0.6, sin(t * 0.9 + 1.0) * 0.35, cos(t * 1.1) * 0.6);
            vA = pow(max(sin(uTime * (0.4 + aSeed * 0.5) + aSeed * 30.0), 0.0), 5.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 0.09 * uPx / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = (exp(-r * r * 14.0) + 0.25 * exp(-r * r * 3.0)) * vA;
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.45) * a * 1.6, a);
          }`,
      })
    );
    flies.frustumCulled = false;
    scene.add(flies);
    shared.flyPx = flies.material.uniforms.uPx;
  }

  // ---------- 떨어지는 씨앗과 떠가는 등불 ----------
  const gp = new Float32Array(N * 2 * 3);
  const gc = new Float32Array(N * 2 * 3);
  const gs = new Float32Array(N * 2);
  const glints = new THREE.BufferGeometry();
  glints.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  glints.setAttribute('aCol', new THREE.BufferAttribute(gc, 3));
  glints.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
  const glintPts = new THREE.Points(
    glints,
    new THREE.ShaderMaterial({
      uniforms: { ...shared, uPx: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aCol;
        attribute float aSize;
        uniform float uPx;
        varying vec3 vCol;
        void main() {
          vCol = aCol;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPx / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float r = length(q) * 2.0;
          float core = exp(-r * r * 30.0);
          float halo = exp(-r * r * 4.0) * 0.35;
          float a = core + halo;
          gl_FragColor = vec4(vCol * a, a);
        }`,
    })
  );
  glintPts.frustumCulled = false;
  scene.add(glintPts);

  const falls = new Array(N).fill(null);
  const lanterns = new Array(N).fill(null);
  let head = 0;
  let clock = 0;

  function ripple(x, z, amp) {
    ripples[head].set(x, z, clock, amp);
    head = (head + 1) % MAX_RIPPLES;
  }

  // ---------- 물에 비친 상 ----------
  const mirror = new THREE.PerspectiveCamera();
  mirror.matrixAutoUpdate = false;
  mirror.matrixWorldAutoUpdate = false;
  const flip = new THREE.Matrix4().makeScale(1, -1, 1);

  function resize() {
    renderer.getDrawingBufferSize(res);
    rt.setSize(Math.max(4, Math.floor(res.x * 0.6)), Math.max(4, Math.floor(res.y * 0.6)));
  }
  resize();

  return {
    ripple,

    reset() {
      falls.fill(null);
      lanterns.fill(null);
      for (const r of ripples) r.set(0, 0, -100, 0);
      gs.fill(0);
      glints.attributes.aSize.needsUpdate = true;
    },

    /** 삶 i 가 끝났다. 가지 끝(x, y, z)에서 씨앗이 떨어진다. reached: 내기의 선을 넘긴 삶 */
    fall(i, x, y, z, reached) {
      if (lanterns[i]) return;
      falls[i] = { x, y, z, v: 0, reached, wob: Math.random() * 6 };
    },

    update(dt, t, age, onLand, idle) {
      clock = t;
      shared.uTime.value = t;
      shared.uAge.value = age;
      for (let i = 0; i < N; i++) {
        const f = falls[i];
        const a = i * 3;
        const b = (N + i) * 3;
        if (f) {
          f.v += 3.6 * dt;
          f.y -= f.v * dt;
          f.x += Math.sin(t * 3 + f.wob) * 0.12 * dt;
          gp[a] = f.x;
          gp[a + 1] = Math.max(f.y, 0.02);
          gp[a + 2] = f.z;
          const c = f.reached ? [1.4, 1.05, 0.55] : [1.35, 0.62, 0.3];
          gc[a] = c[0];
          gc[a + 1] = c[1];
          gc[a + 2] = c[2];
          gs[i] = 0.32;
          if (f.y <= 0) {
            ripple(f.x, f.z, f.reached ? 1.2 : 0.9);
            if (onLand) onLand(f.x, f.z, f.reached);
            lanterns[i] = { x: f.x, z: f.z, born: t, reached: f.reached, drift: 0.04 + Math.random() * 0.05, ph: Math.random() * 6 };
            falls[i] = null;
            gs[i] = 0;
          }
        }
        const L = lanterns[i];
        if (L) {
          const r = Math.hypot(L.x, L.z) || 1;
          L.x += (L.x / r) * L.drift * dt + Math.sin(t * 0.3 + L.ph) * 0.02 * dt;
          L.z += (L.z / r) * L.drift * dt + Math.cos(t * 0.27 + L.ph) * 0.02 * dt;
          const life = Math.max(0, t - L.born);
          const glow = 0.35 + 0.65 * Math.exp(-life * 0.25) + 0.08 * Math.sin(t * 2 + L.ph);
          gp[b] = L.x;
          gp[b + 1] = 0.03;
          gp[b + 2] = L.z;
          const c = L.reached ? [1.3, 1.0, 0.55] : [1.2, 0.55, 0.26];
          gc[b] = c[0] * glow;
          gc[b + 1] = c[1] * glow;
          gc[b + 2] = c[2] * glow;
          gs[N + i] = 0.3;
        } else gs[N + i] = 0;
      }
      glints.attributes.position.needsUpdate = true;
      glints.attributes.aCol.needsUpdate = true;
      glints.attributes.aSize.needsUpdate = true;
      for (const m of mists) m.visible = true;
      // 입력 화면에서는 가끔 물방울 하나가 떨어진다. 소리 없이.
      if (idle && Math.random() < dt * 0.25) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 5;
        ripple(Math.sin(a) * r, Math.cos(a) * r, 0.5);
      }
    },

    render(scene_, camera) {
      const px = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      glintPts.material.uniforms.uPx.value = px;
      shared.flyPx.value = px;
      waterU.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      renderer.getDrawingBufferSize(res);
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      mirror.matrixWorld.multiplyMatrices(flip, camera.matrixWorld);
      mirror.matrixWorldInverse.copy(mirror.matrixWorld).invert();
      water.visible = false;
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene_, mirror);
      renderer.setRenderTarget(null);
      water.visible = true;
    },

    resize,
  };
}
