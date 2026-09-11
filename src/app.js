import {
  parseDocument, buildFileName, resolveCollisions, buildIndexCsv, sanitizeFileName,
} from './parser.js';
import { buildZip } from './zip.js';

/* ==========================================================
 * 版の設定（ビルド時に置換）
 * ======================================================== */
const EDITION = '__EDITION__';        // 'trial' | 'full'
const isTrial = EDITION === 'trial';

/* ==========================================================
 * pdf.js の初期化
 *
 * ワーカーは別ファイルにできない（単一HTML配布のため）ので、
 * ワーカーモジュールを globalThis.pdfjsWorker に載せて
 * pdf.js の「フェイクワーカー」経路を使う。通信もBlobも発生しない。
 * ======================================================== */
const pdfjsLib = globalThis.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'inline';

/**
 * 日本語PDFの多くは CID フォントを使っており、cMap が無いと
 * テキストを取り出せない。HTMLに埋め込んだ cMap を pdf.js に渡す。
 */
let cmapBytes = null;
function cmapAll() {
  if (!cmapBytes) {
    const bin = atob(globalThis.__CMAPS__.d);
    cmapBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) cmapBytes[i] = bin.charCodeAt(i);
  }
  return cmapBytes;
}

class InlineCMapReaderFactory {
  async fetch({ name }) {
    const at = globalThis.__CMAPS__.i[name];
    if (!at) throw new Error(`同梱していない cMap です: ${name}`);
    return { cMapData: cmapAll().subarray(at[0], at[0] + at[1]), isCompressed: true };
  }
}

/** getDocument の共通オプション */
const pdfOpts = (data) => ({
  data,
  isEvalSupported: false,
  CMapReaderFactory: InlineCMapReaderFactory,
  cMapPacked: true,
});

/* ==========================================================
 * 状態
 * ======================================================== */
/** @type {{id:number,file:File,originalName:string,date:string|null,dateIso:string|null,
 *  amount:number|null,vendor:string|null,docType:string,invoiceNo:string|null,
 *  text:string,confidence:object,detail:object,newName:string,note:string}[]} */
const rows = [];
let seq = 0;

const $ = (id) => document.getElementById(id);
const el = {
  drop: $('drop'), picker: $('picker'), tbody: $('tbody'), summary: $('summary'),
  btnZip: $('btnZip'), btnCsv: $('btnCsv'), btnClear: $('btnClear'),
  ownName: $('ownName'), tpl: $('tpl'), folder: $('folder'),
  progress: $('progress'), barFill: $('barFill'), progressTxt: $('progressTxt'),
  drawer: $('drawer'), drawerName: $('drawerName'), drawerBody: $('drawerBody'),
  toast: $('toast'), trialbar: $('trialbar'),
};

if (isTrial) el.trialbar.style.display = '';

/* ==========================================================
 * 小物
 * ======================================================== */
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2600);
}

function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/* ==========================================================
 * PDF テキスト抽出
 * ======================================================== */
async function extractPdfText(buf) {
  const doc = await pdfjsLib.getDocument(pdfOpts(buf)).promise;
  const pages = Math.min(doc.numPages, 5); // 証憑は先頭数ページに情報が集中する
  let text = '';
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY = null;
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith('\n')) text += ' ';
      text += it.str;
      lastY = y;
    }
    text += '\n';
  }
  return { text, doc };
}

/* ==========================================================
 * ファイル取り込み
 * ======================================================== */
async function addFiles(fileList) {
  let files = [...fileList].filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.name));
  if (!files.length) { toast('PDF または画像ファイルを選んでください'); return; }

  el.progress.classList.add('on');
  const own = el.ownName.value.trim();
  const opts = { ownCompanyNames: own ? [own] : [] };

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    el.progressTxt.textContent = `読み取り中… (${i + 1}/${files.length}) ${f.name}`;
    el.barFill.style.width = `${Math.round((i / files.length) * 100)}%`;
    await yieldToUI();

    const row = {
      id: ++seq, file: f, originalName: f.name,
      date: null, dateIso: null, amount: null, vendor: null,
      docType: '', invoiceNo: null, text: '', note: '',
      confidence: { date: 'none', amount: 'none', vendor: 'none' },
      detail: null, newName: '',
    };

    try {
      if (/\.pdf$/i.test(f.name)) {
        const { text } = await extractPdfText(await f.arrayBuffer());
        row.text = text;
        if (text.replace(/\s/g, '').length < 10) {
          row.note = '文字情報なし（画像PDFの可能性）';
        } else {
          Object.assign(row, pick(parseDocument(text, opts)));
        }
      } else {
        row.note = '画像ファイル（手入力してください）';
      }
    } catch (e) {
      row.note = '読み取り失敗: ' + (e && e.message ? e.message : e);
    }

    rows.push(row);
  }

  el.barFill.style.width = '100%';
  setTimeout(() => { el.progress.classList.remove('on'); el.barFill.style.width = '0'; }, 350);
  render();
}

