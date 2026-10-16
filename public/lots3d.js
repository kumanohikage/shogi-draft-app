// くじの3D演出(のし袋・あみだくじ)。配信画面(overlay.js)の中に iframe で入り、くじの状態を postMessage で受け取って動く
// 結果はアプリ(サーバー)がもう決めている。ここは決まった結果を見せるだけ(演出で確率は変わらない)
// 見た目はルーレット(roulette.html)にそろえる: 黄金の後光の背景・光沢のある金・控えめなブルーム・同じ結果の文字
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1920, H = 1080;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sfx = (name) => parent.postMessage({ type: 'lots-sfx', name }, '*');

/* ---------- 描画の土台(ルーレットと同じ設定) ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 400);
scene.add(camera);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0); keyLight.position.set(-6, 10, 14);
const tierLight = new THREE.PointLight(0xffffff, 0, 40, 1.2);
scene.add(new THREE.AmbientLight(0xffffff, 0.35), keyLight, tierLight);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 4, H / 4), 0.55, 0.35, 1.1));
composer.addPass(new OutputPass());
const fitHud = () => { $('hud').style.transform = `scale(${innerWidth / W})`; };
addEventListener('resize', fitHud); fitHud();

/* ---------- 背景: ルーレットの「光」の後光シェーダー(カメラに付けて、画面に対して動かない=酔いにくい目印) ---------- */
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
      // 期待度の色(ゼブラは白黒のしま)
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
{ const d = 120, h = 2 * d * Math.tan((camera.fov * Math.PI) / 360); bg.scale.set(h * camera.aspect * 1.02, h * 1.02, 1); bg.position.set(0, 0, -d); }
camera.add(bg);
// 金の粒(画面に対して漂う。カメラに付けるので、カメラが動いても流れない)
(() => {
  const n = 160, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 44, (Math.random() - 0.5) * 26, -30 - Math.random() * 20], i * 3); seed[i] = Math.random() * 100; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uTime: bgU.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float seed; uniform float uTime; varying float vA; void main(){ vec3 p = position; p.y += mod(uTime * 0.6 + seed, 26.0) - 13.0; p.x += sin(uTime * 0.3 + seed) * 0.6; vA = 0.4 + 0.6 * sin(uTime * 2.0 + seed * 3.0); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = 6.0 * (40.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 0.82, 0.4, smoothstep(0.5, 0.0, d) * vA * 0.8); }' });
  const pts = new THREE.Points(g, m); pts.renderOrder = -9; pts.frustumCulled = false; camera.add(pts);
})();

/* ---------- 小さな道具 ---------- */
const now = () => performance.now() / 1000;
let tweens = [];
const ease = { out: (k) => 1 - Math.pow(1 - k, 3), inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2), sine: (k) => 0.5 - 0.5 * Math.cos(Math.PI * k), lin: (k) => k };
function tween(dur, fn, e = 'inOut', delay = 0) { return new Promise((res) => tweens.push({ t0: now() + delay, dur, fn, e: ease[e], res })); }
const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const FONT = (px, w = 900) => `${w} ${px}px 'Noto Sans JP', sans-serif`;
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const goldGrad = (g, y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.45, '#e8b84a'); gr.addColorStop(1, '#8a5a12'); return gr; };
// くじの名札: 金の枠に「①赤」とチーム名(ルーレットの部品と同じ色づかい)
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
function halo(color, size) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(size, size, 1); return s; }
const GOLD = () => new THREE.MeshStandardMaterial({ color: 0xd9a420, metalness: 1, roughness: 0.28 });

