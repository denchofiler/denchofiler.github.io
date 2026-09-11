import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDate,
  extractAmount,
  extractVendor,
  extractInvoiceNo,
  extractDocType,
  parseDocument,
  buildFileName,
  sanitizeFileName,
  resolveCollisions,
  buildIndexCsv,
} from '../src/parser.js';

import {
  INVOICE_STANDARD,
  RECEIPT_WAREKI,
  INVOICE_SLASH,
  NO_SIGNAL,
  NUMBERS_ONLY,
  INVOICE_CARRYOVER,
} from './fixtures.js';

const OPTS = { today: '2026-09-11' };

/* ---------------------------------------------------------
 * 取引年月日
 * ------------------------------------------------------- */
describe('extractDate', () => {
  test('「請求日」の日付を採用し、「お支払期限」は採用しない', () => {
    assert.equal(extractDate(INVOICE_STANDARD, OPTS).value, '20260115');
  });

  test('和暦と全角数字を西暦8桁に変換する', () => {
    assert.equal(extractDate(RECEIPT_WAREKI, OPTS).value, '20260302');
  });

  test('スラッシュ区切りの日付を読む', () => {
    assert.equal(extractDate(INVOICE_SLASH, OPTS).value, '20260203');
  });

  test('日付が無ければ null', () => {
    assert.equal(extractDate(NO_SIGNAL, OPTS).value, null);
  });

  test('存在しない日付(2026-02-30)は採用しない', () => {
    assert.equal(extractDate('請求日 2026年2月30日 発行日 2026年2月27日', OPTS).value, '20260227');
  });

  test('未来すぎる日付は採用しない', () => {
    assert.equal(extractDate('請求日 2099年1月1日 発行日 2026年5月1日', OPTS).value, '20260501');
  });
});

/* ---------------------------------------------------------
 * 取引金額
 * ------------------------------------------------------- */
describe('extractAmount', () => {
  test('小計・消費税ではなく税込合計を採用する', () => {
    assert.equal(extractAmount(INVOICE_STANDARD).value, 1234567);
  });

  test('全角の「金 ５５０，０００ 円」を読む', () => {
    assert.equal(extractAmount(RECEIPT_WAREKI).value, 550000);
  });

  test('「合計 330,000円」を読む', () => {
    assert.equal(extractAmount(INVOICE_SLASH).value, 330000);
  });

  test('前回請求額・繰越額が最大でも、当月のご請求金額を採用する', () => {
    assert.equal(extractAmount(INVOICE_CARRYOVER).value, 495000);
  });

  test('電話番号・郵便番号・会員番号を金額と誤認しない', () => {
    assert.equal(extractAmount(NUMBERS_ONLY).value, null);
  });

  test('金額が無ければ null', () => {
    assert.equal(extractAmount(NO_SIGNAL).value, null);
  });
});

/* ---------------------------------------------------------
 * 取引先
 * ------------------------------------------------------- */
describe('extractVendor', () => {
  test('「御中」が付く宛先ではなく発行元を採用する', () => {
    assert.equal(extractVendor(INVOICE_STANDARD).value, 'テスト工業株式会社');
  });

  test('「様」が付く宛先ではなく発行元を採用する', () => {
    assert.equal(extractVendor(RECEIPT_WAREKI).value, '株式会社オフィスサプライ北関東');
  });

  test('自社名を指定すると、それを取引先から除外する', () => {
    const r = extractVendor(INVOICE_STANDARD, { ownCompanyNames: ['テスト工業株式会社'] });
    assert.notEqual(r.value, 'テスト工業株式会社');
  });

  test('合同会社の宛先を除外して株式会社の発行元を採る', () => {
    assert.equal(extractVendor(INVOICE_SLASH).value, '株式会社ブルーオーシャン');
  });

  test('法人名が無ければ null', () => {
    assert.equal(extractVendor(NO_SIGNAL).value, null);
  });

  test('法人格だけの文字列は取引先にしない', () => {
    assert.equal(extractVendor('株式会社 御中 合計 1,000円').value, null);
  });
});