function pick(p) {
  return {
    date: p.date, dateIso: p.dateIso, amount: p.amount, vendor: p.vendor,
    docType: p.docType, invoiceNo: p.invoiceNo, confidence: p.confidence, detail: p.detail,
  };
}

/* ==========================================================
 * 表示
 * ======================================================== */
function cellClass(conf) {
  if (conf === 'none') return 'bad';
  if (conf === 'low' || conf === 'mid') return 'warn';
  return '';
}

function recalcNames() {
  const tpl = el.tpl.value.trim() || '{日付}_{金額}_{取引先}';
  const base = rows.map((r, i) => buildFileName(tpl, r, i + 1));
  const resolved = resolveCollisions(base);
  rows.forEach((r, i) => {
    const ext = (r.originalName.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase();
    r.newName = resolved[i] + ext;
  });
}

function folderFor(r) {
  const mode = el.folder.value;
  if (mode === 'none' || !r.date) return '';
  if (mode === 'y') return r.date.slice(0, 4) + '/';
  if (mode === 'ym') return `${r.date.slice(0, 4)}/${r.date.slice(4, 6)}/`;
  if (mode === 'vendor') return (sanitizeFileName(r.vendor || '取引先不明', 30) || '取引先不明') + '/';
  return '';
}

function render() {
  recalcNames();

  if (!rows.length) {
    el.tbody.innerHTML = '<tr class="emptyrow"><td colspan="7" class="empty">まだファイルがありません。上の枠に PDF をドロップしてください。</td></tr>';
    el.summary.textContent = '0 件';
    el.btnZip.disabled = true;
    return;
  }

  el.tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = String(r.id);
    tr.innerHTML = `
      <td class="orig" title="${esc(r.originalName)}">${esc(r.originalName)}${r.note ? `<br><span style="color:#b54708">${esc(r.note)}</span>` : ''}</td>
      <td class="${cellClass(r.confidence.date)}"><input class="cellinput" data-f="date" value="${esc(r.date || '')}" placeholder="YYYYMMDD" inputmode="numeric"></td>
      <td class="${cellClass(r.confidence.amount)}"><input class="cellinput num" data-f="amount" value="${r.amount == null ? '' : r.amount}" placeholder="金額" inputmode="numeric" style="text-align:right"></td>
      <td class="${cellClass(r.confidence.vendor)}"><input class="cellinput" data-f="vendor" value="${esc(r.vendor || '')}" placeholder="取引先"></td>
      <td><input class="cellinput" data-f="docType" value="${esc(r.docType || '')}" placeholder="種別"></td>
      <td class="newname">${esc(folderFor(r))}${esc(r.newName)}</td>
      <td>
        <button class="rowbtn" data-act="preview">確認</button>
        <button class="rowbtn del" data-act="del">削除</button>
      </td>`;
    el.tbody.appendChild(tr);
  }

  const need = rows.filter((r) => !r.date || r.amount == null || !r.vendor).length;
  el.summary.innerHTML = need
    ? `${rows.length} 件中 <span class="need">${need} 件が要確認</span>（空欄を埋めてください）`
    : `${rows.length} 件 — <span class="ok">3項目すべて入力済み</span>`;
  el.btnZip.disabled = false;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ==========================================================
 * 表の編集
 * ======================================================== */
el.tbody.addEventListener('input', (e) => {
  const inp = e.target.closest('.cellinput');
  if (!inp) return;
  const tr = inp.closest('tr');
  const r = rows.find((x) => x.id === +tr.dataset.id);
  if (!r) return;
  const f = inp.dataset.f;

  if (f === 'amount') {
    const v = inp.value.replace(/[^\d]/g, '');
    r.amount = v === '' ? null : parseInt(v, 10);
    r.confidence.amount = r.amount == null ? 'none' : 'high';
  } else if (f === 'date') {
    const v = inp.value.replace(/[^\d]/g, '').slice(0, 8);
    r.date = v.length === 8 ? v : null;
    r.dateIso = r.date ? `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}` : null;
    r.confidence.date = r.date ? 'high' : 'none';
  } else {
    r[f] = inp.value;
    if (f === 'vendor') r.confidence.vendor = inp.value.trim() ? 'high' : 'none';
  }

  recalcNames();
  const cell = tr.querySelector('.newname');
  if (cell) cell.textContent = folderFor(r) + r.newName;
  const td = inp.closest('td');
  td.className = td.classList.contains('newname') ? td.className : cellClass(r.confidence[f] || 'high');
  updateSummary();
});

function updateSummary() {
  const need = rows.filter((r) => !r.date || r.amount == null || !r.vendor).length;
  el.summary.innerHTML = need
    ? `${rows.length} 件中 <span class="need">${need} 件が要確認</span>（空欄を埋めてください）`
    : `${rows.length} 件 — <span class="ok">3項目すべて入力済み</span>`;
}

el.tbody.addEventListener('click', (e) => {
  const btn = e.target.closest('.rowbtn');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = +tr.dataset.id;
  if (btn.dataset.act === 'del') {
    const i = rows.findIndex((x) => x.id === id);
    if (i >= 0) rows.splice(i, 1);
    render();
  } else {
    openPreview(id);
  }
});

/* ==========================================================
 * プレビュー
 * ======================================================== */
let previewUrl = null;
function revokePreviewUrl() {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

async function openPreview(id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  el.drawerName.textContent = r.originalName;
  el.drawerBody.innerHTML = '<p style="color:#667085">表示を準備しています…</p>';
  el.drawer.classList.add('on');

  const frag = document.createElement('div');

  // 表示はブラウザ内蔵のPDFビューアに任せる。
  // pdf.js の canvas 描画は、フォントを埋め込んでいない日本語PDFで
  // 描画が完了しないことがあるため、プレビューには使わない。
  revokePreviewUrl();
  previewUrl = URL.createObjectURL(r.file);

  if (/\.pdf$/i.test(r.originalName)) {
    const frame = document.createElement('iframe');
    frame.src = previewUrl;
    frame.className = 'pdfview';
    frame.title = r.originalName;
    frag.appendChild(frame);

    // PDFビューアを無効にしている環境では枠が空になるので、別窓で開く導線を必ず置く
    const open = document.createElement('a');
    open.href = previewUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    open.className = 'openlink';
    open.textContent = '別のウィンドウで開く';
    frag.appendChild(open);
  } else {
    const img = document.createElement('img');
    img.src = previewUrl;
    img.className = 'imgview';
    frag.appendChild(img);
  }

  const d = r.detail;
  if (d) {
    frag.appendChild(chips('取引年月日の候補', d.date.candidates.map((c) => ({
      label: `${c.value}${c.label ? `（${c.label}）` : ''}`, apply: () => setField(r, 'date', c.value),
    }))));
    frag.appendChild(chips('取引金額の候補', d.amount.candidates.map((c) => ({
      label: `${c.value.toLocaleString('ja-JP')}${c.label ? `（${c.label}）` : ''}`, apply: () => setField(r, 'amount', c.value),
    }))));
    frag.appendChild(chips('取引先の候補', d.vendor.candidates.map((c) => ({
      label: c.name, apply: () => setField(r, 'vendor', c.name),
    }))));
  }

  if (r.text) {
    const h = document.createElement('h4');
    h.textContent = '読み取ったテキスト';
    const pre = document.createElement('div');
    pre.className = 'rawtext';
    pre.textContent = r.text.slice(0, 4000);
    frag.appendChild(h);
    frag.appendChild(pre);
  }

  el.drawerBody.innerHTML = '';
  el.drawerBody.appendChild(frag);
}

function chips(title, items) {
  const wrap = document.createElement('div');
  if (!items.length) return wrap;
  const h = document.createElement('h4');
  h.textContent = title;
  wrap.appendChild(h);
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = it.label;
    b.onclick = it.apply;
    wrap.appendChild(b);
  }
  return wrap;
}

function setField(r, field, value) {
  if (field === 'amount') { r.amount = value; r.confidence.amount = 'high'; }
  else if (field === 'date') {
    r.date = value;
    r.dateIso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    r.confidence.date = 'high';
  } else { r.vendor = value; r.confidence.vendor = 'high'; }
  render();
  toast('反映しました');
}

$('drawerClose').onclick = () => {
  el.drawer.classList.remove('on');
  revokePreviewUrl();
};

/* ==========================================================
 * 書き出し
 * ======================================================== */
function csvForExport() {
  const recs = rows.map((r) => ({ ...r, newName: folderFor(r) + r.newName }));
  // 無料版でも索引簿は実務でそのまま使える状態で出す（注記や透かしは入れない）
  return '﻿' + buildIndexCsv(recs); // Excel が UTF-8 と判定できるよう BOM を付ける
}

el.btnCsv.onclick = () => {
  if (!rows.length) return;
  download('索引簿.csv', new Blob([csvForExport()], { type: 'text/csv;charset=utf-8' }));
  toast('索引簿CSVを書き出しました');
};

el.btnZip.onclick = async () => {
  if (!rows.length) return;
  // ZIP一括書き出しは製品版の機能
  if (isTrial) { $('mUpgrade').classList.add('on'); return; }
  el.btnZip.disabled = true;
  el.progress.classList.add('on');
  el.progressTxt.textContent = 'ZIPを作成しています…';

  try {
    const entries = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      el.barFill.style.width = `${Math.round((i / rows.length) * 100)}%`;
      await yieldToUI();
      entries.push({
        name: folderFor(r) + r.newName,
        data: new Uint8Array(await r.file.arrayBuffer()),
        date: r.file.lastModified ? new Date(r.file.lastModified) : new Date(),
      });
    }

    const encoder = new TextEncoder();
    entries.push({ name: '索引簿.csv', data: encoder.encode(csvForExport()) });
    entries.push({ name: '訂正削除の防止に関する事務処理規程_ひな形.txt', data: encoder.encode(KITEI.corp) });
    entries.push({ name: 'お読みください.txt', data: encoder.encode(README_TXT) });

    const zip = buildZip(entries);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    download(`電子取引データ_${stamp}.zip`, new Blob([zip], { type: 'application/zip' }));
    toast(`${rows.length} 件を書き出しました`);
  } catch (e) {
    toast('書き出しに失敗しました: ' + (e && e.message ? e.message : e));
  } finally {
    el.progress.classList.remove('on');
    el.barFill.style.width = '0';
    el.btnZip.disabled = false;
  }
};

