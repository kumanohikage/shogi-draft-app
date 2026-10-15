// ドラフト会議アプリ サーバー
// 管理画面と配信画面(OBS ブラウザソース)を配信し、WebSocket で状態を同期する
// 単体起動(node server.js)と、Electron からの require の両方に対応
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const Core = require('./public/core.js');
const { makeDemoState } = require('./demo.js');

const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const HISTORY_MAX = 200;
// 「戻す」の対象にしない操作と、戻しても変えない状態
const NO_UNDO = new Set(['lotteryDone', 'setAudio', 'setOption', 'timer']);
const KEEP_ON_UNDO = ['audio', 'options', 'timer', 'lotteryLog'];
const IMG_RE = /\.(png|jpe?g|gif|webp)$/i;
const AUDIO_RE = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$/i;
// 抽選は暗号論的な乱数で(偏りなく)
const fairRandom = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;

function start(opts = {}) {
  const PORT = opts.port || 5188;
  const DATA = opts.dataDir || path.join(__dirname, 'draft-data');
  const IMG = path.join(DATA, 'images');
  const BGM = path.join(DATA, 'bgm'); // BGM は各自ダウンロードした曲をここに置く(アプリには同梱しない)
  // 本番は draft.json、お試しモードは demo.json に分けて保存する(お試しで本番データを壊さない)
  const FILES = { real: path.join(DATA, 'draft.json'), demo: path.join(DATA, 'demo.json') };
  fs.mkdirSync(IMG, { recursive: true });
  fs.mkdirSync(BGM, { recursive: true });

  function load(file) {
    if (fs.existsSync(file)) {
      try { return Object.assign(Core.initialState(), JSON.parse(fs.readFileSync(file, 'utf8'))); }
      catch (e) { console.warn(path.basename(file) + ' を読めませんでした。初期状態で起動します:', e.message); }
    }
    return null;
  }
  let mode = 'real'; // 起動時はいつも本番
  let FILE = FILES.real;
  let state = load(FILE) || Core.initialState();
  let history = [];
  function switchMode(next, fresh) {
    if (next !== 'real' && next !== 'demo') return;
    const audio = state.audio; // 音の設定は本番/お試しで共通
    mode = next; FILE = FILES[mode]; history = [];
    state = (!fresh && load(FILE)) || (mode === 'demo' ? makeDemoState(IMG) : Core.initialState());
    if (audio) state.audio = audio;
  }

  // 書き込み途中で落ちても壊れないよう、一時ファイルに書いてから置き換える
  function save() {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, FILE);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (req.method === 'POST' && p === '/api/upload') return upload(req, res, url, IMG, IMG_RE);
    if (req.method === 'POST' && p === '/api/bgm') return upload(req, res, url, BGM, AUDIO_RE);
    if (p === '/api/bgm') return json(res, listBgm());
    if (p === '/' || p === '/control') p = '/control.html';
    if (p === '/overlay') p = '/overlay.html';
    let file;
    if (p.startsWith('/images/')) file = path.join(IMG, path.basename(p));
    else if (p.startsWith('/bgm/')) file = path.join(BGM, path.basename(p));
    else file = path.join(PUB, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PUB) && !file.startsWith(IMG) && !file.startsWith(BGM)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });

  // 画像・BGM のアップロード(管理画面から)。同じ名前は上書き
  function upload(req, res, url, dir, re) {
    const name = path.basename(url.searchParams.get('name') || '').replace(/[^\w.\-぀-ヿ一-鿿]/g, '_');
    if (!re.test(name)) { res.writeHead(400); return res.end(dir === BGM ? '音声ファイル(mp3 / ogg / wav / m4a)を選んでください' : '画像ファイルを選んでください'); }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 80e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
      json(res, { name });
      if (dir === BGM) broadcast({ type: 'bgmList', list: listBgm() });
    });
  }
  const json = (res, v) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  const listBgm = () => fs.readdirSync(BGM).filter((f) => AUDIO_RE.test(f)).sort((a, b) => a.localeCompare(b, 'ja'));

  const wss = new WebSocket.Server({ server });
  const send = (ws, msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const broadcast = (msg) => wss.clients.forEach((c) => send(c, msg));
  // 「1つ戻す」で抽選が取り消されるか(管理画面で確認を出すため)
  const undoCancelsLottery = () => history.length > 0 && history[history.length - 1].lotteries.length < state.lotteries.length;
  const snapshot = () => ({ type: 'state', state, canUndo: history.length > 0, undoCancelsLottery: undoCancelsLottery(), demo: mode === 'demo' });

  // 配信画面(OBS)を開いていないと演出の終わりが届かず先へ進めないので、2分たったら終わったことにする
  function lotterySafety(id) {
    setTimeout(() => {
      if (!state.lottery || state.lottery.id !== id || state.lottery.done) return;
      state = Core.apply(state, { type: 'lotteryDone', id });
      save();
      broadcast(snapshot());
    }, 120e3);
  }

  // 配信画面(OBS のブラウザソース・ブラウザ)がいくつ開いているか
  const overlays = new Map(); // ws -> { obs, visible, active }
  const presence = () => {
    const list = [...overlays.values()];
    return { type: 'presence', count: list.length, obs: list.some((o) => o.obs), active: list.some((o) => o.obs && o.active === true), hidden: list.length > 0 && list.every((o) => o.obs && (o.visible === false || o.active === false)) };
  };

  wss.on('connection', (ws) => {
    send(ws, snapshot());
    send(ws, presence());
    ws.on('close', () => { if (overlays.delete(ws)) broadcast(presence()); });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      try {
        if (msg.type === 'hello' && msg.role === 'overlay') {
          overlays.set(ws, { obs: !!msg.obs, visible: msg.visible ?? null, active: msg.active ?? null });
          return broadcast(presence());
        }
        if (msg.type === 'action') {
          const next = Core.apply(state, msg.action, fairRandom);
          // 抽選の演出完了の知らせと音の設定は「戻す」の対象にしない
          if (!NO_UNDO.has(msg.action.type)) { history.push(state); if (history.length > HISTORY_MAX) history.shift(); }
          state = next;
          if (msg.action.type === 'drawLottery') {
            // 配信画面が開いていなければ演出は流れないので、その場で結果を出す
            if (!overlays.size) state = Core.apply(state, { type: 'lotteryDone', id: state.lottery.id });
            else lotterySafety(state.lottery.id);
          }
        } else if (msg.type === 'undo') {
          if (!history.length) return;
          // 戻しても、音・設定・タイマー・抽選の記録はそのまま。取り消された抽選は記録に「取り消し」を付ける
          const keep = Object.fromEntries(KEEP_ON_UNDO.map((k) => [k, state[k]]));
          state = Object.assign(history.pop(), keep);
          const alive = new Set(state.lotteries.map((x) => x.id));
          state.lotteryLog = (state.lotteryLog || []).map((e) => (e.id && !alive.has(e.id) && !e.canceledAt ? { ...e, canceledAt: Date.now() } : e));
        } else if (msg.type === 'mode') { // お試しモードの出入り / お試しのやり直し
          switchMode(msg.mode, !!msg.fresh);
        } else return;
        save();
        broadcast(snapshot());
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve({ port: PORT, dataDir: DATA, close: () => server.close() }));
  });
}

module.exports = { start };
if (require.main === module) start({ port: +process.env.PORT || 5188 }).then((s) => console.log(`http://localhost:${s.port}/control  データ: ${s.dataDir}`));
