/*!
 * 電帳ファイラー - 無圧縮ZIP書き出し
 *
 * PDF/JPEG は既に圧縮済みなので、deflate は使わず格納(store)のみ。
 * 外部ライブラリに依存しないため、配布物を1ファイルに保てる。
 * ファイル名は UTF-8 フラグ(bit 11)を立てて日本語をそのまま格納する。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: (((year - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

class ByteWriter {
  constructor(size) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  u16(v) { this.view.setUint16(this.pos, v, true); this.pos += 2; }
  u32(v) { this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  bytes(b) { this.buf.set(b, this.pos); this.pos += b.length; }
}

/**
 * @param {{name: string, data: Uint8Array, date?: Date}[]} files
 * @returns {Uint8Array} ZIP アーカイブ
 */
export function buildZip(files) {
  const enc = new TextEncoder();
  const entries = files.map((f) => {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    return { nameBytes, data, crc: crc32(data), dt: dosDateTime(f.date ? new Date(f.date) : new Date()) };
  });

  const localSize = entries.reduce((n, e) => n + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.nameBytes.length, 0);
  const w = new ByteWriter(localSize + centralSize + 22);

  const FLAG_UTF8 = 0x0800;

  // ローカルファイルヘッダ＋データ本体
  for (const e of entries) {
    e.offset = w.pos;
    w.u32(0x04034b50);
    w.u16(20);            // 展開に必要なバージョン
    w.u16(FLAG_UTF8);
    w.u16(0);             // 無圧縮
    w.u16(e.dt.time);
    w.u16(e.dt.date);
    w.u32(e.crc);
    w.u32(e.data.length); // 圧縮後サイズ＝元サイズ
    w.u32(e.data.length);
    w.u16(e.nameBytes.length);
    w.u16(0);             // 拡張フィールドなし
    w.bytes(e.nameBytes);
    w.bytes(e.data);
  }

  // セントラルディレクトリ
  const centralStart = w.pos;
  for (const e of entries) {
    w.u32(0x02014b50);
    w.u16(20);            // 作成バージョン
    w.u16(20);
    w.u16(FLAG_UTF8);
    w.u16(0);
    w.u16(e.dt.time);
    w.u16(e.dt.date);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(e.nameBytes.length);
    w.u16(0);             // 拡張フィールド
    w.u16(0);             // コメント
    w.u16(0);             // 開始ディスク番号
    w.u16(0);             // 内部属性
    w.u32(0);             // 外部属性
    w.u32(e.offset);
    w.bytes(e.nameBytes);
  }

  // 終端レコード（サイズは EOCD 自身を書く前に確定させる）
  const centralBytes = w.pos - centralStart;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(entries.length);
  w.u16(entries.length);
  w.u32(centralBytes);
  w.u32(centralStart);
  w.u16(0);

  return w.buf.subarray(0, w.pos);
}
