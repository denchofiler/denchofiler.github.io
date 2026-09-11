/**
 * 条件を満たすまで待ってからスクリーンショットを撮る。
 *
 * Chrome の --virtual-time-budget は setTimeout で仮想時計が進むため、
 * PDF解析のような実CPU処理が終わる前に撮影が打ち切られる。
 * そこで DevTools Protocol で接続し、指定した条件が真になるまで待ってから撮る。
 *
 *   node tools/shoot.mjs <url> <out.png> <待機条件のJS式> [幅] [高さ] [倍率]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, readyExpr, w = '1180', h = '1200', scale = '2'] = process.argv.slice(2);
if (!url || !out || !readyExpr) {
  console.error('使い方: node tools/shoot.mjs <url> <out.png> <待機条件> [幅] [高さ] [倍率]');
  process.exit(1);
}

const PORT = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${w},${h}`,
  `--force-device-scale-factor=${scale}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  throw new Error('Chrome の DevTools に接続できませんでした');
}

const ws = new WebSocket(await targetUrl());
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });

  // 条件が真になるまで最大60秒待つ
  let ready = false;
  for (let i = 0; i < 300; i++) {
    await sleep(200);
    try { ready = Boolean(await evaluate(`(() => { try { return (${readyExpr}); } catch { return false; } })()`)); }
    catch { /* ナビゲーション中 */ }
    if (ready) break;
  }
  if (!ready) throw new Error(`待機条件が満たされませんでした: ${readyExpr}`);

  await sleep(400); // 描画の落ち着きを待つ

  // 第7引数にCSSセレクタを渡すと、その要素だけを切り出す
  const clipSel = process.argv[8];
  let clip;
  if (clipSel) {
    const box = await evaluate(`(() => {
      const e = document.querySelector(${JSON.stringify(clipSel)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    })()`);
    if (!box) throw new Error(`切り出す要素が見つかりません: ${clipSel}`);
    clip = { ...box, scale: Number(scale) };
  }

  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}),
  });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`撮影しました: ${out}`);
} finally {
  ws.close();
  chrome.kill();
}
