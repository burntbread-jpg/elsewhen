// 소리. 전부 실제 녹음(assets/audio, Freesound CC0)을 재생한다. 합성음은 만들지 않는다.
// 긴 녹음(베틀, 줄 끊어짐)은 소리가 시작되는 지점을 찾아 조각으로 나눠 쓴다.

const FILES = ['loom', 'snap', 'twig', 'harp_c4', 'harp_c5', 'gayageum_a2', 'room', 'cloth'];
const PENTATONIC = [0, 2, 4, 7, 9];

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.slices = {};
    this.ready = false;
    this.recent = [];
  }

  /** 첫 터치에서 부른다. 브라우저는 사용자 동작 뒤에만 소리를 허용한다. */
  async start(base = 'assets/audio') {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    await Promise.all(
      FILES.map(async (name) => {
        try {
          const res = await fetch(`${base}/${name}.mp3`);
          const data = await res.arrayBuffer();
          this.buffers[name] = await this.ctx.decodeAudioData(data);
        } catch (e) {
          // 소리 하나가 없어도 장면은 계속된다.
        }
      })
    );
    for (const name of ['loom', 'snap']) if (this.buffers[name]) this.slices[name] = findOnsets(this.buffers[name]);
    this.ready = true;
    this.room();
  }

  play(name, { rate = 1, gain = 1, pan = 0, offset = 0, duration = null, fade = 0.02 } = {}) {
    const buf = this.buffers[name];
    if (!this.ready || !buf) return;
    const t = this.ctx.currentTime;
    // 한꺼번에 너무 많은 소리가 겹치지 않게 한다.
    this.recent = this.recent.filter((x) => t - x < 0.25);
    if (this.recent.length > 9) return;
    this.recent.push(t);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const len = duration == null ? buf.duration - offset : duration;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + fade);
    g.gain.setValueAtTime(gain, t + Math.max(fade, len / rate - 0.08));
    g.gain.linearRampToValueAtTime(0, t + len / rate);
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(this.master);
    src.start(t, offset, len);
  }

  /** 긴 녹음에서 조각 하나를 골라 재생한다. pick 은 0~1 */
  slice(name, pick, opts = {}) {
    const list = this.slices[name];
    if (!list || !list.length) return this.play(name, opts);
    const s = list[Math.floor(pick * list.length) % list.length];
    this.play(name, { ...opts, offset: s.start, duration: Math.min(s.length, opts.max || 1.2) });
  }

  /** 실 한 가닥의 음. 자리가 오른쪽일수록 높다. 하프 녹음 두 개를 속도만 바꿔 재생한다. */
  pluck(index, total, gain = 0.5) {
    const step = Math.floor((index / total) * 15);
    const semis = 12 * Math.floor(step / 5) + PENTATONIC[step % 5] - 12; // C4 기준
    const high = semis >= 10;
    this.play(high ? 'harp_c5' : 'harp_c4', {
      rate: Math.pow(2, (high ? semis - 12 : semis) / 12),
      gain,
      pan: (index / total) * 1.4 - 0.7,
      duration: 2.6,
      fade: 0.004,
    });
  }

  room() {
    const buf = this.buffers.room;
    if (!buf || this.roomSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 1;
    src.loopEnd = buf.duration - 1;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 3);
    src.connect(g);
    g.connect(this.master);
    src.start();
    this.roomSrc = src;
  }
}

/** 소리가 시작되는 지점들. 10ms 단위 음량이 직전 평균보다 뚜렷이 커지는 곳. */
function findOnsets(buffer) {
  const data = buffer.getChannelData(0);
  const win = Math.floor(buffer.sampleRate * 0.01);
  const env = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += data[i + j] * data[i + j];
    env.push(Math.sqrt(sum / win));
  }
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const floor = peak * 0.12;
  const onsets = [];
  let avg = 0;
  let last = -100;
  for (let i = 0; i < env.length; i++) {
    if (env[i] > floor && env[i] > avg * 2.5 && i - last > 30) {
      onsets.push(i);
      last = i;
    }
    avg = avg * 0.9 + env[i] * 0.1;
  }
  const out = [];
  for (let k = 0; k < onsets.length; k++) {
    const start = Math.max(0, onsets[k] * 0.01 - 0.015);
    const next = k + 1 < onsets.length ? onsets[k + 1] * 0.01 - 0.02 : buffer.duration;
    out.push({ start, length: Math.max(0.15, Math.min(next - start, 1.5)) });
  }
  return out;
}
