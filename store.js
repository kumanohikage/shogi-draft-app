// データの置き場所: 名簿(人) / 大会 / 大会の中の配信(イベント)
//   roster.json             名簿。アプリ全体で1つ: { people: [{ id, name, short, icon, stand, standScale, standX, standY }] }
//   tournaments/<id>.json   大会(第2版):
//     entrants  大会での人 [{ id(名簿の人), role: leader|player|staff, note(ひとこと), intro(紹介文), introMemo, absent, klass(クラスか段位), title(運営の肩書き) }]
//     teams     チーム [{ id, leaderId(名簿の人。メンバーの1人), name, logo, color }]
//     draft     ドラフト(大会のもの): { state: { 巡・指名・抽選・タイマー… , options: 進め方 } }
//     events    配信(1回の配信) [{ id, name, state: { 進行表・いまの場面… } }]
//     options   大会の見た目(テーマ・背景・切り替え・クラスの見出し…)
//   app.json                いま開いている大会
// 画面とサーバーの進行ロジック(core.js)は、いままでどおり1つの状態 S で動く。
// S は「名簿＋大会＋ドラフト＋いまの配信」を合わせて作り(compose)、保存するときに分けて戻す(decompose)
//   S.leaders = チーム(id はチームの id)。リーダーの人の情報(名前・顔・紹介文…)を合わせて持ち、personId でリーダーの人を指す
//   S.players = 選手(id は名簿の人の id)
// 原則: もの(ドラフト)とその結果は大会、見せ方(進行表・場面)は配信。人そのもの(名前・顔)は名簿、大会での情報は大会
const fs = require('fs');
const path = require('path');
const Core = require('./public/core.js');

// 人そのものの情報(名簿に入る)
const PERSON_KEYS = ['name', 'short', 'icon', 'iconSrc', 'iconCrop', 'stand', 'standSrc', 'standCrop', 'standScale', 'standX', 'standY'];
// 大会での人の情報(リーダーも選手も運営も同じ)
const ENTRANT_KEYS = ['note', 'intro', 'introMemo', 'absent', 'klass', 'title'];
// 大会で共有する設定(見た目)。ほかの設定(進め方・タイマー…)はドラフトのもの
const TOURNAMENT_OPTIONS = ['bgImage', 'logoImage', 'titleMode', 'teamPrefix', 'leaderColors', 'transition', 'transSec', 'transVideo', 'transCut', 'fadeSec', 'theme', 'bgMotion', 'lotEntry', 'classLabel'];
// ドラフトの状態(配信をまたいで続く)。それ以外(いまの場面・進行表)は配信のもの
const DRAFT_KEYS = ['rounds', 'round', 'noms', 'picks', 'lotteries', 'lottery', 'lotteryLog', 'timer', 'waitIdx', 'confirmedKey', 'busyUntil'];
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

// ---------- 前の形(第1版: リーダー＝チーム、ドラフトは配信の中)から第2版へ ----------
function upgrade(t) {
  if (!t || t.version >= 2) return t;
  const leaders = t.leaders || [], players = t.players || [];
  // チームの id は、前のリーダーの id のまま(指名の記録がそのまま使える)
  t.teams = leaders.map((l) => ({ id: l.id, leaderId: l.id, name: l.teamName || '', logo: l.teamLogo || '', color: l.color || '' }));
  t.entrants = [
    ...leaders.map((l) => Object.assign({ id: l.id, role: 'leader' }, pick(l, ENTRANT_KEYS))),
    ...players.map((p) => Object.assign({ id: p.id, role: 'player' }, pick(p, ENTRANT_KEYS))),
  ];
  // ドラフトの状態は、いま開いている配信(なければ最初の配信)から大会へ
  const ev = (t.events || []).find((e) => e.id === t.currentEvent) || (t.events || [])[0];
  const st = (ev && ev.state) || {};
  t.draft = { state: Object.assign(pick(st, DRAFT_KEYS), { options: omit(st.options || {}, TOURNAMENT_OPTIONS) }) };
  for (const e of t.events || []) { e.state = omit(e.state || {}, [...DRAFT_KEYS, 'options']); delete e.type; }
  delete t.leaders; delete t.players;
  t.version = 2;
  return t;
}

