// データの置き場所: 名簿(人) / 大会 / 大会の中のイベント
//   roster.json             名簿。アプリ全体で1つ: { people: [{ id, name, short, icon, stand, standScale, standX, standY }] }
//   tournaments/<id>.json   大会: 大会名・見た目・資料・出る人(役割と大会での情報)・イベント
//   app.json                いま開いている大会
// 画面とサーバーの進行ロジック(core.js)は、いままでどおり1つの状態 S で動く。
// S は「名簿＋大会＋いまのイベント」を合わせて作り(compose)、保存するときに分けて戻す(decompose)
const fs = require('fs');
const path = require('path');
const Core = require('./public/core.js');

// 人そのものの情報(名簿に入る)。それ以外(色・ひとこと・欠場・紹介文・チーム名…)は大会の情報
const PERSON_KEYS = ['name', 'short', 'icon', 'iconSrc', 'iconCrop', 'stand', 'standSrc', 'standCrop', 'standScale', 'standX', 'standY'];
// 大会で共有する設定(見た目)。ほかの設定(進め方・タイマー…)はイベントごと
const TOURNAMENT_OPTIONS = ['bgImage', 'logoImage', 'titleMode', 'teamPrefix', 'leaderColors', 'transition', 'transSec', 'transVideo', 'transCut', 'fadeSec', 'theme', 'bgMotion', 'lotEntry'];
const EVENT_TYPES = { draft: 'ドラフト会議' };

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (fs.existsSync(file)) console.warn(path.basename(file) + ' を読めませんでした:', e.message); return null; }
}
// 書き込み途中で落ちても壊れないよう、一時ファイルに書いてから置き換える
function writeJSON(file, v) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
  fs.renameSync(tmp, file);
}

// ---------- S ⇔ 大会・イベント・名簿 ----------
// 大会(t)のイベント(ev)と名簿(people: id → 人)から、進行ロジック用の状態を作る
function compose(t, ev, people, audio) {
  const src = t.endedAt ? Object.assign({}, people, t.people) : people; // 終えた大会は、終えたときの名簿で
  const join = (x) => Object.assign({ id: x.id }, src[x.id] || (t.people || {})[x.id] || { name: '（名簿にいません）' }, x);
  const st = ev.state || {};
  return Core.normalize(Object.assign(Core.initialState(), st, {
    title: t.title, slides: t.slides || Core.defaultSlides(),
    leaders: (t.leaders || []).map(join), players: (t.players || []).map(join),
    options: Object.assign({}, Core.DEFAULT_OPTIONS, st.options, t.options),
    audio: Object.assign({}, Core.DEFAULT_AUDIO, audio || st.audio),
  }));
}
// 状態を大会・イベントに分けて戻す。人の情報は返り値の people(id → 人)に
function decompose(S, t, ev) {
  const people = {};
  const part = (x) => { people[x.id] = pick(x, PERSON_KEYS); return Object.assign({ id: x.id }, omit(x, ['id', ...PERSON_KEYS])); };
  t.title = S.title; t.slides = S.slides;
  t.leaders = S.leaders.map(part); t.players = S.players.map(part);
  t.options = pick(S.options || {}, TOURNAMENT_OPTIONS);
  ev.state = Object.assign(omit(S, ['title', 'slides', 'leaders', 'players', 'audio', 'options']), { options: omit(S.options || {}, TOURNAMENT_OPTIONS) });
  return people;
}
function newTournament(title, S) {
  const t = { version: 1, id: uid('T'), title: title || 'ドラフト会議', createdAt: Date.now(), endedAt: null, people: {}, options: {}, slides: [], leaders: [], players: [], events: [], currentEvent: null };
  const ev = newEvent('draft');
  t.events.push(ev); t.currentEvent = ev.id;
  const people = decompose(S || Object.assign(Core.initialState(), { title: t.title }), t, ev);
  return { t, people };
}
function newEvent(type, name) {
  return { id: uid('E'), type, name: name || EVENT_TYPES[type] || type, createdAt: Date.now(), state: {} };
}

