// くじの3D演出(封筒・あみだくじ)。配信画面(overlay.js)の中に iframe で入り、くじの状態を postMessage で受け取って動く
// 結果はアプリ(サーバー)がもう決めている。ここは決まった結果を見せるだけ(演出で確率は変わらない)
// くじはこの画面の前(色を選ぶ画面)で選び終わっている。抽選が始まったら「◯◯ 3チーム競合!!」→ 選んだ順に開け(たどり)→ 当たりで決着 → lots3d-done を親へ
// 見た目・音・紙吹雪・カットインはルーレット(roulette.html)に合わせる
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1920, H = 1080, TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- 効果音(ルーレットと同じ音。Web Audio 合成) ---------- */
class SoundEngine {
  constructor() { this.ctx = null; this.vol = 1; this.silent = false; }
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain(); this.apply();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  apply() { if (this.master) this.master.gain.value = this.silent ? 0 : 0.75 * this.vol; }
  ready() { this.init(); return !!this.ctx; }
  tone(f, { type = 'sine', at = 0, dur = 0.2, g = 0.2, f2 = null, attack = 0.004 } = {}) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), gn = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise({ at = 0, dur = 0.3, g = 0.3, f = 2000, f2 = null, q = 1, type = 'bandpass' } = {}) {
    const c = this.ctx, t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  }
  tick(speed = 1) { if (!this.ready()) return; this.tone(1200 * speed, { type: 'triangle', dur: 0.025, g: 0.13, f2: 350 }); }
  reach(level) {
    if (!this.ready()) return;
    this.noise({ dur: 0.5, g: 0.6, f: 900, f2: 120, type: 'lowpass' });
    this.tone(70, { dur: 0.8, g: 0.7, f2: 35 });
    [110, 164.8, 220, 329.6].forEach((f) => this.tone(f, { type: 'sawtooth', dur: 1.3, g: 0.06, attack: 0.02 }));
    const arp = [440, 554.37, 659.25, 880, 1108.73, 1318.51];
    for (let i = 0; i < 2 + level; i++) this.tone(arp[i % arp.length] * (i >= 6 ? 2 : 1), { type: 'square', at: 0.25 + i * 0.07, dur: 0.25, g: 0.06 });
  }
  gata() {
    if (!this.ready()) return;
    this.tone(90, { type: 'square', dur: 0.25, g: 0.35, f2: 40 });
    this.noise({ dur: 0.35, g: 0.7, f: 500, type: 'lowpass' });
    this.tone(2400, { type: 'triangle', at: 0.02, dur: 0.3, g: 0.08, f2: 1800 });
  }
  kakutei() {
    if (!this.ready()) return;
    [1046.5, 1318.5, 1568, 2093, 2637, 3136, 4186].forEach((f, i) => this.tone(f, { at: i * 0.05, dur: 0.6, g: 0.07 }));
    this.noise({ dur: 1.2, g: 0.15, f: 8000, q: 0.5 });
  }
  holdChange(level) {
    if (!this.ready()) return;
    const base = [784, 880, 988, 1175, 1319, 1568][Math.min(level, 5)];
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone(base * m, { type: 'square', at: i * 0.05, dur: 0.16, g: 0.07 }));
    this.noise({ dur: 0.25, g: 0.12, f: 7000, q: 0.7 });
  }
  stopThud() {
    if (!this.ready()) return;
    this.tone(140, { type: 'triangle', dur: 0.12, g: 0.25, f2: 70 });
    this.tone(900, { type: 'square', dur: 0.05, g: 0.07, f2: 420 });
    this.noise({ dur: 0.06, g: 0.2, f: 2500, q: 1.2 });
  }
  kyuin() {
    if (!this.ready()) return;
    for (let r = 0; r < 2; r++) { this.tone(700, { at: r * 0.32, dur: 0.3, g: 0.16, f2: 2600 }); this.tone(1400, { type: 'square', at: r * 0.32, dur: 0.3, g: 0.04, f2: 5200 }); }
  }
  heartbeat() { if (!this.ready()) return; this.tone(58, { dur: 0.16, g: 0.8, f2: 40 }); this.tone(52, { at: 0.22, dur: 0.2, g: 0.55, f2: 36 }); }
  // 外れ: 止まる音 + 下がる2音
  lose() { if (!this.ready()) return; this.stopThud(); this.tone(523, { type: 'triangle', at: 0.08, dur: 0.25, g: 0.12 }); this.tone(392, { type: 'triangle', at: 0.26, dur: 0.5, g: 0.12 }); }
  // 流れ星: 風を切る音 + きらめき
  shoot(dur) {
    if (!this.ready()) return;
    this.noise({ dur, g: 0.22, f: 900, f2: 5000, q: 0.7 });
    for (let i = 0; i < 10; i++) this.tone(2400 + Math.random() * 2600, { at: i * dur / 10, dur: 0.18, g: 0.025 });
  }
  win(mode) {
    if (!this.ready()) return;
    this.tone(55, { dur: 1.2, g: 0.9, f2: 30 });
    this.noise({ dur: 1.0, g: 0.5, f: 4000, f2: 300, type: 'lowpass' });
    const mel = mode === 'light'
      ? [[523.25, 0], [659.25, .12], [783.99, .24], [1046.5, .36], [987.77, .62], [1046.5, .74], [1318.5, .9], [1568, 1.06]]
      : [[220, 0], [261.63, .14], [329.63, .28], [415.3, .42], [440, .62], [523.25, .78], [659.25, .94], [880, 1.1]];
    mel.forEach(([f, at], i) => {
      const last = i === mel.length - 1;
      this.tone(f, { type: 'sawtooth', at, dur: last ? 2.2 : 0.3, g: 0.07, attack: 0.01 });
      this.tone(f * 2, { type: 'square', at, dur: last ? 2.0 : 0.25, g: 0.03 });
    });
    [261.63, 329.63, 392, 523.25].forEach((f) => this.tone(f, { type: 'sawtooth', at: 1.06, dur: 2.4, g: 0.05, attack: 0.05 }));
    for (let i = 0; i < 14; i++) this.tone(2000 + Math.random() * 3000, { at: 1.1 + i * 0.09, dur: 0.3, g: 0.03 });
  }
}
const sound = new SoundEngine();

