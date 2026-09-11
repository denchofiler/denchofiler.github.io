/*!
 * 電帳ファイラー - 日本語証憑パーサ
 * Copyright (c) 2026. All rights reserved.
 */

/* ==========================================================
 * 1. 文字正規化
 * ======================================================== */

const FW_DIGITS = /[０-９]/g;
const FW_ALPHA = /[Ａ-Ｚａ-ｚ]/g;
const fw2hw = (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0);

/** 日付・金額の抽出用。長音符「ー」は社名で使うので変換しない */
export function normalize(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(FW_DIGITS, fw2hw)
    .replace(FW_ALPHA, fw2hw)
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[／]/g, '/')
    .replace(/[－−‐‑‒–—―]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/[￥]/g, '¥')
    .replace(/[　]/g, ' ')
    .replace(/[\u0009\u000b\u000c\u000d]/g, ' ');
}

/** 社名抽出用。記号を潰すと社名が壊れるため最小限にとどめる */
export function normalizeForName(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(FW_DIGITS, fw2hw)
    .replace(/[　]/g, ' ')
    .replace(/[\u0009\u000b\u000c\u000d]/g, ' ');
}

/* ==========================================================
 * 2. 和暦
 * ======================================================== */

const ERAS = [
  { names: ['令和', 'R', 'r'], base: 2018 },
  { names: ['平成', 'H', 'h'], base: 1988 },
  { names: ['昭和', 'S', 's'], base: 1925 },
];

const eraToYear = (era, y) => {
  for (const e of ERAS) if (e.names.includes(era)) return e.base + y;
  return null;
};

/* ==========================================================
 * 3. 直前ラベルの判定
 *
 * 表組みでは「小計 100,000 / 消費税 10,000 / 合計 110,000」のように
 * 肯定語と否定語が近接して並ぶ。窓内の任意一致だと合計が消費税に
 * 引きずられるので、マッチの直前にある “ラベル語ひと塊” だけを見る。
 * ======================================================== */

/** 直前の数字・区切りを取り除いた上で、末尾に露出したラベル語を取り出す */
function labelToken(before, stripTrailing) {
  const seg = before.replace(stripTrailing, '');
  const m = /[^\d\s,]{1,12}$/.exec(seg);
  return m ? m[0] : '';
}

function classify(token, after, { strong, mid, neg }) {
  const find = (list, s) => (s ? list.find((k) => s.includes(k)) || null : null);
  let k;
  if ((k = find(neg, token))) return { score: -400, label: k };
  if ((k = find(strong, token))) return { score: 120, label: k };
  if ((k = find(mid, token))) return { score: 45, label: k };
  if ((k = find(neg, after))) return { score: -400, label: k };
  if ((k = find(strong, after))) return { score: 120, label: k };
  if ((k = find(mid, after))) return { score: 45, label: k };
  return { score: 0, label: null };
}

function dedupeBy(arr, key) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = String(it[key]);
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

/* ==========================================================
 * 4. 取引年月日
 * ======================================================== */

const DATE_STRONG = [
  '取引年月日', '取引日', '発行年月日', '請求年月日', '御請求日', 'ご請求日',
  '請求日', '発行日', '領収日', '納品日', '作成日', '計上日', '売上日', '利用日', '購入日', '決済日',
];
const DATE_MID = ['年月日', '日付', 'Date', 'DATE', 'date', 'Issued'];
const DATE_NEG = [
  '支払期限', 'お支払期限', 'お支払い期限', '支払期日', 'お支払期日', '振込期限', '振込期日',
  '納期', '有効期限', '締切', '締め切り', '締日', '締め日', '期限', '期日',
  '登録日', '開始日', '終了日', '次回', '前回', '設立', '生年月日',
];

const DATE_STRIP = /[:\s.\-/]+$/;

const DATE_PATTERNS = [
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, kind: 'ad' },
  { re: /(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)/g, kind: 'ad' },
  { re: /(令和|平成|昭和)\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, kind: 'jp' },
  { re: /(?:^|[^A-Za-z0-9])([RHS])\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)/g, kind: 'jp' },
  { re: /(\d{4})\s*年\s*(\d{1,2})\s*月(?!\s*\d{1,2}\s*日)/g, kind: 'ym' },
];

