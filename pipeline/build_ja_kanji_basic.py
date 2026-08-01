# -*- coding: utf-8 -*-
"""
コース「ja-kanji-basic」（基本漢字・JLPT N5+N4）の静的データパイプライン。
docs/new-courses-plan.md の Phase 3〜4（コースB）。

収録: kanji-data.json（davidluzgouveia/kanji-data、MIT）で jlpt_new が 4 または 5 の漢字。
カード内容: 意味（タガログ語）＋読み＋使用例をすべて載せる（Kohei 指定）。

意味の出所は二段構え（PLAN §3.5）:
  1. 既存の日本語3コースにその字が単字見出し語として存在すれば、そのタガログ語グロスを流用
  2. 無ければ下の MANUAL_GLOSS（KANJIDIC の英語 meaning を Kohei プロジェクト方針に沿って
     タガログ語へ人手翻訳した表）を使う。対訳コーパス由来ではないため、他コースの手書き例文と
     同様 aiGenerated 相当の扱い（examples 同様、ネイティブレビュー前提。判断ログ#18）。

出力: public/data/courses/ja-kanji-basic/ 配下の静的 JSON（VocabCard[] 形状）
"""
import sys

sys.path.insert(0, ".")
from emit import emit_course, validate_records
from kanji_common import (
    build_kanji_records,
    build_kanji_usage_index,
    build_single_kanji_gloss_index,
    load_all_course_words,
    load_kanji_data,
)

OUT = "../public/data/courses"
COURSE_ID = "ja-kanji-basic"

# KANJIDIC の英語 meaning を人手でタガログ語に訳した表（既存の単字グロスで賄えない59字ぶん）。
# 生成時に「対応表のどちらにも無い字」を検出して落ちる仕組みなので、収録漢字が増えても
# 訳し忘れは静かに欠落しない（kanji_common.build_kanji_records 参照）。
MANUAL_GLOSS = {
    "見": "tingnan; makita",
    "入": "pumasok; ilagay",
    "書": "sumulat",
    "電": "kuryente; elektrisidad",
    "聞": "makinig; magtanong",
    "読": "magbasa",
    "休": "magpahinga; pahinga",
    "自": "sarili",
    "立": "tumayo",
    "開": "magbukas; bukas",
    "明": "maliwanag",
    "意": "kaisipan; layunin",
    "強": "malakas",
    "持": "hawakan; magdala",
    "以": "sa pamamagitan ng",
    "思": "mag-isip",
    "安": "mura; ligtas",
    "院": "institusyon",
    "界": "daigdig; hangganan",
    "教": "magturo",
    "近": "malapit",
    "考": "mag-isip; pag-isipan",
    "売": "magbenta",
    "知": "malaman; alam",
    "集": "magtipon",
    "使": "gamitin",
    "特": "espesyal",
    "始": "magsimula",
    "広": "malawak",
    "少": "kaunti",
    "工": "gawa; konstruksyon",
    "建": "magtayo",
    "止": "tumigil",
    "送": "ipadala",
    "切": "putulin",
    "転": "umikot",
    "研": "pag-aralan",
    "究": "pananaliksik",
    "起": "gumising; bumangon",
    "待": "maghintay",
    "試": "subukan",
    "族": "angkan; lahi",
    "映": "ipakita; salamin",
    "験": "pagsusuri; eksperimento",
    "仕": "maglingkod",
    "去": "umalis; nakaraan",
    "写": "kopyahin",
    "帰": "umuwi",
    "買": "bumili",
    "屋": "tindahan; bahay",
    "走": "tumakbo",
    "習": "matuto",
    "洋": "dagat; kanluranin",
    "借": "humiram",
    "曜": "araw ng linggo",
    "飲": "uminom",
    "貸": "magpahiram",
    "勉": "sikap; masipag",
    "漢": "Tsina; Han",
}


def jlpt_level_of(kanji_data: dict, ch: str) -> str:
    return "N5" if kanji_data[ch]["jlpt_new"] == 5 else "N4"


def main() -> None:
    kanji_data = load_kanji_data()
    words = load_all_course_words()
    single_gloss = build_single_kanji_gloss_index(words)
    usage_index = build_kanji_usage_index(words)

    chars = [ch for ch, info in kanji_data.items() if info.get("jlpt_new") in (4, 5)]
    # N5 を先に、同級内は KANJIDIC の frequency（freq が小さいほど高頻度）順
    chars.sort(key=lambda ch: (kanji_data[ch]["jlpt_new"] != 5, kanji_data[ch].get("freq") or 99999))

    records = build_kanji_records(
        chars, kanji_data, single_gloss, usage_index, MANUAL_GLOSS,
        lambda ch: jlpt_level_of(kanji_data, ch),
    )
    records.sort(key=lambda r: r["_freq"])  # 既に chars の順で並んでいるが明示的に保つ
    for i, r in enumerate(records, start=1):
        r["frequencyRank"] = i
        del r["_freq"]

    errors = validate_records(records)
    if errors:
        for e in errors[:20]:
            print(f"[error] {e}")
        raise SystemExit(f"{len(errors)} validation error(s)")

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese Kanji (JLPT N5–N4)",
        "learningLanguage": "Japanese",
        "glossLanguage": "Tagalog",
        "uiLanguage": "en",
        "type": "kana",  # 会話被覆率%が意味を持たない規模のコース。ja-kana と同じ扱い（PLAN §5.2）
        "band": {"from": 0, "to": len(records)},
        "sources": [
            {
                "name": "KANJIDIC",
                "url": "http://www.edrdg.org/wiki/index.php/KANJIDIC_Project",
                "license": "EDRDG licence",
                "note": "Readings, meanings and stroke counts. Property of the Electronic "
                        "Dictionary Research and Development Group (EDRDG).",
            },
            {
                "name": "Jonathan Waller's JLPT Resources (tanos.co.uk)",
                "url": "https://www.tanos.co.uk/jlpt/",
                "license": "CC BY",
                "note": "JLPT level classification for kanji.",
            },
            {
                "name": "kanji-data by David Gouveia",
                "url": "https://github.com/davidluzgouveia/kanji-data",
                "license": "MIT",
                "note": "Combined KANJIDIC readings/meanings with tanos.co.uk JLPT levels "
                        "into a single structured dataset; used as the data source for this course.",
            },
        ],
    }
    emit_course(COURSE_ID, course_meta, records, OUT)

    cat_path = f"{OUT}/{COURSE_ID}/categories.json"
    with open(cat_path, "w", encoding="utf-8") as f:
        import json
        json.dump({}, f)

    n5 = sum(1 for r in records if r["jlptLevel"] == "N5")
    n4 = sum(1 for r in records if r["jlptLevel"] == "N4")
    generated = sum(1 for r in records if r["headword"] not in single_gloss)
    print(f"[build_ja_kanji_basic] {len(records)} kanji built (N5={n5}, N4={n4}), "
          f"{generated} with newly-translated gloss.")


if __name__ == "__main__":
    main()
