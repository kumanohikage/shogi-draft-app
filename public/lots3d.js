// くじの3D演出(封筒・あみだくじ)。配信画面(overlay.js)の中に iframe で入り、くじの状態を postMessage で受け取って動く
// 結果はアプリ(サーバー)がもう決めている。ここは決まった結果を見せるだけ(演出で確率は変わらない)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = 1920, H = 1080;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sfx = (name) => parent.postMessage({ type: 'lots-sfx', name }, '*');

/* ---------- 描画の土台 ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0705);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 400);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
scene.add(new THREE.HemisphereLight(0xffe2b0, 0x1a0c06, 0.55));
// 画面の大きさに合わせて文字の層を縮める
const fitHud = () => { $('hud').style.transform = `scale(${innerWidth / W})`; };
addEventListener('resize', fitHud); fitHud();

/* ---------- 小さな道具: 時間で動かす・待つ・文字の絵 ---------- */
const now = () => performance.now() / 1000;
let tweens = [];
const ease = { out: (k) => 1 - Math.pow(1 - k, 3), inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2), lin: (k) => k };
function tween(dur, fn, e = 'inOut', delay = 0) { return new Promise((res) => tweens.push({ t0: now() + delay, dur, fn, e: ease[e], res })); }
const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const FONT = (px, w = 900) => `${w} ${px}px 'Noto Sans JP', sans-serif`;
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// くじの名札(①赤 と、選んだチーム)
function tagTexture(lot, team) {
  return tex(512, 240, (g, w) => {
    roundRect(g, 136, 8, 240, 84, 42); g.fillStyle = lot.color; g.fill();
    g.fillStyle = '#fff'; g.font = FONT(56); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lot.label, w / 2, 52);
    if (team) { roundRect(g, 16, 116, 480, 100, 20); g.fillStyle = '#fffaf0'; g.fill(); g.fillStyle = '#2a1606'; g.font = FONT(team.length > 7 ? 46 : 56); g.fillText(team, w / 2, 168); }
    else { g.fillStyle = 'rgba(255,255,255,.75)'; g.font = FONT(64); g.fillText('？', w / 2, 168); }
  });
}
function sprite(texture, w, h) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xcfcfcf, transparent: true, depthWrite: false })); s.scale.set(w, h, 1); return s; }
// 光の輪(加算で重ねる)
const haloTex = tex(256, 256, (g) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); });
function halo(color, size) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(size, size, 1); return s; }

/* ---------- 期待度の光(封筒が開く前にもれる光の色) ----------
 * 色は演出だけ。当たりのときほど「金・虹」が出やすく、外れのときは「青・緑」が出やすい。同じくじなら何度見ても同じ色 */
const GLOW = { blue: 0x3b82ff, green: 0x2fd27a, red: 0xff3b3b, gold: 0xffc933, rainbow: 'rainbow' };
const GLOW_ORDER = ['blue', 'green', 'red', 'gold', 'rainbow'];
const TABLE = { win: [3, 7, 15, 40, 35], lose: [45, 30, 15, 9, 1] };
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
function glowOf(id, lot, win) { const r = hash(`${id}:${lot}`) * 100, t = TABLE[win ? 'win' : 'lose']; let a = 0; for (let i = 0; i < t.length; i++) { a += t[i]; if (r < a) return GLOW_ORDER[i]; } return 'blue'; }
const glowColor = (name, t = now()) => (name === 'rainbow' ? new THREE.Color().setHSL((t * 0.6) % 1, 1, 0.6) : new THREE.Color(GLOW[name]));
function legend(on) {
  $('legend').style.display = on ? 'flex' : 'none';
  if (on) $('legend').innerHTML = `期待度 ${GLOW_ORDER.map((k) => (k === 'rainbow' ? '<i style="background:conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)"></i>' : `<i style="background:#${GLOW[k].toString(16).padStart(6, '0')}"></i>`)).join('<span>＜</span>')}`;
}

