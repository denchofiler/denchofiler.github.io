# 電帳ファイラー

電子帳簿保存法の「検索要件」に対応する、ブラウザ内完結のファイル整理ツール。

PDFをドロップすると **取引年月日・取引金額・取引先** を自動で読み取り、
検索要件を満たすファイル名への一括変更と、索引簿CSVの作成を行います。
ファイルは外部に送信されず、すべてブラウザの中だけで処理します。

---

## まず読むもの

| 目的 | ファイル |
|---|---|
| **今すぐ何をすればいいか** | [docs/90日実行計画.md](docs/90日実行計画.md) ← ここから |
| 事業の全体像・価格・戦略の根拠 | [docs/事業計画.md](docs/事業計画.md) |
| BASEに貼る特商法表記 | [docs/特商法表記.md](docs/特商法表記.md) |
| 商品説明文・キャッチコピー | [marketing/販売文.md](marketing/販売文.md) |
| 告知文の下書き | [marketing/告知案.md](marketing/告知案.md) |

## コマンド

```bash
npm test      # 自動テスト（38件）
npm run build # 製品版・無料版のHTMLを生成
npm run site  # 公開用サイト（site/）を生成
npm run release # 納品用ZIPを作成して検証
```

## 構成

```
src/        製品のソース（parser.js が読み取りの本体）
tests/      自動テスト
vendor/     pdf.js と 日本語cMap（Apache-2.0）
build.js    単一HTMLへのビルド
tools/      サンプルPDF生成・納品ZIP作成・スクリーンショット撮影
product/    製品版（納品物）
demo/       無料版
lp/         販売ページのソース
site/        公開用サイト（GitHub Pages にそのまま置ける）
docs/       事業計画・実行計画
```

## ライセンス

製品コードは著作権者に帰属。PDFの読み取りに [pdf.js](https://github.com/mozilla/pdf.js)（Apache License 2.0）を利用しています。