/* ---------- 描画の土台(ルーレットと同じ設定) ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true; // 封筒から中袋を少しずつ出すとき、口より下を切る
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 400);
scene.add(camera);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0); keyLight.position.set(-6, 10, 14);
const tierLight = new THREE.PointLight(0xffffff, 0, 40, 1.2); tierLight.position.set(0, 3, 12);
scene.add(new THREE.AmbientLight(0xffffff, 0.35), keyLight, tierLight);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fitHud = () => { $('hud').style.transform = `scale(${innerWidth / W})`; };
addEventListener('resize', fitHud); fitHud();

/* ---------- 背景: ルーレットの「光」の後光(カメラに付けて、画面に対して動かない=酔いにくい目印) ---------- */
const bgU = { uTime: { value: 0 }, uReach: { value: 0 }, uWin: { value: 0 }, uDim: { value: 0 }, uGlow: { value: 0.45 }, uTier: { value: new THREE.Color(1, 1, 1) }, uZebra: { value: 0 }, uAspect: { value: W / H } };
const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  uniforms: bgU, depthWrite: false, depthTest: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform float uTime, uReach, uWin, uDim, uGlow, uAspect, uZebra; uniform vec3 uTier; varying vec2 vUv;
    void main(){
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
      float r = length(p), a = atan(p.y, p.x);
      float spd = 0.15 + uReach * 1.6 + uWin * 0.8;
      float rays = pow(0.5 + 0.5 * sin(a * 14.0 + uTime * spd * 3.0), 4.0) * uGlow;
      float rays2 = pow(0.5 + 0.5 * sin(a * 7.0 - uTime * spd * 2.0), 6.0) * uGlow;
      vec3 col = mix(vec3(0.34, 0.20, 0.05), vec3(0.09, 0.035, 0.005), smoothstep(0.0, 1.7, r));
      col += (rays * 0.16 + rays2 * 0.08) * vec3(1.0, 0.75, 0.35) * (1.0 - smoothstep(0.1, 2.2, r));
      vec3 tier = mix(uTier, vec3(step(0.5, fract((p.x + p.y) * 3.0 + uTime * 0.8))), uZebra);
      col = mix(col, tier * (0.08 + 0.3 * rays), uReach * 0.7);
      vec3 rb = 0.5 + 0.5 * cos(6.2831 * (a / 6.2831 * 2.0 + uTime * 0.35 + vec3(0.0, 0.33, 0.67)));
      col += uWin * (rays * 0.35 + 0.05) * rb;
      col *= 1.0 - uDim * 0.8;
      col *= 1.0 - 0.5 * smoothstep(0.7, 2.3, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
bg.renderOrder = -10; bg.frustumCulled = false;
// ルーレットと同じく、見える範囲の 1.5 倍の板(真ん中の明るいところを大きく見せる)
{ const d = 120, h = 2 * d * Math.tan((camera.fov * Math.PI) / 360) * 1.5; bg.scale.set(h * camera.aspect, h, 1); bg.position.set(0, 0, -d); }
camera.add(bg);

/* ---------- 小さな道具 ---------- */
const now = () => performance.now() / 1000;
let tweens = [];
const ease = { out: (k) => 1 - Math.pow(1 - k, 3), inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2), sine: (k) => 0.5 - 0.5 * Math.cos(Math.PI * k), lin: (k) => k };
function tween(dur, fn, e = 'inOut') { return new Promise((res) => tweens.push({ t0: now(), dur, fn, e: ease[e], res })); }
const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const FONT = (px, w = 900) => `${w} ${px}px 'Noto Sans JP', sans-serif`;
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const goldGrad = (g, y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.45, '#e8b84a'); gr.addColorStop(1, '#8a5a12'); return gr; };
// くじの名札: 金の枠に「①赤」とチーム名
function tagTexture(lot, team) {
  return tex(560, 250, (g, w) => {
    roundRect(g, 6, 6, w - 12, 238, 26); g.fillStyle = 'rgba(20,12,4,.88)'; g.fill(); g.lineWidth = 8; g.strokeStyle = goldGrad(g, 0, 250); g.stroke();
    roundRect(g, w / 2 - 110, 22, 220, 78, 39); g.fillStyle = lot.color; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
    g.fillStyle = '#fff'; g.font = FONT(52); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lot.label, w / 2, 62);
    g.fillStyle = team ? '#ffe9b8' : 'rgba(255,233,184,.6)'; g.font = FONT(team && team.length > 7 ? 46 : 56); g.fillText(team || '？', w / 2, 172);
  });
}
function sprite(texture, w, h) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })); s.scale.set(w, h, 1); return s; }
const haloTex = tex(256, 256, (g) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); });
function halo(color, size) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); s.scale.set(size, size, 1); return s; }
const GOLD = () => new THREE.MeshStandardMaterial({ color: 0xd9a420, metalness: 1, roughness: 0.28 });

/* ---------- 演出の値(ルーレットと同じく、目標へなめらかに寄せる) ---------- */
const fx = { win: 0, winT: 0, dim: 0, dimT: 0, amb: 0.15, ambT: 0.15, bulb: 'idle', shake: 0, freezeUntil: 0 };
// 試作(チェック画面の「試作」で入る): 焦らしと手ごたえ。D.proto のときだけ使う
const proto = () => !!(D && D.proto);
// ヒットストップ: 決まった瞬間に 0.08 秒ほど動きを止め、光と揺れを重ねる(ゲームの「手ごたえ」の定番)
function impact(power = 1) { fx.freezeUntil = now() + 0.08 * power; fx.shake = Math.max(fx.shake, 0.5 * power); flash('#fff', 0.35, 0.6 * power); }
const heartbeats = (n, gap = 0.62) => { for (let i = 0; i < n; i++) setTimeout(() => sound.heartbeat(), i * gap * 1000); };

