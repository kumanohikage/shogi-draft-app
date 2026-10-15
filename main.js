// ドラフト会議アプリ Electron 本体
// 内蔵サーバーを起動し、管理画面をアプリの窓として表示する。配信画面は OBS のブラウザソースで読み込む
const { app, BrowserWindow, Menu, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { start } = require('./server');

const PORT = 5188;
const OVERLAY_URL = `http://localhost:${PORT}/overlay`;

// ポータブル版は exe の隣、それ以外はユーザーデータ領域に保存
function resolveDataDir() {
  const base = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
  const dir = path.join(base, 'draft-data');
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  return dir;
}

function buildMenu(dataDir) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'ファイル', submenu: [
      { label: 'データフォルダを開く', click: () => shell.openPath(dataDir) },
      { label: 'BGMフォルダを開く', click: () => { fs.mkdirSync(path.join(dataDir, 'bgm'), { recursive: true }); shell.openPath(path.join(dataDir, 'bgm')); } },
      { type: 'separator' },
      { role: 'quit', label: '終了' },
    ] },
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
  buildMenu(dataDir);
  const win = new BrowserWindow({ width: 1360, height: 900, title: 'ドラフト会議アプリ', backgroundColor: '#14100c', webPreferences: { contextIsolation: true } });
  win.loadURL(`http://localhost:${PORT}/control`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
});
app.on('window-all-closed', () => app.quit());
