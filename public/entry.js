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

  // 花びらが渦を巻いて覆い、ほどけて開く(桜)
  async function petals(el, swap) {
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; cv.style.cssText = 'position:absolute;inset:0';
    el.appendChild(cv);
    const g = cv.getContext('2d'), N = 520;
    const P = Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, r0: 900 + Math.random() * 500, s: 18 + Math.random() * 26, spin: Math.random() * 6, c: ['#ffd3df', '#ffc0d1', '#fbe3ea', '#f7a8c0', '#ffffff'][Math.floor(Math.random() * 5)], d: Math.random() * 0.25 }));
    const draw = (k, out) => {
      g.clearRect(0, 0, 1920, 1080);
      // 桜色で満たす(花びらが集まりきったら一面に)
      const fill = out ? 1 - k : Math.max(0, (k - 0.55) / 0.45);
      if (fill > 0) { g.fillStyle = `rgba(252,226,234,${fill})`; g.fillRect(0, 0, 1920, 1080); }
      for (const p of P) {
        const t = Math.min(1, Math.max(0, (k - p.d) / (1 - p.d)));
        const e = out ? t * t : 1 - (1 - t) * (1 - t);
        const r = out ? 60 + e * p.r0 * 1.3 : p.r0 * (1 - e) + 40;
        const a = p.a + (out ? e * 2.2 : (1 - e) * -3.4);
        const x = 960 + Math.cos(a) * r * 1.2, y = 540 + Math.sin(a) * r * 0.75;
        g.save(); g.translate(x, y); g.rotate(p.spin + a * 2); g.scale(1, 0.6 + 0.4 * Math.cos(p.spin + k * 9));
        g.globalAlpha = out ? 1 - e * 0.9 : Math.min(1, t * 3);
        g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, p.s * 0.55, p.s, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    };
    const run = async (ms, out) => { const t0 = performance.now(); for (;;) { const k = Math.min(1, (performance.now() - t0) / ms); draw(k, out); if (k >= 1) break; await frame(); } };
    await run(900, false);
    swap();
    await later(150);
    await run(1000, true);
    cv.remove();
  }

  // 障子が閉まって、開く(タイトル戦)
  async function shoji(el, swap) {
    // 組子(格子)と和紙。枠は濃い木の色
    const paper = 'background-color:#f3ead6;background-image:linear-gradient(#5a3d22,#5a3d22),linear-gradient(90deg,#5a3d22,#5a3d22),repeating-linear-gradient(90deg,transparent 0 158px,#6b4a2b 158px 166px),repeating-linear-gradient(0deg,transparent 0 172px,#6b4a2b 172px 180px),radial-gradient(ellipse at 50% 40%,rgba(255,250,235,.9),rgba(230,214,180,.6));background-size:100% 26px,26px 100%,auto,auto,auto;background-repeat:no-repeat,no-repeat,repeat,repeat,no-repeat;background-position:0 0,0 0,13px 0,0 13px,0 0;box-shadow:inset 0 0 0 26px #4a3019,0 0 40px rgba(0,0,0,.6)';
    const L = div(el, `position:absolute;top:0;bottom:0;left:0;width:960px;${paper};transform:translateX(-100%)`);
    const R = div(el, `position:absolute;top:0;bottom:0;right:0;width:960px;${paper};transform:translateX(100%)`);
    const close = 'cubic-bezier(.55,0,.25,1)';
    await Promise.all([anim(L, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], 560, close), anim(R, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], 560, close)]);
    swap();
    await later(420);
    await Promise.all([anim(L, [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], 900, 'cubic-bezier(.4,0,.2,1)'), anim(R, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], 900, 'cubic-bezier(.4,0,.2,1)')]);
    L.remove(); R.remove();
  }

  window.DraftEntry = { blackout, band, petals, shoji };
})();
