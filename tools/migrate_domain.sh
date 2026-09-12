#!/usr/bin/env bash
#
# 公開URLを移す。
#
#   ./tools/migrate_domain.sh https://denchofiler.github.io denchofiler/denchofiler.github.io
#   ./tools/migrate_domain.sh https://denchofiler.com       denchofiler/denchofiler.github.io
#
# 第1引数 NEW_URL  : 新しい公開URL（末尾スラッシュなし）
# 第2引数 NEW_REPO : owner/repo（省略時は現在の設定を維持）
#
# サイトはサブパス `/dencho-filer/` からルート `/` へ移る。
# そのため「絶対URL」と「ルート相対パス」の両方を書き換える必要がある。
# site/ は生成物なので触らない（あとで build し直す）。
#
set -euo pipefail
cd "$(dirname "$0")/.."

NEW_URL="${1:?使い方: migrate_domain.sh <新URL> [owner/repo]}"
NEW_URL="${NEW_URL%/}"
NEW_REPO="${2:-}"

OLD_URL="https://9q6xtwz22p-cmd.github.io/dencho-filer"
OLD_PATH="/dencho-filer/"
DRY="${DRY_RUN:-0}"

# 生成物とバイナリを除いた「原本」だけを対象にする
targets() {
  grep -rl -e "$OLD_URL" -e "$OLD_PATH" \
    --include="*.md" --include="*.html" --include="*.json" \
    --include="*.mjs" --include="*.js" --include="*.sh" . 2>/dev/null \
    | grep -v "^./site/" | grep -v "^./node_modules/" | grep -v "^./vendor/" \
    | grep -v "migrate_domain.sh" | sort   # 自分自身は書き換えない（実行中に定数が壊れる）
}

echo "▶ 移行先: $NEW_URL"
[ -n "$NEW_REPO" ] && echo "▶ リポジトリ: $NEW_REPO"
echo

total=0
for f in $(targets); do
  n=$(grep -c -e "$OLD_URL" -e "$OLD_PATH" "$f" || true)
  printf "  %-56s %s行\n" "$f" "$n"
  total=$((total + n))
  if [ "$DRY" != "1" ]; then
    # 絶対URLを先に処理する。順番を逆にすると
    # ".../dencho-filer/tool/" の中のサブパスだけが先に置換されて壊れる。
    python3 - "$f" "$OLD_URL" "$NEW_URL" "$OLD_PATH" <<'PY'
import io, sys
path, old_url, new_url, old_path = sys.argv[1:5]
s = io.open(path, encoding='utf-8').read()
s = s.replace(old_url, new_url)      # 絶対URL
s = s.replace(old_path, '/')         # ルート相対パス
io.open(path, 'w', encoding='utf-8').write(s)
PY
  fi
done
echo
echo "  合計 ${total}行"

if [ "$DRY" = "1" ]; then
  echo
  echo "（DRY_RUN=1 のため書き換えていません）"
  exit 0
fi

# deploy.sh のリポジトリ指定
if [ -n "$NEW_REPO" ]; then
  python3 - "$NEW_REPO" "$NEW_URL" <<'PY'
import io, re, sys
repo, url = sys.argv[1], sys.argv[2]
p = 'tools/deploy.sh'
s = io.open(p, encoding='utf-8').read()
s = re.sub(r'^REPO="[^"]*"', f'REPO="{repo}"', s, flags=re.M)
s = re.sub(r'^URL="[^"]*"',  f'URL="{url}/"',  s, flags=re.M)
io.open(p, 'w', encoding='utf-8').write(s)
PY
  echo "▶ deploy.sh を更新しました"
fi

# Search Console の所有権確認は新しいプロパティで取り直しになる。
# 古いトークンを残すと確認済みだと誤解するので空にする。
python3 - "$NEW_URL" <<'PY'
import io, json, sys
p = 'site.config.json'
c = json.load(io.open(p, encoding='utf-8'))
c['siteUrl'] = sys.argv[1]
c['googleSiteVerification'] = ''   # 新プロパティで取り直す
io.open(p, 'w', encoding='utf-8').write(json.dumps(c, ensure_ascii=False, indent=2) + '\n')
PY
echo "▶ site.config.json を更新しました（GSCトークンは空に戻しました）"

# 独自ドメインの場合は CNAME が要る。github.io ならあってはいけない。
case "$NEW_URL" in
  *.github.io) rm -f lp/CNAME site/CNAME 2>/dev/null || true ;;
  *) echo "${NEW_URL#https://}" > lp/CNAME
     echo "▶ lp/CNAME を作成しました（独自ドメイン用）" ;;
esac

echo
echo "残りの手順:"
echo "  1. git remote set-url origin https://github.com/${NEW_REPO:-<owner/repo>}.git"
echo "  2. npm test && node tools/build_site.mjs"
echo "  3. bash tools/deploy.sh"
echo "  4. Search Console で新プロパティを追加し、確認タグを site.config.json に入れて再デプロイ"