/* ---------- 火花(ルーレットと同じ粒) ---------- */
const sparkTex = (() => {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S); x.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[S, 6], [6, S]]) { const lg = x.createLinearGradient(S / 2 - w / 2, S / 2 - h / 2, S / 2 + w / 2, S / 2 + h / 2); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = lg; x.fillRect(S / 2 - w / 2, S / 2 - h / 2, w, h); }
  return new THREE.CanvasTexture(c);
})();
class Particles {
  constructor(n, tex) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.base = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: H / (2 * Math.tan((camera.fov * Math.PI) / 360)) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; vC = aColor; vA = aAlpha; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb * t.a * vA, 1.0); }`,
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 4;
  }
  emit(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 1) {
    const i = this.i; this.i = (this.i + 1) % this.n; const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = color.r; this.col[k + 1] = color.g; this.col[k + 2] = color.b;
    this.base[i] = size; this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, dr = Math.pow(this.drag[i], dt * 60);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr + this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, f * 3) * (0.75 + 0.25 * Math.sin(i * 7.1 + this.life[i] * 20));
      this.size[i] = this.base[i] * (0.4 + 0.6 * f);
    }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}
const sparks = new Particles(3000, sparkTex);
scene.add(sparks.points);
const WIN_COLS = [new THREE.Color(2.2, 1.6, 0.5), new THREE.Color(2, 2, 2), new THREE.Color(2.4, 0.6, 0.3)];
function burst(at, n, cols = WIN_COLS, speed = 1, size = 1) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(4, 16) * speed, up = rand(-0.2, 1);
    sparks.emit(at.x, at.y, at.z + 0.5, Math.cos(a) * sp, Math.sin(a) * sp + up * 3, rand(-2, 6), cols[i % cols.length], rand(0.15, 0.45) * size, rand(1.2, 2.6), -7, 0.965);
  }
}
// 期待度の色の火花(HDR にしてブルームで光らせる)
const hdr = (c, k = 2.2) => new THREE.Color(c.r * k, c.g * k, c.b * k);
const AMB = new THREE.Color(2.4, 1.7, 0.6);
function emitAmbient(dt) {
  fx.amb += (fx.ambT - fx.amb) * (1 - Math.exp(-dt * 2.5));
  const vh = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z, vw = vh * camera.aspect;
  let n = 26 * fx.amb * dt;
  while (n > 0) { if (Math.random() < n) sparks.emit(camera.position.x + rand(-vw, vw), camNow.look.y - vh * 1.3, rand(-6, 3), rand(-0.3, 0.3), rand(1, 2.6), 0, AMB, rand(0.07, 0.18), rand(5, 9), 0, 1); n -= 1; }
}

/* ---------- 紙吹雪(ルーレットと同じ。画面に対して降らせるのでカメラに付ける) ---------- */
const CONF_N = 450, CONF_Z = 18;
const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 }), CONF_N);
confetti.frustumCulled = false; confetti.renderOrder = 6;
const conf = Array.from({ length: CONF_N }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
{ const d = new THREE.Object3D(); d.scale.setScalar(0); d.updateMatrix(); for (let i = 0; i < CONF_N; i++) { confetti.setMatrixAt(i, d.matrix); confetti.setColorAt(i, new THREE.Color(1, 1, 1)); } }
const confRoot = new THREE.Group(); confRoot.position.z = -CONF_Z; confRoot.add(confetti); camera.add(confRoot);
const CONF_COLORS = ['#ffd700', '#fff4c0', '#ff3b3b', '#ffffff', '#ffb000', '#ff7ad9'].map((h) => new THREE.Color(h));
const viewHalfHeight = () => Math.tan((camera.fov * Math.PI) / 360) * CONF_Z, viewHalfWidth = () => viewHalfHeight() * camera.aspect;
let confI = 0, confLive = false;
function launchConfetti(n) {
  const vw = viewHalfWidth(), vh = viewHalfHeight();
  for (let k = 0; k < n; k++) {
    const c = conf[confI]; confI = (confI + 1) % CONF_N; c.on = true;
    if (k % 3 === 0) { const side = k % 2 ? 1 : -1; c.p.set(side * vw * 0.95, -vh * 1.1, rand(-2, 4)); c.v.set(-side * rand(3, 9), rand(14, 22), rand(-2, 2)); }
    else { c.p.set(rand(-vw, vw), rand(vh, vh + 7), rand(-3, 6)); c.v.set(rand(-1, 1), rand(-3, -1), 0); }
    c.r.set(rand(0, TAU), rand(0, TAU), rand(0, TAU)); c.w.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    confetti.setColorAt(confI, CONF_COLORS[k % CONF_COLORS.length]);
  }
  confetti.instanceColor.needsUpdate = true; confLive = true;
}
const confDummy = new THREE.Object3D();
function updateConfetti(dt, time) {
  if (!confLive) return;
  let any = false;
  for (let i = 0; i < CONF_N; i++) {
    const c = conf[i]; if (!c.on) continue;
    c.v.y -= 9 * dt; c.v.multiplyScalar(Math.pow(0.985, dt * 60)); if (c.v.y < -2.6) c.v.y = -2.6;
    c.p.addScaledVector(c.v, dt); c.p.x += Math.sin(time * 3 + i) * dt * 0.8;
    c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
    if (c.p.y < -viewHalfHeight() * 1.4) c.on = false; else any = true;
    confDummy.position.copy(c.p); confDummy.rotation.copy(c.r); confDummy.scale.setScalar(c.on ? 1 : 0); confDummy.updateMatrix(); confetti.setMatrixAt(i, confDummy.matrix);
  }
  confetti.instanceMatrix.needsUpdate = true; confLive = any;
}

/* ---------- 画面の上の文字 ---------- */
let D = null;
function showResult(team, on) {
  if (on) { $('result-nm').textContent = `指名：${D.player.name}`; $('result-who').textContent = team; }
  $('result').classList.toggle('show', on);
}
function flash(color = '#fff', dur = 0.5, op = 0.9) { const f = $('flash'); f.style.background = color; f.style.setProperty('--fd', `${dur}s`); f.style.setProperty('--fo', op); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
// カットイン(ルーレットと同じ帯と文字)
function cutin(text, cls, { dur = 1400, sub = '', small = false, color = null } = {}) {
  const el = document.createElement('div');
  el.className = `cutin ${cls}${small ? ' small' : ''}`;
  if (color) {
    const c = new THREE.Color(color), hi = `#${c.clone().lerp(new THREE.Color('#fff'), 0.35).getHexString()}`, lo = `#${c.clone().multiplyScalar(0.45).getHexString()}`;
    el.style.setProperty('--band', `linear-gradient(180deg, ${hi}, ${color} 50%, ${lo})`);
    el.style.setProperty('--glow', color);
    el.style.setProperty('--txt', `linear-gradient(180deg, #fff, ${hi} 45%, ${color} 60%, ${lo})`);
  }
  el.style.setProperty('--d', `${dur}ms`);
  el.innerHTML = `<div class="band"></div><div class="wrap"><div class="main"></div>${sub ? '<div class="sub"></div>' : ''}</div>`;
  el.querySelector('.main').textContent = text;
  if (sub) el.querySelector('.sub').textContent = sub;
  const band = el.querySelector('.band');
  for (let i = 0, n = small ? 7 : 14; i < n; i++) {
    const st = document.createElement('i');
    st.style.top = `${5 + Math.random() * 90}%`; st.style.width = `${8 + Math.random() * 22}%`;
    st.style.setProperty('--sd', `${0.25 + Math.random() * 0.35}s`); st.style.animationDelay = `${-Math.random()}s`; st.style.opacity = 0.4 + Math.random() * 0.6;
    band.appendChild(st);
  }
  $('fx').appendChild(el);
  return sleep(dur / 1000).then(() => el.remove());
}
// 開ける(たどる)前のカットイン: チーム名を、選んだくじの色で
function teamCutin(lot, team, last = false) {
  if (last && proto()) { sound.kakutei(); sound.holdChange(5); flash('#fff', 0.5, 0.7); return cutin(team, 't-rainbow', { dur: 1700, sub: '残り物には福がある!!', small: team.length > 7 }); }
  sound.holdChange(1); return cutin(team, 't-gold', { dur: 1200, small: team.length > 7, color: lot.color });
}
// 最後に残った1チームか(それまで全部外れ)
const isLast = (lot) => D.order.indexOf(lot) === D.lots.length - 1;
// 開幕: 指名された選手と競合数(ルーレットと同じ)
function intro(d) { sound.reach(2); return cutin(d.player.name, 't-gold', { dur: 1500, sub: `${d.lots.length}チーム競合!!`, small: d.player.name.length > 8 }); }
// 当たり: ルーレットの決着と同じ音・光・紙吹雪
function finish(at, team, size = 1) {
  sound.kyuin(); setTimeout(() => sound.win('light'), 250);
  flash('#fff', 0.8, 1);
  fx.winT = 1; fx.ambT = 5; fx.bulb = 'win';
  burst(at, 450, WIN_COLS, size, size); launchConfetti(300);
  setTimeout(() => { if (fx.winT) { burst(at, 250, WIN_COLS, size, size); launchConfetti(150); } }, 900);
  setTimeout(() => { if (fx.winT) launchConfetti(150); }, 1900);

  return sleep(0.35).then(() => showResult(team, true));
}