/* ---------------------------------------------------------
 * 登録番号・書類種別
 * ------------------------------------------------------- */
describe('extractInvoiceNo / extractDocType', () => {
  test('登録番号 T+13桁 を取り出す', () => {
    assert.equal(extractInvoiceNo(INVOICE_STANDARD), 'T1234567890123');
  });

  test('登録番号が無ければ null', () => {
    assert.equal(extractInvoiceNo(NO_SIGNAL), null);
  });

  test('書類種別を判定する', () => {
    assert.equal(extractDocType(INVOICE_STANDARD), '請求書');
    assert.equal(extractDocType(RECEIPT_WAREKI), '領収書');
  });
});

/* ---------------------------------------------------------
 * 統合
 * ------------------------------------------------------- */
describe('parseDocument', () => {
  test('請求書から3項目すべてを取り出す', () => {
    const r = parseDocument(INVOICE_STANDARD, OPTS);
    assert.equal(r.date, '20260115');
    assert.equal(r.amount, 1234567);
    assert.equal(r.vendor, 'テスト工業株式会社');
    assert.equal(r.docType, '請求書');
    assert.equal(r.invoiceNo, 'T1234567890123');
  });

  test('読み取れない項目は confidence が none になる', () => {
    const r = parseDocument(NO_SIGNAL, OPTS);
    assert.equal(r.confidence.date, 'none');
    assert.equal(r.confidence.amount, 'none');
    assert.equal(r.confidence.vendor, 'none');
  });
});

/* ---------------------------------------------------------
 * ファイル名
 * ------------------------------------------------------- */
describe('buildFileName / sanitizeFileName', () => {
  const rec = { date: '20260115', amount: 1234567, vendor: 'テスト工業株式会社', docType: '請求書' };

  test('テンプレートから 日付_金額_取引先 を組み立てる', () => {
    assert.equal(
      buildFileName('{日付}_{金額}_{取引先}', rec),
      '20260115_1234567_テスト工業株式会社'
    );
  });

  test('書類種別を含むテンプレートも展開する', () => {
    assert.equal(
      buildFileName('{日付}_{金額}_{取引先}_{書類種別}', rec),
      '20260115_1234567_テスト工業株式会社_請求書'
    );
  });

  test('未取得の項目があっても区切り文字が連続しない', () => {
    const out = buildFileName('{日付}_{金額}_{取引先}', { date: '20260115', amount: null, vendor: 'A商店株式会社' });
    assert.equal(out, '20260115_A商店株式会社');
  });

  test('ファイル名に使えない文字を除去する', () => {
    assert.equal(sanitizeFileName('株式会社A/B:C*D?E"F<G>H|I'), '株式会社ABCDEFGHI');
  });

  test('同名ファイルには連番を付けて衝突を避ける', () => {
    assert.deepEqual(
      resolveCollisions(['a', 'b', 'a', 'a']),
      ['a', 'b', 'a_2', 'a_3']
    );
  });
});

/* ---------------------------------------------------------
 * 索引簿
 * ------------------------------------------------------- */
describe('buildIndexCsv', () => {
  test('検索要件の3項目を列として持つ', () => {
    const csv = buildIndexCsv([]);
    const header = csv.split('\r\n')[0];
    assert.ok(header.includes('取引年月日'));
    assert.ok(header.includes('取引金額(円)'));
    assert.ok(header.includes('取引先'));
  });

  test('日付を YYYY-MM-DD で出力する', () => {
    const csv = buildIndexCsv([{ date: '20260115', amount: 1000, vendor: 'X株式会社', newName: 'f.pdf' }]);
    assert.ok(csv.includes('2026-01-15'));
  });

  test('カンマを含む値をクォートでエスケープする', () => {
    const csv = buildIndexCsv([{ date: '20260115', amount: 1000, vendor: 'A,B株式会社' }]);
    assert.ok(csv.includes('"A,B株式会社"'));
  });
});
