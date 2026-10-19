// 配信画面の背景(テーマごとの 3D)。配信画面の一番奥に iframe で入る
// ゆっくり動かして安っぽくしない(ハトオーバーレイの知見):
//   ・被写界深度: ピントから外れた粒ほど、ミップマップでぼかして(にじませて)少し白っぽく。不透明感は保つ
//   ・カメラの散歩: 周期の違う sin を重ねて、ゆっくり回り込む・寄る
//   ・光のにじみ: 光る粒は柔らかい縁の絵を足し算で重ねる(透明の背景を壊さないよう、後処理のブルームは使わない)
// 映していないとき(光の世界・何も出さない・OBS で映っていない)は描かない: 親から { type: 'bg-run', on }
// ?theme=<id> / ?over=1 自分の背景画像の上に重ねる(奥の色を出さず、動くものだけ)
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const THEME = q.get('theme') || 'sports';
const OVER = q.has('over');
const LITE = q.has('lite'); // 小さな見本: 解像度を落として、1秒に30回
document.body.dataset.theme = THEME;
document.body.classList.toggle('over', OVER);

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const deg = Math.PI / 180;

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setPixelRatio(LITE ? 0.3 : 1);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- 絵(粒の形)。ぼかしても縁が黒ずまないよう、周りを広く透明にして色は乗算済みで使う ---------- */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const TEX = {
  // 柔らかい丸(光の粒・ボケ)
  dot: () => canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.3); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }),
  // 縁が少し明るい丸(遠くの照明のボケ)
  bokeh: () => canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.3); r.addColorStop(0, 'rgba(255,255,255,.35)'); r.addColorStop(0.85, 'rgba(255,255,255,.55)'); r.addColorStop(0.97, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.beginPath(); g.arc(w / 2, w / 2, w * 0.3, 0, Math.PI * 2); g.fill(); }),
  // 横に長い光の筋
  streak: () => canvasTex(512, 64, (g, w, h) => { const r = g.createLinearGradient(w * 0.12, 0, w * 0.88, 0); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.7, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; const v = g.createLinearGradient(0, h * 0.3, 0, h * 0.7); g.fillRect(w * 0.12, h * 0.42, w * 0.76, h * 0.16); void v; }),
  // 縁がぼやけた帯(大きな斜めの帯)
  band: () => canvasTex(256, 64, (g, w, h) => { const r = g.createLinearGradient(0, h * 0.2, 0, h * 0.8); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.5, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.6); }),
  // ガラスの札(角丸・縁が明るい)
  card: () => canvasTex(256, 160, (g, w, h) => { const x = w * 0.15, y = h * 0.15, cw = w * 0.7, ch = h * 0.7, rr = 10; g.beginPath(); g.roundRect(x, y, cw, ch, rr); const f = g.createLinearGradient(x, y, x + cw, y + ch); f.addColorStop(0, 'rgba(255,255,255,.55)'); f.addColorStop(0.5, 'rgba(255,255,255,.18)'); f.addColorStop(1, 'rgba(255,255,255,.4)'); g.fillStyle = f; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke(); }),
  // 桜の花びら(先が少し割れたしずく形)
  petal: () => canvasTex(128, 128, (g, w) => {
    g.translate(w / 2, w / 2);
    g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(-26, 12, -22, -22, -6, -30); g.lineTo(0, -24); g.lineTo(6, -30); g.bezierCurveTo(22, -22, 26, 12, 0, 30); g.closePath();
    const r = g.createLinearGradient(0, 30, 0, -30); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,214,226,1)'); r.addColorStop(1, 'rgba(248,170,196,1)');
    g.fillStyle = r; g.fill();
  }),
  // 金箔の小片
  flake: () => canvasTex(64, 64, (g, w) => { const r = g.createLinearGradient(20, 20, 44, 44); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(1, 'rgba(200,150,70,1)'); g.fillStyle = r; g.beginPath(); g.moveTo(22, 20); g.lineTo(44, 24); g.lineTo(42, 44); g.lineTo(20, 40); g.closePath(); g.fill(); }),
};