/* ---------- カメラ: なめらかに(フレームの速さに左右されない減衰で)目標へ。回さない ---------- */
const cam = { pos: new THREE.Vector3(0, 3, 14), look: new THREE.Vector3(0, 1, 0) };
const camNow = { pos: cam.pos.clone(), look: cam.look.clone() };
function camTo(pos, look, dur = 1) { const p0 = cam.pos.clone(), l0 = cam.look.clone(); return tween(dur, (k) => { cam.pos.lerpVectors(p0, pos, k); cam.look.lerpVectors(l0, look, k); }, 'sine'); }
function camSet(v) { cam.pos.copy(v.pos); cam.look.copy(v.look); camNow.pos.copy(v.pos); camNow.look.copy(v.look); }

/* ---------- 世界を作り直す ---------- */
let world = null;
function clearWorld() {
  if (world) { world.cancel = true; scene.remove(world.root); }
  world = null; tweens = []; meteors.clear(); showResult('', false); fx.winT = fx.win = 0; fx.dimT = 0; fx.bulb = 'idle'; fx.ambT = 0.15; tierLight.intensity = 0;
  $('fx').innerHTML = '';
}
function onData(d) {
  D = d;
  if (!world || world.id !== d.id || world.mode !== d.mode) {
    clearWorld();
    world = d.mode === 'amida' ? buildAmida(d) : buildEnvelope(d);
    world.id = d.id; world.mode = d.mode; world.running = false;
    // 決着済み(配信画面を開き直した等)なら、終わった姿で出す。まだなら最初から演出する
    if (d.done) { world.applyStatic(d); world.played = d.opened; } else { world.played = 0; }
  }
  d.owners.forEach((o, i) => world.setOwner(i, o));
  if (!world.running && !d.done && d.opened > world.played) run(world, d);
}
async function run(w, d) {
  w.running = true;
  const alive = () => !w.cancel;
  if (w.played === 0) { await intro(d); if (w.afterIntro && alive()) await w.afterIntro(); }
  for (let k = w.played; k < d.opened && alive(); k++) {
    const lot = d.order[k];
    await w.open(lot, lot === d.winLot);
    w.played = k + 1;
  }
  if (alive()) parent.postMessage({ type: 'lots3d-done', id: d.id }, '*');
  w.running = false;
}

