// 場面の切り替えの途中で、配信画面の後ろ(OBS・ブラウザの背景)が透けないかを確かめる
// 後ろを赤紫にして全場面を順に切り替え、途中の画面を何枚も撮って赤紫の点を数える(0 ならよい)
// 使い方: electron scripts/check-transitions.js [テーマ,…] [切り替え,…] [抽選の方式]
//   例: electron scripts/check-transitions.js gold,sports fade,slide,wipe,fadeBlack wheel
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

app.commandLine.appendSwitch('mute-audio');
const PORT = 5201;
const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
const themes = (args[0] || 'gold,sports,draft,sakura,title').split(',');
const transitions = (args[1] || 'fade').split(',');
const lot = args[2] || 'envelope';
const OUT = path.join(__dirname, '../ui-check/transitions');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-trans-'));
  const srv = await start({ port: PORT, dataDir });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(60);
  const js = (c) => win.webContents.executeJavaScript(c);
  // 描いた1枚ごとに受け取る(capturePage は遅く、短い切り替えを取りこぼす)
  let watch = null;
  win.webContents.on('paint', (e, dirty, im) => {
    if (!watch) return;
    const bmp = im.resize({ width: 320 }).toBitmap(); // BGRA
    let n = 0;
    for (let p = 0; p < bmp.length; p += 4) if (bmp[p + 2] > 230 && bmp[p + 1] < 40 && bmp[p] > 230) n++;
    watch.frames++;
    if (n > watch.max) { watch.max = n; watch.shot = im; }
  });
  let bad = 0;
  for (const th of themes) for (const tr of transitions) {
    await win.loadURL(`http://localhost:${PORT}/theme-check.html?theme=${th}&lot=${lot}&bare`);
    await wait(1500);
    await js(`playing = false; clearTimeout(timer); document.getElementById('view').style.background = '#ff00ff';
      steps.forEach((s) => { s[1].options = Object.assign({}, s[1].options, { transition: ${JSON.stringify(tr)}, transSec: 0.8, fadeSec: 0.4 }); });`);
    const list = await js('steps.map((s) => [s[0], s[2]])');
    await js('go(0)'); await wait(1500);
    // OBS の背景の代わり: 配信画面のページそのものの下地を赤紫に(透けたところだけ赤紫が見える)
    await js("document.getElementById('ov').contentDocument.documentElement.style.background = '#ff00ff'");
    const worst = [];
    for (let i = 1; i < list.length; i++) {
      watch = { max: 0, shot: null, frames: 0 };
      await js(`go(${i})`);
      await wait(Math.min(list[i][1], 4) * 1000);
      const { max, shot } = watch; watch = null;
      if (max > 0) {
        bad++;
        const name = `${th}-${tr}-${String(i).padStart(2, '0')}-${list[i][0]}.png`;
        fs.writeFileSync(path.join(OUT, name), shot.resize({ width: 960 }).toPNG());
        worst.push(`${list[i][0]}(${max})`);
      }
    }
    console.log(`${worst.length ? '✗' : '✓'} ${th} / ${tr}${worst.length ? ': 透けた ' + worst.join(' ') : ''}`);
  }
  console.log(bad ? `透けた場面 ${bad} (画面: ${OUT})` : '透けた場面はありません');
  srv.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  app.quit();
});
