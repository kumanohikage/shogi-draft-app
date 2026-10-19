// テーマの全場面を1枚の「ボード」に並べて、Figma へ写す(デザイナーが手で直せるレイヤーとして)
// 使い方: electron scripts/figma-board.js <テーマ> <captureId>   (captureId は Figma MCP の generate_figma_design で取る)
//         captureId を省くとボードを作って画像を撮るだけ(ui-check/figma-<テーマ>.png)
// 3D の背景は写せないので、テーマの CSS の背景(?static)で描く
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

app.commandLine.appendSwitch('mute-audio');
const PORT = 5203;
const [themeId = 'gold', captureId] = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
// 確認ページの台本から写す場面(同じ名前が続くときは最後の1枚)。3D の抽選は全テーマ共通なので写さない
const SKIP = new Set(['抽選', '抽選の結果', 'エンディング']);
const COLS = 3, GAP = 160, LABEL = 90;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-figma-'));
  const srv = await start({ port: PORT, dataDir });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || /figma|capture/i.test(e.message)) console.log('  [画面]', e.message); });
  const js = (c) => win.webContents.executeJavaScript(c);

  // 台本(状態の列)を確認ページから借りる
  await win.loadURL(`http://localhost:${PORT}/theme-check.html?theme=${themeId}&lot=envelope&bare`);
  await wait(800);
  const all = await js('JSON.parse(JSON.stringify(steps.map((s) => [s[0], s[1]])))');
  const picked = all.filter(([name], i) => !SKIP.has(name) && !(all[i + 1] && all[i + 1][0] === name));

  await win.loadURL(`http://localhost:${PORT}/overlay.html?mock&static&theme=${themeId}`);
  await wait(800);
  await js('document.fonts.ready');
  const rows = Math.ceil(picked.length / COLS);
  const W = COLS * 1920 + (COLS + 1) * GAP, H = rows * (1080 + LABEL + GAP) + GAP;
  // ボード: 場面ごとに配信画面を写し取って並べる(隠れている場面・iframe・背景の層は外す)
  await js(`(() => {
    const st = document.createElement('style');
    st.textContent = 'html,body{overflow:visible!important;height:auto!important;background:#2b2b2b!important}#board{position:relative;width:${W}px;height:${H}px}.shot{position:absolute;width:1920px;height:1080px;overflow:hidden}.shot>#stage{position:absolute!important;left:0;top:0;transform:none!important}.cap{position:absolute;font:700 56px "Noto Sans JP",sans-serif;color:#fff}';
    document.head.appendChild(st);
    const b = document.createElement('div'); b.id = 'board'; document.body.appendChild(b);
  })()`);
  for (let i = 0; i < picked.length; i++) {
    const [name, state] = picked[i];
    await js(`window.postMessage({ type: 'mock-state', state: ${JSON.stringify(state)} }, '*')`);
    await wait(i ? 3200 : 1200); // めくり・ハンコなどの動きが終わるまで
    const x = GAP + (i % COLS) * (1920 + GAP), y = GAP + Math.floor(i / COLS) * (1080 + LABEL + GAP);
    await js(`(() => {
      const src = document.getElementById('stage'), c = src.cloneNode(true);
      c.querySelectorAll('.scene:not(.on), iframe, video, #trans, #entry, #bglayer').forEach((e) => e.remove());
      c.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; });
      const shot = document.createElement('div'); shot.className = 'shot'; shot.dataset.name = ${JSON.stringify(name)};
      shot.style.left = '${x}px'; shot.style.top = '${y + LABEL}px'; shot.appendChild(c);
      const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = ${JSON.stringify(`${i + 1}. ${name}`)}; cap.style.left = '${x}px'; cap.style.top = '${y}px';
      document.getElementById('board').append(cap, shot);
    })()`);
  }
  await js(`document.getElementById('stage').style.display = 'none'`);
  win.setContentSize(Math.min(W, 8000), Math.min(H, 8000));
  await wait(800);
  fs.writeFileSync(path.join(__dirname, `../ui-check/figma-${themeId}.png`), (await win.webContents.capturePage()).resize({ width: 1600 }).toPNG());
  if (captureId) {
    // Figma の写し取りの部品を読み込んで、ボードを送る
    await js(`new Promise((r) => { const s = document.createElement('script'); s.src = 'https://mcp.figma.com/mcp/html-to-design/capture.js'; s.onload = r; s.onerror = r; document.head.appendChild(s); })`);
    await wait(500);
    const res = await js(`window.figma.captureForDesign({ captureId: '${captureId}', endpoint: 'https://mcp.figma.com/mcp/capture/${captureId}/submit?bindVariables=true', selector: 'body' }).then((v) => JSON.stringify(v).slice(0, 300), (e) => 'ERR ' + e.message)`);
    console.log('  Figma:', res);
  }
  console.log(`✓ ${themeId}: ${picked.length} 場面 ${picked.map((p) => p[0]).join(' / ')}`);
  srv.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  app.quit();
});
