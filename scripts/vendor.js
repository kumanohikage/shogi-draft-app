// ネットにつながっていなくても動くように、3D表示(three.js)とフォントを public/vendor にコピーする
// 使い方: node scripts/vendor.js  (npm install のあとに1回。three やフォントを更新したときも)
const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '../node_modules');
const OUT = path.join(__dirname, '../public/vendor');
fs.rmSync(OUT, { recursive: true, force: true });

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const copyDir = (from, to, filter = () => true) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, filter);
    else if (filter(e.name)) copy(a, b);
  }
};

// three.js: 本体と、ルーレットが使う追加部品(と、その部品が読み込むもの)
copy(path.join(NM, 'three/build/three.module.js'), path.join(OUT, 'three/build/three.module.js'));
for (const d of ['postprocessing', 'shaders', 'environments']) copyDir(path.join(NM, 'three/examples/jsm', d), path.join(OUT, 'three/examples/jsm', d));
copy(path.join(NM, 'three/LICENSE'), path.join(OUT, 'three/LICENSE'));

// フォント: 使う太さだけ。woff2 だけにする(Electron は woff2 が読める)
const fonts = [
  ['dela-gothic-one', ['400']],
  ['noto-sans-jp', ['700', '900']],
];
for (const [pkg, weights] of fonts) {
  const src = path.join(NM, '@fontsource', pkg), dst = path.join(OUT, 'fonts', pkg);
  let css = '';
  for (const w of weights) css += fs.readFileSync(path.join(src, `${w}.css`), 'utf8').replace(/, url\([^)]*\.woff\) format\('woff'\)/g, '');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'font.css'), css);
  for (const f of new Set([...css.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((m) => m[1]))) copy(path.join(src, 'files', f), path.join(dst, 'files', f));
  copy(path.join(src, 'LICENSE'), path.join(dst, 'LICENSE'));
}

let size = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else size += fs.statSync(p).size; } };
walk(OUT);
console.log('vendor:', (size / 1e6).toFixed(1), 'MB');
