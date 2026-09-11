#!/bin/bash
#
# site/ の中身を gh-pages ブランチのルートとして公開する。
#
# GitHub Pages はソースに「/」か「/docs」しか選べないため、
# site/ を直接ソース指定することはできない。そこで site/ だけを
# 切り出したコミットを作り、gh-pages ブランチへ force push する。
#
# 注意: git subtree split の出力には進捗表示の復帰文字(\r)が混ざるため、
#       そのまま refspec に使うとSHAが壊れる。必ず除去すること。
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="9q6xtwz22p-cmd/dencho-filer"
URL="https://9q6xtwz22p-cmd.github.io/dencho-filer/"

echo "▶ サイトを生成しています…"
npm run --silent site

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "サイト更新"
  echo "▶ 変更をコミットしました"
fi

echo "▶ main を push しています…"
git push -q origin main

echo "▶ site/ を gh-pages に反映しています…"
SHA=$(git subtree split --prefix site main 2>/dev/null | tr -d '\r[:space:]' | tail -c 41)
if [ ${#SHA} -ne 40 ]; then
  echo "エラー: site/ のコミットSHAを取得できませんでした (取得値: '$SHA')" >&2
  exit 1
fi
git push -q --force origin "${SHA}:refs/heads/gh-pages"

echo
echo "✓ 公開しました: $URL"
echo "  反映まで1〜2分かかります。"
echo "  公開状態の確認: gh api repos/$REPO/pages/builds/latest --jq '.status'"