/* ================= 封筒(のし袋の見た目) ================= */
const washi = (w, h, draw) => tex(w, h, (g) => {
  g.fillStyle = '#f6f0e2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${170 + Math.random() * 40},${150 + Math.random() * 40},${120 + Math.random() * 30},${0.06 + Math.random() * 0.08})`; g.lineWidth = 0.6 + Math.random() * 1.2; const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14 + 6, x + Math.cos(a) * 30, y + Math.sin(a) * 30); g.stroke(); }
  const v = g.createLinearGradient(0, 0, w, 0); v.addColorStop(0, 'rgba(0,0,0,.06)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(0,0,0,.08)'); g.fillStyle = v; g.fillRect(0, 0, w, h);
  draw && draw(g, w, h);
});
function frontTexture(lot, i) {
  return washi(420, 740, (g, w) => {
    g.fillStyle = '#1b1410'; g.font = FONT(180); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('①②③④⑤⑥⑦⑧⑨⑩⑪⑫'[i], w / 2, 330);
    g.fillStyle = lot.color; g.font = FONT(64); g.fillText(lot.name, w / 2, 455);
  });
}
// 折り返し(ふた): 右上に熨斗、下の縁に影
const flapTexture = () => washi(256, 140, (g, w, h) => {
  g.save(); g.translate(w - 40, 62); g.rotate(-0.12); g.scale(0.62, 0.62);
  g.fillStyle = '#b8261e'; g.beginPath(); g.moveTo(0, -46); g.lineTo(26, -20); g.lineTo(26, 40); g.lineTo(0, 58); g.lineTo(-26, 40); g.lineTo(-26, -20); g.closePath(); g.fill();
  g.fillStyle = '#f2d36b'; g.fillRect(-7, -30, 14, 70); g.restore();
  const sh = g.createLinearGradient(0, h - 14, 0, h); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,40,20,.35)'); g.fillStyle = sh; g.fillRect(0, h - 14, w, 14);
});
// 水引(くじの色の紐 + 金の紐、あわじ結び)
function mizuhikiTexture(color) {
  return tex(420, 220, (g, w, h) => {
    const cords = [color, color, '#f2d36b', color, color];
    cords.forEach((c, k) => { const y = 60 + k * 14; g.strokeStyle = c; g.lineWidth = 9; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y - 2); g.lineTo(w, y - 2); g.stroke(); });
    g.lineWidth = 9;
    for (const [dx, sc] of [[-58, 1], [58, 1], [0, 0.8]]) cords.forEach((c, k) => { g.strokeStyle = c; g.beginPath(); g.ellipse(w / 2 + dx, 88, (46 - k * 5) * sc, (52 - k * 5) * sc, 0, 0, Math.PI * 2); g.stroke(); });
    cords.forEach((c, k) => { g.strokeStyle = c; g.beginPath(); g.moveTo(w / 2 - 20 + k * 8, 120); g.lineTo(w / 2 - 70 + k * 10, h - 6); g.moveTo(w / 2 + 20 - k * 8, 120); g.lineTo(w / 2 + 70 - k * 10, h - 6); g.stroke(); });
  });
}
const PAPER = 0xb9b0a0;
const FLAP = -Math.PI * 1.12; // 開いたふたの角度(少し後ろへ倒す。中袋の前をふさがない)
function buildEnvelope(d) {
  const root = new THREE.Group(); scene.add(root);
  const n = d.lots.length, gap = n <= 3 ? 2.3 : n <= 4 ? 2.2 : n <= 8 ? 2.0 : 1.7, BW = 1.3, BH = 2.3, MZY = -BH * 0.27;
  const envs = d.lots.map((lot, i) => {
    const x = (i - (n - 1) / 2) * gap, z = 0;
    const g = new THREE.Group(); g.position.set(x, BH / 2 + 0.25, z); root.add(g);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.22, 40), GOLD()); ped.position.set(x, 0.11, z); root.add(ped);
    const front = new THREE.MeshStandardMaterial({ map: frontTexture(lot, i), color: PAPER, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
    const back = new THREE.MeshStandardMaterial({ map: washi(256, 440), color: PAPER, roughness: 0.9, envMapIntensity: 0.5 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(BW, BH, 0.07), [back, back, back, back, front, back]));
    const pivot = new THREE.Group(); pivot.position.set(0, BH / 2, 0.045); g.add(pivot);
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH * 0.3), new THREE.MeshStandardMaterial({ map: flapTexture(), color: PAPER, roughness: 0.85, envMapIntensity: 0.5, side: THREE.DoubleSide }));
    flap.position.y = -BH * 0.15; pivot.add(flap);
    const mz = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.04, BW * 0.54), new THREE.MeshStandardMaterial({ map: mizuhikiTexture(lot.color), transparent: true, roughness: 0.4, metalness: 0.3 }));
    mz.position.set(0, MZY, 0.05); g.add(mz);
    // 開けた瞬間だけ光る(残さない)
    const glow = halo(0xffffff, 6); glow.position.set(0, BH * 0.5, 0.2); g.add(glow);
    const light = new THREE.PointLight(0xffffff, 0, 3, 1.6); light.position.set(0, BH * 0.5, 0.9); g.add(light);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.86, BH * 0.62), new THREE.MeshStandardMaterial({ color: 0xd2cabb, transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.5 }));
    card.position.set(0, 0, 0.01); g.add(card);
    const tw = Math.min(gap * 0.68, 1.55);
    const tag = sprite(tagTexture(lot, d.owners[i]), tw, tw * 0.446); tag.position.set(x, 0.02, z + 1.25); tag.renderOrder = 5; tag.material.depthTest = false; root.add(tag);
    return { g, pivot, mz, glow, light, card, tag, lot, x, z, team: d.owners[i], base: g.position.clone(), open: false };
  });
  // 全体: 名札から、上に出た中袋までが入る高さ。チームが多いときは横幅に合わせて引く
  const fit = n * gap + 1.2, tanH = Math.tan((17.5 * Math.PI) / 180);
  const overview = () => { const dist = Math.max(5.1 / 2 / tanH, fit / 2 / tanH / (W / H)); return { pos: new THREE.Vector3(0, 2.0, dist), look: new THREE.Vector3(0, 1.7, 0) }; };
  // 開けるとき: その封筒に寄る(横にずれるだけで回さない)
  const zoom = (e) => ({ pos: new THREE.Vector3(e.x * 0.85, 2.2, Math.min(6.6, overview().pos.z * 0.8)), look: new THREE.Vector3(e.x, 2.0, 0) });
  camSet(overview());
  const cardTex = (win) => tex(360, 460, (c, w, h) => {
    roundRect(c, 4, 4, w - 8, h - 8, 18);
    if (win) { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#e8b84a'); gr.addColorStop(1, '#a86f12'); c.fillStyle = gr; } else c.fillStyle = '#efe8da';
    c.fill(); c.lineWidth = 10; c.strokeStyle = win ? '#9a1a0e' : '#bfb5a4'; c.stroke();
    c.fillStyle = win ? '#7a0d08' : '#6a6258'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (win) { c.font = FONT(78); c.fillText('交渉権', w / 2, h / 2 - 50); c.fillText('確定', w / 2, h / 2 + 50); } else { c.font = FONT(110); c.fillText('外れ', w / 2, h / 2); }
  });
  function setOpenStatic(e, win) { e.mz.visible = false; e.pivot.rotation.x = FLAP; e.card.material.map = cardTex(win); e.card.material.opacity = 1; e.card.material.needsUpdate = true; e.card.position.set(0, 1.05, 0.1); e.open = true; }
  // 残りの封筒をまとめて開ける(当たりが出たあと)
  function openRest() { envs.filter((x) => !x.open).forEach((x, k) => setTimeout(() => {
    x.card.material.map = cardTex(false); x.card.material.needsUpdate = true; sound.tick(0.8);
    tween(0.5, (q) => { x.mz.material.opacity = 1 - q; x.pivot.rotation.x = FLAP * q; x.card.material.opacity = q; x.card.position.set(0, q * 1.05, 0.01 + q * 0.09); }, 'out').then(() => { x.mz.visible = false; });
    x.open = true;
  }, k * 220)); }
  return {
    root,
    setOwner(i, team) { const e = envs[i]; if (e.team === team) return; e.team = team; e.tag.material.map = tagTexture(e.lot, team); e.tag.material.needsUpdate = true; },
    applyStatic(dd) { for (let k = 0; k < dd.opened; k++) setOpenStatic(envs[dd.order[k]], dd.order[k] === dd.winLot); if (dd.done) envs.forEach((e, i) => { if (!e.open) setOpenStatic(e, i === dd.winLot); }); },
    async open(lot, win) {
      const e = envs[lot], team = D.owners[lot], c = new THREE.Color(e.lot.color);
      const top = new THREE.Vector3(); e.g.localToWorld(top.set(0, 2.3 * 0.5, 0.2));

      // 1. この封筒が少し浮いて、カメラが寄る
      const zm = zoom(e), ov = overview();
      await Promise.all([camTo(zm.pos, zm.look, 0.6), tween(0.6, (k) => { e.g.position.y = e.base.y + k * 0.3; }, 'sine')]);
      // 2. チーム名のカットイン(選んだくじの色)
      await teamCutin(e.lot, team, isLast(lot));
      // 3. ためて、震える(試作: 心音2つぶん、止まってもう一度)
      if (proto()) {
        heartbeats(2);
        await tween(0.55, (k) => { e.g.rotation.z = Math.sin(now() * 40) * 0.018 * Math.sin(k * Math.PI); }, 'lin');
        await sleep(0.25);
        await tween(0.45, (k) => { e.g.rotation.z = Math.sin(now() * 46) * 0.026 * k; }, 'lin');
      } else await tween(0.5, (k) => { e.g.rotation.z = Math.sin(now() * 40) * 0.02 * k; }, 'lin');
      e.g.rotation.z = 0;
      // 4. 開ける: 一瞬だけくじの色で光り、火花があふれる(光は残さない)
      sound.gata(); flash('#fff', 0.3, 0.45);
      e.glow.material.color.copy(c); e.light.color.copy(c);
      const cols = [hdr(c), hdr(c, 1.4), new THREE.Color(2, 2, 2)];
      for (let i = 0; i < 140; i++) { const a = rand(0.2, Math.PI - 0.2), sp = rand(2, 6.5); sparks.emit(top.x + rand(-0.4, 0.4), top.y, top.z + 0.3, Math.cos(a) * sp, Math.sin(a) * sp, rand(-0.5, 2), cols[i % cols.length], rand(0.05, 0.14), rand(0.7, 1.4), -6, 0.96); }
      tween(0.6, (k) => { const f = 1 - k; e.glow.material.opacity = f * 0.7; e.glow.scale.setScalar(3 + k * 3); e.light.intensity = f * 5; }, 'out');
      await tween(0.45, (k) => { e.mz.position.y = MZY - k * 0.6; e.mz.material.opacity = 1 - k; e.pivot.rotation.x = FLAP * ease.out(k); }, 'lin');
      e.mz.visible = false;
      // 5. 中袋が上がる
      e.card.material.map = cardTex(win); e.card.material.needsUpdate = true;
      if (proto()) {
        // 絞り: ゆっくり少しだけ出て(ふちの色がのぞく)、止まって、一気に出る
        heartbeats(3, 0.5);
        // 中袋は封筒の口から出す: 口より下は切り取って見せない(上のふちだけがのぞく)
        const mouth = new THREE.Vector3(); e.g.localToWorld(mouth.set(0, 2.3 / 2, 0));
        e.card.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -mouth.y)]; e.card.material.needsUpdate = true;
        e.card.material.opacity = 1; e.card.position.set(0, 0, 0.12);
        await tween(1.1, (k) => { e.card.position.y = k * 0.62; }, 'sine');
        await tween(0.5, (k) => { e.card.position.x = Math.sin(now() * 50) * 0.012 * k; }, 'lin');
        e.card.position.x = 0;
        impact(win ? 1.4 : 0.6);
        e.card.material.clippingPlanes = null; e.card.material.needsUpdate = true;
        await tween(0.25, (k) => { e.card.position.set(0, 0.62 + k * 0.43, 0.12); }, 'out');
      } else await tween(0.6, (k) => { e.card.material.opacity = Math.min(1, k * 2); e.card.position.set(0, k * 1.05, 0.01 + k * 0.09); }, 'out');
      e.open = true;
      if (!win) {
        sound.lose();
        await sleep(0.7);
        await Promise.all([camTo(ov.pos, ov.look, 0.5), tween(0.5, (k) => { e.g.position.y = e.base.y + 0.3 * (1 - k); }, 'sine')]);
        return;
      }
      // 6. 当たり: ルーレットと同じ決着
      await finish(top, team, 0.6);
      await sleep(2.6);
      showResult('', false);
      await Promise.all([camTo(ov.pos, ov.look, 0.8), tween(0.8, (k) => { e.g.position.y = e.base.y + 0.3 * (1 - k); }, 'sine')]);
      openRest(); fx.winT = 0.4; fx.ambT = 1;
      await sleep(0.4 + envs.length * 0.22);
    },
  };
}

