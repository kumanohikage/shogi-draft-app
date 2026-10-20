// 名簿・大会・チーム・ドラフト・配信の保存のテスト
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Core = require('../public/core.js');
const { openStore } = require('../store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'draft-store-'));
const ok = (name, fn) => { fn(); console.log(name, 'ok'); };
const leaderPid = (S, i = 0) => S.leaders[i].personId;

ok('前の版の draft.json を大会へ移す', () => {
  const dir = tmp();
  let s = Core.initialState(); s.title = '春の大会';
  s = Core.apply(s, { type: 'addLeader', name: 'あお' });
  s = Core.apply(s, { type: 'addPlayers', players: [{ name: 'そら', note: '初段' }] });
  s = Core.apply(s, { type: 'setOption', patch: { bgImage: 'bg.png', timerSec: 120 } });
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
  // 人は名簿、ひとことは大会での人、見た目は大会、タイマーはドラフト
  const roster = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8'));
  assert.deepEqual(roster.people.map((p) => p.name).sort(), ['あお', 'そら']);
  assert.ok(!('note' in roster.people.find((p) => p.name === 'そら')));
  const t = st.tournament;
  assert.equal(t.version, 2);
  assert.equal(t.entrants.find((x) => x.role === 'player').note, '初段');
  assert.equal(t.teams.length, 1);
  assert.equal(t.options.bgImage, 'bg.png');
  assert.equal(t.draft.state.options.timerSec, 120);
  assert.ok(!('options' in t.events[0].state));
  assert.equal(openStore(dir).state().leaders[0].name, 'あお');
});

ok('第1版の大会のファイル(リーダー＝チーム・ドラフトは配信の中)を第2版へ', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'tournaments'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'roster.json'), JSON.stringify({ people: [{ id: 'La', name: 'あお' }, { id: 'Pb', name: 'そら' }] }));
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ current: 'T1' }));
  fs.writeFileSync(path.join(dir, 'tournaments', 'T1.json'), JSON.stringify({
    version: 1, id: 'T1', title: '古い大会', createdAt: 1, people: {}, options: { theme: 'sakura' }, slides: [],
    leaders: [{ id: 'La', color: '#e0302c', intro: '前期王者', teamName: 'あおぐみ' }],
    players: [{ id: 'Pb', note: '初段', absent: false }],
    events: [{ id: 'E1', type: 'draft', name: 'ドラフト会議', state: { round: 2, rounds: 3, picks: [{ round: 1, leaderId: 'La', playerId: 'Pb', by: 'single' }], progIdx: 4, scene: 'board', options: { timerSec: 90 } } }],
    currentEvent: 'E1',
  }));
  const st = openStore(dir), S = st.state();
  assert.equal(S.leaders[0].id, 'La');
  assert.equal(S.leaders[0].personId, 'La');
  assert.equal(S.leaders[0].teamName, 'あおぐみ');
  assert.equal(S.leaders[0].intro, '前期王者');
  assert.equal(S.players[0].note, '初段');
  assert.equal(S.round, 2);
  assert.equal(S.picks.length, 1);
  assert.equal(S.progIdx, 4);
  assert.equal(S.options.timerSec, 90);
  assert.equal(S.options.theme, 'sakura');
});

