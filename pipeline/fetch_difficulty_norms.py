# -*- coding: utf-8 -*-
"""コース A（en-10-30k）の「簡単すぎる語」除去に使う難易度規範データを取得する。

判断ログ#34: 判断ログ#32 の193語手動除去は症状対処だった。根本原因は既知語底面が
NGSL+NAWL の 3,772語しかないこと——「10,000語から」を名乗るコースの足切りが実質
3,772語なので、3,772〜10,000相当の約6,000語が構造的に混入する。
#32 は「zipfは学習者の難易度ではなくコーパス出現頻度を測る指標」と正しく結論したが、
その先の「では何で測るのか」が空白だった。本スクリプトはその空白を埋める外部データを取る。

取得するもの:
  AoA (Kuperman et al. 2012, 51,715語)
      習得年齢。carrot/spoon/puppy のような「幼児期に覚えるが大人のコーパスでは
      低頻度」＝zipfが原理的に分離できない語を唯一直接測れる指標。
  Word Prevalence (Brysbaert et al. 2019, 61,853語)
      その語を知っている人の割合。**単独の除去フィルタとしては使わない**——実測で
      ambiguous/cynical/endorse/compassion/treason のようなL2学習者に必要な語を
      大量に巻き込むことが判明した（prevalenceもAoAもネイティブの習得を測る指標で
      L2学習者の難易度とは別軸。#32のzipfと同じ罠が一段深いところにもう一つあった）。
      ここでは「英語の実在レンマかどうか」の判定（F5）と容疑スコアの加点にのみ使う。
  US Census 2010 姓リフト (162,254姓・パブリックドメイン)
      **自動削除には使わない**——上位姓には angel/archer/bacon/baker/berry/bishop/
      cherry/fox/frost/grace のような普通名詞が大半を占めるため。AIレビューへ渡す
      容疑シグナル専用。

ライセンス注意: AoA / prevalence は CRR (Ghent) の CC BY-NC-SA 4.0（非商用）。
出力先の pipeline/raw/ は .gitignore 済みなので public リポジトリには入らない。
これらはビルド時フィルタとしてのみ参照し、データ自体も派生物も配布しない
（成果物として残るのは「除外した英単語のリスト」＝事実の列挙のみ）。

実行: python fetch_difficulty_norms.py
"""
import io
import json
import os
import urllib.request
import zipfile

NORMS_DIR = "raw/norms"
UA = {"User-Agent": "Mozilla/5.0"}

# 2026-08-01 時点で生存を実測確認したURL。
# crr.ugent.be/papers/AoA_51715_words.zip は404になっているため OSF ミラーを使う。
SOURCES = {
    "AoA_51715_words.xlsx": "https://osf.io/download/6kauf/",
    "English_Word_Prevalences.xlsx": "https://osf.io/download/nbu9e/",
}
CENSUS_SURNAMES_URL = "https://www2.census.gov/topics/genealogy/2010surnames/names.zip"
SURNAME_MIN_COUNT = 20_000  # 上位1,797姓。これ以下は普通名詞との衝突ばかりで信号にならない


def log(msg: str) -> None:
    print(f"[fetch_difficulty_norms] {msg}", flush=True)


def download(url: str, dest: str) -> bytes:
    if os.path.exists(dest):
        log(f"skip (already cached): {dest}")
        return open(dest, "rb").read()
    log(f"downloading {url} -> {dest}")
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
    with open(dest, "wb") as f:
        f.write(data)
    log(f"  {len(data):,} bytes")
    return data


def main():
    os.makedirs(NORMS_DIR, exist_ok=True)

    for fname, url in SOURCES.items():
        download(url, f"{NORMS_DIR}/{fname}")

    surname_json = f"{NORMS_DIR}/us_surnames.json"
    if os.path.exists(surname_json):
        log(f"skip (already cached): {surname_json}")
    else:
        import csv

        raw = download(CENSUS_SURNAMES_URL, f"{NORMS_DIR}/us_surnames_raw.zip")
        z = zipfile.ZipFile(io.BytesIO(raw))
        csv_name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        rows = csv.DictReader(io.TextIOWrapper(z.open(csv_name), encoding="utf-8", errors="replace"))
        names = sorted(
            r["name"].strip().lower()
            for r in rows
            if r.get("count", "").isdigit() and int(r["count"]) >= SURNAME_MIN_COUNT
        )
        with open(surname_json, "w", encoding="utf-8") as f:
            json.dump(names, f)
        log(f"us_surnames.json: count>={SURNAME_MIN_COUNT:,} の姓 {len(names)}件")

    log("Done. (pipeline/raw/ は .gitignore 済み＝これらは commit されない)")


if __name__ == "__main__":
    main()