/* ---------- 粒の層: 位置・動き・回転は GPU で計算(箱の中をぐるぐる回る) ---------- */
const VERT = `
uniform float uTime, uFocus, uAperture, uMaxBlur;
uniform vec3 uBox, uCenter;
attribute vec3 aPos, aVel;
attribute vec2 aSize;
attribute vec4 aCol, aRot, aSway;
varying vec2 vUv; varying vec4 vCol; varying float vBlur;
void main() {
  vec3 p = aPos + aVel * uTime;
  p.x += aSway.x * sin(uTime * aSway.z + aSway.w);
  p.y += aSway.y * sin(uTime * aSway.z * 0.7 + aSway.w * 1.3);
  p = uCenter + mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float blur = clamp(abs(-mv.z - uFocus) * uAperture, 0.0, uMaxBlur);
  vBlur = blur;
  float ang = aRot.x + aRot.y * uTime;
  float fl = cos(aRot.z + aRot.w * uTime);
  vec2 c = position.xy * aSize * vec2(mix(0.12, 1.0, abs(fl)), 1.0);
  float grow = 1.0 + blur * 0.18;
  c *= grow;
  c = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  mv.xy += c;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCol = aCol;
  vCol.a *= 1.0 / (grow * grow) * mix(1.0, 0.75 + 0.25 * abs(fl), step(0.001, aRot.w));
  // 箱の端で急に消えたり出たりしないように
  vec3 e = abs(p - uCenter) / (0.5 * uBox);
  vCol.a *= smoothstep(1.0, 0.82, max(max(e.x, e.y), e.z));
}`;
const FRAG = `
uniform sampler2D uMap;
uniform float uWash;
uniform vec3 uWashCol;
varying vec2 vUv; varying vec4 vCol; varying float vBlur;
void main() {
  // ミップでぼかす(上げすぎると絵が四角い色になるので上限つき)。板の縁は消す
  vec4 t = texture2D(uMap, vUv, min(vBlur, 3.2));
  vec2 d = abs(vUv - 0.5);
  t *= smoothstep(0.5, 0.4, max(d.x, d.y));
  vec3 col = t.rgb * vCol.rgb;
  float k = clamp(vBlur / 3.5, 0.0, 1.0);
  float gray = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(gray), k * 0.2);
  col = mix(col, uWashCol * t.a, k * uWash);
  gl_FragColor = vec4(col, t.a) * vCol.a;
}`;
const layers = [];
function layer(o) {
  const n = OVER ? Math.round(o.count * (o.overScale ?? 0.6)) : o.count;
  if (!n || (OVER && o.over === false)) return;
  const g = new THREE.InstancedBufferGeometry();
  g.copy(new THREE.PlaneGeometry(1, 1));
  g.instanceCount = n;
  const A = { aPos: 3, aVel: 3, aSize: 2, aCol: 4, aRot: 4, aSway: 4 };
  const arr = Object.fromEntries(Object.entries(A).map(([k, s]) => [k, new Float32Array(n * s)]));
  for (let i = 0; i < n; i++) {
    const v = o.make(i);
    for (const [k, s] of Object.entries(A)) for (let j = 0; j < s; j++) arr[k][i * s + j] = (v[k.slice(1).toLowerCase()] || [])[j] ?? 0;
  }
  for (const [k, s] of Object.entries(A)) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr[k], s));
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uMap: { value: TEX[o.tex]() }, uBox: { value: new THREE.Vector3(...o.box) }, uCenter: { value: new THREE.Vector3(...o.center) },
      uFocus: { value: o.focus ?? 22 }, uAperture: { value: o.aperture ?? 0.28 }, uMaxBlur: { value: o.maxBlur ?? 4.5 },
      uWash: { value: o.wash ?? 0.15 }, uWashCol: { value: new THREE.Color(o.washCol ?? '#ffffff') },
    },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = o.order ?? 0;
  scene.add(mesh); layers.push(m);
}
const col = (hex, a = 1) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b, a]; };
// 箱: 中心 z=-22、幅は画面より少し広く(カメラが回り込んでも端が見えない)
const BOX = [64, 38, 40], CEN = [0, 0, -22];