/* ---------- 期待度(ルーレットと同じ序列: 青 < 緑 < 赤 < 金 < ゼブラ < 虹)。虹は当たり確定。色は演出だけ ---------- */
const TIER = { blue: 0x3aa0ff, green: 0x22e57a, red: 0xff2a2a, gold: 0xffc21a, zebra: 0xffffff, rainbow: 0xffffff };
const TIER_ORDER = ['blue', 'green', 'red', 'gold', 'zebra', 'rainbow'];
const TABLE = { win: [2, 6, 18, 34, 20, 20], lose: [40, 31, 18, 9, 2, 0] };
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
function tierOf(id, lot, win) { const r = hash(`${id}:${lot}`) * 100, t = TABLE[win ? 'win' : 'lose']; let a = 0; for (let i = 0; i < t.length; i++) { a += t[i]; if (r < a) return TIER_ORDER[i]; } return 'blue'; }
const tierColor = (name, t = now()) => (name === 'rainbow' ? new THREE.Color().setHSL((t * 0.7) % 1, 1, 0.6) : name === 'zebra' ? new THREE.Color(Math.floor(t * 8) % 2 ? 0xffffff : 0xffd23a) : new THREE.Color(TIER[name]));
// 背景を期待度の色に寄せる(リーチのように)
function reach(name, k) { bgU.uReach.value = k; bgU.uZebra.value = name === 'zebra' ? 1 : 0; bgU.uTier.value.copy(tierColor(name)); }

/* ---------- 金の紙吹雪 ---------- */
let confetti = null;
function burstConfetti(at) {
  if (confetti) scene.remove(confetti.points);
  const n = 280, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [];
  const pal = [0xffe066, 0xffc21a, 0xfff3b0, 0xff5a3a, 0xffffff].map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) { pos.set([at.x, at.y, at.z], i * 3); const c = pal[i % pal.length]; col.set([c.r, c.g, c.b], i * 3); const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; vel.push(new THREE.Vector3(Math.cos(a) * s * 0.7, 3 + Math.random() * 6, Math.sin(a) * s * 0.4)); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, toneMapped: false }));
  scene.add(points); confetti = { points, vel, t0: now() };
}
function stepConfetti(dt) {
  if (!confetti) return;
  const p = confetti.points.geometry.attributes.position, age = now() - confetti.t0;
  for (let i = 0; i < confetti.vel.length; i++) { const v = confetti.vel[i]; v.y -= 7 * dt; v.multiplyScalar(0.986); p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt); }
  p.needsUpdate = true; confetti.points.material.opacity = Math.max(0, 1 - Math.max(0, age - 2.6) / 1.4);
  if (age > 4.2) { scene.remove(confetti.points); confetti = null; }
}

/* ---------- 画面の上の文字 ---------- */
function hud(d) {
  $('head').innerHTML = `${d.player.icon ? `<img src="${esc(d.player.icon)}" alt="">` : ''}<span class="pn">${esc(d.player.name)}</span><span class="pk">${d.lots.length}チームが競合</span>`;
  if (!busyNote) $('note').innerHTML = esc(d.note);
}
const note = (t) => { $('note').innerHTML = esc(t); };
function showResult(lot, team, on) {
  if (on) $('result-who').innerHTML = `<i style="--lc:${esc(lot.color)}">${esc(lot.label)}</i>${esc(team)}`;
  $('result').classList.toggle('show', on);
}
const flash = (k) => { $('flash').style.opacity = k; };

/* ---------- カメラ: なめらかに(フレームの速さに左右されない減衰で)目標へ ---------- */
const cam = { pos: new THREE.Vector3(0, 3, 14), look: new THREE.Vector3(0, 1, 0), follow: null };
const camNow = { pos: cam.pos.clone(), look: cam.look.clone() };
function camTo(pos, look, dur = 1) { const p0 = cam.pos.clone(), l0 = cam.look.clone(); return tween(dur, (k) => { cam.pos.lerpVectors(p0, pos, k); cam.look.lerpVectors(l0, look, k); }, 'sine'); }

