# -*- coding: utf-8 -*-
"""
コース「ja-katakana」（カタカナ語コース）の静的データパイプライン。

新規のデータ取得は一切行わない。既存の ja-0-3k / ja-3-10k の見出し語から
カタカナのみで書かれた語（外来語・擬態語等）を抽出し、頻度順に並べ替えて
新コースとして出力するだけ（PLAN §2: docs/new-courses-plan.md のコースA）。

抽出元には既にタガログ語グロス・例文・出典情報が付いているため、
そのまま流用する（訳の新規生成なし＝品質リスクを増やさない）。

出力: public/data/courses/ja-katakana/ 配下の静的 JSON（VocabCard[] 形状）
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, ".")
from emit import emit_course, validate_records

SRC_ROOT = "../public/data/courses"
OUT = "../public/data/courses"
COURSE_ID = "ja-katakana"

# 抽出元コース（この順で読む。同じ語が両方にあれば先に見つかった方＝より基礎的な帯を残す）
SOURCE_COURSES = ["ja-0-3k", "ja-3-10k"]

# 長音符「ー」を含むカタカナのみの見出し語（例: コーヒー）。中黒「・」を含む複合語
# （例: マクドナルド・コーポレーション）は対象外——1語として学習するには長すぎるため。
KATAKANA_ONLY = re.compile(r"^[ァ-ヴー]+$")


def load_course_words(course_id: str) -> list[dict]:
    words = []
    pattern = os.path.join(SRC_ROOT, course_id, "words-*.json")
    for path in sorted(glob.glob(pattern)):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        words.extend(data["words"] if isinstance(data, dict) else data)
    return words


def load_course_sources(course_id: str) -> list[dict]:
    with open(os.path.join(SRC_ROOT, course_id, "meta.json"), encoding="utf-8") as f:
        return json.load(f).get("sources", [])


def build_records() -> tuple[list[dict], list[dict]]:
    seen_headwords: set[str] = set()
    records = []
    sources_by_name: dict[str, dict] = {}

    for course_id in SOURCE_COURSES:
        words = load_course_words(course_id)
        for w in words:
            headword = w["headword"]
            if not KATAKANA_ONLY.match(headword):
                continue
            if headword in seen_headwords:
                continue  # 両コースに同じ語があれば、より基礎的な帯（先に読んだ方）を残す
            seen_headwords.add(headword)
            records.append({
                "headword": headword,
                "reading": w.get("reading") or headword,
                "gloss": w["gloss"],
                "pos": w.get("pos", "noun"),
                "examples": w.get("examples", []),
                # 元の頻度順位は帯をまたぐと連続しないので、抽出後に採番し直す
                # （下で frequencyRank 済みの元の並び順どおりソートしてから振る）。
                "_orig_rank": w.get("frequencyRank", 10**9),
            })
        for s in load_course_sources(course_id):
            sources_by_name[s["name"]] = s  # 出典元の重複を除去（ja-0-3k/ja-3-10k で同じ出典を使う）

    # 元コース内の頻度順を維持したまま、通し番号を振り直す
    records.sort(key=lambda r: r["_orig_rank"])
    for i, r in enumerate(records, start=1):
        r["frequencyRank"] = i
        del r["_orig_rank"]

    return records, list(sources_by_name.values())


def main() -> None:
    records, sources = build_records()
    errors = validate_records(records)
    if errors:
        for e in errors[:20]:
            print(f"[error] {e}")
        raise SystemExit(f"{len(errors)} validation error(s)")

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese Katakana Words",
        "learningLanguage": "Japanese",
        "glossLanguage": "Tagalog",
        "uiLanguage": "en",
        # 会話被覆率%が意味を持たない規模の導入コース。ja-kana と同じ扱いにすることで
        # coverage.ts のコード改修を不要にする（PLAN §5.2）。
        "type": "kana",
        "band": {"from": 0, "to": len(records)},
        "sources": sources,
    }
    emit_course(COURSE_ID, course_meta, records, OUT)

    cat_path = os.path.join(OUT, COURSE_ID, "categories.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump({}, f)

    with_examples = sum(1 for r in records if r["examples"])
    print(f"[build_ja_katakana] {len(records)} katakana words built "
          f"({with_examples} with examples, {len(sources)} source(s) inherited).")


if __name__ == "__main__":
    main()
