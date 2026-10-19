// テーマの効果音(Web Audio で合成)。無いものは金の後光の音
// 部品: tone(波形, 始めの高さ, 終わりの高さ, 鳴らす時刻, 長さ, 大きさ) / hiss(時刻, 長さ, 大きさ, フィルター, 始め, 終わり, Q)
(function () {
  const SE = window.OverlayAudio && window.OverlayAudio.SE;
  if (!SE || !SE.defineTheme) return;

  // スポーツ中継: 速い風切り音と、電子的な短い音
  SE.defineTheme('sports', {
    flip: ({ tone, hiss, t }) => { hiss(t, 0.16, 0.45, 'bandpass', 1800, 6500, 1.4); tone('square', 1320, 1320, t + 0.1, 0.07, 0.07); tone('square', 1760, 1760, t + 0.17, 0.09, 0.06); },
    stamp: ({ tone, hiss, t }) => { tone('sine', 170, 48, t, 0.3, 0.95); hiss(t, 0.12, 0.45, 'highpass', 1500, 2500); tone('sawtooth', 659, 659, t + 0.02, 0.22, 0.07); tone('sawtooth', 988, 988, t + 0.02, 0.22, 0.05); },
    conflict: ({ tone, t }) => { for (let i = 0; i < 4; i++) tone('square', i % 2 ? 740 : 988, i % 2 ? 740 : 988, t + i * 0.14, 0.12, 0.09); tone('sine', 110, 45, t + 0.56, 0.8, 0.9); tone('sawtooth', 220, 210, t + 0.56, 0.9, 0.08); },
    pop: ({ tone, t }) => { tone('triangle', 1500, 2100, t, 0.08, 0.2); },
    entry: ({ tone, hiss, t }) => { hiss(t, 0.55, 0.5, 'bandpass', 400, 5200, 1); tone('sine', 220, 1200, t, 0.5, 0.12); hiss(t + 0.55, 0.5, 0.35, 'bandpass', 5000, 600, 1); },
  });

  // ドラフト会議: 控えめな紙の音、静かな鐘と低い響き
  SE.defineTheme('draft', {
    flip: ({ hiss, tone, t }) => { hiss(t, 0.2, 0.22, 'lowpass', 2400, 900); tone('sine', 1046, 1046, t + 0.1, 0.5, 0.04); },
    stamp: ({ tone, t }) => { tone('sine', 880, 880, t, 1.6, 0.1); tone('sine', 1318, 1318, t, 1.2, 0.04); tone('sine', 220, 200, t, 0.35, 0.3); },
    conflict: ({ tone, hiss, t }) => { tone('sine', 98, 96, t, 2.6, 0.5); tone('sine', 196.5, 195, t, 2.2, 0.16); tone('sine', 293, 292, t, 1.6, 0.06); hiss(t, 0.5, 0.08, 'lowpass', 600, 200); },
    pop: ({ tone, t }) => { tone('sine', 1320, 1320, t, 0.18, 0.08); },
    win: ({ tone, t }) => { [523, 659, 784].forEach((f, i) => tone('sine', f, f, t + i * 0.18, 1.6, 0.1)); tone('sine', 1046, 1046, t + 0.54, 2, 0.08); },
    entry: ({ tone, t }) => { tone('sine', 65, 55, t, 1.4, 0.35); },
  });

  // 桜: 鈴やお琴のような軽い音
  const pluck = (tone, f, t, v = 0.14) => { tone('triangle', f, f, t, 0.9, v); tone('sine', f * 2, f * 2, t, 0.5, v * 0.35); };
  SE.defineTheme('sakura', {
    flip: ({ tone, hiss, t }) => { hiss(t, 0.18, 0.18, 'highpass', 3000, 6000); tone('sine', 1568, 1568, t + 0.1, 0.7, 0.07); tone('sine', 2093, 2093, t + 0.14, 0.6, 0.05); },
    stamp: ({ tone, t }) => { pluck(tone, 784, t); pluck(tone, 1175, t + 0.08, 0.1); },
    conflict: ({ tone, t }) => { [1175, 988, 880, 784, 659, 587].forEach((f, i) => pluck(tone, f, t + i * 0.07, 0.11)); tone('sine', 147, 140, t + 0.4, 1.4, 0.3); },
    pop: ({ tone, t }) => { tone('sine', 2349, 2349, t, 0.3, 0.07); },
    // 花吹雪: 風が強まって、埋め尽くしたところで鈴、抜けていく
    entry: ({ tone, hiss, t }) => { hiss(t, 0.8, 0.22, 'bandpass', 500, 2600, 0.6); hiss(t + 0.7, 1.2, 0.2, 'bandpass', 2600, 700, 0.6); [1568, 2093, 2637].forEach((f, i) => tone('sine', f, f, t + 0.7 + i * 0.08, 1.0, 0.05)); },
  });

  // タイトル戦: 拍子木と太鼓
  const clack = (tone, hiss, t, v = 0.3) => { tone('triangle', 1900, 1700, t, 0.08, v); tone('square', 950, 900, t, 0.05, v * 0.25); hiss(t, 0.04, v, 'bandpass', 2500, 2000, 3); };
  SE.defineTheme('title', {
    flip: ({ hiss, t }) => { hiss(t, 0.26, 0.28, 'bandpass', 700, 1400, 0.8); },
    stamp: ({ tone, hiss, t }) => { clack(tone, hiss, t); },
    conflict: ({ tone, hiss, t }) => { tone('sine', 95, 48, t, 0.7, 1); hiss(t, 0.2, 0.3, 'lowpass', 400, 120); tone('sine', 90, 45, t + 0.38, 0.9, 1); hiss(t + 0.38, 0.25, 0.3, 'lowpass', 400, 120); },
    pop: ({ tone, t }) => { tone('triangle', 1400, 1300, t, 0.05, 0.12); },
    entry: ({ tone, hiss, t }) => { hiss(t, 0.5, 0.3, 'lowpass', 500, 1600, 0.7); tone('sine', 180, 110, t + 0.55, 0.2, 0.6); hiss(t + 1.0, 0.85, 0.22, 'lowpass', 1500, 400, 0.7); },
  });
})();
