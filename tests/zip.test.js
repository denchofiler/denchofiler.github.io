import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { crc32, buildZip } from '../src/zip.js';

const enc = new TextEncoder();

describe('crc32', () => {
  test('標準テストベクタ "123456789" は 0xCBF43926', () => {
    assert.equal(crc32(enc.encode('123456789')) >>> 0, 0xcbf43926);
  });

  test('空データは 0', () => {
    assert.equal(crc32(new Uint8Array(0)) >>> 0, 0);
  });
});

describe('buildZip', () => {
  test('Uint8Array を返し PK シグネチャで始まる', () => {
    const zip = buildZip([{ name: 'a.txt', data: enc.encode('hello') }]);
    assert.ok(zip instanceof Uint8Array);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
  });

  test('unzip -t で構造の検証が通る', () => {
    const zip = buildZip([
      { name: 'a.txt', data: enc.encode('これは請求書です') },
      { name: 'b.csv', data: enc.encode('連番,取引年月日\r\n1,2026-01-15\r\n') },
      { name: 'empty.bin', data: new Uint8Array(0) },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    const zipPath = join(dir, 'out.zip');
    writeFileSync(zipPath, zip);

    const verify = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
    assert.match(verify, /No errors detected/);
  });

  // 日本語ファイル名は UTF-8 フラグ(bit 11)で格納する。
  // macOS 同梱の Info-ZIP unzip 6.00 はこのフラグを解釈しないため、
  // 検証には仕様に準拠した展開系（Python zipfile / Finder 相当の ditto）を使う。
  test('日本語ファイル名を UTF-8 フラグ付きで格納し、名前と内容が復元できる', () => {
    const zip = buildZip([
      { name: '20260115_1234567_テスト工業株式会社.txt', data: enc.encode('これは請求書です') },
      { name: '索引簿.csv', data: enc.encode('連番,取引年月日\r\n1,2026-01-15\r\n') },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-utf8-'));
    const zipPath = join(dir, 'out.zip');
    writeFileSync(zipPath, zip);

    const out = execFileSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
info = [{'name': i.filename, 'utf8': bool(i.flag_bits & 0x800)} for i in z.infolist()]
body = z.read('20260115_1234567_テスト工業株式会社.txt').decode('utf-8')
print(json.dumps({'info': info, 'body': body}, ensure_ascii=False))
`, zipPath], { encoding: 'utf8' });

    const r = JSON.parse(out);
    assert.deepEqual(r.info.map((x) => x.name), ['20260115_1234567_テスト工業株式会社.txt', '索引簿.csv']);
    assert.ok(r.info.every((x) => x.utf8), 'UTF-8 フラグが立っていること');
    assert.equal(r.body, 'これは請求書です');
  });

  test('macOS の標準展開経路(ditto)で日本語名が壊れない', { skip: process.platform !== 'darwin' }, () => {
    const zip = buildZip([{ name: '索引簿.csv', data: enc.encode('連番\r\n1\r\n') }]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-ditto-'));
    const zipPath = join(dir, 'out.zip');
    writeFileSync(zipPath, zip);

    execFileSync('ditto', ['-x', '-k', zipPath, join(dir, 'ex')]);
    assert.ok(readFileSync(join(dir, 'ex', '索引簿.csv'), 'utf8').includes('連番'));
  });

  test('大きめのバイナリでもサイズが保たれる', () => {
    const data = new Uint8Array(300000).map((_, i) => i % 251);
    const zip = buildZip([{ name: 'big.bin', data }]);

    const dir = mkdtempSync(join(tmpdir(), 'zip-big-'));
    const zipPath = join(dir, 'big.zip');
    writeFileSync(zipPath, zip);
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);

    const restored = readFileSync(join(dir, 'big.bin'));
    assert.equal(restored.length, 300000);
    assert.deepEqual(new Uint8Array(restored.subarray(0, 64)), data.subarray(0, 64));
  });
});
