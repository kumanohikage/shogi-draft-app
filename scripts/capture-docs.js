// README 用のスクリーンショットを撮る(お試しモードのダミー名簿で一連の流れを進める)
// 使い方: npx electron scripts/capture-docs.js   → docs/images/ に保存
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('mute-audio'); // 検証中はスピーカーから音を出さない
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const { start } = require('../server.js');
const C = require('../public/core.js');

const OUT = path.join(__dirname, '../docs/images');
const PORT = 5190;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-docs-'));
  await start({ port: PORT, dataDir });
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  let S = null;
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'state') S = m.state; });
  await new Promise((r) => ws.on('open', r));
  const send = async (m) => { ws.send(JSON.stringify(m)); await wait(300); };
  const act = (a) => send({ type: 'action', action: a });
  await send({ type: 'mode', mode: 'demo', fresh: true });
  await act({ type: 'setOption', patch: { lotteryMode: 'roulette' } });
  await act({ type: 'setTitle', title: 'ドラフト会議' });

  const ct = new BrowserWindow({ width: 1360, height: 900, show: false });
  const ov = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, frame: false, webPreferences: { offscreen: true } });
  ov.setContentSize(1920, 1080);
  await ct.loadURL(`http://localhost:${PORT}/control`);
  await ov.loadURL(`http://localhost:${PORT}/overlay`);
  await wait(1500);
  const cjs = (c) => ct.webContents.executeJavaScript(c);
  console.log('配信画面の大きさ', await ov.webContents.executeJavaScript('innerWidth + "x" + innerHeight'));
  // 管理画面: 上から h ピクセルぶん / 配信画面: 1920×1080 を JPEG で
  const shotC = async (name, h = 900) => {
    await wait(500);
    ct.setContentSize(1360, h - 1); await wait(100); ct.setContentSize(1360, h); await wait(300); // 大きさを変えて描き直させる(同じ大きさだと前の絵のまま撮れることがある)
    fs.writeFileSync(path.join(OUT, name + '.png'), (await ct.webContents.capturePage()).toPNG());
    ct.setContentSize(1360, 900);
    console.log('撮影', name);
  };
  const shotO = async (name, delay = 1500) => {
    await wait(delay);
    fs.writeFileSync(path.join(OUT, name + '.jpg'), (await ov.webContents.capturePage()).toJPEG(86));
    console.log('撮影', name);
  };
  const clickNext = async () => { for (let i = 0; i < 40 && await cjs("(document.querySelector('#next button.h-12') || {}).disabled === true"); i++) await wait(150); await cjs("document.querySelector('#next button.h-12').click(); 0"); await wait(400); };
  const L = S.leaders.map((l) => l.id), P = S.players.map((p) => p.id);

  // 1. リーダー(一覧と1人のパネル)
  await cjs("selectTab('leaders'); 0");
  await shotC('control-roster', 900);
  await cjs("openCrop('L', S.leaders[0].id); 0"); await wait(800);
  await cjs("crop.zoom = 1.4; crop.y = -20; document.getElementById('crop-zoom').value = 1.4; drawCrop(); 0");
  await shotC('control-crop', 900);
  await cjs("document.getElementById('crop').close(); selectTab('prog'); 0");

  // 2. 進行表: ドラフトの場面の「⚙ 進め方」と、資料・リーダー紹介の配信画面
  await act({ type: 'progGo', idx: C.programOf(S).findIndex((g) => g.type === 'draft') });
  await cjs("selectTab('prog'); ui.draftTab = 'setup'; render(); 0");
  await shotC('control-show', 1100);
  await cjs("ui.draftTab = 'live'; render(); 0");
  await act({ type: 'progGo', idx: 1 });
  await shotO('overlay-slide', 1200);
  await act({ type: 'introGo', idx: 0 }); await act({ type: 'progGo', idx: 3 });
  await shotO('overlay-intro', 1500);
  await act({ type: 'progGo', idx: C.programOf(S).findIndex((g) => g.type === 'draft') });
  await act({ type: 'setScene', scene: 'board' });

  // 3. 指名の入力
  for (const [i, p] of [[0, 0], [1, 7], [2, 0], [3, 13]]) await act({ type: 'nominate', leaderId: L[i], playerId: P[p] });
  await shotC('control-nominate', 1000);
  for (const [i, p] of [[4, 21], [5, 7]]) await act({ type: 'nominate', leaderId: L[i], playerId: P[p] });
  await shotC('control-ready', 900);
  // 本番ビュー(次にやることとメモ)
  await act({ type: 'updateProgram', id: C.programOf(S).find((g) => g.type === 'draft').id, patch: { memo: '公開の前に、指名の理由を一言ずつ聞く' } });
  await cjs("setView('live'); 0"); await wait(600);
  await shotC('control-live', 900);
  await cjs("setView('edit'); 0");

  // 4. 確認 → 一斉公開 → 重複(2件)
  await clickNext();
  await cjs("[...document.querySelectorAll('#next button')].find((b) => /一斉公開|再指名を公開/.test(b.textContent)).click(); 0"); await wait(400);
  await shotO('overlay-board', 3500);
  await shotC('control-conflict', 900);

  // 5. 抽選ルーレット(2件続けて)
  await clickNext();
  await shotO('overlay-roulette', 4500);
  for (let i = 0; i < 160 && !S.lottery.done; i++) await wait(500);
  await shotO('overlay-result', 1200);
  await shotC('control-lottery-done', 620);
  await clickNext();
  for (let i = 0; i < 160 && !S.lottery.done; i++) await wait(500);
  await wait(1500);

  // 6. ボードに戻して、外れた人がまとめて再指名
  await clickNext();
  await shotC('control-renominate', 1000);
  const losers = S.lotteries.flatMap((x) => x.leaders.filter((id) => id !== x.winner));
  for (const [i, id] of losers.entries()) await act({ type: 'nominate', leaderId: id, playerId: P[30 + i] });
  await clickNext();
  await cjs("[...document.querySelectorAll('#next button')].find((b) => /一斉公開|再指名を公開/.test(b.textContent)).click(); 0"); await wait(400);
  await shotO('overlay-board-done', 3500);

  // 7. チーム表
  await clickNext();
  await shotO('overlay-teams', 3000);
  await shotC('control-teams', 620);

  ws.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(0);
});