/* ---------- 紙吹雪 ---------- */
let confetti = null;
function burstConfetti(at) {
  if (confetti) scene.remove(confetti.points);
  const n = 260, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [];
  const pal = [0xffd54a, 0xff5a5a, 0x5ab0ff, 0x6be08a, 0xffffff, 0xff9ad5].map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    pos.set([at.x, at.y, at.z], i * 3);
    const c = pal[i % pal.length]; col.set([c.r, c.g, c.b], i * 3);
    const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
    vel.push(new THREE.Vector3(Math.cos(a) * s * 0.6, 4 + Math.random() * 7, Math.sin(a) * s * 0.4));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 1 }));
  scene.add(points); confetti = { points, vel, t0: now() };
}
function stepConfetti(dt) {
  if (!confetti) return;
  const p = confetti.points.geometry.attributes.position, age = now() - confetti.t0;
  for (let i = 0; i < confetti.vel.length; i++) { const v = confetti.vel[i]; v.y -= 9 * dt; v.multiplyScalar(0.985); p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt); }
  p.needsUpdate = true; confetti.points.material.opacity = Math.max(0, 1 - Math.max(0, age - 2.5) / 1.5);
  if (age > 4.2) { scene.remove(confetti.points); confetti = null; }
}

/* ---------- 画面の上の文字 ---------- */
function hud(d) {
  $('head').innerHTML = `${d.player.icon ? `<img src="${esc(d.player.icon)}" alt="">` : ''}<span class="pn">${esc(d.player.name)}</span><span class="pk">${d.lots.length}チームが競合</span>`;
  if (!busyNote) $('note').innerHTML = esc(d.note);
  legend(d.mode === 'envelope');
}
function showResult(team, on) { $('result-team').textContent = team || ''; $('result').classList.toggle('on', on); }

/* ---------- カメラ ---------- */
const cam = { pos: new THREE.Vector3(0, 3, 12), look: new THREE.Vector3(0, 1, 0), follow: null };
const curLook = new THREE.Vector3(0, 1, 0);
function camTo(pos, look, dur = 1) {
  const p0 = cam.pos.clone(), l0 = cam.look.clone();
  return tween(dur, (k) => { cam.pos.lerpVectors(p0, pos, k); cam.look.lerpVectors(l0, look, k); });
}

/* ---------- 世界(封筒 / あみだ)を作り直す ---------- */
let world = null, D = null, queue = Promise.resolve(), busyNote = 0;
const note = (t) => { $('note').innerHTML = esc(t); };
function clearWorld() { if (!world) return; scene.remove(world.root); world = null; tweens = []; showResult('', false); }
function onData(d) {
  hud(d);
  if (!world || world.id !== d.id || world.mode !== d.mode) {
    clearWorld();
    world = d.mode === 'amida' ? buildAmida(d) : buildEnvelope(d);
    world.id = d.id; world.mode = d.mode; world.opened = d.opened; world.done = d.done;
    D = d; world.applyStatic(d);
    return;
  }
  const prev = D; D = d;
  // 選んだ: 名札を更新して、少し跳ねる
  d.owners.forEach((o, i) => { if (o && !prev.owners[i]) { world.setOwner(i, o, true); sfx('pop'); } });
  // 開ける / たどる: 1人ずつ順番に(前の演出が終わってから)
  for (let k = world.opened; k < d.opened; k++) { const lot = d.order[k], last = k === d.opened - 1 && d.done; busyNote++; queue = queue.then(() => world.open(lot, lot === d.winLot, last)).finally(() => { busyNote--; if (!busyNote && D) note(D.done ? `${D.owners[D.winLot]} が交渉権を獲得` : D.note); }); }
  world.opened = d.opened;
}

