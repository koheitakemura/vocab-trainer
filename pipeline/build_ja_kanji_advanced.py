# -*- coding: utf-8 -*-
"""
コース「ja-kanji-advanced」（上級漢字）の静的データパイプライン。
docs/new-courses-plan.md の Phase 5（コースC）。build_ja_kanji_basic.py と同じ仕組みを、
収録リストの選び方だけ差し替えて使う。

収録: 日本語3コース（ja-0-3k / ja-3-10k / ja-10-30k）で**10語以上に使われる漢字**のうち、
基本漢字コース（ja-kanji-basic・JLPT N5+N4）に含まれない字（PLAN §4.1 の C-2 案）。
「上級語彙コースから抽出」という Kohei の指定どおり、選定基準は JLPT 級ではなく
自プロジェクトの語彙データでの実際の出現頻度にしている。

意味の出所は基本漢字コースと同じ二段構え:
  1. 既存3コースの単字見出しグロスを流用
  2. 無ければ MANUAL_GLOSS（Workflow で並列翻訳→検証したタガログ語訳。
     生成手順は docs/new-courses-plan.md の Phase 5 実施記録を参照）

出力: public/data/courses/ja-kanji-advanced/ 配下の静的 JSON（VocabCard[] 形状）
"""
import glob
import json
import re
import sys
from collections import Counter

sys.path.insert(0, ".")
from emit import emit_course, validate_records
from kanji_common import (
    build_examples_field,
    build_kanji_records,
    build_kanji_usage_index,
    build_single_kanji_gloss_index,
    load_all_course_words,
    load_kanji_data,
)

OUT = "../public/data/courses"
COURSE_ID = "ja-kanji-advanced"
BASIC_COURSE_ID = "ja-kanji-basic"
MIN_WORD_COUNT = 10  # PLAN §4.1 C-2案：この語数以上で使われる字だけを収録

KANJI_RE = re.compile(r"[一-龯]")

# Workflow（kanji-tagalog-translate）で生成し、目視レビュー後にここへ貼った翻訳表。
# generate_manual_gloss.py が翻訳結果 JSON からこのファイルを自動生成する（手打ちしない）。
try:
    from kanji_advanced_gloss import MANUAL_GLOSS
except ImportError:
    MANUAL_GLOSS = {}


def already_covered_chars() -> set[str]:
    """基本漢字コースが既に収録している字（重複を避ける）。"""
    with open(f"{OUT}/{BASIC_COURSE_ID}/words-00000-01000.json", encoding="utf-8") as f:
        data = json.load(f)
    words = data["words"] if isinstance(data, dict) else data
    return {w["headword"] for w in words}


def jlpt_level_of(kanji_data: dict, ch: str) -> str | None:
    """上級コースは JLPT 級での絞り込みをしていないが、級情報があれば表示用に残す
    （Stats タブの JLPT リングは N5〜N1 を計算するので、N3/N2/N1 に該当する字は
    級バッジの対象になる。N5/N4 相当は無いはず＝基本コースの収録字を除外済みのため）。"""
    lvl = kanji_data[ch].get("jlpt_new")
    return f"N{lvl}" if lvl else None


def main() -> None:
    kanji_data = load_kanji_data()
    words = load_all_course_words()
    single_gloss = build_single_kanji_gloss_index(words)
    usage_index = build_kanji_usage_index(words)
    basic_chars = already_covered_chars()

    word_count = Counter()
    for w in words:
        for ch in set(w["headword"]):
            if KANJI_RE.match(ch):
                word_count[ch] += 1

    chars = [ch for ch, n in word_count.items() if n >= MIN_WORD_COUNT and ch not in basic_chars]
    chars.sort(key=lambda ch: -word_count[ch])  # 出現頻度（語数）が多い字から

    records = build_kanji_records(
        chars, kanji_data, single_gloss, usage_index, MANUAL_GLOSS,
        lambda ch: jlpt_level_of(kanji_data, ch),
    )
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
        "title": "Japanese Kanji (Advanced)",
        "learningLanguage": "Japanese",
        "glossLanguage": "Tagalog",
        "uiLanguage": "en",
        "type": "kana",
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
                "note": "JLPT level classification for kanji (shown when available; "
                        "this course's selection itself is based on usage frequency, not JLPT level).",
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
        json.dump({}, f)

    generated = sum(1 for r in records if r["headword"] not in single_gloss)
    missing_gloss = [ch for ch in chars if ch not in single_gloss and ch not in MANUAL_GLOSS]
    if missing_gloss:
        print(f"[warn] {len(missing_gloss)} 字が MANUAL_GLOSS に無いため build_kanji_records で例外になっているはず: "
              f"{missing_gloss[:20]}")
    print(f"[build_ja_kanji_advanced] {len(records)} kanji built "
          f"(threshold={MIN_WORD_COUNT}+ words, excluding {len(basic_chars)} basic chars), "
          f"{generated} with newly-translated gloss.")


if __name__ == "__main__":
    main()
