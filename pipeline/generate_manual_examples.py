# -*- coding: utf-8 -*-
"""
kanji-example-words-generate Workflow の出力から pipeline/kanji_advanced_examples.py
（MANUAL_EXAMPLES dict）を自動生成する。手打ちしない。

使い方: python generate_manual_examples.py <examples.json>
  examples.json: {"<kanji>": [{"headword": ..., "reading": ..., "gloss": ...}, ...], ...} 形式
"""
import json
import sys

OUT_PATH = "kanji_advanced_examples.py"


def main() -> None:
    src_path = sys.argv[1]
    with open(src_path, encoding="utf-8") as f:
        examples: dict[str, list[dict]] = json.load(f)

    lines = [
        '# -*- coding: utf-8 -*-',
        '"""',
        'ja-kanji-advanced（上級漢字コース）のうち、既存3コースの語彙に一切登場しない字の',
        '使用例（実在する単語＋読み＋タガログ語訳）。kanji-example-words-generate Workflow',
        '（生成→実在性検証の2段パイプライン）の出力から generate_manual_examples.py で',
        '自動生成（手打ちではない）。',
        '"""',
        '',
        'MANUAL_EXAMPLES: dict[str, list[dict]] = {',
    ]
    for ch, words in examples.items():
        if not words:
            continue
        entries = ", ".join(
            "{" + f"'headword': {w['headword']!r}, 'reading': {w['reading']!r}, 'gloss': {w['gloss']!r}" + "}"
            for w in words
        )
        lines.append(f'    {ch!r}: [{entries}],')
    lines.append('}')
    lines.append('')

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    total_words = sum(len(w) for w in examples.values())
    print(f"[generate_manual_examples] wrote {len(examples)} kanji ({total_words} words) to {OUT_PATH}")


if __name__ == "__main__":
    main()
