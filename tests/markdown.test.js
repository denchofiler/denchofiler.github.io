import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, extractTitle, extractDescription } from '../tools/markdown.mjs';

const html = (md) => renderMarkdown(md).html;

describe('renderMarkdown', () => {
  test('見出しにIDを振る', () => {
    assert.match(html('## 検索要件とは'), /<h2 id="検索要件とは">検索要件とは<\/h2>/);
  });

  test('段落は連続行をまとめる', () => {
    assert.equal(html('あいう\nえお'), '<p>あいうえお</p>');
  });

  test('空行で段落を分ける', () => {
    assert.equal(html('一行目\n\n二行目'), '<p>一行目</p>\n<p>二行目</p>');
  });

  test('太字とリンクを変換する', () => {
    assert.match(html('**強調**と[リンク](https://example.com)'),
      /<strong>強調<\/strong>と<a href="https:\/\/example\.com">リンク<\/a>/);
  });

  test('インラインコードの中では他の記法を展開しない', () => {
    assert.match(html('`**これは太字にしない**`'), /<code>\*\*これは太字にしない\*\*<\/code>/);
  });

  test('箇条書きをulにする', () => {
    assert.equal(html('- あ\n- い'), '<ul><li>あ</li><li>い</li></ul>');
  });

  test('番号付きをolにする', () => {
    assert.equal(html('1. あ\n2. い'), '<ol><li>あ</li><li>い</li></ol>');
  });

  test('表を横スクロール可能な入れ物で包む', () => {
    const out = html('| A | B |\n|---|---|\n| 1 | 2 |');
    assert.match(out, /<div class="tbl"><table>/);
    assert.match(out, /<th>A<\/th><th>B<\/th>/);
    assert.match(out, /<td>1<\/td><td>2<\/td>/);
  });

  test('コードブロックを変換し、中身をエスケープする', () => {
    assert.match(html('```\n<script>\n```'), /<pre><code>&lt;script&gt;<\/code><\/pre>/);
  });

  test('引用を変換する', () => {
    assert.equal(html('> 引用文'), '<blockquote>引用文</blockquote>');
  });

  test('水平線を変換する', () => {
    assert.equal(html('---'), '<hr>');
  });

  test('HTMLコメント（執筆メモ）は出力しない', () => {
    assert.equal(html('<!-- メモ -->\n本文'), '<p>本文</p>');
  });

  test('本文中のHTMLをエスケープする', () => {
    assert.match(html('<img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});

describe('extractTitle / extractDescription', () => {
  test('先頭のh1をタイトルにする', () => {
    assert.equal(extractTitle('# 記事タイトル\n\n本文'), '記事タイトル');
  });

  test('最初の段落を説明文にする', () => {
    assert.equal(extractDescription('# タイトル\n\nこれが説明になります。'), 'これが説明になります。');
  });

  test('見出しや引用は説明文に使わない', () => {
    assert.equal(extractDescription('# T\n\n## 小見出し\n\n本当の本文です。'), '本当の本文です。');
  });

  test('長い説明文は切り詰める', () => {
    const d = extractDescription('# T\n\n' + 'あ'.repeat(200));
    assert.ok(d.length <= 121 && d.endsWith('…'));
  });
});

describe('行の連結（日本語と英語の混在）', () => {
  test('英語の行は空白でつなぐ', () => {
    assert.equal(html('hello\nworld'), '<p>hello world</p>');
  });

  test('日本語と英語の境界には空白を入れる', () => {
    assert.equal(html('日本語\nEnglish'), '<p>日本語 English</p>');
  });
});
