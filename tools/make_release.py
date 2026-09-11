#!/usr/bin/env python3
"""
納品用ZIPを作る。

macOS 同梱の `zip` コマンドは日本語ファイル名に UTF-8 フラグ(bit 11)を立てないため、
Windows で受け取った購入者のファイル名が文字化けする。
Python の zipfile は非ASCII名に自動でフラグを立てるので、こちらで作る。
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "product")
OUT = os.path.join(ROOT, "電帳ファイラー_製品版.zip")


def main():
    if not os.path.isdir(SRC):
        sys.exit("product/ がありません。先に `npm run build` を実行してください。")

    entries = []
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, dirnames, filenames in os.walk(SRC):
            dirnames[:] = [d for d in sorted(dirnames) if not d.startswith(".")]
            for name in sorted(filenames):
                if name.startswith("."):
                    continue
                full = os.path.join(dirpath, name)
                # ZIP 内は「電帳ファイラー/」配下に入れる
                rel = os.path.join("電帳ファイラー", os.path.relpath(full, SRC))
                z.write(full, rel)
                entries.append(rel)

    # 作ったZIPを読み直して、UTF-8フラグが立っているか必ず確認する
    with zipfile.ZipFile(OUT) as z:
        bad = [i.filename for i in z.infolist()
               if not i.filename.isascii() and not (i.flag_bits & 0x800)]
        if bad:
            sys.exit("UTF-8フラグが立っていないエントリがあります: %s" % bad)
        if z.testzip() is not None:
            sys.exit("ZIPの整合性チェックに失敗しました")

    size = os.path.getsize(OUT) / 1024
    print("作成しました: %s (%.0f KB, %d ファイル)" % (os.path.basename(OUT), size, len(entries)))
    for e in entries:
        print("  ", e)


if __name__ == "__main__":
    main()