/* ---------- テーマごとの中身 ---------- */
const THEMES = {
  // スポーツ中継: 紺のスタジアム。斜めに流れる光の筋・遠くの照明のボケ・大きな斜めの帯
  sports() {
    const A = -18 * deg, dir = [Math.cos(A), Math.sin(A)];
    layer({ count: 6, tex: 'band', box: [90, 50, 30], center: [0, 0, -30], over: false, order: -2, aperture: 0.05,
      make: () => { const sp = rand(0.4, 1.0); return { pos: [rand(-45, 45), rand(-25, 25), rand(-40, -20)], vel: [dir[0] * sp, dir[1] * sp, 0], size: [rand(70, 110), rand(4, 9)], col: col(pick(['#3d7bff', '#ffffff', '#4fc3ff']), rand(0.05, 0.1)), rot: [A, 0, 0, 0] }; } });
    layer({ count: 50, tex: 'bokeh', box: [90, 50, 30], center: [0, 2, -42], add: true, order: -1,
      make: () => ({ pos: [rand(-45, 45), rand(-25, 25), rand(-55, -30)], vel: [rand(-0.15, 0.15), rand(-0.05, 0.05), 0], size: [rand(1.2, 3.4), 0].map((v, i, a) => (i ? a[0] : v)), col: col(pick(['#ffffff', '#cfe6ff', '#8fc4ff']), rand(0.12, 0.3)), sway: [0.3, 0.3, rand(0.1, 0.3), rand(0, 6)] }) });
    layer({ count: 80, tex: 'streak', box: BOX, center: CEN, add: true, focus: 20, aperture: 0.22,
      make: () => { const sp = rand(1.6, 4.2); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [dir[0] * sp, dir[1] * sp, 0], size: [rand(5, 13), rand(0.16, 0.34)], col: col(pick(['#ffffff', '#8fd8ff', '#4f8dff', '#ffffff']), rand(0.35, 0.8)), rot: [A, 0, 0, 0] }; } });
    layer({ count: 90, tex: 'dot', box: BOX, center: CEN, add: true, focus: 20, aperture: 0.3,
      make: () => { const s = rand(0.18, 0.4); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [dir[0] * 0.8, dir[1] * 0.8 + 0.2, 0], size: [s, s], col: col(pick(['#ffffff', '#9fe0ff']), rand(0.4, 0.9)), sway: [0.4, 0.4, rand(0.2, 0.5), rand(0, 6)] }; } });
  },
  // ドラフト会議: 白い会見場。ゆっくり漂うガラスの札、細かいちり、斜めの光
  draft() {
    layer({ count: 5, tex: 'band', box: [90, 50, 20], center: [0, 0, -40], over: false, add: true, order: -2, aperture: 0.02,
      make: () => ({ pos: [rand(-40, 40), rand(-10, 10), -40], vel: [rand(0.15, 0.3), 0, 0], size: [rand(50, 70), rand(6, 12)], col: col('#ffffff', rand(0.25, 0.45)), rot: [rand(62, 70) * deg, 0, 0, 0] }) });
    layer({ count: 16, tex: 'card', box: [70, 40, 36], center: [0, 0, -24], focus: 22, aperture: 0.3, wash: 0.35, overScale: 0.4,
      make: () => { const s = rand(3.2, 6); return { pos: [rand(-35, 35), rand(-20, 20), rand(-40, -8)], vel: [rand(0.15, 0.35), rand(0.04, 0.12), 0], size: [s * 1.6, s], col: col(pick(['#ffffff', '#e9eef8', '#f3f0e6']), rand(0.8, 1)), rot: [rand(-8, 8) * deg, rand(-0.02, 0.02), rand(0, 6), rand(0.05, 0.14)], sway: [0.6, 0.5, rand(0.05, 0.12), rand(0, 6)] }; } });
    layer({ count: 200, tex: 'dot', box: BOX, center: CEN, focus: 18, aperture: 0.25,
      make: () => { const s = rand(0.12, 0.28); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [rand(0.05, 0.2), rand(0.08, 0.25), 0], size: [s, s], col: col(pick(['#8a93a6', '#b9a46a', '#a7b0c2']), rand(0.35, 0.7)), sway: [0.5, 0.4, rand(0.1, 0.3), rand(0, 6)] }; } });
  },
  // 桜: 舞い落ちる花びら(手前は大きくぼけ、奥は小さく)、遠くの花のかたまりのボケ
  sakura() {
    layer({ count: 22, tex: 'dot', box: [90, 50, 30], center: [0, 0, -44], over: false, order: -1, aperture: 0.02,
      make: () => { const s = rand(4, 10); return { pos: [rand(-45, 45), rand(-25, 25), -44], vel: [rand(0.05, 0.2), rand(-0.05, 0.05), 0], size: [s, s], col: col(pick(['#ffc6d6', '#ffdbe5', '#f9b4c8']), rand(0.35, 0.6)), sway: [1, 0.6, rand(0.05, 0.1), rand(0, 6)] }; } });
    layer({ count: 230, tex: 'petal', box: BOX, center: CEN, focus: 20, aperture: 0.26, wash: 0.12, overScale: 0.7,
      make: () => { const s = rand(0.9, 1.5); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [rand(0.5, 1.1), rand(-1.3, -0.6), 0], size: [s, s], col: col(pick(['#ffffff', '#fff0f4', '#ffe1ea', '#ffd0dd']), rand(0.75, 1)), rot: [rand(0, 6.3), rand(-0.8, 0.8), rand(0, 6.3), rand(0.8, 2.2)], sway: [rand(0.4, 1), rand(0.2, 0.5), rand(0.4, 0.9), rand(0, 6)] }; } });
    layer({ count: 40, tex: 'dot', box: BOX, center: CEN, add: true, focus: 20, aperture: 0.3,
      make: () => { const s = rand(0.16, 0.32); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [0.3, -0.2, 0], size: [s, s], col: col('#ffffff', rand(0.3, 0.7)), sway: [0.5, 0.5, rand(0.3, 0.6), rand(0, 6)] }; } });
  },
  // タイトル戦: 夜の対局室。立ちのぼる金の粉、ゆっくり回る金箔
  title() {
    layer({ count: 40, tex: 'bokeh', box: [90, 50, 30], center: [0, 0, -44], over: false, add: true, order: -1, aperture: 0.03,
      make: () => { const s = rand(1.5, 4); return { pos: [rand(-45, 45), rand(-25, 25), -46], vel: [rand(-0.05, 0.05), rand(0.05, 0.15), 0], size: [s, s], col: col(pick(['#ffcf7a', '#e8a94a', '#ffdca0']), rand(0.1, 0.22)), sway: [0.6, 0.3, rand(0.05, 0.12), rand(0, 6)] }; } });
    layer({ count: 260, tex: 'dot', box: BOX, center: CEN, add: true, focus: 19, aperture: 0.28,
      make: () => { const s = rand(0.14, 0.32); return { pos: [rand(-32, 32), rand(-19, 19), rand(-42, -4)], vel: [rand(-0.1, 0.1), rand(0.15, 0.45), 0], size: [s, s], col: col(pick(['#ffe2a0', '#ffcf6a', '#fff2cc']), rand(0.45, 0.95)), rot: [0, 0, rand(0, 6), rand(1, 3)], sway: [0.6, 0.3, rand(0.2, 0.5), rand(0, 6)] }; } });
    layer({ count: 46, tex: 'flake', box: BOX, center: CEN, add: true, focus: 19, aperture: 0.26,
      make: () => { const s = rand(0.45, 0.85); return { pos: [rand(-32, 32), rand(-19, 19), rand(-40, -6)], vel: [rand(-0.1, 0.1), rand(0.1, 0.3), 0], size: [s, s], col: col('#ffd78a', rand(0.5, 0.9)), rot: [rand(0, 6.3), rand(-0.4, 0.4), rand(0, 6.3), rand(0.6, 1.6)], sway: [0.5, 0.3, rand(0.2, 0.4), rand(0, 6)] }; } });
  },
};
(THEMES[THEME] || THEMES.sports)();

