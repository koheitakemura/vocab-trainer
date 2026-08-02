# -*- coding: utf-8 -*-
"""
共通の出力エミッタ。joined word レコード（dict のリスト）を
src/types.ts の VocabCard[] と厳密に一致する JSON に変換し、
public/data/courses/<courseId>/ に 1k帯ごとの静的ファイルとして書き出す。

レコード形状（呼び出し側が用意する）:
{
  "headword": str, "reading": str, "gloss": str, "pos": str,
  "examples": [{"text": str, "translation": str}, ...],
  "frequencyRank": int, "jlptLevel": "N5"|"N4"|"N3"|"N2"|"N1"|None,
}
"""
import json
import os

from card_id import assign_ids

BAND_SIZE = 1000


def band_filename(band_index: int, band_start: int = 0) -> str:
    lo = (band_index + band_start) * BAND_SIZE
    hi = lo + BAND_SIZE
    return f"words-{lo:05d}-{hi:05d}.json"


def emit_course(
    course_id: str,
    course_meta: dict,
    records: list[dict],
    out_root: str,
    band_start: int = 0,
) -> list[dict]:
    """records は frequencyRank 昇順である前提。**採番済みの cards を返す**。

    id は並び位置からではなく cardId レジストリ（pipeline/id_registry/）から引く。
    既存語は同じ ID を再利用し、新語だけ新しい番号を採る＝語彙を作り直しても
    学習進捗の紐付けが壊れない（card_id.py の冒頭を参照）。
    戻り値を返すのは、categories.json を書く build_*.py が同じ採番式を手書きで
    再実装しなくて済むようにするため（コピーが増えるとドリフト源になる）。

    band_start: 出力ファイル名の帯オフセット（既定0＝words-00000-01000.json...）。
    絶対頻度ランクが0始まりでない帯（例: コースE=10001始まり）は band_start=10 を渡すと
    words-10000-11000.json... の命名になる。既存呼び出し側（band_start省略）の出力は不変。
    """
    out_dir = os.path.join(out_root, course_id)
    os.makedirs(out_dir, exist_ok=True)

    card_ids, _report = assign_ids(course_id, records)

    cards = []
    for i, r in enumerate(records, start=1):
        card = {
            "id": card_ids[i - 1],
            "courseId": course_id,
            "headword": r["headword"],
            "reading": r.get("reading") or None,
            "gloss": r["gloss"],
            "pos": r["pos"],
            "examples": r.get("examples", []),
            "frequencyRank": r.get("frequencyRank", i),
            "jlptLevel": r.get("jlptLevel"),
        }
        # 'band' は VocabCard 型には無い任意の付加情報（絶対頻度帯の整数値）。
        # レコードに無ければ既存コース(C/D/B)と全く同じ出力形状を保つ（キー自体を出さない）。
        if r.get("band") is not None:
            card["band"] = r["band"]
        cards.append(card)

    bands = []
    for band_index in range(0, (len(cards) + BAND_SIZE - 1) // BAND_SIZE or 1):
        chunk = cards[band_index * BAND_SIZE : (band_index + 1) * BAND_SIZE]
        if not chunk:
            continue
        fname = band_filename(band_index, band_start)
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, indent=None, separators=(",", ":"))
        bands.append(fname)

    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(course_meta, f, ensure_ascii=False, indent=2)

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"bands": bands, "wordCount": len(cards)}, f, ensure_ascii=False, indent=2)

    print(f"[emit] {course_id}: {len(cards)} words -> {len(bands)} band file(s) in {out_dir}")
    return cards


def validate_records(records: list[dict]) -> list[str]:
    """必須フィールド・型の軽量チェック。エラーメッセージのリストを返す（空=OK）。"""
    errors = []
    for i, r in enumerate(records):
        for field in ("headword", "gloss", "pos"):
            if not r.get(field):
                errors.append(f"record[{i}] missing/empty required field: {field}")
        if "examples" in r and not isinstance(r["examples"], list):
            errors.append(f"record[{i}] examples must be a list")
        for ex in r.get("examples", []):
            if not ex.get("text") or not ex.get("translation"):
                errors.append(f"record[{i}] example missing text/translation: {ex}")
    return errors
