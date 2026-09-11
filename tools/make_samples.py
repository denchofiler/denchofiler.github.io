#!/usr/bin/env python3
"""検証用・配布用のサンプル証憑PDFを生成する（日本語CIDフォント使用）。"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
F = "HeiseiKakuGo-W5"
W, H = A4
OUT = os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(OUT, exist_ok=True)


def invoice(fname, *, title, to, issuer, issue_label, issue_date, due_label, due_date,
            items, tax_rate=0.10, total_label="ご請求金額", reg_no=None,
            addr=None, tel=None, bank=None, note=None):
    c = canvas.Canvas(os.path.join(OUT, fname), pagesize=A4)

    c.setFont(F, 20)
    c.drawCentredString(W / 2, H - 60, title)

    # 宛先（左上）
    c.setFont(F, 12)
    c.drawString(50, H - 110, f"{to} 御中")
    c.line(50, H - 116, 300, H - 116)

    # 発行元（右上）
    y = H - 105
    c.setFont(F, 11)
    c.drawString(350, y, issuer)
    c.setFont(F, 8)
    for line in filter(None, [reg_no and f"登録番号: {reg_no}", addr, tel]):
        y -= 13
        c.drawString(350, y, line)

    # 日付（左）
    c.setFont(F, 9)
    c.drawString(50, H - 140, f"{issue_label}: {issue_date}")
    if due_label:
        c.drawString(50, H - 154, f"{due_label}: {due_date}")

    subtotal = sum(q * u for _, q, u in items)
    tax = int(subtotal * tax_rate)
    total = subtotal + tax

    # 合計の大書き
    c.setFont(F, 13)
    c.drawString(50, H - 190, f"{total_label}")
    c.setFont(F, 17)
    c.drawString(180, H - 192, f"¥{total:,}-")
    c.line(50, H - 200, 330, H - 200)

    # 明細表
    y = H - 240
    c.setFont(F, 9)
    for label, x in [("品名", 55), ("数量", 330), ("単価", 400), ("金額", 480)]:
        c.drawString(x, y, label)
    c.line(50, y - 5, 545, y - 5)
    for name, qty, unit in items:
        y -= 20
        c.drawString(55, y, name)
        c.drawRightString(370, y, str(qty))
        c.drawRightString(455, y, f"{unit:,}")
        c.drawRightString(540, y, f"{qty * unit:,}")

    y -= 26
    c.line(350, y + 12, 545, y + 12)
    for label, val in [("小計", subtotal), (f"消費税({int(tax_rate*100)}%)", tax), ("合計", total)]:
        c.drawString(390, y, label)
        c.drawRightString(540, y, f"{val:,}")
        y -= 18

    if bank:
        c.setFont(F, 9)
        c.drawString(50, 120, f"お振込先: {bank}")
    if note:
        c.setFont(F, 8)
        c.drawString(50, 100, note)

    c.save()
    return total


def receipt(fname, *, to, issuer, date, amount, reason, reg_no=None, tel=None):
    c = canvas.Canvas(os.path.join(OUT, fname), pagesize=A4)
    c.setFont(F, 22)
    c.drawCentredString(W / 2, H - 70, "領収書")
    c.setFont(F, 10)
    c.drawRightString(545, H - 100, date)
    c.setFont(F, 13)
    c.drawString(60, H - 140, f"{to} 様")
    c.line(60, H - 146, 330, H - 146)
    c.setFont(F, 18)
    c.drawString(60, H - 190, f"金 {amount:,} 円")
    c.line(60, H - 198, 330, H - 198)
    c.setFont(F, 10)
    c.drawString(60, H - 225, f"但し {reason} として")
    c.drawString(60, H - 245, "上記正に領収いたしました")
    y = H - 300
    c.setFont(F, 11)
    c.drawString(340, y, issuer)
    c.setFont(F, 8)
    for line in filter(None, [reg_no and f"登録番号 {reg_no}", tel]):
        y -= 13
        c.drawString(340, y, line)
    c.save()


if __name__ == "__main__":
    invoice(
        "01_請求書_テスト工業.pdf",
        title="請求書", to="株式会社サンプル商事", issuer="テスト工業株式会社",
        issue_label="請求日", issue_date="2026年1月15日",
        due_label="お支払期限", due_date="2026年2月28日",
        items=[("Webサイト制作費", 1, 1000000), ("保守運用費", 1, 122334)],
        reg_no="T1234567890123", addr="〒150-0001 東京都渋谷区神宮前1-2-3",
        tel="TEL: 03-1234-5678", bank="みずほ銀行 渋谷支店 普通 1234567",
    )
    invoice(
        "02_請求書_ブルーオーシャン.pdf",
        title="ご請求書", to="合同会社ノースウインド", issuer="株式会社ブルーオーシャン",
        issue_label="発行日", issue_date="2026/02/03",
        due_label="支払期日", due_date="2026/03/31",
        items=[("コンサルティング業務 2月分", 1, 300000)],
        total_label="合計金額", reg_no="T2233445566778",
        addr="〒060-0001 札幌市中央区北1条西2-3", tel="TEL 011-222-3333",
    )
    invoice(
        "03_請求書_和暦.pdf",
        title="請求書", to="有限会社みどり印刷", issuer="株式会社オフィスサプライ北関東",
        issue_label="取引年月日", issue_date="令和8年3月2日",
        due_label="お支払期限", due_date="令和8年3月31日",
        items=[("コピー用紙 A4", 40, 3200), ("トナーカートリッジ", 6, 18500)],
        reg_no="T9876543210987", tel="電話 048-111-2222",
    )
    invoice(
        "04_請求書_繰越あり.pdf",
        title="請求書", to="株式会社クライアント", issuer="株式会社ヤマト商会",
        issue_label="発行日", issue_date="2026年4月30日",
        due_label="お支払期限", due_date="2026年5月31日",
        items=[("鋼材 SS400", 3, 150000)],
        note="前回請求額 9,800,000  入金額 9,800,000  繰越金額 0",
        reg_no="T5544332211009", tel="TEL 052-777-8888",
    )
    receipt(
        "05_領収書_オフィスサプライ.pdf",
        to="有限会社みどり印刷", issuer="株式会社オフィスサプライ北関東",
        date="令和8年3月2日", amount=550000, reason="印刷代",
        reg_no="T9876543210987", tel="電話 048-111-2222",
    )
    print("生成しました:", sorted(os.listdir(OUT)))
