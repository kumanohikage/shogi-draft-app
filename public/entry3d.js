// 光の世界(3D の抽選)へ入るときの切り替え(3D)。配信画面の一番手前に iframe で入る
// 考え方: 画面を完全に覆う → 覆っている間に入れ替える(親へ entry-swap)→ 開ける(親へ entry-end)
//   流れもの(桜の花吹雪・スポーツの帯)は止めずに通り抜ける: 少しずつ増えながら押し寄せ、覆い尽くし、そのまま流れ去る
//   障子(タイトル戦)は閉まって開く
// 安っぽくしない(ハトオーバーレイの知見): 奥行きの視差(手前ほど速く大きい)・被写界深度(ピントから外れるほどぼかす)・面の向きで明るさが変わる光
// 動かしていないときは描かない。親から { type: 'entry-play', kind, colors }
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
const TANH = Math.tan((camera.fov / 2) * Math.PI / 180);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const R = (a, b) => a + Math.random() * (b - a);
const hex = (h) => new THREE.Color(h);

/* ---------- 花びらの絵(ぼかしても縁が黒ずまないよう、色は乗算済み・周りを広く透明に) ---------- */
function petalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(-26, 12, -22, -22, -6, -30); g.lineTo(0, -24); g.lineTo(6, -30); g.bezierCurveTo(22, -22, 26, 12, 0, 30); g.closePath();
  const r = g.createLinearGradient(0, 30, 0, -30); r.addColorStop(0, '#ffffff'); r.addColorStop(0.6, '#ffe4ec'); r.addColorStop(1, '#ffc4d4');
  g.fillStyle = r; g.fill();
  // 花びらの筋
  g.globalAlpha = 0.18; g.strokeStyle = '#e88aa8'; g.lineWidth = 1;
  for (const x of [-8, 0, 8]) { g.beginPath(); g.moveTo(0, 28); g.quadraticCurveTo(x * 0.6, 0, x, -22); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* ---------- 流れもの: 下地(覆いきる帯)＋粒(奥行きつき)。下地のふちは粒の下に隠れる ---------- */
// 位置はすべて「画面の半幅を1とした横の座標」で決め、奥行きごとに実際の大きさへ直す。流れの位置 uC が全体を運ぶ
const BACK_VERT = `varying vec2 vN; void main() { vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BACK_FRAG = `
uniform float uC, uCore, uEdge, uSlant, uDir, uRag;
uniform vec3 uCol, uCol2;
varying vec2 vN;
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
void main() {
  float s = uDir * vN.x + vN.y * uSlant;
  // ふちはまっすぐにせず、でこぼこに(花びらが集まったふちに見えるように)。前と後ろで形を変える
  float r1 = (vnoise(vN.y * 5.0 + 3.1) * 0.7 + vnoise(vN.y * 13.0 + 7.7) * 0.3 - 0.5) * uRag;
  float r2 = (vnoise(vN.y * 5.0 + 11.3) * 0.7 + vnoise(vN.y * 13.0 + 1.9) * 0.3 - 0.5) * uRag;
  float a = smoothstep(uC - uCore - uEdge, uC - uCore, s + r1) * (1.0 - smoothstep(uC + uCore, uC + uCore + uEdge, s + r2));
  vec3 col = mix(uCol2, uCol, vN.y * 0.5 + 0.5);
  gl_FragColor = vec4(col * a, a);
}`;
function backing(cfg) {
  const m = new THREE.ShaderMaterial({
    vertexShader: BACK_VERT, fragmentShader: BACK_FRAG, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
    uniforms: { uC: { value: 0 }, uCore: { value: cfg.core }, uEdge: { value: cfg.edge }, uRag: { value: cfg.rag || 0 }, uSlant: { value: cfg.slant || 0 }, uDir: { value: cfg.dir }, uCol: { value: hex(cfg.col[0]) }, uCol2: { value: hex(cfg.col[1]) } },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

// 花びら: 3D で回る(縦にも横にも)。面の向きで明るさが変わる。左右に揺れて、少しずつ落ちる
const PETAL_VERT = `
uniform float uT, uC, uTanH, uAspect, uRefD, uPar, uFocus, uAperture, uDir;
attribute vec4 aA; // 横の位置 u・縦の位置・奥行き・大きさ(px)
attribute vec4 aB; // 回転の軸・回る速さ
attribute vec4 aF; // 位相・揺れの幅・揺れの速さ・落ちる速さ
attribute vec3 aTint;
varying vec2 vUv; varying vec3 vTint; varying float vShade, vBlur, vA;
vec3 rot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float d = aA.z, g = pow(uRefD / d, uPar);
  float xn = uDir * (aA.x + uC * g) + aF.y * sin(uT * aF.z + aF.x);
  float yn = aA.y - aF.w * uT + aF.y * 0.6 * sin(uT * aF.z * 0.7 + aF.x * 1.7);
  float hH = d * uTanH, hW = hH * uAspect;
  vec3 c = vec3(xn * hW, yn * hH, -d);
  float blur = clamp(abs(d - uFocus) * uAperture, 0.0, 3.2);
  float grow = 1.0 + blur * 0.18;
  float ws = aA.w / 1080.0 * 2.0 * hH * grow;
  vec3 k = normalize(aB.xyz);
  float ang = aF.x * 3.0 + aB.w * uT;
  vec3 p = rot(vec3(position.xy * ws, 0.0), k, ang);
  vec3 n = rot(vec3(0.0, 0.0, 1.0), k, ang);
  vec3 L = normalize(vec3(0.35, 0.8, 0.5));
  vShade = 0.86 + 0.24 * abs(dot(n, L)); // 光の当たる向きで明るく(影は灰色にせず桜色へ)
  if (n.z < 0.0) vShade *= 0.95; // 裏は少し暗く
  vBlur = blur; vA = 1.0 / (grow * grow);
  vUv = uv; vTint = aTint;
  gl_Position = projectionMatrix * vec4(c + p, 1.0);
}`;
const PETAL_FRAG = `
uniform sampler2D uMap;
varying vec2 vUv; varying vec3 vTint; varying float vShade, vBlur, vA;
void main() {
  vec4 t = texture2D(uMap, vUv, min(vBlur, 3.2));
  vec2 dd = abs(vUv - 0.5);
  t *= smoothstep(0.5, 0.42, max(dd.x, dd.y));
  vec3 col = t.rgb * vTint;
  col = vShade < 1.0 ? mix(col * vec3(0.93, 0.74, 0.82), col, smoothstep(0.86, 1.0, vShade)) : col * vShade;
  gl_FragColor = vec4(col, t.a) * vA;
}`;
// 帯(スポーツ): 斜めの細長い板。光沢の筋と、縁の影
const SLAB_VERT = `
uniform float uT, uC, uTanH, uAspect, uRefD, uPar, uFocus, uAperture, uDir, uAng;
attribute vec4 aA; // u・奥行き・幅(px)・濃さ
attribute vec3 aTint;
varying vec2 vUv; varying vec3 vTint; varying float vBlur, vA;
void main() {
  float d = aA.y, g = pow(uRefD / d, uPar);
  float xn = uDir * (aA.x + uC * g);
  float hH = d * uTanH, hW = hH * uAspect;
  float blur = clamp(abs(d - uFocus) * uAperture, 0.0, 2.5);
  vec2 sz = vec2(aA.z / 1080.0 * 2.0 * hH * (1.0 + blur * 0.1), hH * 3.2);
  vec2 q = position.xy * sz;
  float a = uAng * uDir;
  q = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  vBlur = blur; vA = aA.w; vUv = uv; vTint = aTint;
  gl_Position = projectionMatrix * vec4(xn * hW + q.x, q.y, -d, 1.0);
}`;
const SLAB_FRAG = `
varying vec2 vUv; varying vec3 vTint; varying float vBlur, vA;
void main() {
  float x = vUv.x;
  float soft = 0.02 + vBlur * 0.06;
  float edge = smoothstep(0.0, soft, x) * smoothstep(1.0, 1.0 - soft, x);
  vec3 col = vTint * (0.82 + 0.28 * x);
  col += vec3(1.0) * 0.35 * smoothstep(0.1, 0.16, x) * (1.0 - smoothstep(0.16, 0.24, x)); // 光沢の筋
  col *= 1.0 - 0.25 * smoothstep(0.85, 1.0, x); // 縁の影
  float a = edge * vA;
  gl_FragColor = vec4(col * a, a);
}`;

function instanced(n, attrs, vert, frag, uniforms, extra = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.copy(new THREE.PlaneGeometry(1, 1));
  g.instanceCount = n;
  for (const [k, [size, arr]] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, size));
  const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true, ...extra });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
// 密度の形に合わせて横の位置を選ぶ(先頭はまばらで少しずつ増え、芯はぎっしり、後ろはまた減る)
function sampleU(dens, lo, hi) { for (;;) { const u = R(lo, hi); if (Math.random() < dens(u)) return u; } }

// 流れの位置: はじめ少し加速、あとは同じ速さで通り抜ける(止まらない)
const flow = (c0, c1, T) => (t) => { const s = Math.min(1, Math.max(0, t / T)); return c0 + (c1 - c0) * (0.82 * s + 0.18 * s * s * (3 - 2 * s)); };

/* ---------- 桜: 右から花吹雪が少しずつ増えて押し寄せ、画面を覆い尽くし、そのまま左へ流れ去る ---------- */
function sakura() {
  const scene = new THREE.Scene();
  const CORE = 2.0, T = 3.4, REF = 26;
  const back = backing({ core: CORE, edge: 0.14, rag: 0.5, dir: 1, col: ['#fde3eb', '#fff0f4'] });
  scene.add(back);
  // 先頭(左側の u)はまばら → 芯 → 後ろ。下地のふち(±CORE)には多めに重ねてふちを隠す
  const dens = (u) => (u < -CORE ? Math.pow(Math.max(0, (u + 4.8) / (4.8 - CORE)), 1.8) : u > CORE ? Math.max(0, 1 - (u - CORE) / 1.7) : 1);
  const layers = [[2900, [20, 36], [16, 34], 1.4], [1700, [9, 20], [28, 72], 1.2], [1900, [23, 29], [56, 130], 1.25, 'edge'], [170, [3.2, 9], [130, 320], 1.0]];
  const list = [];
  for (const [n, dr, sr, yr, edge] of layers) for (let i = 0; i < n; i++) {
    const u = edge ? (Math.random() < 0.5 ? -1 : 1) * (CORE + R(-0.5, 0.4)) : sampleU(dens, -4.8, CORE + 1.7);
    const tint = [[1, 0.95, 0.97], [1, 0.9, 0.94], [0.99, 0.84, 0.9], [1, 0.97, 0.98]][Math.floor(Math.random() * 4)];
    list.push({ d: R(dr[0], dr[1]), a: [u, R(-yr, yr + 0.4), 0, R(sr[0], sr[1])], b: [R(-1, 1), R(-1, 1), R(-0.4, 1), R(2.5, 7)], f: [R(0, 6.3), R(0.01, 0.03), R(2, 5), R(0.05, 0.16)], tint });
  }
  list.sort((p, q) => q.d - p.d); // 奥から描く
  const n = list.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4), F = new Float32Array(n * 4), C = new Float32Array(n * 3);
  list.forEach((p, i) => { p.a[2] = p.d; A.set(p.a, i * 4); B.set(p.b, i * 4); F.set(p.f, i * 4); C.set(p.tint, i * 3); });
  const uni = { uT: { value: 0 }, uC: { value: 0 }, uTanH: { value: TANH }, uAspect: { value: 16 / 9 }, uRefD: { value: REF }, uPar: { value: 0.35 }, uFocus: { value: 15 }, uAperture: { value: 0.22 }, uDir: { value: 1 }, uMap: { value: petalTexture() } };
  scene.add(instanced(n, { aA: [4, A], aB: [4, B], aF: [4, F], aTint: [3, C] }, PETAL_VERT, PETAL_FRAG, uni));
  // 先頭が右の外 → 後ろが左の外へ
  // 奥の花びらは遅く見える(視差)ので、終わりは奥の分まで抜けきるところまで
  const pos = flow(4.8 + 1.15, -(CORE + 1.7 + 1.2) / 0.88, T);
  return {
    scene, duration: T, swapAt: null,
    update(t) { const c = pos(t); uni.uT.value = t; uni.uC.value = c; back.material.uniforms.uC.value = c; this.covered = Math.abs(c) <= CORE - 1.02 - 0.25; },
  };
}

/* ---------- スポーツ中継: チームカラーの板が奥行きをつけて斜めに走り抜け、覆い尽くし、そのまま抜ける ---------- */
function band(colors) {
  const scene = new THREE.Scene();
  const CORE = 2.0, T = 1.9, REF = 14, SLANT = Math.tan(18 * Math.PI / 180) * 9 / 16;
  const back = backing({ core: CORE, edge: 0.25, dir: -1, slant: SLANT, col: ['#13285e', '#0b1633'] });
  scene.add(back);
  const pal = [...colors, '#ffd400', '#ffffff', '#1f5bff', '#13285e'].map((h) => hex(h));
  const dens = (u) => (u < -CORE ? Math.max(0, (u + 4.2) / (4.2 - CORE)) : u > CORE ? Math.max(0, 1 - (u - CORE) / 1.2) : 0.55);
  const list = [];
  for (let i = 0; i < 70; i++) list.push({ d: R(8, 22), u: sampleU(dens, -4.2, CORE + 1.2), w: R(90, 460), a: 1, c: pal[Math.floor(Math.random() * pal.length)] });
  for (let i = 0; i < 26; i++) list.push({ d: R(5, 20), u: sampleU(dens, -4.2, CORE + 1.2), w: R(3, 9), a: 0.8, c: hex('#ffffff') }); // 細い光の線
  for (let i = 0; i < 10; i++) list.push({ d: R(2.5, 5), u: (Math.random() < 0.5 ? -1 : 1) * CORE + R(-0.3, 0.3), w: R(260, 600), a: 1, c: pal[Math.floor(Math.random() * pal.length)] }); // 手前の大きな板(ぼける)
  list.sort((p, q) => q.d - p.d);
  const n = list.length, A = new Float32Array(n * 4), C = new Float32Array(n * 3);
  list.forEach((p, i) => { A.set([p.u, p.d, p.w, p.a], i * 4); C.set([p.c.r, p.c.g, p.c.b], i * 3); });
  const uni = { uT: { value: 0 }, uC: { value: 0 }, uTanH: { value: TANH }, uAspect: { value: 16 / 9 }, uRefD: { value: REF }, uPar: { value: 0.5 }, uFocus: { value: 12 }, uAperture: { value: 0.25 }, uDir: { value: -1 }, uAng: { value: -18 * Math.PI / 180 } };
  scene.add(instanced(n, { aA: [4, A], aTint: [3, C] }, SLAB_VERT, SLAB_FRAG, uni));
  const pos = flow((4.2 + 1 + SLANT) / 0.78, -(CORE + 1.2 + 1 + SLANT) / 0.78, T);
  return { scene, duration: T, update(t) { const c = pos(t); uni.uT.value = t; uni.uC.value = c; back.material.uniforms.uC.value = c; this.covered = Math.abs(c) <= CORE - 1 - SLANT - 0.02; } };
}

/* ---------- タイトル戦: 木の枠と和紙の障子が閉まり(後ろから灯りが透ける)、開く ---------- */
function shoji() {
  const scene = new THREE.Scene();
  const D = 6, hH = D * TANH, hW = hH * 16 / 9, PW = hW + 0.35, PH = hH * 2 + 0.6;
  // 和紙: 繊維のむら
  const pc = document.createElement('canvas'); pc.width = pc.height = 512;
  const pg = pc.getContext('2d'); pg.fillStyle = '#f4ead4'; pg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { pg.strokeStyle = `rgba(${R(170, 220) | 0},${R(150, 200) | 0},${R(110, 160) | 0},${R(0.04, 0.12)})`; pg.lineWidth = R(0.5, 1.4); const x = R(0, 512), y = R(0, 512), a = R(0, 6.3), l = R(4, 18); pg.beginPath(); pg.moveTo(x, y); pg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); pg.stroke(); }
  const paperTex = new THREE.CanvasTexture(pc); paperTex.colorSpace = THREE.SRGBColorSpace;
  // 木目
  const wc = document.createElement('canvas'); wc.width = 64; wc.height = 512;
  const wg = wc.getContext('2d'); wg.fillStyle = '#6b4526'; wg.fillRect(0, 0, 64, 512);
  for (let i = 0; i < 40; i++) { wg.strokeStyle = `rgba(40,22,10,${R(0.15, 0.35)})`; wg.lineWidth = R(0.5, 2); const x = R(0, 64); wg.beginPath(); wg.moveTo(x, 0); wg.bezierCurveTo(x + R(-6, 6), 170, x + R(-6, 6), 340, x + R(-4, 4), 512); wg.stroke(); }
  const woodTex = new THREE.CanvasTexture(wc); woodTex.colorSpace = THREE.SRGBColorSpace;
  const paperMat = new THREE.MeshStandardMaterial({ map: paperTex, emissive: hex('#ffe6c2'), emissiveMap: paperTex, emissiveIntensity: 0.3, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0.05 });
  const panel = (sign) => {
    const grp = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), paperMat); grp.add(paper);
    const bar = (w, h, x, y, depth = 0.14) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), woodMat); m.position.set(x, y, depth / 2); grp.add(m); };
    const F = 0.16; // 外枠
    bar(PW, F, 0, PH / 2 - F / 2, 0.2); bar(PW, F, 0, -PH / 2 + F / 2, 0.2); bar(F, PH, -PW / 2 + F / 2, 0, 0.2); bar(F, PH, PW / 2 - F / 2, 0, 0.2);
    for (let i = 1; i < 4; i++) bar(0.035, PH, -PW / 2 + (PW * i) / 4, 0); // 組子(縦)
    for (let i = 1; i < 6; i++) bar(PW, 0.035, 0, -PH / 2 + (PH * i) / 6); // 組子(横)
    // 引き手
    const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), new THREE.MeshStandardMaterial({ color: '#2a1c12', roughness: 0.4, metalness: 0.4 }));
    hand.rotation.x = Math.PI / 2; hand.position.set(sign * -(PW / 2 - 0.4), 0, 0.17); grp.add(hand);
    grp.position.z = -D;
    scene.add(grp);
    return grp;
  };
  const L = panel(-1), Rp = panel(1);
  scene.add(new THREE.AmbientLight('#fff1dc', 0.55));
  const key = new THREE.DirectionalLight('#ffe6c0', 1.6); key.position.set(-3, 4, 3); scene.add(key);
  const rim = new THREE.PointLight('#ffb070', 6, 12); rim.position.set(0, 0.5, -D + 1.6); scene.add(rim);
  const ease = (s) => (s < 0 ? 0 : s > 1 ? 1 : s);
  const closeE = (s) => 1 - Math.pow(1 - ease(s), 3), openE = (s) => { s = ease(s); return s * s * (3 - 2 * s); };
  const TC = 0.6, TH = 0.4, TO = 1.0, T = TC + TH + TO;
  return {
    scene, duration: T,
    update(t) {
      const closed = t < TC ? closeE(t / TC) : t < TC + TH ? 1 : 1 - openE((t - TC - TH) / TO);
      const off = (1 - closed) * (PW + 0.3);
      L.position.x = -PW / 2 - off + 0.01; Rp.position.x = PW / 2 + off - 0.01;
      // 閉まったときに少し寄る・灯りがふっと明るくなる
      camera.position.z = -0.25 * Math.sin(Math.min(1, t / T) * Math.PI);
      paperMat.emissiveIntensity = 0.22 + 0.2 * closed;
      this.covered = closed >= 0.999;
    },
  };
}

/* ---------- 再生 ---------- */
let cur = null, raf = 0;
const dispose = (scene) => scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { for (const v of Object.values(m.uniforms || {})) if (v.value && v.value.isTexture) v.value.dispose(); if (m.map) m.map.dispose(); m.dispose(); } });
function play(kind, colors) {
  cancelAnimationFrame(raf);
  if (cur) dispose(cur.scene);
  camera.position.set(0, 0, 0);
  cur = kind === 'petals' ? sakura() : kind === 'band' ? band(colors || []) : kind === 'shoji' ? shoji() : null;
  if (!cur) { parent.postMessage({ type: 'entry-swap' }, '*'); parent.postMessage({ type: 'entry-end' }, '*'); return; }
  const t0 = performance.now();
  let swapped = false;
  const tick = (now) => {
    const t = (now - t0) / 1000;
    cur.update(t);
    renderer.render(cur.scene, camera);
    // 覆いきってから入れ替える
    if (!swapped && cur.covered) { swapped = true; parent.postMessage({ type: 'entry-swap' }, '*'); }
    if (t >= cur.duration) {
      if (!swapped) parent.postMessage({ type: 'entry-swap' }, '*');
      renderer.clear(); dispose(cur.scene); cur = null;
      parent.postMessage({ type: 'entry-end' }, '*');
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'entry-play') play(m.kind, m.colors); });
// 最初に一度ずつ組み立てておく(シェーダーを先に用意して、押した瞬間に引っかからないように)
for (const k of ['petals', 'band', 'shoji']) { const s = k === 'petals' ? sakura() : k === 'band' ? band([]) : shoji(); s.update(0); renderer.compile(s.scene, camera); dispose(s.scene); }
renderer.clear();
parent.postMessage({ type: 'entry3d-ready' }, '*');
