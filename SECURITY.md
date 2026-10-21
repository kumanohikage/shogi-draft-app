# セキュリティについて

## 問題を見つけたとき

セキュリティにかかわる問題（他人のパソコンを操作できてしまう、データが漏れる など）を見つけたときは、公開の Issue や SNS には書かず、次のどちらかで知らせてください。

- GitHub の [Security → Report a vulnerability](https://github.com/kumanohikage/shogi-draft-app/security/advisories/new)（非公開で届きます）
- [要望・不具合のフォーム](https://docs.google.com/forms/d/e/1FAIpQLSdwnDA_wSGOq3aWtDHe5qtCHSGIJsPYO_ktHkcbxBT3eRp0IQ/viewform)（「種類」は「不具合」、内容の最初に「セキュリティ」と書いてください）

確認して直したら、新しい版を [Releases](https://github.com/kumanohikage/shogi-draft-app/releases) で公開します。

## 直す範囲

直すのは、いちばん新しい版だけです。古い版を使っている方は、新しい版に入れ替えてください。アプリは起動時に新しい版を確認し、出ていれば画面の上で知らせます（メニューの「ヘルプ」でオフにできます）。

## このアプリのつくり

- インターネットにつながなくても動きます。外へ送るのは、起動時の「新しい版の確認」（GitHub に最新の版の番号を聞くだけ。何も送りません）と、メニューから開くページだけです
- 内蔵のサーバーは、このパソコンの中からの接続だけを受けます。スマホ操作をオンにしたときだけ、同じ Wi-Fi のスマホからも受けます（推測できない鍵が要ります。鍵はオンにするたびに変わります）
- 使っている部品（Electron など）にセキュリティの修正が出たら、更新した版を出します
