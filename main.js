// ドラフト会議アプリ Electron 本体
// 内蔵サーバーを起動し、管理画面をアプリの窓として表示する。配信画面は OBS のブラウザソースで読み込む
const { app, BrowserWindow, Menu, shell, clipboard, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { start } = require('./server');

const PORT = 5188;
const OVERLAY_URL = `http://localhost:${PORT}/overlay`;
const RELEASES_API = 'https://api.github.com/repos/kumanohikage/shogi-draft-app/releases/latest'; // 最新版の番号を見るだけ(何も送らない)
const RELEASES_URL = 'https://github.com/kumanohikage/shogi-draft-app/releases/latest';
const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdwnDA_wSGOq3aWtDHe5qtCHSGIJsPYO_ktHkcbxBT3eRp0IQ/viewform'; // 要望・不具合のフォーム(Google フォーム)

// ポータブル版は exe の隣、それ以外はユーザーデータ領域に保存
function resolveDataDir() {
  const base = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
  const dir = path.join(base, 'draft-data');
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  return dir;
}

// アプリ全体の設定(データフォルダの app-prefs.json)。checkUpdates = 起動時に新しい版を確認する
const prefsFile = (dataDir) => path.join(dataDir, 'app-prefs.json');
function loadPrefs(dataDir) { try { return { checkUpdates: true, ...JSON.parse(fs.readFileSync(prefsFile(dataDir), 'utf8')) }; } catch { return { checkUpdates: true }; } }
function savePrefs(dataDir, p) { try { fs.writeFileSync(prefsFile(dataDir), JSON.stringify(p, null, 1)); } catch { /* 設定が残らないだけ */ } }
// a が b より新しい版か(1.2.3 の形)
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// 新しい版の確認。manual = メニューから押したとき(結果をいつも知らせる)
async function checkUpdate(win, manual) {
  let v = '', url = RELEASES_URL;
  try {
    const r = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'shogi-draft-app' } });
    if (r.ok) { const j = await r.json(); v = String(j.tag_name || '').replace(/^v/, ''); if (/^https:\/\/github\.com\//.test(j.html_url || '')) url = j.html_url; }
  } catch { /* オフラインなど */ }
  if (/^\d+\.\d+\.\d+$/.test(v) && newer(v, app.getVersion())) {
    win.webContents.executeJavaScript(`window.showUpdate && window.showUpdate(${JSON.stringify(v)}, ${JSON.stringify(app.getVersion())}, ${JSON.stringify(url)}); 0`).catch(() => {});
  } else if (manual) {
    dialog.showMessageBox(win, { type: 'info', title: '新しい版の確認', message: v ? `いまの版（${app.getVersion()}）が最新です。` : '確認できませんでした。インターネットにつながっているか確かめてください。' });
  }
}
function buildMenu(dataDir, prefs, getWin) {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'ファイル', submenu: [
      { label: 'データフォルダを開く', click: () => shell.openPath(dataDir) },
      { label: 'BGMフォルダを開く', click: () => { fs.mkdirSync(path.join(dataDir, 'bgm'), { recursive: true }); shell.openPath(path.join(dataDir, 'bgm')); } },
      { type: 'separator' },
      { role: 'quit', label: '終了' },
    ] },
    ...(mac ? [{ label: '編集', submenu: [{ role: 'cut', label: '切り取り' }, { role: 'copy', label: 'コピー' }, { role: 'paste', label: '貼り付け' }, { role: 'selectAll', label: 'すべてを選択' }] }] : []),
    { label: 'OBS設定', submenu: [
      { label: `配信画面のURLをコピー (${OVERLAY_URL})`, click: () => clipboard.writeText(OVERLAY_URL) },
      { label: '配信画面をブラウザで確認', click: () => shell.openExternal(OVERLAY_URL) },
      { type: 'separator' },
      { label: 'OBSへの設定方法', click: () => dialog.showMessageBox({ type: 'info', title: 'OBSへの設定方法', message: 'OBSへの設定方法',
        detail: `1. OBSで「ソース」→「＋」→「ブラウザ」を追加\n2. URLに ${OVERLAY_URL} を入力\n3. 幅 1920 / 高さ 1080 にする\n4. 「OBSで音声を制御する」にチェックを入れてOK（BGM・効果音をOBSの音声ミキサーで扱えます）\n\nこのアプリを起動している間だけ表示されます。` }) },
    ] },
    { label: '表示', submenu: [
      { role: 'reload', label: '再読み込み' },
      { role: 'toggleDevTools', label: '開発ツール' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'ズームをリセット' }, { role: 'zoomIn', label: 'ズームイン' }, { role: 'zoomOut', label: 'ズームアウト' },
    ] },
    { label: 'ヘルプ', submenu: [
      { label: '使い方(README)', click: () => shell.openExternal('https://github.com/kumanohikage/shogi-draft-app#readme') },
      { label: '要望・不具合を送る', click: () => shell.openExternal(FEEDBACK_URL) },
      { type: 'separator' },
      { label: '新しい版を確認', click: () => checkUpdate(getWin(), true) },
      { label: '起動時に新しい版を確認する', type: 'checkbox', checked: prefs.checkUpdates, click: (it) => { prefs.checkUpdates = it.checked; savePrefs(dataDir, prefs); } },
      { label: `バージョン ${app.getVersion()}`, enabled: false },
    ] },
  ]));
}

// 配信画面の一場面を 1920×1080 の PNG にする(画面には出さない窓で開いて撮る)
async function capture(scene) {
  const w = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, frame: false, show: false, webPreferences: { offscreen: true } });
  try {
    w.setContentSize(1920, 1080);
    w.webContents.setAudioMuted(true);
    await w.loadURL(`http://localhost:${PORT}/overlay?export=${scene}`);
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 800)))');
    return (await w.webContents.capturePage()).toPNG();
  } finally { w.destroy(); }
}

app.whenReady().then(async () => {
  const dataDir = resolveDataDir();
  try {
    await start({ port: PORT, dataDir, capture });
  } catch (e) {
    dialog.showErrorBox('起動できません', `ポート ${PORT} が使用中です。すでにアプリが起動していないか確認してください。\n\n${e.message}`);
    app.quit(); return;
  }
  const prefs = loadPrefs(dataDir);
  let win = null;
  buildMenu(dataDir, prefs, () => win);
  // 開発中(npm run app)の窓のアイコン。配布版は exe・app に入ったアイコンを使う
  const icon = path.join(__dirname, 'build', 'icon.png');
  win = new BrowserWindow({ width: 1360, height: 900, title: 'ドラフト会議アプリ', backgroundColor: '#14100c', ...(fs.existsSync(icon) ? { icon } : {}), webPreferences: { contextIsolation: true } });
  win.loadURL(`http://localhost:${PORT}/control`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // 起動して少ししてから、新しい版を確認(メニューの「ヘルプ」でオフにできる)
  win.webContents.once('did-finish-load', () => { if (prefs.checkUpdates) setTimeout(() => checkUpdate(win, false), 3000); });
});
app.on('window-all-closed', () => app.quit());