// ---------- S ⇔ 大会・ドラフト・配信・名簿 ----------
// 大会(t)と配信(ev)と名簿(people: id → 人)から、進行ロジック用の状態を作る
function compose(t, ev, people, audio) {
  const src = t.endedAt ? Object.assign({}, people, t.people) : people; // 終えた大会は、終えたときの名簿で
  const personOf = (id) => src[id] || (t.people || {})[id] || { name: '（名簿にいません）' };
  const entrant = Object.fromEntries((t.entrants || []).map((x) => [x.id, x]));
  const leaders = (t.teams || []).map((tm) => Object.assign(
    { id: tm.id, personId: tm.leaderId || '' },
    tm.leaderId ? personOf(tm.leaderId) : { name: '' },
    pick(entrant[tm.leaderId] || {}, ENTRANT_KEYS),
    { id: tm.id, personId: tm.leaderId || '', teamName: tm.name || '', teamLogo: tm.logo || '', color: tm.color || '#888888' },
  ));
  const players = (t.entrants || []).filter((x) => x.role === 'player').map((x) => Object.assign({}, personOf(x.id), pick(x, ENTRANT_KEYS), { id: x.id }));
  const ds = (t.draft && t.draft.state) || {};
  const es = ev.state || {};
  return Core.normalize(Object.assign(Core.initialState(), es, omit(ds, ['options']), {
    title: t.title, slides: t.slides || Core.defaultSlides(),
    leaders, players,
    options: Object.assign({}, Core.DEFAULT_OPTIONS, ds.options, t.options),
    audio: Object.assign({}, Core.DEFAULT_AUDIO, audio),
  }));
}
// 状態を大会・ドラフト・配信に分けて戻す。人の情報は返り値の people(id → 人)に
function decompose(S, t, ev) {
  const people = {};
  const staff = (t.entrants || []).filter((x) => x.role === 'staff'); // 運営は S に無いのでそのまま残す
  const entrants = [];
  t.teams = S.leaders.map((l) => {
    const pid = l.personId || '';
    if (pid) {
      people[pid] = pick(l, PERSON_KEYS);
      entrants.push(Object.assign({ id: pid, role: 'leader' }, pick(l, ENTRANT_KEYS)));
    }
    return { id: l.id, leaderId: pid, name: l.teamName || '', logo: l.teamLogo || '', color: l.color || '' };
  });
  for (const p of S.players) { people[p.id] = pick(p, PERSON_KEYS); entrants.push(Object.assign({ id: p.id, role: 'player' }, pick(p, ENTRANT_KEYS))); }
  t.entrants = [...entrants, ...staff.filter((x) => !entrants.some((y) => y.id === x.id))];
  t.title = S.title; t.slides = S.slides;
  t.options = pick(S.options || {}, TOURNAMENT_OPTIONS);
  t.draft = { state: Object.assign(pick(S, DRAFT_KEYS), { options: omit(S.options || {}, TOURNAMENT_OPTIONS) }) };
  ev.state = omit(S, ['title', 'slides', 'leaders', 'players', 'audio', 'options', ...DRAFT_KEYS]);
  t.version = 2;
  return people;
}
function newTournament(title, S) {
  const t = { version: 2, id: uid('T'), title: title || 'ドラフト会議', createdAt: Date.now(), endedAt: null, people: {}, options: {}, slides: [], entrants: [], teams: [], draft: { state: {} }, events: [], currentEvent: null };
  const ev = newEvent();
  t.events.push(ev); t.currentEvent = ev.id;
  const people = decompose(S || Object.assign(Core.initialState(), { title: t.title }), t, ev);
  return { t, people };
}
function newEvent(name) {
  return { id: uid('E'), name: name || 'ドラフト会議', createdAt: Date.now(), state: {} };
}
// 前の形の S(draft.json・お試しのひな形)は、リーダーの id がそのまま人の id。チームとして読めるように personId を付ける
const withPersonIds = (S) => { for (const l of S.leaders || []) if (!l.personId) l.personId = l.id; return S; };

