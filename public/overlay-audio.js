// 配信画面の音: BGM(bgm フォルダの曲) と 効果音(Web Audio で合成。音源ファイル不要)
(function () {
  /* ---------- 効果音 ---------- */
  let ctx = null, master = null, noise = null, seVol = 0.7;
  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = seVol;
      master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  // 音を1つ鳴らす部品
  function tone(type, f0, f1, t0, dur, vol, out = master) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function hiss(t0, dur, vol, ftype, f0, f1, q = 1) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  const SE = {
    // カードがめくれる「シュパッ」+ 名前が出る「カーン」
    flip() {
      if (!init()) return;
      const t = ctx.currentTime;
      hiss(t, 0.2, 0.5, 'bandpass', 2600, 500, 1.2);
      tone('triangle', 1568, 1568, t + 0.12, 0.55, 0.18);
      tone('sine', 2349, 2349, t + 0.12, 0.4, 0.08);
    },
    // 交渉権確定のハンコ「ドンッ」+ 小さなきらめき
    stamp() {
      if (!init()) return;
      const t = ctx.currentTime;
      tone('sine', 150, 45, t, 0.35, 0.9);
      hiss(t, 0.08, 0.5, 'lowpass', 3000, 800);
      [1047, 1319, 1568, 2093].forEach((f, i) => tone('triangle', f, f, t + 0.08 + i * 0.05, 0.5, 0.08));
    },
    // 競合「ジャッ、ジャーン!」(不協和の和音 + 低いドーン + シンバル)
    conflict() {
      if (!init()) return;
      const t = ctx.currentTime;
      const hit = (t0, dur, vol) => {
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.frequency.setValueAtTime(500, t0); f.frequency.exponentialRampToValueAtTime(3200, t0 + 0.08); f.frequency.exponentialRampToValueAtTime(700, t0 + dur);
        g.gain.value = vol; f.connect(g); g.connect(master);
        [110, 116.5, 164.8, 174.6, 220, 233.1].forEach((fr) => { tone('sawtooth', fr, fr * 0.995, t0, dur, 0.22, f); });
        tone('sine', 90, 38, t0, Math.min(dur, 1.2), 0.9);
        hiss(t0, dur * 0.9, 0.35, 'highpass', 5000, 3000);
      };
      hit(t, 0.22, 0.7);
      hit(t + 0.3, 1.8, 1);
    },
    // 当たり「パンパカパーン」(明るい長三和音を駆け上がって、きらめき)
    win() {
      if (!init()) return;
      const t = ctx.currentTime;
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([f, d]) => { tone('square', f, f, t + d, 0.18, 0.12); tone('triangle', f * 2, f * 2, t + d, 0.2, 0.06); });
      [523, 659, 784, 1047].forEach((f) => tone('sawtooth', f, f, t + 0.52, 1.1, 0.07));
      tone('sine', 1047, 1047, t + 0.52, 1.2, 0.18);
      [2093, 2637, 3136, 4186, 3136, 4186].forEach((f, i) => tone('sine', f, f, t + 0.6 + i * 0.07, 0.35, 0.05));
      hiss(t + 0.5, 0.6, 0.25, 'highpass', 6000, 4000);
    },
    // 光がもれる「キュイーン」(上がっていくきらめき)
    glow() {
      if (!init()) return;
      const t = ctx.currentTime;
      tone('sine', 300, 1200, t, 1.3, 0.12);
      tone('triangle', 600, 2400, t + 0.1, 1.2, 0.05);
      hiss(t, 1.3, 0.12, 'bandpass', 800, 6000, 2);
    },
    // 外れ「ポン…」(下がる2音)
    lose() {
      if (!init()) return;
      const t = ctx.currentTime;
      tone('triangle', 523, 523, t, 0.25, 0.16); tone('triangle', 392, 392, t + 0.18, 0.5, 0.16);
    },
    // チーム表に名前が入る「ポン」
    pop() {
      if (!init()) return;
      const t = ctx.currentTime;
      tone('sine', 880, 1320, t, 0.14, 0.25);
    },
    // 光の世界へ入るときの音(金の後光は無し。テーマで決める)
    entry() {},
    setVolume(v) { seVol = v; if (master) master.gain.value = v; },
  };

  /* ---------- BGM ----------
   * 抽選ルーレットの間はゆっくり消して、戻ったらゆっくり戻す(止めた位置から続ける) */
  const el = new Audio();
  el.loop = true; el.preload = 'auto';
  let cur = '', want = '', vol = 0, target = 0, level = 0.25, lastT = 0, ducked = false, quick = false;
  const FADE_OUT = 2.0, FADE_IN = 3.0, SWITCH = 0.6, QUICK = 0.3; // 秒
  function step(now) {
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
    const switching = want !== cur;
    const tgt = switching ? 0 : target;
    const sec = switching ? SWITCH : quick ? QUICK : tgt < vol ? FADE_OUT : FADE_IN;
    const speed = Math.max(level, vol, 0.05) / sec;
    vol = tgt > vol ? Math.min(tgt, vol + speed * dt) : Math.max(tgt, vol - speed * dt);
    if (vol === tgt) quick = false;
    el.volume = Math.min(1, Math.max(0, vol));
    if (vol <= 0) {
      if (switching) { cur = want; if (cur) el.src = `/bgm/${encodeURIComponent(cur)}`; else el.removeAttribute('src'); }
      if (!el.paused) el.pause();
    }
    if (target > 0 && want === cur && cur && el.paused) el.play().catch(() => {});
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  const BGM = {
    // audio: { bgm, bgmOn, bgmVol(0〜100) }, duck: ルーレット中など
    update(audio, duck) {
      want = audio.bgmOn && audio.bgm ? audio.bgm : '';
      level = Math.pow((audio.bgmVol ?? 50) / 100, 2); // 耳の感じ方に合わせて2乗
      // 音量つまみの変更はすぐ反映。ルーレットの出入りと曲の頭はゆっくり
      const t = want && !duck ? level : 0;
      if (t !== target && !!duck === ducked && want === cur && vol > 0) quick = true;
      ducked = !!duck;
      target = t;
    },
    get state() { return { cur, vol, paused: el.paused, time: el.currentTime }; },
  };

  /* ---------- テーマの効果音 ----------
   * テーマごとに、めくる・ハンコ・競合・ポンなどを差し替える(無いものは金の後光の音)。
   * 部品(tone / hiss / ctx)を渡して、テーマ側で音を組み立てる */
  const THEME_SE = {};
  let themeId = 'gold';
  const base = Object.assign({}, SE);
  for (const k of Object.keys(base)) {
    if (k === 'setVolume') continue;
    SE[k] = function () { const t = THEME_SE[themeId]; if (t && t[k]) { if (!init()) return; return t[k]({ ctx, tone, hiss, t: ctx.currentTime }); } return base[k](); };
  }
  SE.setTheme = (id) => { themeId = id; };
  SE.defineTheme = (id, sounds) => { THEME_SE[id] = sounds; };

  window.OverlayAudio = { SE, BGM };
})();
