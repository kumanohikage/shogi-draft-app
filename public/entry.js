// 「抽選する」で光の世界(3D の抽選)へ入るときの切り替え。テーマごとの入り方
// DraftEntry[kind](el, swap, { colors }) → Promise。覆いきったところで swap() を呼んで後ろを入れ替え、また開ける
// フラッシュ(白く光らせる)は使わない
(function () {
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const div = (el, css) => { const d = document.createElement('div'); d.style.cssText = css; el.appendChild(d); return d; };
  const anim = (d, frames, ms, ease = 'cubic-bezier(.6,0,.3,1)', delay = 0) => d.animate(frames, { duration: ms, easing: ease, delay, fill: 'forwards' }).finished;

  // 静かに暗転(ドラフト会議)
  async function blackout(el, swap) {
    const d = div(el, 'position:absolute;inset:0;background:#05070d;opacity:0');
    await anim(d, [{ opacity: 0 }, { opacity: 1 }], 550, 'ease-in');
    swap();
    await later(380);
    await anim(d, [{ opacity: 1 }, { opacity: 0 }], 700, 'ease-out');
    d.remove();
  }

  // チームカラーの帯が斜めに横切る(スポーツ中継)
  async function band(el, swap, { colors = [] }) {
    const cs = [...colors, '#ffd400', '#1f5bff', '#ffffff', '#0b1633'].slice(0, 6);
    while (cs.length < 6) cs.push('#1f5bff');
    const n = cs.length, w = 1920 / n + 260;
    const bands = cs.map((c, i) => div(el, `position:absolute;top:-60px;bottom:-60px;left:${i * (1920 / n) - 130}px;width:${w}px;background:${c};transform:skewX(-18deg) translateX(-2600px)`));
    await Promise.all(bands.map((b, i) => anim(b, [{ transform: 'skewX(-18deg) translateX(-2600px)' }, { transform: 'skewX(-18deg) translateX(0)' }], 420, 'cubic-bezier(.5,0,.2,1)', i * 45)));
    swap();
    await later(120);
    await Promise.all(bands.map((b, i) => anim(b, [{ transform: 'skewX(-18deg) translateX(0)' }, { transform: 'skewX(-18deg) translateX(2600px)' }], 480, 'cubic-bezier(.6,0,.4,1)', (n - 1 - i) * 40)));
    bands.forEach((b) => b.remove());
  }

  // 花吹雪(桜): 風に運ばれた花びらが横から押し寄せて画面を埋め尽くし、埋まっている間に入れ替えて、また風に運ばれて抜けていく
  // 覆う → 隠れている間に入れ替える → 開ける(画面全体を覆った瞬間に切り替える、OBS のスティンガーと同じ考え方)
  // 花びら1枚の動き(落ち方の研究より): 左右に揺れる(flutter)・縦に回る(tumble)・ふらふら不規則に漂う・くるくる回る。風に横へ運ばれる(渦は巻かない)
  async function petals(el, swap) {
    const W = 1920, H = 1080;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.cssText = 'position:absolute;inset:0';
    el.appendChild(cv);
    const g = cv.getContext('2d');
    // 花びらの絵(先が少し割れたしずく形)。色違いと、手前用のぼけた絵を先に作っておく
    const TINTS = [['#ffffff', '#ffe3ec'], ['#fff3f6', '#ffc9d8'], ['#ffe6ee', '#f7a8c0'], ['#fffafb', '#ffd6e2']];
    const sprite = (c0, c1, size, blur) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'), k = size / 128;
      if (blur) x.filter = `blur(${blur}px)`;
      x.translate(size / 2, size / 2); x.scale(k * 0.8, k * 0.8);
      x.beginPath(); x.moveTo(0, 30); x.bezierCurveTo(-26, 12, -22, -22, -6, -30); x.lineTo(0, -24); x.lineTo(6, -30); x.bezierCurveTo(22, -22, 26, 12, 0, 30); x.closePath();
      const gr = x.createLinearGradient(0, 30, 0, -30); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      x.fillStyle = gr; x.fill();
      return c;
    };
    const SHARP = TINTS.map(([a, b]) => sprite(a, b, 96, 0)), SOFT = TINTS.map(([a, b]) => sprite(a, b, 256, 7));
    // 風の向き(少し下へ吹き下ろす)。花びらと桜色の帯は「風の向きの座標」で動かし、最後に画面へ回す
    const ANG = 12 * Math.PI / 180, ca = Math.cos(ANG), sa = Math.sin(ANG);
    const toScreen = (u, v) => [W / 2 + u * ca - v * sa, H / 2 + u * sa + v * ca];
    // 花びらのかたまり: 半幅 HALF に大きな花びらをすき間なく重ねる。その奥に、すき間から透けないための桜色の下地(花びらのかたまりより狭く、ふちは花びらの下に隠れる)
    // 画面の角は風の向きの座標で ±1051。下地の芯の半幅 1400 なので、真ん中が ±300 の間は全部覆っている
    const CORE = 1500, EDGE = 420, HALF = 1780;
    // 帯の真ん中の位置(時刻 ms → 風の向きの座標)。押し寄せる(速い→ゆっくり)・埋め尽くしたまま漂う・抜けていく(ゆっくり→速い)
    const KEYS = [[0, -2880, 6.5], [700, -250, 1.43], [1050, 250, 1.43], [1850, 2880, 6.0]];
    const center = (t) => {
      if (t <= 0) return KEYS[0][1];
      for (let i = 0; i < KEYS.length - 1; i++) {
        const [t0, p0, v0] = KEYS[i], [t1, p1, v1] = KEYS[i + 1];
        if (t > t1) continue;
        const d = t1 - t0, s = (t - t0) / d, s2 = s * s, s3 = s2 * s;
        return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * d * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * d * v1;
      }
      return KEYS[KEYS.length - 1][1];
    };
    const END = KEYS[KEYS.length - 1][0], SWAP = KEYS[1][0];
    const R = (a, b) => a + Math.random() * (b - a);
    // 奥(帯の後ろ)・中・手前(大きくぼけた花びら)
    const make = (n, layer, size, spread = 500) => Array.from({ length: n }, () => ({
      layer, s: R(size[0], size[1]), tint: Math.floor(Math.random() * TINTS.length),
      u: layer === 'edge' ? (Math.random() < 0.5 ? -1 : 1) * R(CORE - EDGE - 120, CORE + 160) : R(-HALF - spread, HALF + spread), v: R(-1250, 1250), k: R(-0.07, 0.07), fall: R(40, 160),
      fa: R(18, 48), fw: R(3, 6), fp: R(0, 6.3), wa: R(10, 30), ww: R(1.2, 2.6), wp: R(0, 6.3),
      rot: R(0, 6.3), spin: R(-3.5, 3.5), tw: R(5, 11), tp: R(0, 6.3), a: layer === 'far' ? R(0.55, 0.8) : 1,
    }));
    // 奥の小さな花びら・かたまり(大きな花びらを密に)・前を舞う花びら・手前の大きくぼけた花びら
    const P = [...make(300, 'far', [14, 26]), ...make(2400, 'mass', [48, 96], 60), ...make(1500, 'edge', [44, 90]), ...make(420, 'mid', [26, 50]), ...make(36, 'near', [130, 240])];
    const drawPetal = (p, c, t) => {
      const sec = t / 1000;
      const u = c * (1 + p.k) + p.u + p.fa * Math.sin(p.fw * sec + p.fp) + 0.5 * p.fa * Math.sin(p.fw * 0.37 * sec + p.fp * 2);
      const v = p.v + p.fall * sec + p.wa * Math.sin(p.ww * sec + p.wp);
      const [x, y] = toScreen(u, v);
      const r = p.s * (p.layer === 'near' ? 1.4 : 1);
      if (x < -r || x > W + r || y < -r || y > H + r) return;
      const flip = Math.cos(p.tw * sec + p.tp); // 縦に回る(見かけの幅が変わる)
      const rot = p.rot + p.spin * sec;
      g.setTransform(Math.cos(rot) * flip, Math.sin(rot) * flip, -Math.sin(rot), Math.cos(rot), x, y);
      g.globalAlpha = p.a * (0.7 + 0.3 * Math.abs(flip));
      const img = p.layer === 'near' ? SOFT[p.tint] : SHARP[p.tint];
      g.drawImage(img, -r, -r, r * 2, r * 2);
    };
    const drawBand = (c) => {
      g.setTransform(ca, sa, -sa, ca, W / 2, H / 2);
      g.globalAlpha = 1;
      const gr = g.createLinearGradient(c - CORE, 0, c + CORE, 0), e = EDGE / (CORE * 2);
      gr.addColorStop(0, 'rgba(250,210,223,0)'); gr.addColorStop(e, 'rgba(250,210,223,1)');
      gr.addColorStop(1 - e, 'rgba(250,210,223,1)'); gr.addColorStop(1, 'rgba(250,210,223,0)');
      g.fillStyle = gr; g.fillRect(c - CORE, -1400, CORE * 2, 2800);
    };
    let swapped = false;
    const t0 = performance.now();
    for (;;) {
      const t = performance.now() - t0, c = center(t);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      for (const p of P) if (p.layer === 'far') drawPetal(p, c, t);
      drawBand(c);
      // 下地のふちには花びらを特に多く重ねて、ふちの線が見えないように
      for (const p of P) if (p.layer === 'mass' || p.layer === 'edge') drawPetal(p, c, t);
      for (const p of P) if (p.layer === 'mid' || p.layer === 'near') drawPetal(p, c, t);
      // 埋め尽くしたところで入れ替える
      if (!swapped && t >= SWAP) { swapped = true; swap(); }
      if (t >= END) break;
      await frame();
    }
    if (!swapped) swap();
    cv.remove();
  }

  // 障子が閉まって、開く(タイトル戦)
  async function shoji(el, swap) {
    // 組子(格子)と和紙。枠は濃い木の色
    const paper = 'background-color:#f3ead6;background-image:linear-gradient(#5a3d22,#5a3d22),linear-gradient(90deg,#5a3d22,#5a3d22),repeating-linear-gradient(90deg,transparent 0 158px,#6b4a2b 158px 166px),repeating-linear-gradient(0deg,transparent 0 172px,#6b4a2b 172px 180px),radial-gradient(ellipse at 50% 40%,rgba(255,250,235,.9),rgba(230,214,180,.6));background-size:100% 26px,26px 100%,auto,auto,auto;background-repeat:no-repeat,no-repeat,repeat,repeat,no-repeat;background-position:0 0,0 0,13px 0,0 13px,0 0;box-shadow:inset 0 0 0 26px #4a3019,0 0 40px rgba(0,0,0,.6)';
    const L = div(el, `position:absolute;top:0;bottom:0;left:0;width:960px;${paper};transform:translateX(-100%)`);
    const R = div(el, `position:absolute;top:0;bottom:0;right:0;width:960px;${paper};transform:translateX(100%)`);
    // 引手(3D の版と同じ: 閉じ合わせる側の縦框に掘り込んだ細長いくぼみ。扉の幅 960px を 900mm とみて 幅 約18mm・高さ 約75mm)
    const pull = 'position:absolute;top:calc(50% + 22px);width:12px;height:76px;margin-top:-38px;border-radius:6px;background:#0d0805;border:3px solid #9a7a44;box-sizing:content-box';
    div(L, `${pull};right:4px`); div(R, `${pull};left:4px`);
    const close = 'cubic-bezier(.55,0,.25,1)';
    await Promise.all([anim(L, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], 560, close), anim(R, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], 560, close)]);
    swap();
    await later(420);
    await Promise.all([anim(L, [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], 900, 'cubic-bezier(.4,0,.2,1)'), anim(R, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], 900, 'cubic-bezier(.4,0,.2,1)')]);
    L.remove(); R.remove();
  }

  window.DraftEntry = { blackout, band, petals, shoji };
})();