/* ---------- 世界を作り直す ---------- */
let world = null, D = null, queue = Promise.resolve(), busyNote = 0;
function clearWorld() { if (!world) return; scene.remove(world.root); world = null; tweens = []; showResult(null, '', false); reach('gold', 0); bgU.uWin.value = 0; tierLight.intensity = 0; }
function onData(d) {
  hud(d);
  if (!world || world.id !== d.id || world.mode !== d.mode) {
    clearWorld();
    world = d.mode === 'amida' ? buildAmida(d) : buildNoshi(d);
    world.id = d.id; world.mode = d.mode; world.opened = d.opened;
    D = d; world.applyStatic(d);
    return;
  }
  const prev = D; D = d;
  d.owners.forEach((o, i) => { if (o && !prev.owners[i]) { world.setOwner(i, o, true); sfx('pop'); } });
  for (let k = world.opened; k < d.opened; k++) {
    const lot = d.order[k];
    busyNote++;
    queue = queue.then(() => world.open(lot, lot === d.winLot)).finally(() => { busyNote--; if (!busyNote && D) note(D.done ? `${D.owners[D.winLot]} が交渉権を獲得` : D.note); });
  }
  world.opened = d.opened;
}

/* ================= のし袋 ================= */
// 和紙の質感(白地に繊維)
const washi = (w, h, draw) => tex(w, h, (g) => {
  g.fillStyle = '#f6f0e2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${170 + Math.random() * 40},${150 + Math.random() * 40},${120 + Math.random() * 30},${0.06 + Math.random() * 0.08})`; g.lineWidth = 0.6 + Math.random() * 1.2; const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14 + 6, x + Math.cos(a) * 30, y + Math.sin(a) * 30); g.stroke(); }
  const v = g.createLinearGradient(0, 0, w, 0); v.addColorStop(0, 'rgba(0,0,0,.06)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(0,0,0,.08)'); g.fillStyle = v; g.fillRect(0, 0, w, h);
  draw && draw(g, w, h);
});
// 熨斗(右上の小さな飾り)と表書き(番号)
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
function buildNoshi(d) {
  const root = new THREE.Group(); scene.add(root);
  const n = d.lots.length, gap = n <= 4 ? 2.4 : n <= 8 ? 2.0 : 1.7, BW = 1.3, BH = 2.3, MZY = -BH * 0.27;
  // 舞台(金の縁の黒い円盤)
  const R0 = n * gap * 0.5 + 1.4;
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0 + 0.2, 0.24, 64), new THREE.MeshStandardMaterial({ color: 0x1a0d04, metalness: 0.6, roughness: 0.35 }));
  stage.position.set(0, -0.12, -0.6); root.add(stage);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R0 + 0.1, 0.07, 12, 96), GOLD()); rim.rotation.x = Math.PI / 2; rim.position.set(0, 0, -0.6); root.add(rim);
  const envs = [];
  d.lots.forEach((lot, i) => {
    const x = (i - (n - 1) / 2) * gap, z = -0.12 * x * x / Math.max(1, n / 3);
    const g = new THREE.Group(); g.position.set(x, BH / 2 + 0.25, z); g.rotation.y = -x * 0.03; root.add(g);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.22, 40), GOLD()); ped.position.set(x, 0.11, z); root.add(ped);
    const front = new THREE.MeshStandardMaterial({ map: frontTexture(lot, i), color: PAPER, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
    const back = new THREE.MeshStandardMaterial({ map: washi(256, 440), color: PAPER, roughness: 0.9, envMapIntensity: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, 0.07), [back, back, back, back, front, back]);
    g.add(body);
    // 上の折り返し(開くふた)
    const pivot = new THREE.Group(); pivot.position.set(0, BH / 2, 0.045); g.add(pivot);
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH * 0.3), new THREE.MeshStandardMaterial({ map: flapTexture(), color: PAPER, roughness: 0.85, envMapIntensity: 0.5, side: THREE.DoubleSide }));
    flap.position.y = -BH * 0.15; pivot.add(flap);
    // 水引
    const mz = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.04, BW * 0.54), new THREE.MeshStandardMaterial({ map: mizuhikiTexture(lot.color), transparent: true, roughness: 0.4, metalness: 0.3 }));
    mz.position.set(0, MZY, 0.05); g.add(mz);
    // 中の光と、中袋(結果のカード)
    const glow = halo(0xffffff, 6.5); glow.position.set(0, BH * 0.45, -0.3); g.add(glow);
    const light = new THREE.PointLight(0xffffff, 0, 2.6, 1.6); light.position.set(0, BH * 0.4, 0.8); g.add(light);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.86, BH * 0.62), new THREE.MeshStandardMaterial({ color: 0xd2cabb, transparent: true, opacity: 0, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.5 }));
    card.position.set(0, 0, 0.01); g.add(card);
    const tw = Math.min(gap * 0.68, 1.55);
    const tag = sprite(tagTexture(lot, d.owners[i]), tw, tw * 0.446); tag.position.set(x, 0.02, z + 1.25); tag.renderOrder = 5; tag.material.depthTest = false; root.add(tag);
    envs.push({ g, pivot, flap, mz, glow, light, card, tag, lot, x, z, base: g.position.clone(), open: false });
  });
  const fit = Math.max(n * gap + 2.5, 7.5), tanH = Math.tan((17.5 * Math.PI) / 180);
  const overview = () => { const dist = Math.max((BH + 4.2) / 2 / tanH, fit / 2 / tanH / (W / H)) * 1.05; return { pos: new THREE.Vector3(0, 2.2, dist), look: new THREE.Vector3(0, 1.15, 0) }; };
  const ov = overview(); cam.pos.copy(ov.pos); cam.look.copy(ov.look); camNow.pos.copy(ov.pos); camNow.look.copy(ov.look);
  const cardTex = (win) => tex(360, 460, (c, w, h) => {
    roundRect(c, 4, 4, w - 8, h - 8, 18);
    if (win) { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#e8b84a'); gr.addColorStop(1, '#a86f12'); c.fillStyle = gr; } else c.fillStyle = '#efe8da';
    c.fill(); c.lineWidth = 10; c.strokeStyle = win ? '#9a1a0e' : '#bfb5a4'; c.stroke();
    c.fillStyle = win ? '#7a0d08' : '#6a6258'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (win) { c.font = FONT(78); c.fillText('交渉権', w / 2, h / 2 - 50); c.fillText('確定', w / 2, h / 2 + 50); } else { c.font = FONT(110); c.fillText('外れ', w / 2, h / 2); }
  });
  function setOpenStatic(e, win) { e.mz.visible = false; e.pivot.rotation.x = -Math.PI * 0.98; e.card.material.map = cardTex(win); e.card.material.opacity = 1; e.card.material.needsUpdate = true; e.card.position.set(0, 1.05, 0.1); e.open = true; }
  return {
    root,
    setOwner(i, team, anim) { const e = envs[i]; e.tag.material.map = tagTexture(e.lot, team); e.tag.material.needsUpdate = true; if (anim) tween(0.5, (k) => { e.g.position.y = e.base.y + Math.sin(k * Math.PI) * 0.35; }, 'out'); },
    applyStatic(dd) { for (let k = 0; k < dd.opened; k++) setOpenStatic(envs[dd.order[k]], dd.order[k] === dd.winLot); if (dd.done) envs.forEach((e, i) => { if (!e.open) setOpenStatic(e, i === dd.winLot); }); },
    async open(lot, win) {
      const e = envs[lot], tier = tierOf(D.id, lot, win), team = D.owners[lot];
      note(`${team} ののし袋を開けます`);
      // 1. 寄る(回さない・ゆっくり)
      await Promise.all([camTo(new THREE.Vector3(e.x * 0.85, 2.2, e.z + 8.6), new THREE.Vector3(e.x, 1.45, e.z), 0.8), tween(0.8, (k) => { e.g.position.y = e.base.y + k * 0.25; }, 'sine')]);
      // 2. 期待度の光が後ろからもれる。背景も色づく
      sfx('glow');
      await tween(1.4, (k) => {
        const c = tierColor(tier); e.glow.material.color.copy(c); e.light.color.copy(c); tierLight.color.copy(c);
        e.glow.material.opacity = k * 0.55; e.light.intensity = k * 3; tierLight.intensity = k * 1.2; reach(tier, k);
        e.g.rotation.z = Math.sin(now() * 30) * 0.015 * k;
      }, 'lin');
      e.g.rotation.z = 0;
      // 3. 水引がほどけて落ち、上の折り返しが開く → 光があふれる
      sfx('flip');
      await tween(0.6, (k) => {
        e.mz.position.y = MZY - k * 0.6; e.mz.material.opacity = 1 - k;
        e.pivot.rotation.x = -Math.PI * 0.98 * ease.out(k); const c = tierColor(tier); e.glow.material.color.copy(c); e.glow.scale.setScalar(6.5 + k * 3); e.light.intensity = 3 + k * 4;
      }, 'lin');
      e.mz.visible = false;
      // 4. 中袋が上がる
      e.card.material.map = cardTex(win); e.card.material.needsUpdate = true;
      await tween(0.8, (k) => { e.card.material.opacity = Math.min(1, k * 2); e.card.position.set(0, k * 1.05, 0.01 + k * 0.09); e.glow.material.opacity = 0.7 * (1 - k * 0.5); e.light.intensity = 7 * (1 - k * 0.6); }, 'out');
      e.open = true;
      if (win) {
        sfx('win'); note(`${team} が交渉権を獲得`);
        tween(0.25, (k) => flash(0.7 * (1 - k)));
        burstConfetti(new THREE.Vector3(e.x, 3.2, e.z + 1));
        tween(0.6, (k) => { bgU.uWin.value = k; reach(tier, 1 - k); }, 'out');
        showResult(e.lot, team, true);
        await sleep(2.2);
        showResult(null, '', false);
      } else { sfx('lose'); note(`${team}: 外れ`); await tween(0.6, (k) => reach(tier, 1 - k)); }
      tween(0.8, (k) => { tierLight.intensity = 1.2 * (1 - k); e.glow.material.opacity *= 0.9; });
      // 5. 引く。当たりなら残りののし袋も開ける
      const o = overview();
      await Promise.all([camTo(o.pos, o.look, 0.9), tween(0.9, (k) => { e.g.position.y = e.base.y + 0.25 * (1 - k); }, 'sine')]);
      if (win) {
        tween(1.0, (k) => { bgU.uWin.value = 1 - k * 0.6; });
        envs.filter((x) => !x.open).forEach((x, k) => setTimeout(() => {
          x.card.material.map = cardTex(false); x.card.material.needsUpdate = true; sfx('flip');
          tween(0.5, (q) => { x.mz.material.opacity = 1 - q; x.pivot.rotation.x = -Math.PI * 0.98 * q; x.card.material.opacity = q; x.card.position.set(0, q * 1.05, 0.01 + q * 0.09); }, 'out').then(() => { x.mz.visible = false; });
          x.open = true;
        }, 200 + k * 220));
      }
    },
  };
}

