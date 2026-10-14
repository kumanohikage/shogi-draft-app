// node test/core.test.js
const assert = require('assert');
const C = require('../public/core.js');

let s = C.initialState();
for (let i = 0; i < 6; i++) s = C.apply(s, { type: 'addLeader', name: `L${i}` });
s = C.apply(s, { type: 'addPlayers', players: Array.from({ length: 20 }, (_, i) => ({ name: `P${i}` })) });
const L = s.leaders.map((l) => l.id), P = s.players.map((p) => p.id);
assert.strictEqual(new Set(s.leaders.map((l) => l.color)).size, 6, '色は重ならない');

// 1巡目: L0 と L5 が P0 で重複、ほかは単独
const want = [0, 1, 2, 3, 4, 0];
L.forEach((id, i) => { s = C.apply(s, { type: 'nominate', leaderId: id, playerId: P[want[i]] }); });
s = C.apply(s, { type: 'reveal' });
assert.strictEqual(s.picks.length, 4, '単独指名4人は確定');
assert.deepStrictEqual(C.conflicts(s).map((c) => c.leaders.length), [2]);
assert.strictEqual(C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[9] }).noms[L[0]].playerId, P[0], '公開後の指名は変わらない');

// 抽選: rng=0.9 → 2人目(L5)が当たり
s = C.apply(s, { type: 'drawLottery', playerId: P[0] }, () => 0.9);
assert.strictEqual(s.lottery.winner, L[5]);
assert.strictEqual(s.scene, 'roulette');
assert.ok(C.pickOf(s, L[5], 1));
assert.strictEqual(s.noms[L[0]].playerId, null, '外れた L0 は再指名');
s = C.apply(s, { type: 'lotteryDone', id: s.lottery.id });
assert.throws(() => C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[1] }), /確定/, '確定済みの選手は指名できない');

// L0 再指名 → 公開 → 単独なので確定 → 巡が完了
s = C.apply(s, { type: 'nominate', leaderId: L[0], playerId: P[7] });
s = C.apply(s, { type: 'reveal' });
assert.ok(C.roundComplete(s));
assert.throws(() => C.apply(s, { type: 'drawLottery', playerId: P[0] }));
s = C.apply(s, { type: 'nextRound' });
assert.strictEqual(s.round, 2);
assert.deepStrictEqual(s.noms, {});

// 抽選の公平性: rng を均等に振ると各リーダーが同じ回数当たる
let t = C.initialState();
for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
t = C.apply(t, { type: 'addPlayers', players: [{ name: 'X' }] });
for (const l of t.leaders) t = C.apply(t, { type: 'nominate', leaderId: l.id, playerId: t.players[0].id });
t = C.apply(t, { type: 'reveal' });
const hits = {};
for (let k = 0; k < 3000; k++) { const u = C.apply(t, { type: 'drawLottery', playerId: t.players[0].id }, () => (k + 0.5) / 3000); hits[u.lottery.winner] = (hits[u.lottery.winner] || 0) + 1; }
assert.deepStrictEqual(Object.values(hits), [1000, 1000, 1000]);

// CSV 往復
const csv = C.rosterToCSV(s);
const back = C.rosterFromCSV(csv);
assert.strictEqual(back.leaders.length, 6); assert.strictEqual(back.players.length, 20);
assert.deepStrictEqual(C.rosterFromCSV('種類,名前,色,画像ファイル\n選手,"a,b"\nリーダー,X,#123456,x.png').leaders[0], { name: 'X', color: '#123456', icon: 'x.png' });
// 旧書式(チーム名の列あり)も読める
assert.deepStrictEqual(C.rosterFromCSV('種類,名前,チーム名,色,画像ファイル\nリーダー,X,チームX,#123456,x.png\n選手,Y,,,y.png'), { leaders: [{ name: 'X', color: '#123456', icon: 'x.png' }], players: [{ name: 'Y', icon: 'y.png' }] });

// 1人ずつ公開: 全員公開するまでは確定しない(後から重複が出ることがあるため)
{
  let t = C.initialState();
  for (let i = 0; i < 3; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: [{ name: 'a' }, { name: 'b' }] });
  const [l0, l1, l2] = t.leaders.map((l) => l.id), [pa, pb] = t.players.map((p) => p.id);
  t = C.apply(t, { type: 'nominate', leaderId: l0, playerId: pa });
  t = C.apply(t, { type: 'nominate', leaderId: l1, playerId: pb });
  t = C.apply(t, { type: 'nominate', leaderId: l2, playerId: pa });
  t = C.apply(t, { type: 'reveal', leaderId: l0 });
  t = C.apply(t, { type: 'reveal', leaderId: l1 });
  assert.strictEqual(t.picks.length, 0);
  assert.strictEqual(C.allRevealed(t), false);
  t = C.apply(t, { type: 'reveal', leaderId: l2 });
  assert.deepStrictEqual(t.picks.map((p) => p.leaderId), [l1]);
  assert.deepStrictEqual(C.conflicts(t), [{ playerId: pa, leaders: [l0, l2] }]);
  // 音の設定
  t = C.apply(t, { type: 'setAudio', patch: { bgmVol: 30 } });
  assert.deepStrictEqual(t.audio, { ...C.DEFAULT_AUDIO, bgmVol: 30 });
}

// 重複が2件: 全部抽選し終わるまで再指名できない(プロ野球のドラフトと同じ)
{
  let t = C.initialState();
  for (let i = 0; i < 4; i++) t = C.apply(t, { type: 'addLeader', name: `L${i}` });
  t = C.apply(t, { type: 'addPlayers', players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
  const L = t.leaders.map((l) => l.id), [pa, pb, pc] = t.players.map((p) => p.id);
  for (const [l, p] of [[0, pa], [1, pa], [2, pb], [3, pb]]) t = C.apply(t, { type: 'nominate', leaderId: L[l], playerId: p });
  t = C.apply(t, { type: 'reveal' });
  assert.strictEqual(C.conflicts(t).length, 2);
  t = C.apply(t, { type: 'drawLottery', playerId: pa }, () => 0);
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc }), /演出/);
  t = C.apply(t, { type: 'lotteryDone', id: t.lottery.id });
  assert.throws(() => C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc }), /すべて抽選/);
  t = C.apply(t, { type: 'drawLottery', playerId: pb }, () => 0);
  t = C.apply(t, { type: 'lotteryDone', id: t.lottery.id });
  t = C.apply(t, { type: 'nominate', leaderId: L[1], playerId: pc });
  assert.strictEqual(t.noms[L[1]].playerId, pc);
}

console.log('core OK');
