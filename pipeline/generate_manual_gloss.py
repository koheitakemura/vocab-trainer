# -*- coding: utf-8 -*-
"""
kanji-tagalog-translate Workflow の翻訳結果 JSON から pipeline/kanji_advanced_gloss.py
（MANUAL_GLOSS dict）を自動生成する。手打ちしない。

使い方: python generate_manual_gloss.py <translations.json>
  translations.json: {"<kanji>": "<タガログ語グロス>", ...} 形式
"""
import json
import sys

OUT_PATH = "kanji_advanced_gloss.py"


def main() -> None:
    src_path = sys.argv[1]
    with open(src_path, encoding="utf-8") as f:
        translations: dict[str, str] = json.load(f)

    lines = [
        '# -*- coding: utf-8 -*-',
        '"""',
        'ja-kanji-advanced（上級漢字コース）の単字グロスのうち、既存3コースの単字見出しに',
        '無かった字のタガログ語訳。kanji-tagalog-translate Workflow（翻訳→検証の2段パイプライン）',
        'の出力から generate_manual_gloss.py で自動生成（手打ちではない）。',
        '"""',
        '',
        'MANUAL_GLOSS: dict[str, str] = {',
    ]
    for ch, gloss in translations.items():
        lines.append(f'    {ch!r}: {gloss!r},')
    lines.append('}')
    lines.append('')

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"[generate_manual_gloss] wrote {len(translations)} entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