el.btnClear.onclick = () => {
  if (!rows.length) return;
  if (!confirm('取り込んだファイルをすべて一覧から削除します。よろしいですか？')) return;
  rows.length = 0;
  render();
};

/* ==========================================================
 * ドラッグ＆ドロップ
 * ======================================================== */
el.drop.onclick = () => el.picker.click();
el.picker.onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };

['dragenter', 'dragover'].forEach((ev) => el.drop.addEventListener(ev, (e) => {
  e.preventDefault(); el.drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => el.drop.addEventListener(ev, (e) => {
  e.preventDefault(); el.drop.classList.remove('over');
}));
el.drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

el.tpl.addEventListener('input', render);
el.folder.addEventListener('change', render);

/* ==========================================================
 * モーダル
 * ======================================================== */
const openModal = (id) => $(id).classList.add('on');
$('btnHelp').onclick = () => openModal('mHelp');
$('btnLaw').onclick = () => openModal('mLaw');
$('btnKitei').onclick = () => openModal('mKitei');
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.hasAttribute('data-close')) m.classList.remove('on');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal.on').forEach((m) => m.classList.remove('on'));
  if (el.drawer.classList.contains('on')) { el.drawer.classList.remove('on'); revokePreviewUrl(); }
});
document.querySelectorAll('[data-kitei]').forEach((b) => {
  b.onclick = () => {
    const kind = b.dataset.kitei;
    download(
      kind === 'corp' ? '事務処理規程_法人用.txt' : '事務処理規程_個人事業主用.txt',
      new Blob(['﻿' + KITEI[kind]], { type: 'text/plain;charset=utf-8' })
    );
    toast('ひな形をダウンロードしました');
  };
});

