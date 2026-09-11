/**
 * 単一HTMLへのビルド
 *
 * pdf.js は ESM なので、末尾の `export{内部名 as 公開名,...}` を
 * `globalThis.pdfjsLib={公開名:内部名,...}` に置き換えて取り込む。
 * ワーカーも同じ手口で globalThis.pdfjsWorker に載せる。こうすると
 * pdf.js が「フェイクワーカー」経路を使うため、別ファイルも Blob URL も
 * 必要なく、file:// で開いても動く。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const read = (p) => readFileSync(p, 'utf8');

// 販売ページのURL。BASEのショップを開設したらここを差し替える。
const BUY_URL = process.env.BUY_URL
  || (existsSync('site.config.json') ? JSON.parse(readFileSync('site.config.json', 'utf8')).buyUrl : '')
  || 'https://claude.ai/code/artifact/23c94998-6cf8-4269-9855-1b0803f7cc1d';

/**
 * 日本語(Adobe-Japan1)の cMap を1つのバイナリに連結して base64 で埋め込む。
 * これが無いと、CIDフォントを使う日本語PDFからテキストを取り出せない。
 * 中国語・韓国語の cMap は容量を優先して同梱しない。
 */
const JP_CMAPS = `78-EUC-H 78-EUC-V 78-H 78-RKSJ-H 78-RKSJ-V 78-V 78ms-RKSJ-H 78ms-RKSJ-V
83pv-RKSJ-H 90ms-RKSJ-H 90ms-RKSJ-V 90msp-RKSJ-H 90msp-RKSJ-V 90pv-RKSJ-H 90pv-RKSJ-V
Add-H Add-RKSJ-H Add-RKSJ-V Add-V
Adobe-Japan1-0 Adobe-Japan1-1 Adobe-Japan1-2 Adobe-Japan1-3 Adobe-Japan1-4 Adobe-Japan1-5
Adobe-Japan1-6 Adobe-Japan1-UCS2
EUC-H EUC-V Ext-H Ext-RKSJ-H Ext-RKSJ-V Ext-V H V Hankaku Hiragana Katakana
NWP-H NWP-V RKSJ-H RKSJ-V Roman WP-Symbol
UniJIS-UCS2-H UniJIS-UCS2-V UniJIS-UCS2-HW-H UniJIS-UCS2-HW-V
UniJIS-UTF16-H UniJIS-UTF16-V UniJIS-UTF32-H UniJIS-UTF32-V UniJIS-UTF8-H UniJIS-UTF8-V
UniJISPro-UCS2-HW-V UniJISPro-UCS2-V UniJISX0213-UTF32-H UniJISX0213-UTF32-V
UniJISX02132004-UTF32-H UniJISX02132004-UTF32-V`.split(/\s+/).filter(Boolean);

function buildCmapBundle() {
  const chunks = [];
  const index = {};
  let offset = 0;
  const missing = [];

  for (const name of JP_CMAPS) {
    const p = join('vendor', 'cmaps', name + '.bcmap');
    if (!existsSync(p)) { missing.push(name); continue; }
    const buf = readFileSync(p);
    index[name] = [offset, buf.length];
    offset += buf.length;
    chunks.push(buf);
  }
  if (missing.length) throw new Error('cMap が不足しています: ' + missing.join(', '));

  const b64 = Buffer.concat(chunks).toString('base64');
  return `globalThis.__CMAPS__={i:${JSON.stringify(index)},d:"${b64}"};`;
}

/** 末尾の export 文を globalThis への代入に書き換える */
function esmToGlobal(src, globalName) {
  const m = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(src);
  if (!m) throw new Error(`export 文が見つかりません: ${globalName}`);
  const pairs = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const as = s.split(/\s+as\s+/);
      const local = as[0].trim();
      const exported = (as[1] || as[0]).trim();
      return `${JSON.stringify(exported)}:${local}`;
    });
  return src.slice(0, m.index) + `globalThis.${globalName}={${pairs.join(',')}};`;
}

/** import / export を取り除いて 1 スコープに連結できる形にする */
function stripModuleSyntax(src) {
  return src
    .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+(?=(?:function|const|let|var|class)\s)/gm, '');
}

const inScript = (s) => s.replace(/<\/script/gi, '<\\/script');

function build({ edition, outDir, outFile, label }) {
  const appJs = [
    stripModuleSyntax(read('src/parser.js')),
    stripModuleSyntax(read('src/zip.js')),
    stripModuleSyntax(read('src/app.js')),
  ].join('\n\n');

  // 連結後のコードを構文チェックする。ブラウザでしか出ない
  // 正規表現リテラルの壊れなどを、出荷前にここで止める。
  new Script(appJs, { filename: 'app.bundle.js' });

  const html = read('src/app.html')
    .replace('/*__CSS__*/', () => read('src/app.css'))
    .replace('/*__CMAPS__*/', () => buildCmapBundle())
    .replace('/*__PDFJS_WORKER__*/', () => inScript(esmToGlobal(read('vendor/pdf.worker.min.mjs'), 'pdfjsWorker')))
    .replace('/*__PDFJS__*/', () => inScript(esmToGlobal(read('vendor/pdf.min.mjs'), 'pdfjsLib')))
    .replace('/*__APP_JS__*/', () => inScript(appJs.replace('__EDITION__', edition)))
    .replace('__EDITION_LABEL__', label)
    .replace('__BUY_URL__', BUY_URL);

  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, outFile);
  writeFileSync(out, html, 'utf8');
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`${out}  (${kb} KB)`);

  if (html.includes('__EDITION__') || html.includes('/*__')) {
    throw new Error('未置換のプレースホルダが残っています');
  }
  return out;
}

/**
 * Artifact 公開用に、body の中身だけを取り出す。
 * 公開基盤側が doctype / html / head / body を付けるため、
 * こちらで重ねると入れ子になってしまう。<style> は body 内でも有効なので持ち込む。
 */
function toFragment(htmlPath, outPath, title) {
  const html = read(htmlPath);
  const style = /<style>[\s\S]*?<\/style>/.exec(html);
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!style || !body) throw new Error('body/style を取り出せませんでした');

  const frag = `<title>${title}</title>\n${style[0]}\n${body[1].trim()}\n`;
  writeFileSync(outPath, frag, 'utf8');
  console.log(`${outPath}  (${(Buffer.byteLength(frag) / 1024).toFixed(0)} KB)`);
}

build({ edition: 'full', outDir: 'product', outFile: '電帳ファイラー.html', label: '製品版' });
const trial = build({ edition: 'trial', outDir: 'demo', outFile: '電帳ファイラー_体験版.html', label: '体験版' });
toFragment(trial, join('demo', 'artifact-trial.html'), '電帳ファイラー 体験版 — 電子帳簿保存法 検索要件対応ツール');