/* ================= あみだくじ ================= */
function buildAmida(d) {
  const root = new THREE.Group(); scene.add(root);
  const n = d.lots.length, gap = n <= 3 ? 4.2 : n <= 5 ? 3.4 : n <= 8 ? 2.6 : 2.0, TOP = 5, BOT = -5, rungs = d.amida.rungs, R = rungs.length;
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
  const ys = Array.from({ length: R }, (_, r) => TOP - (r + 1) * ((TOP - BOT) / (R + 1)));
  const RAD = 0.075, TR = 0.15;
  const cyl = (len, mat, r) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  const ball = (mat, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
  // 縦の線: 金(光沢)
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xb8892a, metalness: 1, roughness: 0.3, emissive: 0x3a2300, emissiveIntensity: 0.6 });
  xs.forEach((x) => { const m = cyl(TOP - BOT, laneMat, RAD); m.position.set(x, 0, 0); root.add(m); [TOP, BOT].forEach((y) => { const b = ball(laneMat, RAD); b.position.set(x, y, 0); root.add(b); }); });
  // 横の線: 最初は隠す。玉が着いたときに光って現れる。最後に全部見せる
  const rungMat = () => new THREE.MeshStandardMaterial({ color: 0xffe6a0, metalness: 0.6, roughness: 0.25, emissive: 0xffc04a, emissiveIntensity: 0.9, transparent: true, opacity: 0 });
  const rungMeshes = rungs.map((row, r) => row.map((i) => { const m = cyl(gap, rungMat(), RAD); m.rotation.z = Math.PI / 2; m.position.set((xs[i] + xs[i + 1]) / 2, ys[r], 0); m.visible = false; root.add(m); return { m, i, r }; }));
  const showRung = (r, i, flashIt) => { const o = rungMeshes[r].find((x) => x.i === i); if (!o || (o.m.visible && o.m.material.opacity >= 1)) return; o.m.visible = true; if (flashIt) tween(0.4, (k) => { o.m.material.opacity = k; o.m.material.emissiveIntensity = 3.2 * (1 - k) + 0.9; }, 'out'); else o.m.material.opacity = 1; };
  // 上の名札、下のゴール
  const tw = Math.min(gap * 0.9, 3.4);
  const tags = d.lots.map((lot, i) => { const s = sprite(tagTexture(lot, d.owners[i]), tw, tw * 0.446); s.position.set(xs[i], TOP + tw * 0.3, 0); root.add(s); return s; });
  const goalTex = (state) => tex(256, 256, (c, w, h) => {
    roundRect(c, 8, 8, w - 16, h - 16, 40);
    if (state === 'win') { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#ffc21a'); gr.addColorStop(1, '#b06a00'); c.fillStyle = gr; } else c.fillStyle = state === 'lose' ? '#4a4038' : 'rgba(20,12,4,.9)';
    c.fill(); c.lineWidth = 10; c.strokeStyle = goldGrad(c, 0, h); c.stroke();
    c.fillStyle = state === 'win' ? '#7a0d08' : state === 'lose' ? '#cfc4b4' : '#ffe9b8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = FONT(state === 'win' ? 70 : 120); c.fillText(state === 'win' ? '当たり' : state === 'lose' ? '×' : '？', w / 2, h / 2 + 6);
  });
  const gs = Math.min(gap * 0.6, 1.7);
  const goals = xs.map((x) => { const s = sprite(goalTex('hide'), gs, gs); s.position.set(x, BOT - gs * 0.62, 0); root.add(s); return s; });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(gap * 0.32, gap * 0.45, 30, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  pillar.position.set(0, 9, -0.6); root.add(pillar);
  // 道すじ
  function pathOf(lane, z = 0.02) {
    let x = lane; const pts = [new THREE.Vector3(xs[x], TOP, z)], cross = [];
    rungs.forEach((row, r) => { const y = ys[r]; if (row.includes(x)) { pts.push(new THREE.Vector3(xs[x], y, z), new THREE.Vector3(xs[x + 1], y, z)); cross.push([r, x, pts.length - 2]); x++; } else if (row.includes(x - 1)) { pts.push(new THREE.Vector3(xs[x], y, z), new THREE.Vector3(xs[x - 1], y, z)); cross.push([r, x - 1, pts.length - 2]); x--; } });
    pts.push(new THREE.Vector3(xs[x], BOT, z));
    return { pts, end: x, cross };
  }
  // 通った線(くじの色で光る)。曲がり角には玉を置いて、切れ目なくつなぐ
  // 前にたどった線は少し暗くして奥へ(新しい線が隠れない)
  const trails = [];
  const trail = (color) => { const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.25, metalness: 0.2, roughness: 0.3 }); trails.push(m); return m; };
  const dimTrails = () => trails.forEach((m) => { const e0 = m.emissiveIntensity; tween(0.5, (k) => { m.emissiveIntensity = e0 + (0.3 - e0) * k; }); });
  function trailSeg(a, b, mat) { const len = a.distanceTo(b); const m = cyl(1, mat, TR); m.position.copy(a); m.lookAt(b); m.rotateX(Math.PI / 2); m.scale.set(1, 0.0001, 1); m.visible = false; m.userData = { a, b, len }; root.add(m); return m; }
  function setSeg(m, k) { const { a, b, len } = m.userData; m.visible = k > 0.002; m.scale.y = Math.max(0.0001, len * k); m.position.copy(a).lerp(b, k / 2); }
  function joint(p, mat) { const b = ball(mat, TR); b.position.copy(p); root.add(b); return b; }
  const spanTop = TOP + tw * 0.56, spanBot = BOT - gs * 1.2, fullW = n * gap + 2;
  const tanH = Math.tan((17.5 * Math.PI) / 180);
  const distFor = (h) => Math.max(h / 2 / tanH, fullW / 2 / tanH / (W / H));
  const overview = () => { const h = (spanTop - spanBot) / 0.78, cy = (spanTop + spanBot) / 2 + 0.25; return { pos: new THREE.Vector3(0, cy, distFor(h)), look: new THREE.Vector3(0, cy, 0) }; };
  // たどるときの画角: 全体の半分くらいの高さ(横は全部入る)。距離は途中で変えない
  const followDist = Math.min(overview().pos.z, distFor((spanTop - spanBot) * 0.55));
  const ov = overview(); cam.pos.copy(ov.pos); cam.look.copy(ov.look); camNow.pos.copy(ov.pos); camNow.look.copy(ov.look);
  return {
    root,
    setOwner(i, team, anim) { tags[i].material.map = tagTexture(d.lots[i], team); tags[i].material.needsUpdate = true; if (anim) tween(0.5, (k) => { tags[i].position.y = TOP + tw * 0.3 + Math.sin(k * Math.PI) * 0.4; }, 'out'); },
    applyStatic(dd) {
      for (let k = 0; k < dd.opened; k++) {
        const lane = dd.order[k], p = pathOf(lane, 0.02 + k * 0.04), mat = trail(new THREE.Color(dd.lots[lane].color));
        if (lane !== dd.winLot) mat.emissiveIntensity = 0.3;
        p.cross.forEach(([r, i]) => showRung(r, i, false));
        for (let s = 0; s < p.pts.length - 1; s++) setSeg(trailSeg(p.pts[s], p.pts[s + 1], mat), 1);
        p.pts.forEach((q) => joint(q, mat));
        goals[p.end].material.map = goalTex(lane === dd.winLot ? 'win' : 'lose'); goals[p.end].material.needsUpdate = true;
      }
      if (dd.done) { rungMeshes.flat().forEach((o) => showRung(o.r, o.i, false)); goals.forEach((g, i) => { if (i !== d.amida.goal) { g.material.map = goalTex('lose'); g.material.needsUpdate = true; } }); }
    },
    async open(lane, win) {
      dimTrails();
      const p = pathOf(lane, 0.02 + trails.length * 0.04), color = new THREE.Color(d.lots[lane].color), team = D.owners[lane], tier = tierOf(D.id, lane, win), mat = trail(color);
      note(`${team} のくじをたどります`);
      const orb = ball(new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.25), toneMapped: false }), TR * 2.1);
      const orbLight = new THREE.PointLight(color, 4, 6, 1.4); orb.add(orbLight);
      const orbHalo = halo(color, 1.8); orbHalo.material.opacity = 0.75; orb.add(orbHalo);
      orb.position.copy(p.pts[0]); root.add(orb);
      // 1. 上下だけ寄る(横に振らない・傾けない・距離は一定)
      sfx('glow');
      const topY = Math.min(overview().look.y, TOP - 1.2);
      await camTo(new THREE.Vector3(0, topY, followDist), new THREE.Vector3(0, topY, 0), 0.8);
      tween(0.6, (k) => { reach(tier, k * 0.6); tierLight.color.copy(tierColor(tier)); tierLight.intensity = k * 2; });
      // 2. たどる: 一定の速さ(動き出しと止まりだけなめらか)。カメラは玉の高さに上下でついていく
      const segs = []; for (let s = 0; s < p.pts.length - 1; s++) segs.push(trailSeg(p.pts[s], p.pts[s + 1], mat));
      const lens = segs.map((m) => m.userData.len), total = lens.reduce((a, b) => a + b, 0);
      joint(p.pts[0], mat);
      const joined = new Set([0]);
      cam.follow = { orb, dist: followDist, minY: BOT + 1.0, maxY: topY };
      await tween(3.4, (k) => {
        let dist = k * total, s = 0;
        while (s < segs.length - 1 && dist > lens[s]) { setSeg(segs[s], 1); if (!joined.has(s + 1)) { joined.add(s + 1); joint(p.pts[s + 1], mat); } dist -= lens[s]; s++; }
        const q = Math.min(1, dist / lens[s]); setSeg(segs[s], q);
        orb.position.copy(segs[s].userData.a).lerp(segs[s].userData.b, q);
        p.cross.forEach(([r, i, at]) => { if (s >= at) showRung(r, i, true); });
        if (tier !== 'blue' && tier !== 'green') orbHalo.material.color.copy(tierColor(tier));
      }, 'inOut');
      setSeg(segs[segs.length - 1], 1); joint(p.pts[p.pts.length - 1], mat);
      cam.follow = null;
      // 3. ゴールに着いて結果
      goals[p.end].material.map = goalTex(win ? 'win' : 'lose'); goals[p.end].material.needsUpdate = true;
      tween(0.4, (k) => goals[p.end].scale.setScalar(gs * (1 + Math.sin(k * Math.PI) * 0.3)), 'out');
      tween(0.6, (k) => { orbLight.intensity = 4 * (1 - k); orbHalo.material.opacity = 0.75 * (1 - k); reach(tier, 0.6 * (1 - k)); tierLight.intensity = 2 * (1 - k); });
      if (win) {
        sfx('win'); note(`${team} が交渉権を獲得`);
        tween(0.25, (k) => flash(0.6 * (1 - k)));
        pillar.position.x = xs[p.end]; tween(0.6, (k) => { pillar.material.opacity = 0.45 * k; bgU.uWin.value = k; }, 'out');
        burstConfetti(new THREE.Vector3(xs[p.end], BOT + 0.5, 1));
        showResult(d.lots[lane], team, true);
        await sleep(2.0);
        showResult(null, '', false);
      } else { sfx('lose'); note(`${team}: 外れ`); await sleep(0.7); }
      root.remove(orb);
      // 4. 引いて全体を見せる(当たりのときは横線を全部見せて、公平に決まったことがわかるように)
      const o = overview();
      await camTo(o.pos, o.look, win ? 1.4 : 0.8);
      if (win) {
        rungMeshes.flat().forEach((x, k) => setTimeout(() => showRung(x.r, x.i, true), k * 45));
        goals.forEach((g, i) => { if (i !== p.end) setTimeout(() => { g.material.map = goalTex('lose'); g.material.needsUpdate = true; }, 500); });
        tween(1.4, (k) => { pillar.material.opacity = 0.45 * (1 - k * 0.5); bgU.uWin.value = 1 - k * 0.6; });
      }
    },
  };
}

