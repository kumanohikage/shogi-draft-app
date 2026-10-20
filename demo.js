// お試しモードのダミーデータ(名簿と、シルエットの画像)
const fs = require('fs');
const path = require('path');
const Core = require('./public/core.js');

const LEADERS = ['飛鳥 りく', '角田 みお', '金森 はる', '銀河 そう', '桂 なぎ', '香月 ゆい'];
const FAMILY = ['香川', '桂木', '銀山', '金田', '飛田', '角谷', '王寺', '歩坂'];
const GIVEN = ['あおい', 'ひかる', 'ゆう', 'みこと', 'そら', 'れん'];
// 選手アイコンの地色(落ち着いた色を巡回)
// ひとこと(段位や得意戦法の例)
const NOTES = ['初段', '居飛車党', '振り飛車党', '二段', '1級', '四間飛車', '三段', '角換わり', '相掛かり', '中飛車', '2級', '矢倉'];
const TONES = ['#8a6d4a', '#5f7a8a', '#7a5f8a', '#5f8a6d', '#8a5f5f', '#6d6d8a', '#8a7f5f', '#5f8a85'];

function silhouette(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<rect width="120" height="120" fill="${bg}"/>
<circle cx="60" cy="46" r="22" fill="#ffffff" fill-opacity=".85"/>
<path d="M18 120c2-26 20-40 42-40s40 14 42 40z" fill="#ffffff" fill-opacity=".85"/>
</svg>`;
}

// 立ち絵のシルエット(縦長・背景は透明)
function standSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1000">
<circle cx="300" cy="200" r="120" fill="${color}"/>
<path d="M110 1000 C110 620 170 380 300 380 C430 380 490 620 490 1000 Z" fill="${color}"/>
<circle cx="300" cy="200" r="120" fill="#ffffff" fill-opacity=".18"/>
</svg>`;
}
const INTROS = ['前期王者', '初参加', '居飛車の鬼', '振り飛車一筋', '', 'リベンジに燃える'];
// 紹介のメモ(自分用。本番モードで「メモ」に出る)
const INTRO_MEMOS = [
  '前期優勝チームを率いた飛鳥リーダー。連覇に向けた意気込みを伺う',
  '今期初参加の角田リーダー。本日の指名方針を伺う',
  '居飛車の名手として知られる金森リーダー。チーム作りの考えを伺う',
  '振り飛車一筋の銀河リーダー。今期の補強ポイントを伺う',
  '桂リーダー。ひとことご挨拶をいただく',
  '前期は惜しくも敗退した香月リーダー。雪辱への思いを伺う',
];
// 場面ごとの台本(自分用のメモ)。プロ野球のドラフト会議の司会進行にならって
const SCRIPTS = {
  G_open: 'ただいまより、お試しドラフト会議を開催いたします。\n本日は6名のリーダーが、エントリー選手48名の中から、それぞれ3名の選手を選択いたします。\nどうぞ最後までご覧ください。',
  G_about: 'はじめに、本大会の概要についてご説明いたします。\n（資料を読み上げる）',
  G_rule: '続きまして、本日の指名の方法についてご説明いたします。\n各巡、全リーダーが同時に選手を指名いたします。\n指名が重複した場合は、抽選により交渉権を決定いたします。\n交渉権を獲得できなかったリーダーは、再度指名を行います。',
  G_intro: '続きまして、本日指名を行う各リーダーをご紹介いたします。\n（お名前と紹介文を読み上げ、ひとこといただく）',
  G_draft: 'それでは、指名を開始いたします。\n第1巡、選択希望選手の発表に移ります。\n（読み上げ）第1巡選択希望選手、〇〇チーム、△△。\n重複の場合: ただいまの指名が重複いたしましたので、抽選を行います。',
  G_final: '以上をもちまして、すべての指名が終了いたしました。\n各チームの指名選手をご覧ください。',
  G_end: 'これをもちまして、お試しドラフト会議を終了いたします。\n選手の皆さま、リーダーの皆さま、ご視聴いただいた皆さま、誠にありがとうございました。',
};

// 画像を書き出して、お試し用の初期状態を返す
function makeDemoState(imgDir) {
  fs.mkdirSync(imgDir, { recursive: true });
  const leaders = LEADERS.map((name, i) => {
    const color = Core.LEADER_COLORS[i % Core.LEADER_COLORS.length];
    const icon = `demo_leader_${i + 1}.svg`;
    fs.writeFileSync(path.join(imgDir, icon), silhouette(color));
    const stand = `demo_stand_${i + 1}.svg`;
    fs.writeFileSync(path.join(imgDir, stand), standSvg(color));
    return { name, short: name.split(' ')[0], color, icon, stand, intro: INTROS[i], introMemo: INTRO_MEMOS[i] };
  });
  const players = [];
  FAMILY.forEach((f, i) => GIVEN.forEach((g, j) => {
    const n = players.length + 1;
    const icon = `demo_player_${String(n).padStart(2, '0')}.svg`;
    fs.writeFileSync(path.join(imgDir, icon), silhouette(TONES[(i + j) % TONES.length]));
    players.push({ name: `${f} ${g}`, icon, note: NOTES[(i * 6 + j) % NOTES.length], klass: 'ABBCCD'[(i * 5 + j * 3) % 6] });
  }));
  let s = Core.initialState();
  s = Core.apply(s, { type: 'setTitle', title: 'お試しドラフト会議' });
  s = Core.apply(s, { type: 'replaceRoster', leaders, players });
  for (const [id, memo] of Object.entries(SCRIPTS)) s = Core.apply(s, { type: 'updateProgram', id, patch: { memo } });
  return s;
}

module.exports = { makeDemoState };
