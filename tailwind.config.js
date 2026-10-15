// 管理画面のスタイル(melta UI のトークン体系に合わせる。色だけはアプリの金×焦げ茶を踏襲)
// 生成: npm run css  →  public/control.css
module.exports = {
  content: ['./public/control.html', './public/control.js', './public/remote.html', './public/remote.js', './public/flow.js'],
  theme: {
    extend: {
      colors: {
        // primary = 金(アクセント)。400 が見出し・リンク用の金 #e8b84a
        primary: {
          50: '#fdf8ec', 100: '#faeccb', 200: '#f5d993', 300: '#efc565', 400: '#e8b84a',
          500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', 'sans-serif'],
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '1.4' }],
        xs: ['0.8125rem', { lineHeight: '1.4' }],
        sm: ['0.9375rem', { lineHeight: '1.7' }],
        base: ['1.125rem', { lineHeight: '2.0' }],
        lg: ['1.25rem', { lineHeight: '1.5' }],
        xl: ['1.375rem', { lineHeight: '1.4' }],
        '2xl': ['1.625rem', { lineHeight: '1.4' }],
        '3xl': ['2rem', { lineHeight: '1.4' }],
      },
    },
  },
};
