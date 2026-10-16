// 管理画面の検査: いろいろな状態にして描画された HTML を melta UI の lint にかけ、スクショも撮る
// あわせて axe-core で WCAG 2.1 AA(コントラスト等)も検査する(melta の CI と同じ道具)
// 使い方: npm run check:ui   (結果は ui-check/ に出る。error が1件でもあれば exit 1)
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('mute-audio'); // 検証中はスピーカーから音を出さない
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const { start } = require('../server.js');
const C = require('../public/core.js');

const OUT = path.join(__dirname, '../ui-check');
const PORT = 5197;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { lint } = await import('melta-ds-mcp/lint');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-ui-check-'));
  await start({ port: PORT, dataDir });

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  let S = null;
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'state') S = m.state; });
  await new Promise((r) => ws.on('open', r));
  const send = async (msg) => { ws.send(JSON.stringify(msg)); await wait(300); };
  const act = (action) => send({ type: 'action', action });

  const win = new BrowserWindow({ width: 1360, height: 900, show: false });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('  [画面]', e.message); });
  await win.loadURL(`http://localhost:${PORT}/control`);
  await wait(800);
  const js = (code) => win.webContents.executeJavaScript(code);
  const tab = async (name) => { await js(`selectTab(${JSON.stringify(name)})`); await wait(200); };

  let errors = 0, warns = 0;
  const seen = new Map(); // 同じ違反はまとめて表示する
  const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  async function check(name) {
    await wait(300);
    const html = '<!DOCTYPE html>\n' + await js('document.documentElement.outerHTML');
    fs.writeFileSync(path.join(OUT, name + '.html'), html);
    const h = await js('document.documentElement.scrollHeight');
    win.setContentSize(1360, Math.min(Math.max(h, 900), 4000)); await wait(200);
    fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(1360, 900);
    const r = lint(html, { sourceType: 'html' });
    // axe: WCAG 2.1 AA
    await js(AXE);
    const ax = await js("axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }).then((r) => ({ passes: r.passes.length, list: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 3) })) }))");
    errors += r.errorCount + ax.list.length; warns += r.warnCount;
    const ok = r.passed && !ax.list.length;
    console.log(`${ok ? '✓' : '✗'} ${name}: melta error ${r.errorCount} / warn ${r.warnCount}  axe 違反 ${ax.list.length}（合格 ${ax.passes} 項目）`);
    for (const v of ax.list) { const key = 'axe ' + v.id; if (!seen.has(key)) { seen.set(key, v); console.log(`    [axe:${v.impact}] ${v.id}: ${v.help}  例: ${v.nodes.join(' | ')}`); } }
    for (const v of r.violations) {
      const key = `${v.severity} ${v.ruleId} ${v.token || ''}`;
      if (!seen.has(key)) { seen.set(key, v); console.log(`    [${v.severity}] ${v.ruleId}: ${v.token || ''} → ${v.alternative || ''}`); }
    }
  }

  // 1. 何も登録していない状態
  await check('01-run-empty');
  await tab('leaders'); await check('02-leaders-empty');
  // 2. お試しモード(ダミー名簿)
  await send({ type: 'mode', mode: 'demo' });
  // 進行表のドラフトの場面へ(お試しは進行表の最初=オープニングから始まる)
  await act({ type: 'progGo', idx: C.programOf(S).findIndex((g) => g.type === 'draft') });
  await check('03-roster-demo');
  await tab('prog'); await check('04-run-demo-start');
  const L = S.leaders.map((l) => l.id), P = S.players.map((p) => p.id);
  // 以降は「次にやること」の大きなボタンを押して進める(主催者の操作と同じ)
  const next = async (expect) => {
    for (let i = 0; i < 40 && await js("(document.querySelector('#next button.h-12') || {}).disabled === true"); i++) await wait(150); // 演出中(押せない)の間は待つ
    const label = await js("(document.querySelector('#next button.h-12') || {}).textContent || ''");
    if (expect && !label.includes(expect)) { console.log(`✗ 次のボタンが「${label}」（期待: ${expect}）`); errors++; }
    await js("document.querySelector('#next button.h-12').click()"); await wait(400);
  };
  // サブのボタン(白枠)を文字で探して押す
  const sub = async (label) => {
    const ok = await js(`(() => { const b = [...document.querySelectorAll('#next button')].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (b) b.click(); return !!b; })()`);
    if (!ok) { console.log(`✗ 「${label}」のボタンがない`); errors++; }
    await wait(400);
  };
  // 3. 指名を入れる(選手A に3人、選手E に2人の重複が2件)
  for (const [i, p] of [[0, 0], [1, 0], [2, 0], [3, 3], [4, 4]]) await act({ type: 'nominate', leaderId: L[i], playerId: P[p] });
  await check('05-run-entering');
  await act({ type: 'nominate', leaderId: L[5], playerId: P[4] });
  await check('06-run-ready');
  // 各カードの「公開」で1人だけ公開 → 残りを一斉公開
  await js("document.querySelector('#noms [data-next=\"revealOne\"]').click(); 0"); await wait(400);
  if (S.picks.length !== 0 || Object.values(S.noms).filter((n) => n.revealed).length !== 1) { console.log('✗ 1人ずつ公開が想定どおりでない'); errors++; }
  await check('06b-run-partial');
  await sub('残りを一斉公開');
  await check('07-run-conflict');
  // 4. 抽選1件目(演出中 → 結果)→ ボードに戻らずに2件目の抽選へ
  const losers = [];
  await next('抽選する');
  await check('08-run-lottery-pending');
  await act({ type: 'lotteryDone', id: S.lottery.id });
  losers.push(...S.lottery.leaders.filter((id) => id !== S.lottery.winner));
  await check('09-run-lottery-done');
  const blockedCards = await js("[...document.querySelectorAll('#noms p')].filter((p) => p.textContent.includes('ほかの重複の抽選が終わったら')).length");
  if (blockedCards !== losers.length) { console.log(`✗ 外れたリーダーの再指名が止まっていない (${blockedCards})`); errors++; }
  await next('次の抽選へ');
  await act({ type: 'lotteryDone', id: S.lottery.id });
  losers.push(...S.lottery.leaders.filter((id) => id !== S.lottery.winner));
  await check('09b-run-lottery2-done');
  await next('指名ボードに戻す');
  if (S.scene !== 'board') { console.log('✗ ボードに戻っていない'); errors++; }
  await check('10-run-renominate');
  // 5. 外れた全員でまとめて再指名 → 公開 → チーム表 → 次の巡
  for (const [i, id] of losers.entries()) await act({ type: 'nominate', leaderId: id, playerId: P[10 + i] });
  await next('確認した'); await check('10b-run-confirm');
  await sub('再指名を公開');
  await check('11-run-round-complete');
  await next('チーム表を映す');
  if (S.scene !== 'teams') { console.log('✗ チーム表になっていない'); errors++; }
  await check('12-run-teams');
  await next('第2巡へ進む');
  if (S.round !== 2 || S.scene !== 'round') { console.log('✗ 第2巡のはじめ(巡の見出し)になっていない'); errors++; }
  await check('13-run-round2');
  // 6. 画像の登録: ドロップ → 調整画面 → 位置と大きさを変えて保存 → 開き直すと調整が残っている
  await tab('players');
  const before = S.players[0].icon;
  await js(`(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const g = c.getContext('2d'); g.fillStyle = '#c0261e'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#1f63d6'; g.fillRect(100, 0, 100, 100);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
    document.querySelector('#players [data-icon]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);
  await wait(600);
  if (!(await js("document.getElementById('crop').open"))) { console.log('✗ 調整画面が開かない'); errors++; }
  await js("crop.zoom = 2; crop.x = 40; drawCrop(); 0");
  await check('14-roster-crop');
  await js("document.getElementById('crop-save').click(); 0");
  for (let i = 0; i < 30 && S.players[0].icon === before; i++) await wait(200); // 保存が終わるまで待つ
  const p0 = S.players[0];
  if (!p0.icon || p0.icon === before || !fs.existsSync(path.join(dataDir, 'images', p0.icon)) || !p0.iconSrc || !p0.iconCrop || p0.iconCrop.zoom !== 2) { console.log(`✗ 画像の保存に失敗 ${JSON.stringify(p0)}`); errors++; }
  else console.log(`✓ 画像を調整して保存: ${p0.icon}（元画像 ${p0.iconSrc}、調整 ${JSON.stringify(p0.iconCrop)}）`);
  await js("document.querySelector('#players [data-icon]').click()"); await wait(800);
  const re = await js("({ open: document.getElementById('crop').open, zoom: crop.zoom, x: Math.round(crop.x) })");
  if (!re.open || re.zoom !== 2 || re.x !== 40) { console.log(`✗ 開き直したときに調整が残っていない ${JSON.stringify(re)}`); errors++; }
  else console.log('✓ 開き直すと前の調整のまま');
  await js("document.getElementById('crop').close(); 0");
  await check('15-roster-image');
  await tab('show'); await check('16-show');
  await tab('leaders'); await check('17-leaders');
  await tab('prog'); await js("ui.draftTab = 'setup'; render(); 0"); await check('18-draft-setup');
  await js("ui.draftTab = 'live'; ui.selId = C.programOf(S)[1].id; render(); 0"); await check('19-scene-slide');
  await js("setView('live'); 0"); await wait(600); await check('20-live');
  await js("setView('edit'); ui.selId = null; render(); 0");
  await send({ type: 'mode', mode: 'real' });

  console.log(`\n合計 error ${errors} / warn ${warns}   (HTML とスクショ: ${OUT})`);
  ws.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(errors ? 1 : 0);
});
