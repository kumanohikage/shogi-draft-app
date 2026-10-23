// 光の世界(3D の抽選)へ入るときの切り替え(3D)。配信画面の一番手前に iframe で入る
// 考え方: 画面を完全に覆う → 覆っている間に入れ替える(親へ entry-swap)→ 開ける(親へ entry-end)
//   流れもの(桜の花吹雪)は止めずに通り抜ける: 少しずつ増えながら押し寄せ、覆い尽くし、そのまま流れ去る
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

/* ---------- 共通: 画面いっぱいの板(NDC)と、たくさんの板をまとめて描く部品 ---------- */
const BACK_VERT = `varying vec2 vN; void main() { vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
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
/* ---------- 桜: 何枚か右から左へ通り過ぎたと思ったら、ばっと花吹雪が目の前を通り過ぎ、余韻は短く、抽選の画面になっている ---------- */
// 色の面は見せない。覆うのは目の前を通る特大の花びら(ぼけている)。そのすき間だけを、同じ速さで動く「ぼけた花びらの群れ」の下地で埋める
// 花びらは1枚ずつ「右の端に入る時刻」を持つ。風の進み具合 C(t) で左へ運ばれ、手前ほど速く見える(視差)
// 風の場(調べ: ~/research/wind-particles)
//   ・全体を1つの sin で揺らすと、全部の花びらがそろって動き、水の波に見える(そろった動きは不自然: GPU Gems 3 ch.6)
//   ・渦はカールノイズ(Bridson ら 2007)。ノイズのポテンシャルの回転で、場所ごとに違う渦ができる。大きな渦と小さな渦を重ね、場も時間で流れる
//   ・突風: ゆっくりした変動と、短いでたらめなゆらぎ(風工学の乱流モデル)。流れの一部が一瞬だけ速く進む
const WIND_GLSL = `
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }
// ポテンシャル: 大きな渦 → 小さな渦(小さいほど弱く、速く流れる)
float wpsi(vec2 p, float t) {
  vec2 p2 = mat2(0.80, 0.60, -0.60, 0.80) * p, p3 = mat2(0.36, -0.93, 0.93, 0.36) * p;
  return wn(p * 1.2 + vec2(t * 0.9, t * 0.15)) * 0.62 + wn(p2 * 2.9 + vec2(t * 1.7, -t * 0.4) + 11.0) * 0.27 + wn(p3 * 6.3 + vec2(t * 2.6, t * 0.8) + 37.0) * 0.11;
}
// 渦の動き(カールノイズ): (∂ψ/∂y, -∂ψ/∂x)
vec2 wcurl(vec2 p, float t) {
  float e = 0.02;
  float a = wpsi(p + vec2(0.0, e), t), b = wpsi(p - vec2(0.0, e), t);
  float c = wpsi(p + vec2(e, 0.0), t), d = wpsi(p - vec2(e, 0.0), t);
  return vec2(a - b, -(c - d)) / (2.0 * e);
}
// 突風のむら: 流れの向き(左)に、場所によって一瞬多く進む
float wgust(vec2 p, float t) { return wn(vec2(p.x * 0.7 + t * 1.6, p.y * 0.5 + 3.0)) * 0.7 + wn(vec2(p.x * 2.2 + t * 4.0, p.y * 1.4 + 9.0)) * 0.3; }
// 花びら1枚の位置(画面の半幅=1)を風でずらす。手前ほど大きく(視差)
vec2 wind(vec2 q, float t, float g) {
  vec2 p = vec2(q.x * 1.78, q.y);
  vec2 v = wcurl(p, t);
  float k = min(g, 1.7);
  return vec2(v.x * 0.015 - wgust(p, t) * 0.16, v.y * 0.02) * k;
}
`;
const SAKURA_VERT = `
uniform float uT, uC, uTanH, uAspect, uFocus, uAperture, uV;
attribute vec4 aA; // 中央を通るときの風の進み・縦の位置・奥行き・大きさ(px)
attribute vec4 aB; // 回転の軸・回る速さ
attribute vec4 aF; // 位相・揺れの幅・揺れの速さ・落ちる速さ
attribute vec4 aTint; // 色・中央を通る時刻
varying vec2 vUv; varying vec3 vTint; varying float vShade, vBlur, vA, vGlint;
${WIND_GLSL}
vec3 rot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void main() {
  float d = aA.z, g = pow(14.0 / d, 0.5);
  // 花びら1枚の揺れ: 決まった波(sin)にすると、どの花びらも同じ形に揺れて見える。花びらごとに違うでたらめな揺らぎにする
  float wt = uT * aF.z * 0.9;
  vec2 jit = vec2(wn(vec2(wt, aF.x * 13.1)) - 0.5, wn(vec2(wt * 0.8 + 5.0, aF.x * 7.7)) - 0.5) * 2.0 * aF.y * 0.7;
  float xn = -g * (uC - aA.x) + jit.x;
  float yn = aA.y - aF.w * (uT - aTint.w) + jit.y;
  // 風: 場所ごとに違う渦と、突風のむら
  vec2 w = wind(vec2(xn, yn), uT, g);
  xn += w.x; yn += w.y;
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
  vShade = 0.86 + 0.24 * abs(dot(n, L));
  if (n.z < 0.0) vShade *= 0.95;
  // 光を受ける向きになった瞬間に、きらっと明るく
  vGlint = pow(abs(dot(n, normalize(L + vec3(0.0, 0.0, 1.0)))), 22.0);
  // 速く流れる花びらは、流れる向きに少しのびる(動きのぶれ)。1コマで動く距離と花びらの大きさで決める
  float move = 16.0 * g * uV / max(aA.w, 1.0);
  float stretch = 1.0 + min(1.6, move * 0.5);
  p.x *= stretch;
  vBlur = blur; vA = 1.0 / (grow * grow) / sqrt(stretch);
  vUv = uv; vTint = aTint.rgb;
  gl_Position = projectionMatrix * vec4(c + p, 1.0);
}`;
const SAKURA_FRAG = `
uniform sampler2D uMap;
uniform float uAlpha;
varying vec2 vUv; varying vec3 vTint; varying float vShade, vBlur, vA, vGlint;
void main() {
  vec4 t = texture2D(uMap, vUv, min(vBlur, 3.2));
  vec2 dd = abs(vUv - 0.5);
  t *= smoothstep(0.5, 0.42, max(dd.x, dd.y));
  vec3 col = t.rgb * vTint;
  col = vShade < 1.0 ? mix(col * vec3(0.93, 0.74, 0.82), col, smoothstep(0.86, 1.0, vShade)) : col * vShade;
  col += vec3(1.0, 0.97, 0.98) * vGlint * 0.75 * t.a;
  gl_FragColor = vec4(col, t.a) * vA * uAlpha;
}`;
// すき間を埋める下地: 目の前の花びらと同じ速さで横切る帯。中は色の面ではなく、ぼけた花びらが重なったようなむら
const VEIL_FRAG = `
uniform float uX, uCore, uRag, uT;
varying vec2 vN;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vec2(vN.x * 1.78, vN.y);
  float x = vN.x - uX;
  float r = (n2(vec2(vN.y * 3.0, 1.7)) - 0.5) * uRag + (n2(vec2(vN.y * 9.0, 5.3)) - 0.5) * uRag * 0.4;
  float a = smoothstep(-uCore - 0.12, -uCore, x + r) * (1.0 - smoothstep(uCore, uCore + 0.12, x - r));
  // ぼけた花びらの重なり(大きな丸いむら)を、帯といっしょに流す
  vec2 p = vec2(q.x - uX * 1.78, q.y);
  float m = n2(p * 2.2) * 0.6 + n2(p * 5.0 + 3.0) * 0.4;
  vec3 col = mix(vec3(0.98, 0.80, 0.87), vec3(1.0, 0.95, 0.97), smoothstep(0.25, 0.85, m));
  gl_FragColor = vec4(col * a, a);
}`;
// 光の粒(玉ボケ): 足し算で重ねる。風に乗って流れ、またたく
const BOKEH_VERT = `
uniform float uT, uC, uTanH, uAspect;
attribute vec4 aA; // 中央を通るときの風の進み・縦の位置・奥行き・大きさ(px)
attribute vec4 aF; // 位相・またたきの速さ・落ちる速さ・明るさ
attribute vec4 aTint; // 色・中央を通る時刻
varying vec2 vUv; varying vec3 vCol;
${WIND_GLSL}
void main() {
  float d = aA.z, g = pow(14.0 / d, 0.5);
  float xn = -g * (uC - aA.x);
  float yn = aA.y - aF.z * (uT - aTint.w);
  vec2 w = wind(vec2(xn, yn), uT, g);
  xn += w.x; yn += w.y;
  float hH = d * uTanH, hW = hH * uAspect;
  float ws = aA.w / 1080.0 * 2.0 * hH;
  float tw = 0.55 + 0.45 * sin(uT * aF.y + aF.x);
  vCol = aTint.rgb * aF.w * tw;
  vUv = uv;
  gl_Position = projectionMatrix * vec4(xn * hW + position.x * ws, yn * hH + position.y * ws, -d, 1.0);
}`;
const BOKEH_FRAG = `
uniform sampler2D uMap;
varying vec2 vUv; varying vec3 vCol;
void main() { vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(vCol * t.a, 0.0); }`;
// 目の前を通るときの、やわらかい光(白く光らせない。右上から差す桜色の光)
const SHINE_FRAG = `
uniform float uK;
varying vec2 vN;
void main() {
  vec2 q = vec2((vN.x - 0.55) * 1.78, vN.y - 0.45);
  float a = exp(-dot(q, q) * 0.9) * uK;
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.94) * a, 0.0);
}`;
function bokehTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.75)'); r.addColorStop(0.7, 'rgba(255,255,255,.22)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}
function softPetalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.filter = 'blur(1.5px)';
  g.drawImage(petalTexture().image, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.NoColorSpace;
  return t;
}
function sakura() {
  const scene = new THREE.Scene();
  // 全体の長さ / 目の前を通る(覆いきる)時刻 / 花吹雪の本体が通り過ぎる時刻(ここで抽選の演出を始めてよい。残りの数枚は抽選の上を流れていく)
  const T = 2.7, TP = 0.95, RELEASE = 1.75;
  // 風の速さ: はじめから速い(花びらはさっと横切る)。ばっと来るところでさらに強く
  const speed = (t) => 3.2 + 1.6 * Math.exp(-Math.pow((t - TP) / 0.3, 2));
  const DT = 0.002, table = [0];
  for (let t = DT; t <= T + 1; t += DT) table.push(table[table.length - 1] + speed(t) * DT);
  const C = (t) => table[Math.max(0, Math.min(table.length - 1, Math.round(t / DT)))];
  const gOf = (d) => Math.pow(14 / d, 0.5);
  // 白っぽいもの〜濃い桜色まで混ぜる(桜色の背景の上でも花びらが見えるように)
  const tint = () => [[1, 1, 1], [1, 0.93, 0.96], [0.98, 0.8, 0.88], [0.95, 0.7, 0.8], [1, 0.97, 0.98]][Math.floor(Math.random() * 5)];
  // 右の端に入る時刻の分布: はじめは数枚ずつ、0.5秒ごろからどっと来る。通り過ぎたあとは少しだけ
  // 終わりぎわは一斉に途切れさせず、だんだん減らして、最後は数枚がぽつぽつ遅れて流れる(切れ目が縦一列にそろわないように)
  const rate = (e) => (e < 0.5 ? 0.06 : e < 0.85 ? 0.06 + 0.94 * ((e - 0.5) / 0.35) : Math.max(0, Math.exp(-(e - 0.85) / 0.16) * (1 - (e - 0.85) / 0.95)));
  const enter = () => { for (;;) { const e = R(0, 1.8); if (Math.random() < rate(e)) return e; } };
  const list = [];
  const add = (n, dr, sr, opt = {}) => {
    for (let i = 0; i < n; i++) {
      const d = R(dr[0], dr[1]), g = gOf(d), size = R(sr[0], sr[1]);
      const margin = (size / 1080) * 1.2;
      // 中央を通るときの風の進み。入る時刻から、画面の半幅(＋花びらの大きさ)ぶん進んだところ
      let cx;
      for (let k = 0; k < 50; k++) { cx = opt.tau != null ? C(opt.tau()) : C(opt.enter ? opt.enter() : enter()) + (1 + margin) / g; if (opt.tau != null || cx + (1 + margin) / g <= C(T - 0.03)) break; }
      const tau = table.findIndex((v) => v >= cx) * DT;
      list.push({ d, a: [cx, R(opt.y?.[0] ?? -1.2, opt.y?.[1] ?? 1.5), d, size], b: [R(-1, 1), R(-1, 1), R(-0.4, 1), R(2.5, 7)], f: [R(0, 6.3), R(0.01, 0.03), R(2, 5), R(opt.fall?.[0] ?? 0.06, opt.fall?.[1] ?? 0.22)], t: [...(opt.tint ? opt.tint() : tint()), tau], soft: !!opt.soft, wall: !!opt.wall });
    }
  };
  add(700, [14, 26], [24, 46]); // 奥
  add(700, [7, 14], [44, 110]); // 中
  add(800, [3.5, 8], [90, 260], { enter: () => R(0.45, 0.85), fall: [0.05, 0.12] }); // ばっと来る
  // 目の前を通る花吹雪のかたまり(目がくらむほど)。くっきりした花びらをぎっしり、下地の帯と同じ時刻にそろえて通す
  add(650, [3.0, 6.0], [160, 420], { tau: () => TP + R(-0.17, 0.17), y: [-1.1, 1.2], fall: [0.03, 0.08], wall: true });
  // そのさらに手前を、大きくぼけた花びらが数枚
  // (白いと光ったように見えるので、桜色だけ。少し透かす)
  add(18, [1.5, 2.4], [700, 1300], { tau: () => TP + R(-0.15, 0.15), y: [-1.0, 1.0], fall: [0.02, 0.06], soft: true, tint: () => [[0.97, 0.78, 0.86], [0.94, 0.7, 0.8], [0.98, 0.84, 0.9]][Math.floor(Math.random() * 3)] });
  list.sort((p, q) => q.d - p.d);
  const build = (items, tex) => {
    const n = items.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4), F = new Float32Array(n * 4), Tt = new Float32Array(n * 4);
    items.forEach((p, i) => { A.set(p.a, i * 4); B.set(p.b, i * 4); F.set(p.f, i * 4); Tt.set(p.t, i * 4); });
    const uni = { uT: { value: 0 }, uC: { value: 0 }, uV: { value: 0 }, uTanH: { value: TANH }, uAspect: { value: 16 / 9 }, uFocus: { value: 13 }, uAperture: { value: 0.22 }, uMap: { value: tex }, uAlpha: { value: 1 } };
    const mesh = instanced(n, { aA: [4, A], aB: [4, B], aF: [4, F], aTint: [4, Tt] }, SAKURA_VERT, SAKURA_FRAG, uni);
    return { mesh, uni };
  };
  const far = build(list.filter((p) => !p.soft && !p.wall), petalTexture());
  const wall = build(list.filter((p) => p.wall), petalTexture());
  // 下地の帯: 目の前の花びらと同じ奥行き(2.7)の速さで流れる
  const gW = gOf(2.3), CP = C(TP), CORE = 1.6, RAG = 0.4;
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: BACK_VERT, fragmentShader: VEIL_FRAG, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true, uniforms: { uX: { value: 9 }, uCore: { value: CORE }, uRag: { value: RAG }, uT: { value: 0 } } }));
  veil.frustumCulled = false;
  const near = build(list.filter((p) => p.soft), softPetalTexture());
  near.uni.uAlpha.value = 0.82;
  // 光の粒: 奥は小さく強く、手前は大きくぼんやり。花びらと同じ風に乗る
  const NB = 300, BA = new Float32Array(NB * 4), BF = new Float32Array(NB * 4), BT = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) {
    const d = R(2.5, 30), g = gOf(d), near3 = d < 6;
    const size = near3 ? R(90, 220) : R(10, 46) * (1 + (30 - d) / 30);
    let cx; for (let k = 0; k < 50; k++) { cx = C(enter()) + 1.1 / g; if (cx + 1.1 / g <= C(T - 0.03)) break; }
    const tau = table.findIndex((v) => v >= cx) * DT;
    BA.set([cx, R(-1.2, 1.4), d, size], i * 4);
    BF.set([R(0, 6.3), R(6, 16), R(0.03, 0.12), near3 ? R(0.08, 0.18) : R(0.35, 0.9)], i * 4);
    BT.set([...[[1, 1, 1], [1, 0.9, 0.95], [1, 0.95, 0.88]][Math.floor(Math.random() * 3)], tau], i * 4);
  }
  const bUni = { uT: { value: 0 }, uC: { value: 0 }, uTanH: { value: TANH }, uAspect: { value: 16 / 9 }, uMap: { value: bokehTexture() } };
  const bokeh = instanced(NB, { aA: [4, BA], aF: [4, BF], aTint: [4, BT] }, BOKEH_VERT, BOKEH_FRAG, bUni, { blending: THREE.AdditiveBlending });
  const shine = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: BACK_VERT, fragmentShader: SHINE_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 } } }));
  shine.frustumCulled = false;
  // 奥の花びら → 下地の帯 → かたまり → 手前のぼけた花びら → 光の粒(花びらの間で光る) → やわらかい光
  far.mesh.renderOrder = 0; veil.renderOrder = 1; wall.mesh.renderOrder = 2; near.mesh.renderOrder = 3; bokeh.renderOrder = 4; shine.renderOrder = 5;
  scene.add(far.mesh, veil, wall.mesh, near.mesh, bokeh, shine);
  return {
    scene, duration: T, release: RELEASE, ratio: 0.75,
    update(t) {
      const c = C(t);
      for (const m of [far, wall, near]) { m.uni.uT.value = t; m.uni.uC.value = c; m.uni.uV.value = speed(t); }
      bUni.uT.value = t; bUni.uC.value = c;
      shine.material.uniforms.uK.value = 0.32 * Math.exp(-Math.pow((t - TP - 0.05) / 0.25, 2));
      const x = -gW * (c - CP);
      veil.material.uniforms.uX.value = x;
      // 帯の真ん中が画面の真ん中を過ぎたところ(前後に少し余裕があり、全部覆っている)で入れ替える
      this.covered = t >= TP - 0.01;
    },
  };
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
    // 引手: 障子は紙ではなく、閉じ合わせる側の縦框に掘り込む(丸い引手は襖のもの)。
    // 障子1枚の幅(約 PW)を 900mm とみて、幅 約18mm・高さ 約75mm の細長いくぼみ。真鍮の縁に黒いくぼみ
    const capsule = (w, h) => { const s = new THREE.Shape(), r = w / 2; s.absarc(0, h / 2 - r, r, 0, Math.PI, false); s.absarc(0, -h / 2 + r, r, Math.PI, Math.PI * 2, false); return new THREE.ShapeGeometry(s, 16); };
    const hx = sign * -(PW / 2 - F / 2), hy = -PH / 24;
    const rimPull = new THREE.Mesh(capsule(0.085, 0.34), new THREE.MeshStandardMaterial({ color: '#9a7a44', roughness: 0.32, metalness: 0.85 }));
    rimPull.position.set(hx, hy, 0.202); grp.add(rimPull);
    const pit = new THREE.Mesh(capsule(0.06, 0.31), new THREE.MeshStandardMaterial({ color: '#0d0805', roughness: 0.6, metalness: 0.2 }));
    pit.position.set(hx, hy, 0.204); grp.add(pit);
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
  cur = kind === 'petals' ? sakura() : kind === 'shoji' ? shoji() : null;
  // 桜はぼけた花びらばかりなので、少し粗く描いて軽くする
  if (cur) { renderer.setPixelRatio(cur.ratio || 1); resize(); }
  if (!cur) { parent.postMessage({ type: 'entry-swap' }, '*'); parent.postMessage({ type: 'entry-end' }, '*'); return; }
  const t0 = performance.now();
  let swapped = false, released = false;
  const tick = (now) => {
    const t = (now - t0) / 1000;
    cur.update(t);
    renderer.render(cur.scene, camera);
    // 覆いきってから入れ替える
    if (!swapped && cur.covered) { swapped = true; parent.postMessage({ type: 'entry-swap' }, '*'); }
    // 本体が通り過ぎたら知らせる(後ろの演出を始めてよい)
    if (cur.release && !released && t >= cur.release) { released = true; parent.postMessage({ type: 'entry-release' }, '*'); }
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
for (const k of ['petals', 'shoji']) { const s = k === 'petals' ? sakura() : shoji(); s.update(0); renderer.compile(s.scene, camera); dispose(s.scene); }
renderer.clear();
parent.postMessage({ type: 'entry3d-ready' }, '*');
