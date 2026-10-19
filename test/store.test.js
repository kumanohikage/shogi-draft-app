// 名簿・大会・イベントの保存のテスト
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Core = require('../public/core.js');
const { openStore } = require('../store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'draft-store-'));
const ok = (name, fn) => { fn(); console.log(name, 'ok'); };

ok('前の版の draft.json を大会へ移す', () => {
  const dir = tmp();
  let s = Core.initialState(); s.title = '春の大会';
  s = Core.apply(s, { type: 'addLeader', name: 'あお' });
  s = Core.apply(s, { type: 'addPlayers', players: [{ name: 'そら', note: '初段' }] });
  s = Core.apply(s, { type: 'setOption', patch: { bgImage: 'bg.png', timerSec: 120 } });
  s.audio.bgmVol = 12;
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(s));
  const st = openStore(dir, path.join(dir, 'draft.json'));
  const S = st.state();
  assert.equal(S.title, '春の大会');
  assert.equal(S.leaders[0].name, 'あお');
  assert.equal(S.leaders[0].id, s.leaders[0].id);
  assert.equal(S.players[0].note, '初段');
  assert.equal(S.options.bgImage, 'bg.png');
  assert.equal(S.options.timerSec, 120);
  assert.ok(fs.existsSync(path.join(dir, 'draft.json.migrated')));
  assert.ok(!fs.existsSync(path.join(dir, 'draft.json')));
  // 人は名簿、ひとことは大会、見た目は大会、タイマーはイベント
  const roster = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8'));
  assert.deepEqual(roster.people.map((p) => p.name).sort(), ['あお', 'そら']);
  assert.ok(!('note' in roster.people.find((p) => p.name === 'そら')));
  const t = st.tournament;
  assert.equal(t.players[0].note, '初段');
  assert.equal(t.options.bgImage, 'bg.png');
  assert.equal(t.events[0].state.options.timerSec, 120);
  assert.ok(!('bgImage' in t.events[0].state.options));
  // 開き直しても同じ
  const S2 = openStore(dir).state();
  assert.equal(S2.leaders[0].name, 'あお');
});

ok('名簿は大会をまたいで共有(リーダーと選手が入れ替わってもよい)', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = st.state();
  S = Core.apply(S, { type: 'addLeader', name: 'あお' });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'そら' }] });
  S = Core.apply(S, { type: 'updatePlayer', id: S.players[0].id, patch: { note: '初段' } });
  st.save(S);
  const aoId = S.leaders[0].id, soraId = S.players[0].id;
  const first = st.tournament.id;
  st.create('秋の大会');
  S = st.state();
  assert.equal(S.leaders.length, 0);
  // 名簿から: あおは選手、そらはリーダーで
  S = Core.apply(S, { type: 'addPeople', role: 'player', people: [st.person(aoId)] });
  S = Core.apply(S, { type: 'addPeople', role: 'leader', people: [st.person(soraId)] });
  assert.equal(S.players[0].id, aoId);
  assert.equal(S.leaders[0].id, soraId);
  assert.ok(S.leaders[0].color);
  assert.equal(S.leaders[0].note, undefined); // ひとことは大会ごと
  // 名前を直すと、ほかの大会にも出る
  S = Core.apply(S, { type: 'updateLeader', id: soraId, patch: { name: 'そら改' } });
  st.save(S);
  st.open(first);
  const S1 = st.state();
  assert.equal(S1.players[0].name, 'そら改');
  assert.equal(S1.players[0].note, '初段');
  // 同じ名前でもう一度入れても、名簿の人として入る(重複しない)
  st.create('冬の大会');
  let S3 = Core.apply(st.state(), { type: 'addPlayers', players: [{ name: 'あお' }] });
  S3 = st.save(S3);
  assert.equal(S3.players[0].id, aoId);
  assert.equal(st.roster().length, 2);
  const lib = st.library();
  assert.equal(lib.tournaments.length, 3);
  assert.equal(lib.roster.find((p) => p.id === aoId).uses.length, 3);
});

ok('大会を終えると、その時点の名簿で固定', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = Core.apply(st.state(), { type: 'addPlayers', players: [{ name: 'そら' }] });
  st.save(S);
  const id = S.players[0].id, done = st.tournament.id;
  st.end();
  st.create('次');
  S = Core.apply(st.state(), { type: 'addPeople', role: 'player', people: [st.person(id)] });
  S = Core.apply(S, { type: 'updatePlayer', id, patch: { name: 'そら(改名)' } });
  st.save(S);
  st.open(done);
  assert.equal(st.state().players[0].name, 'そら');
  st.reopen();
  assert.equal(st.state().players[0].name, 'そら(改名)');
});

ok('イベントごとに進行表とドラフトの状態', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = st.state();
  S = Core.apply(S, { type: 'addLeader', name: 'A' });
  S = Core.apply(S, { type: 'addLeader', name: 'B' });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'x' }, { name: 'y' }] });
  S = Core.apply(S, { type: 'setTitle', title: '大会' });
  S.progIdx = 3;
  st.save(S);
  const e1 = st.event.id;
  st.addEvent('draft');
  const S2 = st.state();
  assert.equal(S2.title, '大会');
  assert.equal(S2.leaders.length, 2);
  assert.equal(S2.progIdx, 0);
  st.openEvent(e1);
  assert.equal(st.state().progIdx, 3);
  assert.throws(() => st.removePerson(S.players[0].id));
});