function isValidYMD(y, m, d) {
  if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function extractDate(text, opts = {}) {
  const t = normalize(text);
  const today = opts.today ? new Date(opts.today) : new Date();
  const maxFuture = new Date(today.getTime() + 400 * 864e5);
  const minPast = new Date(today.getTime() - 3660 * 864e5);
  const total = t.length || 1;
  const cands = [];

  for (const p of DATE_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(t)) !== null) {
      let y, mo, d;
      if (p.kind === 'ad') { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if (p.kind === 'ym') { y = +m[1]; mo = +m[2]; d = 1; }
      else {
        y = eraToYear(m[1], m[2] === '元' ? 1 : +m[2]);
        if (y == null) continue;
        mo = +m[3]; d = +m[4];
      }
      if (!isValidYMD(y, mo, d)) continue;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt > maxFuture || dt < minPast) continue;

      const before = t.slice(Math.max(0, m.index - 30), m.index);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const hit = classify(labelToken(before, DATE_STRIP), after,
        { strong: DATE_STRONG, mid: DATE_MID, neg: DATE_NEG });

      cands.push({
        value: `${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`,
        iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        index: m.index,
        raw: m[0].trim(),
        label: hit.label,
        score: hit.score + Math.round(30 * (1 - m.index / total)) + (p.kind === 'ym' ? -40 : 0),
      });
    }
  }

  if (!cands.length) return { value: null, iso: null, score: 0, label: null, candidates: [] };
  cands.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const best = cands[0];
  return {
    value: best.value, iso: best.iso, score: best.score, label: best.label,
    candidates: dedupeBy(cands, 'value').slice(0, 8),
  };
}

/* ==========================================================
 * 5. 取引金額（税込総額）
 * ======================================================== */

const AMT_STRONG = [
  'ご請求金額', '御請求金額', 'ご請求額', '御請求額', '請求金額', '請求額',
  'お支払金額', 'お支払い金額', '支払金額', 'お支払額', '領収金額',
  '合計金額', '税込合計', '税込金額', '総額', '総計', 'ご請求', '御請求',
];
const AMT_MID = ['合計', 'TOTAL', 'Total', 'total', '金額', '計'];
const AMT_NEG = [
  '小計', '消費税', '税抜', '内税', '外税', '対象', '単価', '数量', '前回', '繰越',
  '差引', '源泉', '値引', '割引', '税率', '内訳', '残高', '入金', '手数料', '預り',
  '御中', 'TEL', 'Tel', '電話', 'FAX', '〒', '番号', '口座', '郵便', '住所',
];

const AMT_STRIP = /[0-9,¥\\()%\s.\-円]+$/;
const AMOUNT_RE = /([¥\\]|金)?\s*(\d{1,3}(?:,\d{3})+|\d{3,10})\s*(円|-)?/g;

export function extractAmount(text) {
  const t = normalize(text);
  const cands = [];
  const re = new RegExp(AMOUNT_RE.source, AMOUNT_RE.flags);
  let m;

  while ((m = re.exec(t)) !== null) {
    const grouped = m[2].includes(',');
    const val = parseInt(m[2].replace(/,/g, ''), 10);
    if (!Number.isFinite(val) || val < 1 || val > 99999999999) continue;

    const hasCurrency = Boolean(m[1]) || m[3] === '円';
    // 桁区切りが無い数字は、通貨表記が無ければ電話番号・郵便番号・管理番号の可能性が高い
    if (!grouped && !hasCurrency) continue;

    const before = t.slice(Math.max(0, m.index - 34), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 10);
    const hit = classify(labelToken(before, AMT_STRIP), after,
      { strong: AMT_STRONG, mid: AMT_MID, neg: AMT_NEG });

    cands.push({
      value: val, index: m.index, raw: m[0].trim(), label: hit.label,
      score: hit.score + (hasCurrency ? 12 : 0),
    });
  }

  if (!cands.length) return { value: null, score: 0, label: null, candidates: [] };

  const positives = cands.filter((c) => c.score > 0);
  let best;
  if (positives.length) {
    // 同程度のラベル強度なら最大額＝税込総額とみなす
    const top = Math.max(...positives.map((c) => c.score));
    const tier = positives.filter((c) => c.score >= top - 20);
    best = tier.reduce((a, b) => (b.value > a.value ? b : a));
  } else {
    best = { ...cands.reduce((a, b) => (b.value > a.value ? b : a)), score: 5 };
  }

  const uniq = dedupeBy([...cands].sort((a, b) => b.score - a.score || b.value - a.value), 'value');
  return { value: best.value, score: best.score, label: best.label, candidates: uniq.slice(0, 10) };
}

/* ==========================================================
 * 6. 取引先（発行元）
 * ======================================================== */