/* ================= 封筒 ================= */
function buildEnvelope(d) {
  const root = new THREE.Group(); scene.add(root);
  scene.fog = new THREE.Fog(0x0b0705, 16, 40);
  // テーブル(深い赤のビロード)とスポットライト
  const table = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x3a0f0c, roughness: 0.95 }));
  table.rotation.x = -Math.PI / 2; root.add(table);
  const spot = new THREE.SpotLight(0xffe0b0, 260, 40, 0.55, 0.6, 1.6); spot.position.set(0, 14, 6); spot.target.position.set(0, 0.6, 0); root.add(spot, spot.target);
  const fill = new THREE.PointLight(0xffb070, 30, 30); fill.position.set(0, 4, 10); root.add(fill);
  const n = d.lots.length, gap = 2.9, envs = [];
  d.lots.forEach((lot, i) => {
    const x = (i - (n - 1) / 2) * gap, z = -0.18 * x * x / Math.max(1, n / 2);
    const g = new THREE.Group(); g.position.set(x, 1.0, z); g.rotation.set(-0.12, -x * 0.04, 0); root.add(g);
    const color = new THREE.Color(lot.color);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.45, 0.08), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 }));
    g.add(body);
    // 表の番号
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.45), new THREE.MeshBasicMaterial({ transparent: true, map: tex(440, 290, (c, w, h) => { c.fillStyle = 'rgba(255,255,255,.95)'; c.font = FONT(170); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('①②③④⑤⑥⑦⑧⑨⑩⑪⑫'[i], w / 2, h / 2 + 30); }) }));
    face.position.z = 0.042; g.add(face);
    // ふた(上のふちを軸に開く)
    const pivot = new THREE.Group(); pivot.position.set(0, 0.725, 0.045); g.add(pivot);
    const shape = new THREE.Shape(); shape.moveTo(-1.1, 0); shape.lineTo(1.1, 0); shape.lineTo(0, -0.78); shape.closePath();
    const flap = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.82), roughness: 0.5, side: THREE.DoubleSide }));
    flap.position.z = 0.002; pivot.add(flap);
    // 中からもれる光と、中のカード
    const glow = halo(0xffffff, 4.2); glow.position.set(0, 0.3, -0.2); g.add(glow);
    const light = new THREE.PointLight(0xffffff, 0, 8); light.position.set(0, 0.4, 0.6); g.add(light);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.15), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    card.position.set(0, 0, 0.01); g.add(card);
    const tag = sprite(tagTexture(lot, d.owners[i]), 2.4, 1.125); tag.position.set(x, -0.05, z + 1.0); root.add(tag);
    envs.push({ g, body, pivot, glow, light, card, tag, lot, x, z, base: g.position.clone(), open: false });
  });
  const overview = () => ({ pos: new THREE.Vector3(0, 3.6, 8.5 + n * 0.7), look: new THREE.Vector3(0, 0.9, 0) });
  const ov = overview(); cam.pos.copy(ov.pos); cam.look.copy(ov.look); curLook.copy(ov.look);
  const cardTex = (win) => tex(380, 230, (c, w, h) => {
    roundRect(c, 6, 6, w - 12, h - 12, 22); c.fillStyle = win ? '#e8b730' : '#cfc8bd'; c.fill();
    c.lineWidth = 10; c.strokeStyle = win ? '#c0261e' : '#b0a89c'; c.stroke();
    c.fillStyle = win ? '#7a0d08' : '#5a534a'; c.font = FONT(win ? 66 : 80); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(win ? '交渉権確定' : '外れ', w / 2, h / 2 + 4);
  });
  function setOpenStatic(e, win) { e.pivot.rotation.x = -Math.PI * 1.04; e.card.material.map = cardTex(win); e.card.material.opacity = 1; e.card.material.needsUpdate = true; e.card.position.set(0, 0.95, 0.12); e.open = true; }
  const W_ = {
    root,
    setOwner(i, team, anim) {
      const e = envs[i]; e.tag.material.map = tagTexture(e.lot, team); e.tag.material.needsUpdate = true;
      if (anim) tween(0.5, (k) => { e.g.position.y = e.base.y + Math.sin(k * Math.PI) * 0.45; }, 'out');
    },
    applyStatic(dd) {
      for (let k = 0; k < dd.opened; k++) setOpenStatic(envs[dd.order[k]], dd.order[k] === dd.winLot);
      if (dd.done) envs.forEach((e, i) => { if (!e.open) setOpenStatic(e, i === dd.winLot); });
    },
    async open(lot, win, last) {
      const e = envs[lot], gname = glowOf(D.id, lot, win), team = D.owners[lot];
      // 1. 寄る
      const close = { pos: new THREE.Vector3(e.x, 1.9, e.z + 4.8), look: new THREE.Vector3(e.x, 1.25, e.z) };
      note(`${team} の封筒を開けます`);
      await Promise.all([camTo(close.pos, close.look, 0.9), tween(0.9, (k) => { e.g.position.y = e.base.y + k * 0.3; e.g.rotation.x = -0.12 * (1 - k); })]);
      // 2. ふちから光がもれる(期待度の色)。ふるえる
      sfx('glow');
      await tween(1.4, (k) => {
        const c = glowColor(gname); e.glow.material.color.copy(c); e.light.color.copy(c);
        e.glow.material.opacity = k * 0.55; e.light.intensity = k * 7; e.g.rotation.z = Math.sin(now() * 40) * 0.025 * k;
      }, 'lin');
      e.g.rotation.z = 0;
      // 3. ふたが開く → 光があふれる
      sfx('flip');
      await tween(0.6, (k) => { e.pivot.rotation.x = -Math.PI * 1.04 * k; const c = glowColor(gname); e.glow.material.color.copy(c); e.glow.scale.setScalar(4.2 + k * 3.5); e.light.intensity = 7 + k * 14; }, 'out');
      // 4. カードが出る
      e.card.material.map = cardTex(win); e.card.material.needsUpdate = true;
      await tween(0.8, (k) => { e.card.material.opacity = Math.min(1, k * 2); e.card.position.set(0, k * 0.95, 0.01 + k * 0.11); e.glow.material.opacity = 0.55 * (1 - k * 0.6); e.light.intensity = 21 * (1 - k * 0.7); }, 'out');
      e.open = true;
      if (win) { sfx('win'); note(`${team} が交渉権を獲得`); burstConfetti(new THREE.Vector3(e.x, 2.2, e.z + 0.8)); showResult(team, true); await sleep(1.6); }
      else { sfx('lose'); note(`${team}: 外れ`); await sleep(0.7); }
      // 5. 引く。当たりなら、残りの封筒もまとめて開ける
      const o = overview();
      await Promise.all([camTo(o.pos, o.look, 1.0), tween(1.0, (k) => { e.g.position.y = e.base.y + 0.3 * (1 - k); e.glow.material.opacity *= 0.95; })]);
      if (win) {
        showResult('', false);
        const rest = envs.filter((x) => !x.open);
        rest.forEach((x, k) => setTimeout(() => { x.card.material.map = cardTex(false); x.card.material.needsUpdate = true; sfx('flip'); tween(0.5, (q) => { x.pivot.rotation.x = -Math.PI * 1.04 * q; x.card.material.opacity = q; x.card.position.set(0, q * 0.95, 0.01 + q * 0.11); }, 'out'); x.open = true; }, 300 + k * 260));
      }
    },
  };
  return W_;
}

