// ドラフト会議アプリ サーバー
// 管理画面と配信画面(OBS ブラウザソース)を配信し、WebSocket で状態を同期する
// 単体起動(node server.js)と、Electron からの require の両方に対応
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const os = require('os');
const QRCode = require('qrcode');
const Core = require('./public/core.js');
const { makeDemoState } = require('./demo.js');
const { openStore } = require('./store.js');

const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webm': 'video/webm', '.mp4': 'video/mp4',
};
const HISTORY_MAX = 200;
// 「戻す」の対象にしない操作と、戻しても変えない状態
const NO_UNDO = new Set(['lotteryDone', 'setAudio', 'setOption', 'timer']);
const KEEP_ON_UNDO = ['audio', 'options', 'timer', 'lotteryLog'];
const IMG_RE = /\.(png|jpe?g|gif|webp|webm|mp4)$/i; // 画像と、場面の切り替えの動画
const AUDIO_RE = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$/i;
// 抽選は暗号論的な乱数で(偏りなく)
const fairRandom = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;

function start(opts = {}) {
  const PORT = opts.port || 5188;
  const DATA = opts.dataDir || path.join(__dirname, 'draft-data');
  const IMG = path.join(DATA, 'images');
  const BGM = path.join(DATA, 'bgm'); // BGM は各自ダウンロードした曲をここに置く(アプリには同梱しない)
  fs.mkdirSync(IMG, { recursive: true });
  fs.mkdirSync(BGM, { recursive: true });
  // 本番とお試しは置き場所を分ける(お試しで本番データを壊さない)。前の版の draft.json / demo.json は最初に大会へ移す
  const AUDIO = path.join(DATA, 'audio.json'); // 音の設定は本番/お試し・大会で共通
  const readAudio = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).audio || null; } catch { return null; } };
  let audio = (() => { try { return JSON.parse(fs.readFileSync(AUDIO, 'utf8')); } catch { return readAudio(path.join(DATA, 'draft.json')); } })();
  const stores = {};
  const storeOf = (m) => (stores[m] ||= m === 'demo'
    ? openStore(path.join(DATA, 'demo'), path.join(DATA, 'demo.json'), () => makeDemoState(IMG))
    : openStore(DATA, path.join(DATA, 'draft.json')));
  let mode = 'real'; // 起動時はいつも本番
  let store = storeOf(mode);
  let state = store.state(audio);
  if (!audio) audio = state.audio;
  let history = [];
  function switchMode(next, fresh) {
    if (next !== 'real' && next !== 'demo') return;
    mode = next; history = [];
    if (fresh && mode === 'demo') { // お試しを最初から: お試しの置き場所ごと作り直す
      fs.rmSync(path.join(DATA, 'demo'), { recursive: true, force: true });
      delete stores.demo;
    }
    store = storeOf(mode);
    state = store.state(audio);
  }
  // 大会・イベントを切り替えたら、その状態を読み直す(「戻す」は切り替えの前には戻らない)
  function reload() { history = []; state = store.state(audio); }

  function save() {
    audio = state.audio;
    try { fs.writeFileSync(AUDIO, JSON.stringify(audio)); } catch { /* 音の設定が残らないだけ */ }
    state = store.save(state);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (req.method === 'POST' && p === '/api/upload') return upload(req, res, url, IMG, IMG_RE);
    if (req.method === 'POST' && p === '/api/bgm') return upload(req, res, url, BGM, AUDIO_RE);
    if (p === '/api/bgm') return json(res, listBgm());
    // チーム表を画像で保存(画面を撮るのは Electron 側。opts.capture が無いとき=node だけで動かしたときは使えない)
    if (p === '/api/export/teams.png') {
      if (!opts.capture) { res.writeHead(501); return res.end('アプリ(exe)から使ってください'); }
      return opts.capture('teams').then((png) => {
        const name = encodeURIComponent(`${state.title || 'ドラフト'}_チーム表.png`);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename*=UTF-8''${name}`, 'Cache-Control': 'no-store' });
        res.end(png);
      }, (e) => { res.writeHead(500); res.end(e.message); });
    }
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
    if (!re.test(name)) { res.writeHead(400); return res.end(dir === BGM ? '音声ファイル(mp3 / ogg / wav / m4a)を選んでください' : '画像か動画のファイルを選んでください'); }
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
  const BOOT = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // この起動の印
  const send = (ws, msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const allClients = () => [...wss.clients, ...(remote.wss ? remote.wss.clients : [])];
  const broadcast = (msg) => allClients().forEach((c) => send(c, msg));
  // 「1つ戻す」で抽選が取り消されるか(管理画面で確認を出すため)
  const undoCancelsLottery = () => history.length > 0 && history[history.length - 1].lotteries.length < state.lotteries.length;
  const snapshot = () => ({ type: 'state', state, canUndo: history.length > 0, undoCancelsLottery: undoCancelsLottery(), demo: mode === 'demo' });
  // 大会・イベント・名簿の一覧は、このPCの管理画面にだけ送る
  const sendLibrary = () => { const lib = store.library(); wss.clients.forEach((c) => send(c, lib)); };

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

  /* ---------- スマホ操作(同じ Wi-Fi の端末から) ----------
   * 使うときだけ、別のポートで LAN に開く(ふだんはこのPCの中だけ)。
   * 推測できない鍵(128bit)を QR コードの URL に入れ、鍵を持たない端末は画面も操作も拒否する。
   * 鍵はオンにするたび・作り直すたびに新しくなり、アプリを閉じれば無効になる。 */
  const REMOTE_PORT = opts.remotePort || PORT + 2;
  const remote = { token: null, server: null, wss: null };
  const REMOTE_FILES = new Set(['/remote.html', '/remote.js', '/core.js', '/flow.js', '/control.css']);
  const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const cookieToken = (req) => (/(?:^|;\s*)dk=([0-9a-f]+)/.exec(req.headers.cookie || '') || [])[1];
  function remoteHandler(req, res) {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    // QR の URL(?k=鍵)で来たら、鍵をクッキーにしてから画面へ(URL に鍵を残さない)
    const k = url.searchParams.get('k');
    if (k && safeEqual(k, remote.token)) {
      res.writeHead(302, { 'Set-Cookie': `dk=${k}; HttpOnly; SameSite=Strict; Path=/`, Location: '/remote', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!safeEqual(cookieToken(req), remote.token)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta name="viewport" content="width=device-width"><p style="font:16px sans-serif;padding:24px">つながりませんでした。パソコンのアプリに出ている QR コードを読み直してください。</p>');
    }
    if (p === '/' || p === '/remote') p = '/remote.html';
    let file;
    if (p.startsWith('/images/')) file = path.join(IMG, path.basename(p));
    else if (REMOTE_FILES.has(p)) file = path.join(PUB, p);
    else { res.writeHead(404); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }
  // このPCの LAN の IP(家庭や会場の Wi-Fi で使われる範囲を優先)
  function lanIPs() {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
    return ips.sort((a, b) => rank(a) - rank(b));
  }
  async function remoteInfo() {
    if (!remote.server) return { type: 'remote', on: false };
    const urls = lanIPs().map((ip) => `http://${ip}:${REMOTE_PORT}/remote?k=${remote.token}`);
    const qr = urls[0] ? await QRCode.toString(urls[0], { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '';
    return { type: 'remote', on: true, urls, qr, clients: remote.wss.clients.size };
  }
  // 鍵などを含むので、このPCの管理画面にだけ送る
  const sendLocal = async () => { const info = await remoteInfo(); wss.clients.forEach((c) => send(c, info)); };
  function closeRemote() {
    if (!remote.server) return;
    remote.wss.clients.forEach((c) => c.terminate());
    remote.wss.close(); remote.server.close();
    Object.assign(remote, { token: null, server: null, wss: null });
  }
  function openRemote() {
    closeRemote();
    remote.token = crypto.randomBytes(16).toString('hex');
    remote.server = http.createServer(remoteHandler);
    remote.wss = new WebSocket.Server({ server: remote.server, verifyClient: (info) => safeEqual(cookieToken(info.req), remote.token) });
    remote.wss.on('connection', (ws) => { onConnection(ws, true); sendLocal(); ws.on('close', sendLocal); });
    return new Promise((resolve, reject) => { remote.server.once('error', reject); remote.server.listen(REMOTE_PORT, '0.0.0.0', resolve); });
  }

  wss.on('connection', (ws) => onConnection(ws, false));
  function onConnection(ws, isRemote) {
    send(ws, { type: 'boot', id: BOOT }); // アプリを入れ替えて起動し直したら、開いたままの配信画面・スマホは読み込み直す
    send(ws, snapshot());
    send(ws, presence());
    if (!isRemote) { remoteInfo().then((i) => send(ws, i)); send(ws, store.library()); }
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
          // くじ: 残り1人になったら、少し待ってから残りのくじを配る(同時だとどちらを選んだか分かりにくい)
          if (msg.action.type === 'lotPick') {
            const L = state.lottery, rest = L ? L.leaders.filter((id) => L.picks[id] == null) : [];
            if (L && L.phase === 'pick' && rest.length === 1) {
              const id = L.id, lot = L.lots.findIndex((_, i) => !Object.values(L.picks).includes(i));
              setTimeout(() => {
                if (!state.lottery || state.lottery.id !== id || state.lottery.phase !== 'pick') return;
                history.push(state); state = Core.apply(state, { type: 'lotPick', lot }); broadcast(snapshot());
              }, 1400);
            }
          }
          if (msg.action.type === 'drawLottery' && state.lottery && state.lottery.mode && state.lottery.mode !== 'roulette') { /* くじを選ぶ方式: 選び終わるまで待つ */ }
          else if (msg.action.type === 'drawLottery' || msg.action.type === 'lotSpin' || (msg.action.type === 'lotOpen' && Core.optionsOf(state).lotFx !== '2d')) {
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
        } else if (msg.type === 'remote') { // スマホ操作のオン・オフ・鍵の作り直し(このPCの管理画面からだけ)
          if (isRemote) return;
          if (msg.cmd === 'off') { closeRemote(); sendLocal(); }
          else openRemote().then(sendLocal, (e) => { closeRemote(); send(ws, { type: 'error', message: `スマホ操作を始められませんでした(${e.message})` }); sendLocal(); });
          return;
        } else if (msg.type === 'mode') { // お試しモードの出入り / お試しのやり直し
          switchMode(msg.mode, !!msg.fresh);
        } else if (msg.type === 'library') { // 大会・イベント・名簿(このPCの管理画面からだけ)
          if (isRemote) return;
          if (library(msg, ws) === false) return; // 一覧を返すだけの操作は保存も配信もしない
        } else return;
        save();
        broadcast(snapshot());
        if (msg.type !== 'action' || /^(add|remove|update|replace)|^setTitle$/.test(msg.action.type)) sendLibrary();
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
  }

  function library(msg, ws) {
    switch (msg.cmd) {
      case 'create': save(); store.create(String(msg.title || '').slice(0, 40) || '新しい大会'); reload(); break;
      case 'open': if (msg.id === store.tournament.id) return; save(); store.open(msg.id); reload(); break;
      case 'end': save(); store.end(); reload(); break;
      case 'reopen': save(); store.reopen(); reload(); break;
      case 'remove': store.remove(msg.id); break;
      case 'addEvent': save(); store.addEvent(); reload(); break;
      case 'openEvent': if (msg.id === store.event.id) return; save(); store.openEvent(msg.id); reload(); break;
      case 'renameEvent': store.renameEvent(msg.id, msg.name); break;
      case 'removeEvent': save(); store.removeEvent(msg.id); reload(); break;
      case 'removePerson': store.removePerson(msg.id); break;
      // 名簿の人を直す(名簿の画面から)。いまの大会にも出ている人なら、表示も直す(「戻す」の記録は残す)
      case 'updatePerson': save(); store.updatePerson(msg.id, msg.patch); state = store.state(audio); break;
      // 人の、大会ごとの履歴(名簿の画面)。この画面にだけ返す
      case 'history': send(ws, { type: 'history', id: msg.id, rows: store.history(msg.id) }); return false;
      // チームのリーダーを、名簿の人に替える(「戻す」で取り消せる)
      case 'setLeader': {
        const person = store.person(msg.personId);
        if (!person) throw new Error('名簿にいない人です');
        const next = Core.apply(state, { type: 'setLeader', id: msg.id, person });
        history.push(state); state = next;
        break;
      }
      case 'addPeople': { // 名簿から大会へ(「戻す」で取り消せる)
        const people = (msg.ids || []).map(store.person).filter(Boolean);
        const next = Core.apply(state, { type: 'addPeople', role: msg.role, people });
        history.push(state); state = next;
        break;
      }
      default: throw new Error('不明な操作');
    }
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve({ port: PORT, dataDir: DATA, close: () => { closeRemote(); server.close(); } }));
  });
}

module.exports = { start };
if (require.main === module) start({ port: +process.env.PORT || 5188 }).then((s) => console.log(`http://localhost:${s.port}/control  データ: ${s.dataDir}`));