ok('チームとリーダーは別。リーダーを名簿の人に替えてもチームはそのまま', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = Core.apply(st.state(), { type: 'addLeader', name: 'あお' });
  S = Core.apply(S, { type: 'updateLeader', id: S.leaders[0].id, patch: { teamName: 'すごいひとたち', intro: '前期王者' } });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'そら' }] });
  S = st.save(S);
  const teamId = S.leaders[0].id, aoId = leaderPid(S);
  assert.notEqual(teamId, aoId);
  // 別の大会でリーダーをしている人を、名簿から選んでリーダーにする
  const first = st.tournament.id;
  st.create('二つ目');
  let T = Core.apply(st.state(), { type: 'addLeader', name: 'みお' });
  T = st.save(T);
  const mioId = leaderPid(T);
  st.open(first);
  S = Core.apply(st.state(), { type: 'setLeader', id: teamId, person: st.person(mioId) });
  S = st.save(S);
  assert.equal(S.leaders[0].id, teamId);
  assert.equal(S.leaders[0].personId, mioId);
  assert.equal(S.leaders[0].name, 'みお');
  assert.equal(S.leaders[0].teamName, 'すごいひとたち');
  assert.equal(S.leaders[0].intro, undefined); // 紹介文は人ごと(前のリーダーのものは引き継がない)
  // 選手と同じ人はリーダーにできない
  assert.throws(() => Core.apply(S, { type: 'setLeader', id: teamId, person: st.person(S.players[0].id) }));
  void aoId;
});

ok('名簿は大会をまたいで共有(リーダーと選手が入れ替わってもよい)', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = Core.apply(st.state(), { type: 'addLeader', name: 'あお' });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'そら' }] });
  S = Core.apply(S, { type: 'updatePlayer', id: S.players[0].id, patch: { note: '初段', klass: 'B' } });
  S = st.save(S);
  const aoId = leaderPid(S), soraId = S.players[0].id;
  const first = st.tournament.id;
  st.create('秋の大会');
  S = st.state();
  assert.equal(S.leaders.length, 0);
  // 名簿から: あおは選手、そらはリーダーで。クラスとひとことは前の大会の値を写す
  S = Core.apply(S, { type: 'addPeople', role: 'player', people: [st.person(aoId)] });
  S = Core.apply(S, { type: 'addPeople', role: 'leader', people: [st.person(soraId)] });
  assert.equal(S.players[0].id, aoId);
  assert.equal(S.leaders[0].personId, soraId);
  assert.equal(S.leaders[0].klass, 'B');
  assert.ok(S.leaders[0].color);
  // 名前を直すと、ほかの大会にも出る
  S = Core.apply(S, { type: 'updateLeader', id: S.leaders[0].id, patch: { name: 'そら改' } });
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
  // 大会ごとの履歴
  const h = st.history(soraId);
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.role).sort(), ['leader', 'player']);
});

ok('ドラフトの結果は履歴に出る', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = Core.apply(st.state(), { type: 'addLeader', name: 'A' });
  S = Core.apply(S, { type: 'updateLeader', id: S.leaders[0].id, patch: { teamName: 'チームA' } });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'x' }] });
  S.picks = [{ round: 1, leaderId: S.leaders[0].id, playerId: S.players[0].id, by: 'lottery' }];
  st.save(S);
  const h = st.history(S.players[0].id);
  assert.equal(h[0].team, 'チームA');
  assert.equal(h[0].round, 1);
  assert.equal(h[0].by, 'lottery');
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

ok('ドラフトは大会のもの(配信をまたいで続く)。進行表は配信ごと', () => {
  const dir = tmp();
  const st = openStore(dir);
  let S = st.state();
  S = Core.apply(S, { type: 'addLeader', name: 'A' });
  S = Core.apply(S, { type: 'addLeader', name: 'B' });
  S = Core.apply(S, { type: 'addPlayers', players: [{ name: 'x' }, { name: 'y' }] });
  S = Core.apply(S, { type: 'setTitle', title: '大会' });
  S.progIdx = 3; S.round = 2;
  st.save(S);
  const e1 = st.event.id;
  st.addEvent();
  const S2 = st.state();
  assert.equal(S2.title, '大会');
  assert.equal(S2.leaders.length, 2);
  assert.equal(S2.progIdx, 0); // 進行表は配信ごと
  assert.equal(S2.round, 2); // ドラフトは続く
  st.openEvent(e1);
  assert.equal(st.state().progIdx, 3);
  assert.throws(() => st.removePerson(S.players[0].id));
});
