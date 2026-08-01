# -*- coding: utf-8 -*-
"""
コース「ja-kanji-advanced」（上級漢字）の静的データパイプライン。
docs/new-courses-plan.md の Phase 5（コースC）＋ Phase 6（N5〜N1完全網羅化）。
build_ja_kanji_basic.py と同じ仕組みを、収録リストの選び方だけ差し替えて使う。

収録（Phase 6 で拡張した選定基準・合併集合）:
  A) 日本語3コース（ja-0-3k / ja-3-10k / ja-10-30k）で**10語以上に使われる漢字**
     （Phase 5・PLAN §4.1 の C-2 案。「上級語彙コースから抽出」という Kohei の指定どおり、
     自プロジェクトの語彙データでの実際の出現頻度を基準にした集合）
  B) kanji-data.json の tanos.co.uk 由来 jlpt_new が N3/N2/N1 の字すべて
     （Phase 6。Kohei から「基本漢字コース(N5+N4)＋上級漢字コースでN5〜N1を完全網羅したい」
     と指定されたため追加。Aだけだと自コース語彙での使用頻度が低いN2/N1の字が大量に漏れる
     ＝実測でN3は91%・N2は57%・N1は16%しか網羅できていなかった）
  のいずれかに該当し、基本漢字コース（ja-kanji-basic・N5+N4）に含まれない字。

意味の出所は基本漢字コースと同じ二段構え:
  1. 既存3コースの単字見出しグロスを流用
  2. 無ければ MANUAL_GLOSS（Workflow で並列翻訳→検証したタガログ語訳。
     Phase 5で392字・Phase 6で追加861字、生成手順は docs/new-courses-plan.md 参照）

使用例の出所も二段構え（Phase 6で追加）:
  1. 既存3コースの語彙に実際にその字を含む単語があれば、それを使う（Phase 5と同じ）
  2. 一切登場しない字（Phase 6で251字判明）は MANUAL_EXAMPLES
     （Workflowで実在する日本語単語を生成→実在性を検証したもの）を使う

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
MIN_WORD_COUNT = 10  # PLAN §4.1 C-2案：この語数以上で使われる字は無条件で収録
JLPT_COMPLETE_LEVELS = (3, 2, 1)  # Phase 6: この級はtanos.co.uk準拠で完全収録

KANJI_RE = re.compile(r"[一-龯]")

# Workflow（kanji-tagalog-translate / kanji-tagalog-translate-batch2）で生成し、
# 目視レビュー後にここへ貼った翻訳表。generate_manual_gloss.py が翻訳結果 JSON から
# このファイルを自動生成する（手打ちしない）。
try:
    from kanji_advanced_gloss import MANUAL_GLOSS
except ImportError:
    MANUAL_GLOSS = {}

# Workflow（kanji-example-words-generate）で生成した「自コース語彙に登場しない字」の
# 使用例表（実在する単語＋読み＋タガログ語訳）。generate_manual_examples.py が生成する。
try:
    from kanji_advanced_examples import MANUAL_EXAMPLES
except ImportError:
    MANUAL_EXAMPLES = {}


def already_covered_chars() -> set[str]:
    """基本漢字コースが既に収録している字（重複を避ける）。"""
    with open(f"{OUT}/{BASIC_COURSE_ID}/words-00000-01000.json", encoding="utf-8") as f:
        data = json.load(f)
    words = data["words"] if isinstance(data, dict) else data
    return {w["headword"] for w in words}


def jlpt_level_of(kanji_data: dict, ch: str) -> str | None:
    """級情報があれば表示用に残す（Stats タブの JLPT リングが読む）。
    N5/N4 相当は無いはず＝基本コースの収録字を除外済みのため。"""
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

    freq_chars = {ch for ch, n in word_count.items() if n >= MIN_WORD_COUNT}
    jlpt_chars = {
        ch for ch, info in kanji_data.items() if info.get("jlpt_new") in JLPT_COMPLETE_LEVELS
    }
    chars = list((freq_chars | jlpt_chars) - basic_chars)
    # 出現頻度（語数）が多い字から。同数のときは字そのもの（コードポイント）で決着させる
    # ＝ set の反復順（ハッシュ値依存で実行のたびに変わりうる）に並び順を委ねない。
    # frequencyRank・id はここでの並びで確定するため、非決定的だと再ビルドのたびに
    # 同じ字のIDが変わり、既存ユーザーの学習進捗（cardId で紐付け）が壊れる。
    chars.sort(key=lambda ch: (-word_count.get(ch, 0), ch))

    records = build_kanji_records(
        chars, kanji_data, single_gloss, usage_index, MANUAL_GLOSS,
        lambda ch: jlpt_level_of(kanji_data, ch),
        manual_examples=MANUAL_EXAMPLES,
    )
    for i, r in enumerate(records, start=1):
        r["frequencyRank"] = i
        del r["_freq"]

    empty_examples = [r["headword"] for r in records if not r.get("examples")]
    if empty_examples:
        raise SystemExit(
            f"{len(empty_examples)} 字が使用例ゼロ（自コース語彙にも MANUAL_EXAMPLES にも無い）: "
            f"{empty_examples[:20]}"
        )

    errors = validate_records(records)
    if errors:
        for e in errors[:20]:
            print(f"[error] {e}")
        raise SystemExit(f"{len(errors)} validation error(s)")

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese Kanji (JLPT N3–N1)",
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
                "note": "JLPT level classification for kanji. This course's selection combines "
                        "usage-frequency-based extraction with full N3-N1 coverage per this "
                        "classification (N5/N4 are covered by the basic kanji course).",
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

    generated_gloss = sum(1 for r in records if r["headword"] not in single_gloss)
    generated_examples = sum(1 for ch in chars if not (usage_index.get(ch)))
    from_freq = len(freq_chars - basic_chars)
    from_jlpt_only = len(chars) - from_freq
    print(f"[build_ja_kanji_advanced] {len(records)} kanji built "
          f"(usage-frequency: {from_freq}, JLPT-completeness-only: {from_jlpt_only}, "
          f"excluding {len(basic_chars)} basic chars), "
          f"{generated_gloss} with newly-translated gloss, "
          f"{generated_examples} with MANUAL_EXAMPLES (no corpus usage).")


if __name__ == "__main__":
    main()