const CORP_SUFFIX = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社'];
const CORP_PREFIX = [
  '一般社団法人', '公益社団法人', '一般財団法人', '公益財団法人', '特定非営利活動法人',
  '医療法人社団', '医療法人', '学校法人', '社会福祉法人', '宗教法人', '独立行政法人', '国立大学法人',
];
const CORP_ABBR = ['(株)', '（株）', '㈱', '(有)', '（有）', '㈲'];
const ALL_CORP_WORDS = [...CORP_SUFFIX, ...CORP_PREFIX, ...CORP_ABBR];

const NAME_CH = "[0-9A-Za-zぁ-んァ-ヶ一-龥ー・＆&'’.-]";
const ISSUER_HINTS = ['登録番号', '振込先', 'お振込', '振込口座', 'TEL', 'Tel', '電話', 'FAX', '〒', '発行元', '発行者', '担当', '住所'];
const STOP_TOKENS = ['御中', '様', '殿', '宛', '印', '請求書', '見積書', '領収書', '納品書', '発行', '登録番号', '住所', '電話', '担当', '件名'];

function trimName(name) {
  let s = name.trim();
  for (const tk of STOP_TOKENS) {
    const i = s.indexOf(tk);
    if (i > 0) s = s.slice(0, i);
  }
  return s.replace(/\d{3,}$/, '').replace(/^[\s.・-]+|[\s.・-]+$/g, '');
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function collectCompanies(t) {
  const out = [];
  const push = (name, index, raw) => {
    const cleaned = trimName(name).replace(/\s+/g, '');
    if (cleaned.length < 3 || cleaned.length > 32) return;
    if (ALL_CORP_WORDS.includes(cleaned)) return; // 法人格だけの語は社名ではない
    out.push({ name: cleaned, index, raw });
  };

  // 前置型「株式会社ABC」: 法人格の直前が社名の一部でないこと
  const HEAD = '(?:^|[^' + NAME_CH.slice(1, -1) + '])';
  // 後置型「ABC株式会社」: 法人格の直後が社名の続きでないこと
  const TAIL = '(?!' + NAME_CH + ')';

  const runPrefix = (word) => {
    const re = new RegExp(HEAD + escRe(word) + '\\s?(' + NAME_CH + '{1,18})', 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      // 先頭の境界文字ぶんだけ開始位置をずらす
      const off = m[0].startsWith(word) ? 0 : 1;
      push(word + m[1], m.index + off, m[0].slice(off));
    }
  };
  const runSuffix = (word) => {
    const re = new RegExp('(' + NAME_CH + '{1,18}?)\\s?' + escRe(word) + TAIL, 'g');
    let m;
    while ((m = re.exec(t)) !== null) push(m[1] + word, m.index, m[0]);
  };

  for (const suf of CORP_SUFFIX) { runPrefix(suf); runSuffix(suf); }
  for (const pre of CORP_PREFIX) runPrefix(pre);
  for (const ab of CORP_ABBR) { runPrefix(ab); runSuffix(ab); }
  return out;
}

export function extractInvoiceNo(text) {
  const t = normalize(text);
  const m = /登録番号[^0-9T]{0,10}T?\s*-?\s*(\d{13})/.exec(t) || /T\s*-?\s*(\d{13})(?!\d)/.exec(t);
  return m ? 'T' + m[1] : null;
}

export function extractVendor(text, opts = {}) {
  const t = normalizeForName(text);
  const own = (opts.ownCompanyNames || []).map((s) => String(s).trim()).filter(Boolean);
  const total = t.length || 1;

  const raw = collectCompanies(t);
  if (!raw.length) return { value: null, score: 0, candidates: [] };

  const hon = /(御中|様)/.exec(t);
  const honIdx = hon ? hon.index : -1;

  const scored = raw.map((c) => {
    let score = 30;
    const end = c.index + c.raw.length;

    // 直後が「御中/様」＝宛先（＝自社）なので強く除外する
    if (/^\s{0,3}(御中|様|行|宛)/.test(t.slice(end, end + 5))) score -= 500;
    for (const o of own) if (c.name.includes(o) || o.includes(c.name)) score -= 600;

    const around = t.slice(Math.max(0, c.index - 130), end + 170);
    if (ISSUER_HINTS.some((h) => around.includes(h))) score += 70;
    if (/T\s*-?\s*\d{13}/.test(around)) score += 60;
    if (honIdx >= 0 && c.index > honIdx) score += 45;

    const rel = c.index / total;
    if (rel > 0.88) score -= 40;
    else if (rel < 0.5) score += 10;
    if (c.name.length <= 4) score -= 15;
    if (c.name.length >= 24) score -= 20;

    return { ...c, score };
  });

  const byName = new Map();
  for (const c of scored) {
    const prev = byName.get(c.name);
    if (!prev || c.score > prev.score) byName.set(c.name, c);
  }
  const list = [...byName.values()].sort((a, b) => b.score - a.score || a.index - b.index);
  const best = list[0];
  if (!best || best.score < -100) return { value: null, score: 0, candidates: list.slice(0, 8) };
  return { value: best.name, score: best.score, candidates: list.slice(0, 8) };
}

/* ==========================================================
 * 7. 書類種別
 * ======================================================== */

const DOC_TYPES = [
  ['領収書', ['領収書', '領収証', 'レシート', 'RECEIPT', 'Receipt']],
  ['請求書', ['請求書', 'ご請求書', '御請求書', 'INVOICE', 'Invoice']],
  ['納品書', ['納品書', '物品受領書']],
  ['見積書', ['見積書', 'お見積書', '御見積書', 'QUOTATION', 'Quotation']],
  ['注文書', ['注文書', '発注書', '注文請書']],
  ['契約書', ['契約書', '覚書', '合意書']],
];

export function extractDocType(text) {
  const t = normalize(text);
  const head = t.slice(0, Math.max(200, Math.floor(t.length * 0.2)));
  for (const [label, keys] of DOC_TYPES) if (keys.some((k) => head.includes(k))) return label;
  for (const [label, keys] of DOC_TYPES) if (keys.some((k) => t.includes(k))) return label;
  return '';
}

/* ==========================================================
 * 8. 統合
 * ======================================================== */

export function parseDocument(text, opts = {}) {
  const date = extractDate(text, opts);
  const amount = extractAmount(text);
  const vendor = extractVendor(text, opts);
  const level = (s, hi, mid) => (s >= hi ? 'high' : s >= mid ? 'mid' : 'low');

  return {
    date: date.value,
    dateIso: date.iso,
    amount: amount.value,
    vendor: vendor.value,
    invoiceNo: extractInvoiceNo(text),
    docType: extractDocType(text),
    confidence: {
      date: date.value ? level(date.score, 100, 40) : 'none',
      amount: amount.value ? level(amount.score, 100, 40) : 'none',
      vendor: vendor.value ? level(vendor.score, 100, 40) : 'none',
    },
    detail: { date, amount, vendor },
  };
}

/* ==========================================================
 * 9. ファイル名
 * ======================================================== */

export function sanitizeFileName(s, maxLen = 60) {
  let out = String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, '')
    .replace(/\.+$/g, '')
    .trim();
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/** 使用可能: {日付} {金額} {取引先} {書類種別} {登録番号} {連番} {元ファイル名} */
export function buildFileName(tpl, rec, index = 1) {
  const map = {
    '日付': rec.date || '00000000',
    '金額': rec.amount == null ? '' : String(rec.amount),
    '取引先': sanitizeFileName(rec.vendor || '取引先不明', 30),
    '書類種別': rec.docType || '',
    '登録番号': rec.invoiceNo || '',
    '連番': String(index).padStart(3, '0'),
    '元ファイル名': sanitizeFileName(String(rec.originalName || '').replace(/\.[^.]+$/, ''), 40),
  };
  const out = String(tpl)
    .replace(/\{([^}]+)\}/g, (_, k) => (k in map ? map[k] : ''))
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitizeFileName(out, 120) || '無題';
}

/** 同名衝突を _2, _3 … で回避する */
export function resolveCollisions(names) {
  const used = new Map();
  return names.map((n) => {
    const key = n.toLowerCase();
    if (!used.has(key)) { used.set(key, 1); return n; }
    let c = used.get(key) + 1;
    let cand = `${n}_${c}`;
    while (used.has(cand.toLowerCase())) { c += 1; cand = `${n}_${c}`; }
    used.set(key, c);
    used.set(cand.toLowerCase(), 1);
    return cand;
  });
}

/* ==========================================================
 * 10. 索引簿 CSV（検索要件対応）
 * ======================================================== */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function buildIndexCsv(records) {
  const header = ['連番', '取引年月日', '取引金額(円)', '取引先', '書類種別', '登録番号', '保存ファイル名', '元ファイル名', '備考'];
  const lines = [header.map(csvCell).join(',')];
  records.forEach((r, i) => {
    const iso = r.dateIso || (r.date ? `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}` : '');
    lines.push([i + 1, iso, r.amount == null ? '' : r.amount, r.vendor || '', r.docType || '',
      r.invoiceNo || '', r.newName || '', r.originalName || '', r.note || ''].map(csvCell).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}
