// テーマの確認: 確認ページの場面を順に出して、画面を撮る(ui-check/theme-<id>/)
// 使い方: electron scripts/check-theme.js <テーマ> [抽選の方式] [抽選を撮る秒数のリスト(カンマ区切り)]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

app.commandLine.appendSwitch('mute-audio');
const PORT = 5199;
const [themeId = 'gold', lot = 'envelope', lotTimes = '1.2,3,8'] = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
const LONG = process.argv.includes('--long'); // 長い名前で撮る
const OUT = path.join(__dirname, '../ui-check', `theme-${themeId}${LONG ? '-long' : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-theme-'));
  const srv = await start({ port: PORT, dataDir });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('  [画面]', e.message); });
  await win.loadURL(`http://localhost:${PORT}/theme-check.html?theme=${themeId}&lot=${lot}&bare${LONG ? '&long' : ''}`);
  await wait(1500);
  const js = (c) => win.webContents.executeJavaScript(c);
  await js(`playing = false; clearTimeout(timer); document.getElementById('play').setAttribute('aria-pressed','false')`);
  const list = await js(`steps.map((s) => s[0])`);
  let k = 0;
  for (let i = 0; i < list.length; i++) {
    await js(`go(${i})`);
    const isLot = list[i] === '抽選';
    const shots = isLot ? lotTimes.split(',').map(Number) : [1.6];
    let t0 = 0;
    for (const t of shots) {
      await wait((t - t0) * 1000); t0 = t;
      const img = await win.webContents.capturePage();
      const name = `${String(++k).padStart(2, '0')}-${list[i]}${isLot ? `-${t}s` : ''}.png`;
      fs.writeFileSync(path.join(OUT, name), img.resize({ width: 960 }).toPNG());
    }
  }
  // 一覧(4列)の1枚にまとめる
  const files = fs.readdirSync(OUT).filter((x) => x.endsWith('.png')).sort();
  const cells = files.map((x) => `<figure><img src="${encodeURI(x)}"><figcaption>${x.replace('.png', '')}</figcaption></figure>`).join('');
  const rows = Math.ceil(files.length / 4);
  await win.setContentSize(1920, rows * 270);
  const sheet = path.join(OUT, 'sheet.html');
  fs.writeFileSync(sheet, `<meta charset="utf-8"><style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(4,480px);font:14px sans-serif;color:#ccc}figure{margin:0;position:relative}img{width:480px;display:block}figcaption{position:absolute;left:4px;top:2px;background:#000a;padding:0 4px}</style>${cells}`);
  await win.loadURL(require('url').pathToFileURL(sheet).href);
  await wait(500);
  fs.writeFileSync(path.join(OUT, '..', `theme-${themeId}-sheet.png`), (await win.webContents.capturePage()).toPNG());
  console.log(`✓ ${k} 枚: ${OUT}`);
  srv.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  app.quit();
});