/* ================= あみだくじ ================= */
function buildAmida(d) {
  const root = new THREE.Group(); scene.add(root);
  scene.fog = new THREE.FogExp2(0x05040a, 0.011);
  const n = d.lots.length, gap = n <= 3 ? 4.6 : n <= 5 ? 4 : 3.3, TOP = 5.5, BOT = -5.5, rungs = d.amida.rungs, R = rungs.length;
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
  const ys = Array.from({ length: R }, (_, r) => TOP - (r + 1) * ((TOP - BOT) / (R + 1)));
  // 星くずの背景
  const starGeo = new THREE.BufferGeometry(), sp = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) sp.set([(Math.random() - 0.5) * 120, (Math.random() - 0.5) * 70, -20 - Math.random() * 40], i * 3);
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  root.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfa8ff, size: 0.12, transparent: true, opacity: 0.7 })));
  // 縦の線(うっすら)
  const dim = new THREE.MeshStandardMaterial({ color: 0x3a3860, emissive: 0x24224a, roughness: 0.4 });
  const cyl = (len, mat, r = 0.08) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  xs.forEach((x) => { const m = cyl(TOP - BOT, dim); m.position.set(x, (TOP + BOT) / 2, 0); root.add(m); });
  // 横の線: はじめは隠す(先が見えないように)。たどって着いたときに光って現れる。最後に全部見せる
  const rungMeshes = rungs.map((row, r) => row.map((i) => { const m = cyl(gap, new THREE.MeshStandardMaterial({ color: 0x9fa6ff, emissive: 0x6f78ff, emissiveIntensity: 1.2, transparent: true, opacity: 0 })); m.rotation.z = Math.PI / 2; m.position.set((xs[i] + xs[i + 1]) / 2, ys[r], 0); m.visible = false; root.add(m); return { m, i, r }; }));
  const showRung = (r, i, flash) => { const o = rungMeshes[r].find((x) => x.i === i); if (!o || o.m.visible && o.m.material.opacity >= 1) return; o.m.visible = true; if (flash) tween(0.35, (k) => { o.m.material.opacity = k; o.m.material.emissiveIntensity = 4 * (1 - k) + 1.2; }, 'out'); else o.m.material.opacity = 1; };
  // 上の名札、下のゴール(？)
  const tags = d.lots.map((lot, i) => { const s = sprite(tagTexture(lot, d.owners[i]), Math.min(gap * 0.98, 4.6), Math.min(gap * 0.98, 4.6) * 0.47); s.position.set(xs[i], TOP + 1.5, 0); root.add(s); return s; });
  const goalTex = (state) => tex(256, 256, (c, w, h) => {
    roundRect(c, 8, 8, w - 16, h - 16, 40); c.fillStyle = state === 'win' ? '#ffd54a' : state === 'lose' ? '#d8d2c8' : '#24203a'; c.fill();
    c.lineWidth = 10; c.strokeStyle = state === 'win' ? '#fff3c4' : '#ffffff'; c.stroke();
    c.fillStyle = state === 'win' ? '#a3150f' : state === 'lose' ? '#6a6258' : '#cdbfff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = FONT(state === 'win' ? 72 : 120); c.fillText(state === 'win' ? '当たり' : state === 'lose' ? '×' : '？', w / 2, h / 2 + 6);
  });
  const goals = xs.map((x) => { const s = sprite(goalTex('hide'), 2.4, 2.4); s.position.set(x, BOT - 1.7, 0); root.add(s); return s; });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 30, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  pillar.position.set(0, BOT + 12, -0.5); root.add(pillar);
  // たどる線(通ったところが光る)
  function pathOf(lane) {
    let x = lane; const pts = [new THREE.Vector3(xs[x], TOP, 0.12)], cross = [];
    rungs.forEach((row, r) => { const y = ys[r]; if (row.includes(x)) { pts.push(new THREE.Vector3(xs[x], y, 0.12), new THREE.Vector3(xs[x + 1], y, 0.12)); cross.push([r, x, pts.length - 2]); x++; } else if (row.includes(x - 1)) { pts.push(new THREE.Vector3(xs[x], y, 0.12), new THREE.Vector3(xs[x - 1], y, 0.12)); cross.push([r, x - 1, pts.length - 2]); x--; } });
    pts.push(new THREE.Vector3(xs[x], BOT, 0.12));
    return { pts, end: x, cross };
  }
  function trailSeg(a, b, color) { const len = a.distanceTo(b); const m = cyl(1, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }), 0.17); m.position.copy(a); m.lookAt(b); m.rotateX(Math.PI / 2); m.scale.set(1, 0.0001, 1); m.visible = false; m.userData = { a, b, len }; root.add(m); return m; }
  function setSeg(m, k) { const { a, b, len } = m.userData; m.visible = k > 0.002; m.scale.y = Math.max(0.0001, len * k); m.position.copy(a).lerp(b, k / 2); }
  const spanTop = TOP + 2.6, spanBot = BOT - 2.9, fullH = (spanTop - spanBot) / 0.78, fullW = Math.max(n * gap + 5, 14);
  const overview = () => { const t = Math.tan((20 * Math.PI) / 180), dist = Math.max(fullH / 2 / t, fullW / 2 / t / (W / H)); const cy = (spanTop + spanBot) / 2 + 0.4; return { pos: new THREE.Vector3(0, cy, dist), look: new THREE.Vector3(0, cy, 0) }; };
  const ov = overview(); cam.pos.copy(ov.pos); cam.look.copy(ov.look); curLook.copy(ov.look);
  const W_ = {
    root,
    setOwner(i, team, anim) { tags[i].material.map = tagTexture(d.lots[i], team); tags[i].material.needsUpdate = true; if (anim) tween(0.5, (k) => { tags[i].position.y = TOP + 1.5 + Math.sin(k * Math.PI) * 0.6; }, 'out'); },
    applyStatic(dd) {
      for (let k = 0; k < dd.opened; k++) { const lane = dd.order[k], p = pathOf(lane); p.cross.forEach(([r, i]) => showRung(r, i, false)); for (let s = 0; s < p.pts.length - 1; s++) setSeg(trailSeg(p.pts[s], p.pts[s + 1], new THREE.Color(dd.lots[lane].color)), 1); goals[p.end].material.map = goalTex(lane === dd.winLot ? 'win' : 'lose'); goals[p.end].material.needsUpdate = true; }
      if (dd.done) { rungMeshes.flat().forEach((o) => showRung(o.r, o.i, false)); goals.forEach((g, i) => { if (i !== d.amida.goal) { g.material.map = goalTex('lose'); g.material.needsUpdate = true; } }); }
    },
    async open(lane, win, last) {
      const p = pathOf(lane), color = new THREE.Color(d.lots[lane].color), team = D.owners[lane];
      // 光の玉
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.15) }));
      const orbLight = new THREE.PointLight(color, 16, 9); orb.add(orbLight);
      const orbHalo = halo(color, 2.2); orbHalo.material.opacity = 0.6; orb.add(orbHalo);
      orb.position.copy(p.pts[0]); root.add(orb);
      // 上から寄る
      sfx('glow'); note(`${team} のくじをたどります`);
      await camTo(new THREE.Vector3(orb.position.x, TOP + 3.2, 8.8), new THREE.Vector3(orb.position.x, TOP - 2.4, 0), 1.0);
      // たどる: カメラは近くで玉を追いかける(曲がるときに少し傾く)
      const segs = []; for (let s = 0; s < p.pts.length - 1; s++) segs.push(trailSeg(p.pts[s], p.pts[s + 1], color));
      const lens = segs.map((m) => m.userData.len), total = lens.reduce((a, b) => a + b, 0);
      cam.follow = { orb, off: new THREE.Vector3(0, 3.4, 8.6), vx: 0 };
      await tween(4.4, (k) => {
        let dist = k * total, s = 0;
        while (s < segs.length - 1 && dist > lens[s]) { setSeg(segs[s], 1); dist -= lens[s]; s++; }
        const q = Math.min(1, dist / lens[s]); setSeg(segs[s], q);
        const a = segs[s].userData.a, b = segs[s].userData.b; orb.position.copy(a).lerp(b, q);
        cam.follow.vx = (b.x - a.x) / Math.max(0.01, lens[s]);
        // 横に曲がるところに着いたら、その横線が光って現れる
        p.cross.forEach(([r, i, at]) => { if (s >= at) showRung(r, i, true); });
      }, 'inOut');
      cam.follow = null;
      // ゴール: 着いて初めて結果がわかる
      goals[p.end].material.map = goalTex(win ? 'win' : 'lose'); goals[p.end].material.needsUpdate = true;
      tween(0.4, (k) => goals[p.end].scale.setScalar(2.4 + Math.sin(k * Math.PI) * 0.7), 'out');
      if (win) {
        sfx('win'); pillar.position.x = xs[p.end]; tween(0.6, (k) => { pillar.material.opacity = 0.55 * k; }, 'out');
        burstConfetti(new THREE.Vector3(xs[p.end], BOT, 1)); showResult(team, true); note(`${team} が交渉権を獲得`);
        await sleep(1.4);
      } else { sfx('lose'); note(`${team}: 外れ`); await sleep(0.6); }
      tween(0.6, (k) => { orbLight.intensity = 16 * (1 - k); orbHalo.material.opacity = 0.6 * (1 - k); });
      // 引いて全体を見せる(最後は横線を全部見せて、公平に決まったことがわかるように)
      const o = overview();
      await camTo(o.pos, o.look, win ? 1.8 : 1.0);
      if (win) {
        showResult('', false);
        rungMeshes.flat().forEach((x, k) => setTimeout(() => showRung(x.r, x.i, true), k * 40));
        goals.forEach((g, i) => { if (i !== p.end) setTimeout(() => { g.material.map = goalTex('lose'); g.material.needsUpdate = true; }, 600); });
        tween(1.2, (k) => { pillar.material.opacity = 0.55 * (1 - k * 0.5); });
      }
      root.remove(orb);
    },
  };
  return W_;
}

/* ---------- 毎フレーム ---------- */
let last = now();
function frame() {
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  tweens = tweens.filter((tw) => { if (t < tw.t0) return true; const k = Math.min(1, (t - tw.t0) / tw.dur); tw.fn(tw.e(k)); if (k >= 1) { tw.res(); return false; } return true; });
  // カメラ: 追いかけているときは玉の少し後ろ上から、なめらかに
  if (cam.follow) {
    const o = cam.follow.orb.getWorldPosition(new THREE.Vector3());
    const want = o.clone().add(cam.follow.off).add(new THREE.Vector3(-cam.follow.vx * 1.6, 0, 0));
    cam.pos.lerp(want, 0.12); cam.look.lerp(o.clone().add(new THREE.Vector3(cam.follow.vx * 1.2, -1.8, 0)), 0.15);
  }
  camera.position.copy(cam.pos);
  curLook.lerp(cam.look, 0.5); camera.lookAt(curLook);
  camera.rotation.z += cam.follow ? -cam.follow.vx * 0.03 : 0;
  stepConfetti(dt);
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'lots') onData(m.data); });
parent.postMessage({ type: 'lots3d-ready' }, '*');