/* ---------- 毎フレーム ---------- */
let last = now();
function frame() {
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  bgU.uTime.value = t;
  tweens = tweens.filter((tw) => { if (t < tw.t0) return true; const k = Math.min(1, (t - tw.t0) / tw.dur); tw.fn(tw.e(k)); if (k >= 1) { tw.res(); return false; } return true; });
  // あみだ: 玉の高さだけを、ばねのように遅れてなめらかに追う(横・回転・距離は変えない)
  if (cam.follow) {
    const y = Math.max(cam.follow.minY, Math.min(cam.follow.maxY, cam.follow.orb.position.y));
    const k = 1 - Math.exp(-dt * 3.2);
    cam.pos.y += (y - cam.pos.y) * k; cam.look.y += (y - 0.4 - cam.look.y) * k;
    cam.pos.x = cam.look.x = 0; cam.pos.z = cam.follow.dist;
  }
  // 実際のカメラも、時間あたり一定の減衰でついていく(フレームの速さで動きが変わらない)
  const k2 = 1 - Math.exp(-dt * 10);
  camNow.pos.lerp(cam.pos, k2); camNow.look.lerp(cam.look, k2);
  camera.position.copy(camNow.pos); camera.lookAt(camNow.look);
  stepConfetti(dt);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'lots') onData(m.data); });
parent.postMessage({ type: 'lots3d-ready' }, '*');