// ---------- 置き場所 1つ分(本番 / お試し) ----------
// root: データのフォルダ。legacy: 前の版の1ファイル(draft.json / demo.json)。あれば最初に大会へ移す
function openStore(root, legacy, makeFirst) {
  const TDIR = path.join(root, 'tournaments');
  fs.mkdirSync(TDIR, { recursive: true });
  const ROSTER = path.join(root, 'roster.json'), APP = path.join(root, 'app.json');
  const tFile = (id) => path.join(TDIR, id + '.json');
  let roster = readJSON(ROSTER) || { version: 1, people: [] };
  const app = readJSON(APP) || { current: null };
  const peopleMap = () => Object.fromEntries(roster.people.map((p) => [p.id, p]));
  const saveRoster = () => writeJSON(ROSTER, roster);
  const saveApp = () => writeJSON(APP, app);

  function upsertPeople(people) {
    const map = peopleMap();
    for (const [id, p] of Object.entries(people)) {
      if (map[id]) Object.assign(map[id], p);
      else { const q = Object.assign({ id }, p); roster.people.push(q); map[id] = q; }
    }
  }
  function create(title, S) {
    const { t, people } = newTournament(title, S);
    upsertPeople(people); saveRoster();
    writeJSON(tFile(t.id), t);
    app.current = t.id; saveApp();
    return t;
  }

  // 前の版のデータを移す(元のファイルは .migrated を付けて残す)
  if (legacy && fs.existsSync(legacy) && !fs.existsSync(ROSTER)) {
    const raw = readJSON(legacy);
    if (raw) {
      create(raw.title, Core.normalize(Object.assign(Core.initialState(), raw)));
      fs.renameSync(legacy, legacy + '.migrated');
    }
  }

  const list = () => fs.readdirSync(TDIR).filter((f) => f.endsWith('.json')).map((f) => readJSON(path.join(TDIR, f))).filter((t) => t && t.id);
  let cur = app.current && readJSON(tFile(app.current));
  if (!cur) { const all = list().sort((a, b) => b.createdAt - a.createdAt); cur = all[0] || create('ドラフト会議', makeFirst && makeFirst()); app.current = cur.id; saveApp(); }

  const event = () => cur.events.find((e) => e.id === cur.currentEvent) || cur.events[0];
  const store = {
    get tournament() { return cur; },
    get event() { return event(); },
    roster: () => roster.people,
    list,
    // いまの大会・イベントの状態
    state: (audio) => compose(cur, event(), peopleMap(), audio),
    // 状態を保存する。名簿にまだいない人で、同じ名前の人が名簿にいれば、その人として入れる(同じ人を何度も登録しない)
    save(S) {
      const map = peopleMap(), inT = new Set([...cur.leaders, ...cur.players].map((x) => x.id));
      for (const x of [...S.leaders, ...S.players]) {
        if (map[x.id] || inT.has(x.id)) continue;
        const same = roster.people.find((p) => p.name === x.name && !S.leaders.some((l) => l.id === p.id) && !S.players.some((q) => q.id === p.id));
        if (!same) continue;
        for (const k of PERSON_KEYS) if (!x[k] && same[k]) x[k] = same[k]; // 空の欄は名簿の情報で埋める
        x.id = same.id;
      }
      const people = decompose(S, cur, event());
      if (cur.endedAt) { // 終えた大会は名簿を変えない(名簿にいない新しい人だけ足す)
        cur.people = Object.assign(cur.people || {}, people);
        upsertPeople(Object.fromEntries(Object.entries(people).filter(([id]) => !map[id]))); saveRoster();
      }
      else { upsertPeople(people); saveRoster(); }
      writeJSON(tFile(cur.id), cur);
      return S;
    },
    create(title) { cur = create(title); return cur; },
    open(id) { const t = readJSON(tFile(id)); if (!t) throw new Error('大会が見つかりません'); cur = t; app.current = id; saveApp(); },
    // 大会を終える: いまの名簿を大会に写して固定する / 再開: 名簿の最新に戻す
    end() { const map = peopleMap(); cur.people = Object.fromEntries([...cur.leaders, ...cur.players].map((x) => [x.id, Object.assign({}, map[x.id])])); cur.endedAt = Date.now(); writeJSON(tFile(cur.id), cur); },
    reopen() { cur.endedAt = null; cur.people = {}; writeJSON(tFile(cur.id), cur); },
    remove(id) {
      if (id === cur.id) throw new Error('開いている大会は削除できません');
      const f = tFile(id); if (!fs.existsSync(f)) return;
      const bin = path.join(root, 'trash'); fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(f, path.join(bin, `${id}-${Date.now()}.json`)); // 念のため捨てずに残す
    },
    addEvent(type) { if (!EVENT_TYPES[type]) throw new Error('不明なイベント'); const ev = newEvent(type); cur.events.push(ev); cur.currentEvent = ev.id; writeJSON(tFile(cur.id), cur); },
    openEvent(id) { if (!cur.events.some((e) => e.id === id)) throw new Error('イベントが見つかりません'); cur.currentEvent = id; writeJSON(tFile(cur.id), cur); },
    renameEvent(id, name) { const e = cur.events.find((x) => x.id === id); if (e) { e.name = String(name || '').slice(0, 30) || EVENT_TYPES[e.type]; writeJSON(tFile(cur.id), cur); } },
    removeEvent(id) {
      if (cur.events.length <= 1) throw new Error('イベントが1つだけのときは削除できません');
      cur.events = cur.events.filter((e) => e.id !== id);
      if (cur.currentEvent === id) cur.currentEvent = cur.events[0].id;
      writeJSON(tFile(cur.id), cur);
    },
    // 名簿から人を消す(どの大会にも出ていない人だけ)
    removePerson(id) {
      if (usedBy(id).length) throw new Error('大会に出ている人は名簿から消せません');
      roster.people = roster.people.filter((p) => p.id !== id); saveRoster();
    },
    // 管理画面に送る一覧(大会・イベント・名簿)
    library() {
      const ts = list();
      const uses = {};
      for (const t of ts) for (const [role, xs] of [['leader', t.leaders || []], ['player', t.players || []]]) for (const x of xs) (uses[x.id] ||= []).push({ t: t.id, title: t.title, role });
      return {
        type: 'library',
        current: cur.id, ended: !!cur.endedAt, currentEvent: event().id,
        events: cur.events.map((e) => ({ id: e.id, type: e.type, name: e.name })),
        tournaments: ts.sort((a, b) => b.createdAt - a.createdAt).map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt, endedAt: t.endedAt, leaders: (t.leaders || []).length, players: (t.players || []).length })),
        roster: roster.people.map((p) => ({ id: p.id, name: p.name, short: p.short || '', icon: p.icon || '', uses: uses[p.id] || [] })).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      };
    },
    // 名簿の人(大会に入れるときに使う情報だけ)
    person: (id) => { const p = peopleMap()[id]; return p ? Object.assign({ id }, pick(p, PERSON_KEYS)) : null; },
  };
  function usedBy(id) { return list().filter((t) => [...(t.leaders || []), ...(t.players || [])].some((x) => x.id === id)); }
  return store;
}

module.exports = { openStore, compose, decompose, PERSON_KEYS, TOURNAMENT_OPTIONS, EVENT_TYPES };