// ---------- 置き場所 1つ分(本番 / お試し) ----------
// root: データのフォルダ。legacy: 前の版の1ファイル(draft.json / demo.json)。あれば最初に大会へ移す
function openStore(root, legacy, makeFirst) {
  const TDIR = path.join(root, 'tournaments');
  fs.mkdirSync(TDIR, { recursive: true });
  const ROSTER = path.join(root, 'roster.json'), APP = path.join(root, 'app.json');
  const tFile = (id) => path.join(TDIR, id + '.json');
  const readT = (id) => upgrade(readJSON(tFile(id)));
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
    const { t, people } = newTournament(title, S && withPersonIds(S));
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

  const list = () => fs.readdirSync(TDIR).filter((f) => f.endsWith('.json')).map((f) => upgrade(readJSON(path.join(TDIR, f)))).filter((t) => t && t.id);
  let cur = app.current && readT(app.current);
  if (!cur) { const all = list().sort((a, b) => b.createdAt - a.createdAt); cur = all[0] || create('ドラフト会議', makeFirst && makeFirst()); app.current = cur.id; saveApp(); }

  const event = () => cur.events.find((e) => e.id === cur.currentEvent) || cur.events[0];
  const entrantIds = (t) => new Set((t.entrants || []).map((x) => x.id));
  // 人の、大会ごとの履歴(名簿の画面で見る)
  function historyOf(id) {
    const out = [];
    for (const t of list()) {
      const e = (t.entrants || []).find((x) => x.id === id);
      if (!e) continue;
      const team = (t.teams || []).find((tm) => tm.leaderId === id) || null;
      const ds = (t.draft && t.draft.state) || {};
      const pickRow = (ds.picks || []).find((p) => p.playerId === id);
      const pickTeam = pickRow && (t.teams || []).find((tm) => tm.id === pickRow.leaderId);
      const teamName = (tm) => (tm ? tm.name || '' : '');
      out.push({ t: t.id, title: t.title, createdAt: t.createdAt, endedAt: t.endedAt, role: e.role, klass: e.klass || '', classLabel: (t.options || {}).classLabel || 'クラス',
        team: teamName(team || pickTeam), teamLeader: (team || pickTeam || {}).leaderId || '', round: pickRow ? pickRow.round : null, by: pickRow ? pickRow.by : null });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  const store = {
    get tournament() { return cur; },
    get event() { return event(); },
    roster: () => roster.people,
    list,
    // いまの大会・配信の状態
    state: (audio) => compose(cur, event(), peopleMap(), audio),
    // 状態を保存する。名簿にまだいない人で、同じ名前の人が名簿にいれば、その人として入れる(同じ人を何度も登録しない)
    save(S) {
      const map = peopleMap(), inT = entrantIds(cur);
      const used = new Set([...S.leaders.map((l) => l.personId), ...S.players.map((p) => p.id)]);
      const adopt = (x, getId, setId) => {
        const id = getId(x);
        if (!id || map[id] || inT.has(id)) return;
        const same = roster.people.find((p) => p.name === x.name && !used.has(p.id));
        if (!same) return;
        for (const k of PERSON_KEYS) if (!x[k] && same[k]) x[k] = same[k]; // 空の欄は名簿の情報で埋める
        used.delete(id); used.add(same.id); setId(x, same.id);
      };
      for (const l of S.leaders) adopt(l, (x) => x.personId, (x, v) => { x.personId = v; });
      for (const p of S.players) adopt(p, (x) => x.id, (x, v) => { x.id = v; });
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
    open(id) { const t = readT(id); if (!t) throw new Error('大会が見つかりません'); cur = t; app.current = id; saveApp(); },
    // 大会を終える: いまの名簿を大会に写して固定する / 再開: 名簿の最新に戻す
    end() { const map = peopleMap(); cur.people = Object.fromEntries([...entrantIds(cur)].map((id) => [id, Object.assign({}, map[id])])); cur.endedAt = Date.now(); writeJSON(tFile(cur.id), cur); },
    reopen() { cur.endedAt = null; cur.people = {}; writeJSON(tFile(cur.id), cur); },
    remove(id) {
      if (id === cur.id) throw new Error('開いている大会は削除できません');
      const f = tFile(id); if (!fs.existsSync(f)) return;
      const bin = path.join(root, 'trash'); fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(f, path.join(bin, `${id}-${Date.now()}.json`)); // 念のため捨てずに残す
    },
    addEvent() { const ev = newEvent(`配信${cur.events.length + 1}`); cur.events.push(ev); cur.currentEvent = ev.id; writeJSON(tFile(cur.id), cur); },
    openEvent(id) { if (!cur.events.some((e) => e.id === id)) throw new Error('配信が見つかりません'); cur.currentEvent = id; writeJSON(tFile(cur.id), cur); },
    renameEvent(id, name) { const e = cur.events.find((x) => x.id === id); if (e) { e.name = String(name || '').slice(0, 30) || '配信'; writeJSON(tFile(cur.id), cur); } },
    removeEvent(id) {
      if (cur.events.length <= 1) throw new Error('配信が1つだけのときは削除できません');
      cur.events = cur.events.filter((e) => e.id !== id);
      if (cur.currentEvent === id) cur.currentEvent = cur.events[0].id;
      writeJSON(tFile(cur.id), cur);
    },
    // 名簿の人を直す(名簿の画面から)
    updatePerson(id, patch) {
      const p = peopleMap()[id]; if (!p) throw new Error('名簿にいない人です');
      Object.assign(p, pick(patch || {}, PERSON_KEYS)); saveRoster();
    },
    // 名簿から人を消す(どの大会にも出ていない人だけ)
    removePerson(id) {
      if (usedBy(id).length) throw new Error('大会に出ている人は名簿から消せません');
      roster.people = roster.people.filter((p) => p.id !== id); saveRoster();
    },
    // 管理画面に送る一覧(大会・配信・名簿)
    library() {
      const ts = list();
      const uses = {};
      for (const t of ts) for (const x of t.entrants || []) (uses[x.id] ||= []).push({ t: t.id, title: t.title, role: x.role });
      return {
        type: 'library',
        current: cur.id, ended: !!cur.endedAt, currentEvent: event().id,
        events: cur.events.map((e) => ({ id: e.id, name: e.name })),
        tournaments: ts.sort((a, b) => b.createdAt - a.createdAt).map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt, endedAt: t.endedAt, teams: (t.teams || []).length, players: (t.entrants || []).filter((x) => x.role === 'player').length, events: (t.events || []).length })),
        roster: roster.people.map((p) => ({ id: p.id, name: p.name, short: p.short || '', icon: p.icon || '', uses: uses[p.id] || [] })).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      };
    },
    history: historyOf,
    // 名簿の人(大会に入れるときに使う情報)。直近の大会のクラス・ひとことを写す
    person: (id) => {
      const p = peopleMap()[id]; if (!p) return null;
      const last = list().filter((t) => t.id !== cur.id).sort((a, b) => b.createdAt - a.createdAt).map((t) => (t.entrants || []).find((x) => x.id === id)).find(Boolean);
      return Object.assign({ id }, pick(p, PERSON_KEYS), last ? pick(last, ['klass', 'note']) : {});
    },
  };
  function usedBy(id) { return list().filter((t) => (t.entrants || []).some((x) => x.id === id)); }
  return store;
}

module.exports = { openStore, compose, decompose, upgrade, PERSON_KEYS, ENTRANT_KEYS, TOURNAMENT_OPTIONS, DRAFT_KEYS, EVENT_TYPES };
