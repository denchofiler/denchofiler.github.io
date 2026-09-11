/**
 * GitHub Pages 用の静的サイトを組み立てる。
 *
 * Artifact は共有リンクとしては使えるが検索エンジンにインデックスされない。
 * ツテが無い状態で唯一積み上がる導線は検索流入なので、
 * インデックスされる場所に「無料ツール」と「販売ページ」を置く。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE_URL = (process.env.SITE_URL || 'https://9q6xtwz22p-cmd.github.io/dencho-filer').replace(/\/$/, '');
const OUT = 'site';

const TITLE = '電帳ファイラー — 電子帳簿保存法の検索要件に対応するファイル整理ツール';
const DESC = 'PDFをドロップするだけで、取引年月日・取引金額・取引先を読み取り、'
  + '電子帳簿保存法の検索要件を満たすファイル名への一括変更と索引簿CSVの作成を行います。'
  + 'ファイルは外部に送信されず、すべてブラウザ内で完結。索引簿の作成までは無料。';

const TOOL_TITLE = '電帳法 ファイル名 変換ツール（無料）— 取引年月日・金額・取引先を自動で読み取り';
const TOOL_DESC = '請求書・領収書のPDFから取引年月日・取引金額・取引先を読み取り、'
  + '電子帳簿保存法の検索要件を満たすファイル名と索引簿CSVを作ります。'
  + '無料・登録不要・インストール不要。ファイルは外部に送信されません。';

const read = (p) => readFileSync(p, 'utf8');

// Google Search Console の所有権確認タグ。
//   GSC_TOKEN="xxxx" npm run deploy  のように渡すと head に差し込まれる。
const GSC = process.env.GSC_TOKEN || '';
const gscTag = GSC ? `<meta name="google-site-verification" content="${GSC}">` : '';

/** LP断片（<title> + <style> + 本文）を、SEO用のheadを備えた完全なHTMLにする */
function page({ fragment, url, title, description, image, jsonLd, extraHead = '' }) {
  const i = fragment.indexOf('</style>');
  const styleBlock = fragment.slice(fragment.indexOf('<style>'), i + 8);
  const body = fragment.slice(i + 8).trim();

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="電帳ファイラー">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${SITE_URL}/${image}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>🗂️</text></svg>">
${gscTag}
${extraHead}
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
${styleBlock}
</head>
<body>
${body}
</body>
</html>
`;
}

mkdirSync(join(OUT, 'tool'), { recursive: true });

/* ---------- 販売ページ ---------- */
const lpJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '電帳ファイラー',
  description: DESC,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Windows, macOS（ブラウザで動作）',
  url: SITE_URL + '/',
  inLanguage: 'ja',
  offers: [
    { '@type': 'Offer', name: '1事業者ライセンス', price: '9800', priceCurrency: 'JPY', category: '買い切り' },
    { '@type': 'Offer', name: '会計事務所ライセンス', price: '39800', priceCurrency: 'JPY', category: '買い切り' },
  ],
};

writeFileSync(join(OUT, 'index.html'), page({
  fragment: read('lp/index.html'),
  url: SITE_URL + '/',
  title: TITLE,
  description: DESC,
  image: 'ogp.jpg',
  jsonLd: lpJsonLd,
}), 'utf8');

/* ---------- 無料ツール ---------- */
// 体験版の完成HTMLから <style> と body を取り出して、SEO用のheadを付け直す
const trial = read('demo/電帳ファイラー_体験版.html');
const trialFragment = '<style>' + trial.split('<style>')[1].split('</style>')[0] + '</style>'
  + trial.split('<body>')[1].split('</body>')[0];

const toolJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: '電帳法 ファイル名 変換ツール（無料）',
  description: TOOL_DESC,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'すべて（ブラウザで動作）',
  url: SITE_URL + '/tool/',
  inLanguage: 'ja',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
};

writeFileSync(join(OUT, 'tool', 'index.html'), page({
  fragment: trialFragment,
  url: SITE_URL + '/tool/',
  title: TOOL_TITLE,
  description: TOOL_DESC,
  image: 'ogp.jpg',
  jsonLd: toolJsonLd,
}), 'utf8');

/* ---------- 画像 ---------- */
for (const f of ['hero.jpg', 'screen-table.jpg', 'screen-evidence.jpg', 'ogp.jpg']) {
  const src = join('lp', 'assets', f);
  if (existsSync(src)) copyFileSync(src, join(OUT, f));
}

/* ---------- クローラ向け ---------- */
writeFileSync(join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf8');

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${SITE_URL}/tool/</loc><lastmod>${today}</lastmod><priority>0.9</priority></url>
</urlset>
`, 'utf8');

// GitHub Pages が Jekyll で処理してアンダースコア始まりを無視しないようにする
writeFileSync(join(OUT, '.nojekyll'), '', 'utf8');

console.log(`サイトを生成しました: ${OUT}/  (公開URLの想定: ${SITE_URL})`);
for (const f of ['index.html', 'tool/index.html', 'robots.txt', 'sitemap.xml']) {
  const size = readFileSync(join(OUT, f)).length / 1024;
  console.log(`  ${f}  ${size.toFixed(0)} KB`);
}