/* ================= あみだくじ(全体が見える画角のまま、流れ星がたどる) ================= */
// 流れ星の尾: 頭の通ったあとを点で残し、古いほど細く薄く(尾は毎フレーム描き直す)
const meteors = new Set();
class Meteor {
  constructor(n = 320) {
    this.n = n; this.pts = []; this.pos = new Float32Array(n * 3); this.k = new Float32Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aK', new THREE.BufferAttribute(this.k, 1).setUsage(THREE.DynamicDrawUsage));
    this.u = { uTex: { value: sparkTex }, uCol: { value: new THREE.Color() }, uScale: { value: H / (2 * Math.tan((camera.fov * Math.PI) / 360)) }, uFade: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aK; uniform float uScale; varying float vK; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (0.06 + 0.94 * aK) * 0.42 * uScale / -mv.z; gl_Position = projectionMatrix * mv; vK = aK; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uCol; uniform float uFade; varying float vK; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); vec3 c = mix(uCol * 1.8, vec3(2.2), pow(vK, 14.0)); gl_FragColor = vec4(c * t.a * pow(vK, 1.4) * 0.26 * uFade, 1.0); }`,
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.head = halo(0xffffff, 0.9); this.head.material.opacity = 1; this.head.renderOrder = 6;
    this.glow = halo(0xffffff, 2.4); this.glow.material.opacity = 0.45;
    meteors.add(this);
  }
  push(p) { // 1フレームで大きく動いても尾がとぎれないように、間を埋める
    const last = this.pts[this.pts.length - 1];
    const steps = last ? Math.max(1, Math.ceil(last.distanceTo(p) / 0.06)) : 1;
    for (let s = 1; s <= steps; s++) this.pts.push(last ? last.clone().lerp(p, s / steps) : p.clone());
    if (this.pts.length > this.n) this.pts.splice(0, this.pts.length - this.n);
    this.head.position.copy(p); this.glow.position.copy(p);
  }
  update() {
    const m = this.pts.length;
    for (let i = 0; i < this.n; i++) { const p = this.pts[i] || this.pts[m - 1]; if (p) this.pos.set([p.x, p.y, p.z], i * 3); this.k[i] = i < m ? (i + 1) / m : 0; }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.aK.needsUpdate = true;
  }
}
function buildAmida(d) {
  const root = new THREE.Group(); scene.add(root);
  const n = d.lots.length, gap = Math.max(2.0, Math.min(10, 17 / Math.max(1, n - 1))), TOP = 5, BOT = -5, rungs = d.amida.rungs, R = rungs.length;
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
  const ys = Array.from({ length: R }, (_, r) => TOP - (r + 1) * ((TOP - BOT) / (R + 1)));
  const RAD = 0.03, TR = 0.07;
  const cyl = (len, mat, r) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  const ball = (mat, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
  const laneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.52, 0.2), toneMapped: false, transparent: true, opacity: 0.7 });
  xs.forEach((x) => { const m = cyl(TOP - BOT, laneMat, RAD); m.position.set(x, 0, 0); root.add(m); });
  // 電飾(ルーレットの縁と同じく、順に点いて流れる)
  const BULB_GAP = 0.42, perLane = Math.floor((TOP - BOT) / BULB_GAP) + 1, NB = perLane * n;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), NB);
  { const dm = new THREE.Object3D(); for (let i = 0; i < NB; i++) { const l = Math.floor(i / perLane), j = i % perLane; dm.position.set(xs[l], TOP - j * BULB_GAP, -0.08); dm.updateMatrix(); bulbs.setMatrixAt(i, dm.matrix); bulbs.setColorAt(i, new THREE.Color(1, 1, 1)); } }
  root.add(bulbs);
  const BASE_BULB = new THREE.Color(3.2, 2.2, 0.7), bc = new THREE.Color();
  function updateBulbs(t) {
    for (let i = 0; i < NB; i++) {
      const j = i % perLane;
      if (fx.bulb === 'win') bc.setHSL((j / perLane + t * 0.9) % 1, 1, 0.5).multiplyScalar(3.5 * (0.6 + 0.4 * ((j + Math.floor(t * 12)) % 2)));
      else if (fx.bulb === 'spin') bc.copy(BASE_BULB).multiplyScalar((j + Math.floor(t * 28)) % 4 === 0 ? 1.3 : 0.2);
      else bc.copy(BASE_BULB).multiplyScalar((perLane - j + Math.floor(t * 7)) % 6 < 2 ? 1 : 0.12);
      bulbs.setColorAt(i, bc);
    }
    bulbs.instanceColor.needsUpdate = true;
  }
  // 横の線: 最初は隠す。流れ星が着いたときに光って現れる。決着したら全部見せる
  const rungMat = () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.52, 0.2), toneMapped: false, transparent: true, opacity: 0 });
  const rungMeshes = rungs.map((row, r) => row.map((i) => { const m = cyl(gap, rungMat(), RAD); m.rotation.z = Math.PI / 2; m.position.set((xs[i] + xs[i + 1]) / 2, ys[r], 0); m.visible = false; root.add(m); return { m, i, r }; }));
  const showRung = (r, i, flashIt) => { const o = rungMeshes[r].find((x) => x.i === i); if (!o || o.m.visible) return; o.m.visible = true; if (flashIt) tween(0.4, (k) => { o.m.material.opacity = 0.7 * k; o.m.material.color.setRGB(0.75 + 2.5 * (1 - k), 0.52 + 2 * (1 - k), 0.2 + 1 * (1 - k)); }, 'out'); else o.m.material.opacity = 0.7; };
  const tw = Math.min(gap * 0.9, 3.6);
  const owners = d.owners.slice();
  const tags = d.lots.map((lot, i) => { const s = sprite(tagTexture(lot, owners[i]), tw, tw * 0.446); s.position.set(xs[i], TOP + tw * 0.3, 0); root.add(s); return s; });
  const goalTex = (state) => tex(256, 256, (c, w, h) => {
    roundRect(c, 8, 8, w - 16, h - 16, 40);
    if (state === 'win') { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#ffc21a'); gr.addColorStop(1, '#b06a00'); c.fillStyle = gr; } else c.fillStyle = state === 'lose' ? '#4a4038' : 'rgba(20,12,4,.9)';
    c.fill(); c.lineWidth = 10; c.strokeStyle = goldGrad(c, 0, h); c.stroke();
    c.fillStyle = state === 'win' ? '#7a0d08' : state === 'lose' ? '#cfc4b4' : '#ffe9b8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = FONT(state === 'win' ? 70 : 120); c.fillText(state === 'win' ? '当たり' : state === 'lose' ? '×' : '？', w / 2, h / 2 + 6);
  });
  const gs = Math.min(gap * 0.6, 2.0);
  const goals = xs.map((x) => { const s = sprite(goalTex('hide'), gs, gs); s.position.set(x, BOT - gs * 0.62, 0); root.add(s); return s; });
  const setGoal = (i, state) => { goals[i].material.map = goalTex(state); goals[i].material.needsUpdate = true; };
  function pathOf(lane, z = 0.02) {
    let x = lane; const pts = [new THREE.Vector3(xs[x], TOP, z)], cross = [];
    rungs.forEach((row, r) => { const y = ys[r]; if (row.includes(x)) { pts.push(new THREE.Vector3(xs[x], y, z), new THREE.Vector3(xs[x + 1], y, z)); cross.push([r, x, pts.length - 2]); x++; } else if (row.includes(x - 1)) { pts.push(new THREE.Vector3(xs[x], y, z), new THREE.Vector3(xs[x - 1], y, z)); cross.push([r, x - 1, pts.length - 2]); x--; } });
    pts.push(new THREE.Vector3(xs[x], BOT, z));
    return { pts, end: x, cross };
  }
  // 通ったあとの線(くじの色)。曲がり角には玉を置いて切れ目なくつなぐ。前の線は暗くして奥へ
  const trails = [];
  const trail = (color) => { const m = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), toneMapped: false, transparent: true }); m.userData.base = color.clone(); trails.push(m); return m; };
  const dimTrail = (m, to = 0.8) => { const c0 = m.color.clone(), c1 = m.userData.base.clone().multiplyScalar(to); tween(0.5, (k) => m.color.lerpColors(c0, c1, k)); };
  const dimTrails = () => trails.forEach((m) => dimTrail(m));
  // まだ通っていない道を、くじの色で(薄く)見せる
  function drawPath(lane, z, mat) { const p = pathOf(lane, z); p.cross.forEach(([r, i]) => showRung(r, i, false)); for (let s = 0; s < p.pts.length - 1; s++) setSeg(trailSeg(p.pts[s], p.pts[s + 1], mat), 1); p.pts.forEach((q) => joint(q, mat)); return p; }
  function trailSeg(a, b, mat) { const len = a.distanceTo(b); const m = cyl(1, mat, TR); m.position.copy(a); m.lookAt(b); m.rotateX(Math.PI / 2); m.scale.set(1, 0.0001, 1); m.visible = false; m.userData = { a, b, len }; root.add(m); return m; }
  function setSeg(m, k) { const { a, b, len } = m.userData; m.visible = k > 0.002; m.scale.y = Math.max(0.0001, len * k); m.position.copy(a).lerp(b, k / 2); }
  function joint(p, mat) { const b = ball(mat, TR); b.position.copy(p); root.add(b); return b; }
  // 画角は全体が入る位置で固定(動かさない)
  const spanTop = TOP + tw * 0.56, spanBot = BOT - gs * 1.2, fullW = n * gap + 2, tanH = Math.tan((17.5 * Math.PI) / 180);
  const h0 = (spanTop - spanBot) / 0.78, cy = (spanTop + spanBot) / 2 + 0.25;
  camSet({ pos: new THREE.Vector3(0, cy, Math.max(h0 / 2 / tanH, fullW / 2 / tanH / (W / H))), look: new THREE.Vector3(0, cy, 0) });
  return {
    root,
    setOwner(i, team) { if (owners[i] === team) return; owners[i] = team; tags[i].material.map = tagTexture(d.lots[i], team); tags[i].material.needsUpdate = true; },
    update: updateBulbs,
    async afterIntro() {
      const g = d.amida.goal; goals.forEach((_, i) => setGoal(i, i === g ? 'win' : 'lose')); sound.kakutei(); flash('#fff', 0.3, 0.35);
      burst(goals[g].position.clone(), 60, WIN_COLS, 0.4, 0.6);
      await tween(0.6, (k) => goals[g].scale.setScalar(gs * (1 + Math.sin(k * Math.PI) * 0.35)), 'out');
      await sleep(0.5);
    },
    applyStatic(dd) {
      // 決着済み: 全部の道を見せる(当たりの道を明るく、いちばん手前に)
      const lanes = dd.lots.map((_, i) => i).sort((a, b) => (a === dd.winLot) - (b === dd.winLot));
      lanes.forEach((lane, k) => { const mat = trail(new THREE.Color(dd.lots[lane].color)); if (lane !== dd.winLot) mat.color.copy(mat.userData.base).multiplyScalar(0.8); const p = drawPath(lane, 0.02 + k * 0.04, mat); setGoal(p.end, lane === dd.winLot ? 'win' : 'lose'); });
      rungMeshes.flat().forEach((o) => showRung(o.r, o.i, false));
    },
    async open(lane, win) {
      const team = D.owners[lane], lot = d.lots[lane], lc = new THREE.Color(lot.color);

      tween(0.4, (k) => { tags[lane].scale.set(tw * (1 + 0.15 * Math.sin(k * Math.PI)), tw * 0.446 * (1 + 0.15 * Math.sin(k * Math.PI)), 1); });
      // 1. チーム名のカットイン(選んだくじの色)
      await teamCutin(lot, team, isLast(lane));
      dimTrails();
      const p = pathOf(lane, 0.02 + trails.length * 0.04), mat = trail(new THREE.Color(d.lots[lane].color));
      // 2. 流れ星: くじの色の尾を引いて、一定の速さでたどる(動き出しと止まりだけなめらか)
      const met = new Meteor(); root.add(met.points, met.head, met.glow);
      const segs = []; for (let s = 0; s < p.pts.length - 1; s++) segs.push(trailSeg(p.pts[s], p.pts[s + 1], mat));
      const lens = segs.map((m) => m.userData.len), total = lens.reduce((a, b) => a + b, 0), slow = proto(), DUR = 2.6 + total * 0.02 + (slow ? 1.6 : 0);
      // 試作: 時間の最後 35% で、道のりの最後 10% だけ進む(ゴール前でスロー)
      const progress = (k) => (!slow ? k : k < 0.65 ? (k / 0.65) * 0.9 : 0.9 + ((k - 0.65) / 0.35) * 0.1);
      let slowed = false;
      joint(p.pts[0], mat); const joined = new Set([0]); const crossed = new Set();
      sound.shoot(DUR); fx.dimT = 0.6; fx.bulb = 'spin';
      const col = lc, head = new THREE.Vector3();
      await tween(DUR, (k) => {
        if (slow && k > 0.65 && !slowed) { slowed = true; heartbeats(3, 0.5); fx.dimT = 0.8; }
        let dist = progress(k) * total, s = 0;
        while (s < segs.length - 1 && dist > lens[s]) { setSeg(segs[s], 1); if (!joined.has(s + 1)) { joined.add(s + 1); joint(p.pts[s + 1], mat); } dist -= lens[s]; s++; }
        const q = Math.min(1, dist / lens[s]); setSeg(segs[s], q);
        head.copy(segs[s].userData.a).lerp(segs[s].userData.b, q); head.z += 0.25;
        met.u.uCol.value.copy(col); met.glow.material.color.copy(col); met.push(head);
        // こぼれるきらめき
        for (let j = 0; j < 3; j++) sparks.emit(head.x + rand(-0.1, 0.1), head.y + rand(-0.1, 0.1), head.z, rand(-0.8, 0.8), rand(-0.6, 1.2), rand(-0.3, 0.3), Math.random() < 0.4 ? new THREE.Color(2, 2, 2) : hdr(col), rand(0.08, 0.22), rand(0.5, 1.1), -1.5, 0.97);
        p.cross.forEach(([r, i, at]) => { if (s >= at && !crossed.has(at)) { crossed.add(at); showRung(r, i, true); sound.tick(1.1); } });
      }, slow ? 'sine' : 'inOut');
      setSeg(segs[segs.length - 1], 1); joint(p.pts[p.pts.length - 1], mat);
      if (slow) impact(win ? 1.4 : 0.6);
      fx.dimT = 0; fx.bulb = 'idle';
      // 3. ゴール: 流れ星がはじけて結果
      const end = head.clone();
      burst(end, win ? 120 : 70, [hdr(col), new THREE.Color(2, 2, 2)], 0.6, 0.7);
      tween(0.6, (k) => { met.u.uFade.value = 1 - k; met.head.material.opacity = 1 - k; met.glow.material.opacity = 0.45 * (1 - k); }, 'out').then(() => { root.remove(met.points, met.head, met.glow); meteors.delete(met); });
      setGoal(p.end, win ? 'win' : 'lose');
      tween(0.4, (k) => goals[p.end].scale.setScalar(gs * (1 + Math.sin(k * Math.PI) * 0.3)), 'out');
      if (!win) { sound.lose(); await sleep(0.9); return; }
      // 4. 当たり: ルーレットと同じ決着。そのあと、まだ通っていない道も全部見せる(公平に決まったことがわかるように)
      await finish(end, team, 0.8);
      await sleep(2.6);
      showResult('', false);
      fx.winT = 0.4; fx.ambT = 1; fx.bulb = 'idle';
      const done = new Set(D.order.slice(0, D.opened));
      const rest = d.lots.map((_, i) => i).filter((i) => !done.has(i));
      for (const l of rest) {
        const m = trail(new THREE.Color(d.lots[l].color)); m.color.copy(m.userData.base).multiplyScalar(0.8); m.opacity = 0;
        const q = drawPath(l, 0.01, m); setGoal(q.end, 'lose'); sound.tick(0.8);
        await tween(0.35, (k) => { m.opacity = k; });
      }
      rungMeshes.flat().forEach((x) => showRung(x.r, x.i, false));
      await sleep(0.6);
    },
  };
}

/* ---------- 毎フレーム ---------- */
let last = now();
function frame() {
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  const frozen = t < fx.freezeUntil;
  if (frozen) tweens.forEach((tw) => { tw.t0 += dt; });
  else tweens = tweens.filter((tw) => { const k = Math.min(1, (t - tw.t0) / tw.dur); tw.fn(tw.e(k)); if (k >= 1) { tw.res(); return false; } return true; });
  const k = (rate) => 1 - Math.exp(-dt * rate);
  fx.win += (fx.winT - fx.win) * k(3); fx.dim += (fx.dimT - fx.dim) * k(4);
  bgU.uTime.value = t; bgU.uWin.value = fx.win; bgU.uDim.value = fx.dim;
  bgU.uGlow.value = 0.4 + 0.6 * Math.min(1, fx.amb / 3.4);
  tierLight.intensity = fx.win * 4; tierLight.color.setHSL((t * 0.4) % 1, 1, 0.6);
  bloom.strength = 0.45 + fx.win * 0.45;
  // カメラ(時間あたり一定の減衰でついていく。回さない)
  camNow.pos.lerp(cam.pos, k(10)); camNow.look.lerp(cam.look, k(10));
  camera.position.copy(camNow.pos); camera.lookAt(camNow.look);
  fx.shake *= Math.exp(-dt * 6);
  if (fx.shake > 0.01) camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(fx.shake * 0.12));
  emitAmbient(dt);
  if (fx.win > 0.5 && Math.random() < dt * 12) burst(camNow.look, 8);
  if (!frozen) sparks.update(dt);
  meteors.forEach((m) => m.update());
  if (world && world.update) world.update(t);
  updateConfetti(dt, t);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'lots') onData(m.data);
  else if (m.type === 'lots-reset') { clearWorld(); }
  else if (m.type === 'volume') { sound.vol = m.v; sound.apply(); }
  else if (m.type === 'silence') { sound.silent = !!m.on; sound.apply(); }
});
parent.postMessage({ type: 'lots3d-ready' }, '*');