/* ---------- カメラの散歩(ゆっくり回り込む・寄る) ---------- */
function walk(t) {
  const yaw = (4 * Math.sin(0.11 * t) + 2 * Math.sin(0.047 * t)) * deg;
  const pitch = (1.6 * Math.sin(0.08 * t) + 0.8 * Math.sin(0.031 * t)) * deg;
  const dist = 22 - 2.2 * (0.5 + 0.5 * Math.sin(0.05 * t));
  const target = new THREE.Vector3(0, 0, -22);
  camera.position.set(target.x + Math.sin(yaw) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * dist);
  camera.lookAt(target);
  camera.rotation.z += 0.6 * deg * Math.sin(0.06 * t);
}

/* ---------- 描く(映していないときは止める) ---------- */
let running = !window.parent || window.parent === window, time = rand(0, 100), last = performance.now(), raf = 0;
function frame(now) {
  raf = 0;
  if (!running) return;
  // 1秒に60回まで(リフレッシュレートの高い画面でむだに描かない)
  if (now - last < (LITE ? 31 : 15)) { raf = requestAnimationFrame(frame); return; }
  time += Math.min(0.05, (now - last) / 1000); last = now;
  walk(time);
  for (const m of layers) m.uniforms.uTime.value = time;
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}
function setRun(on) {
  running = on;
  if (on && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}
addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'bg-run') setRun(!!m.on); });
// 最初の1枚は描いておく(切り替えた瞬間に何も無い、を避ける)
walk(time); for (const m of layers) m.uniforms.uTime.value = time; renderer.render(scene, camera);
if (running) setRun(true);
if (window.parent !== window) window.parent.postMessage({ type: 'bg-ready' }, '*');