/* ==========================================================
 * 同梱テキスト
 * ======================================================== */
const KITEI = {
  corp: `電子取引データの訂正及び削除の防止に関する事務処理規程

第1章 総則

（目的）
第1条 この規程は、電子計算機を使用して作成する国税関係帳簿書類の保存方法の特例に関する法律
第7条に定められた電子取引の取引情報に係る電磁的記録の保存義務を履行するため、
電子取引の取引情報の訂正及び削除を原則として禁止し、その真実性を確保することを目的とする。

（適用範囲）
第2条 この規程は、______（以下「当社」という。）のすべての役員及び従業員に適用する。

（管理責任者）
第3条 この規程の管理責任者は、______部______とする。

第2章 電子取引データの取扱い

（電子取引の範囲）
第4条 当社における電子取引の範囲は次のとおりとする。
 一 電子メールにより受領又は送付した請求書、領収書、契約書、見積書等
 二 取引先のウェブサイト又は電子取引システムを通じて授受した上記書類
 三 クレジットカード利用明細、交通系ICカードの利用履歴等の電磁的記録
 四 その他前各号に準ずるもの

（データの保存）
第5条 電子取引の取引情報に係る電磁的記録は、取引年月日、取引金額及び取引先を
検索の条件として設定できる状態で、所定の保存先に保存するものとする。

（訂正削除の原則禁止）
第6条 保存する電磁的記録の訂正及び削除は、原則として禁止する。

（訂正削除を行う場合）
第7条 業務処理上やむを得ない理由により保存されている電磁的記録を訂正又は削除する場合は、
管理責任者に対して「電磁的記録訂正・削除申請書」を提出し、承認を得た上で行うものとする。
2 前項の申請書及び承認の記録は、対象となった電磁的記録の保存期間と同一の期間保存する。
3 訂正又は削除を行った場合は、履歴として訂正削除の年月日、内容及び理由を記録する。

（管理責任者の責務）
第8条 管理責任者は、この規程の遵守状況を定期的に確認し、必要に応じて是正の措置を講ずる。

附則
（施行）
第9条 この規程は、______年______月______日から施行する。

─────────────────────────────────────────
※ 本ひな形は一般的な構成にならった参考例です。自社の実態に合わせて記載を調整のうえ、
   採用にあたっては顧問税理士又は所轄税務署にご確認ください。
   作成: 電帳ファイラー
`,
  solo: `電子取引データの訂正及び削除の防止に関する事務処理規程（個人事業主用）

（目的）
第1条 この規程は、電子計算機を使用して作成する国税関係帳簿書類の保存方法の特例に関する法律
第7条に定められた電子取引の取引情報に係る電磁的記録の保存義務を履行するため、
電子取引の取引情報の訂正及び削除を原則として禁止し、その真実性を確保することを目的とする。

（電子取引の範囲）
第2条 当方における電子取引の範囲は次のとおりとする。
 一 電子メールにより受領又は送付した請求書、領収書、契約書、見積書等
 二 取引先のウェブサイト又は電子取引システムを通じて授受した上記書類
 三 クレジットカード利用明細等の電磁的記録
 四 その他前各号に準ずるもの

（データの保存）
第3条 電子取引の取引情報に係る電磁的記録は、取引年月日、取引金額及び取引先を
検索の条件として設定できる状態で、所定の保存先に保存する。

（訂正削除の原則禁止）
第4条 保存する電磁的記録の訂正及び削除は、原則として行わない。

（訂正削除を行う場合）
第5条 やむを得ない理由により電磁的記録を訂正又は削除する場合は、
訂正削除の年月日、対象となった取引、内容及び理由を記録し、
当該記録を対象の電磁的記録と同一の期間保存する。

附則
（施行）
第6条 この規程は、______年______月______日から施行する。

氏名（屋号）: ______________________

─────────────────────────────────────────
※ 本ひな形は一般的な構成にならった参考例です。実態に合わせて記載を調整のうえ、
   採用にあたっては顧問税理士又は所轄税務署にご確認ください。
   作成: 電帳ファイラー
`,
};

const README_TXT = `このZIPについて（電帳ファイラーが作成）

■ 中身
 ・リネーム済みの電子取引データ（取引年月日_取引金額_取引先 の形式）
 ・索引簿.csv … 取引年月日・取引金額・取引先の一覧（Excelで開けます）
 ・訂正削除の防止に関する事務処理規程_ひな形.txt

■ 保存の手順
 1. このZIPを展開します。
 2. 展開したフォルダを、会計データの保存先（社内サーバ、クラウドストレージ等）に置きます。
 3. 事務処理規程は自社の内容に調整し、印刷または電子で備え付けてください。

■ 検索要件について
 ファイル名に「取引年月日・取引金額・取引先」を含めているため、
 OSのファイル検索でこの3項目による検索ができます。
 範囲指定検索・組合せ検索が必要な場合は、索引簿.csv を表計算ソフトで開き、
 オートフィルタ等をご利用ください。

■ ご注意
 本ツール及び同梱の文書は一般的な情報提供であり、税務アドバイスではありません。
 最終的な運用可否は顧問税理士又は所轄税務署にご確認ください。
`;

/* ==========================================================
 * 起動
 * ======================================================== */
render();
