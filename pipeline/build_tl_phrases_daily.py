# -*- coding: utf-8 -*-
"""
コース「タガログ語 日常フレーズ集」（tl-phrases-daily）の本ビルド。

pipeline/data/tl-phrases-daily/final_cards.json（450件・Phase 3の多段検証済み）を
public/data/courses/tl-phrases-daily/ へ出力する。

このスクリプトは**純関数**（ヒューリスティック推定・重複間引き・定員切り捨てを持たない）。
tl-0-2k で発覚した「中間データと出荷物の非同期」（pipeline/raw が .gitignore 対象で
検知できなかった問題）を繰り返さないため、ソースは pipeline/data/tl-phrases-daily/
（git 管理下）に固定し、入力が想定外なら黙って調整せず落ちるようにする。

使い方:
  python build_tl_phrases_daily.py          通常ビルド（public/data に出力）
  python build_tl_phrases_daily.py --check  一時ディレクトリに再ビルドし、
                                             出荷済みとバイト単位で比較する（冪等性の証明）
"""
import filecmp
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, ".")
from emit import emit_course  # noqa: E402

DATA_DIR = "data/tl-phrases-daily"
OUT = "../public/data/courses"
COURSE_ID = "tl-phrases-daily"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_final_cards() -> list[dict]:
    with open(f"{DATA_DIR}/final_cards.json", encoding="utf-8") as f:
        cards = json.load(f)
    log(f"final_cards.json loaded: {len(cards)} entries")
    return cards


def load_slots() -> dict[str, dict]:
    with open(f"{DATA_DIR}/slots.json", encoding="utf-8") as f:
        slots = json.load(f)
    return {s["slotId"]: s for s in slots}


REQUIRED_FIELDS = ("slotId", "headword", "reading", "gloss", "pos", "root", "examples")


def build_records(cards: list[dict], slots: dict[str, dict]) -> list[dict]:
    """カードをレコード化する。純関数——並び順の推定・重複排除・件数調整は一切しない。
    slots.json とのズレ（欠落・余剰・スロット順のカテゴリ不明）は例外にする。"""
    for c in cards:
        missing = [f for f in REQUIRED_FIELDS if not c.get(f)]
        if missing:
            raise SystemExit(f"card {c.get('slotId', '?')} missing required fields: {missing}")
        if c["slotId"] not in slots:
            raise SystemExit(f"card slotId {c['slotId']} not found in slots.json")

    card_by_slot = {c["slotId"]: c for c in cards}
    slot_ids_ordered = list(slots.keys())  # slots.json のカテゴリブロック順を学習順にする
    if set(card_by_slot) != set(slot_ids_ordered):
        missing = set(slot_ids_ordered) - set(card_by_slot)
        extra = set(card_by_slot) - set(slot_ids_ordered)
        raise SystemExit(f"cards <-> slots mismatch: missing={missing} extra={extra}")

    records = []
    for i, slot_id in enumerate(slot_ids_ordered, start=1):
        c = card_by_slot[slot_id]
        s = slots[slot_id]
        records.append(
            {
                "idKey": slot_id,
                "headword": c["headword"],
                "reading": c.get("reading") or c["headword"],
                "gloss": c["gloss"],
                "pos": c["pos"],
                "root": c.get("root"),
                "examples": c.get("examples", []),
                "frequencyRank": i,
                "category": s["category"],
            }
        )
    return records


def course_meta() -> dict:
    return {
        "id": COURSE_ID,
        "title": "Tagalog Daily Phrases",
        "learningLanguage": "Tagalog",
        "glossLanguage": "Japanese",
        "uiLanguage": "en",
        "type": "phrase",
        "band": {"from": 0, "to": 450},
        "sources": [
            {
                "name": "AI生成（Claude, Anthropic）",
                "url": "https://www.anthropic.com",
                "license": "N/A",
                "note": "フレーズ本文・読み・訳・語根分解・返答例は、場面設計（人手作成のスロット表）"
                "を元にAI生成し、独立した複数のAIによる多段検証（言語面・場面面）と裁定を経ている"
                "（判断ログ#36）。",
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": "生成されたフレーズが実在の言い回しとして裏付けられるかの検証（attestation）に"
                "参照した。例文としては使用していない。",
            },
        ],
    }


def build(out_root: str) -> list[dict]:
    cards = load_final_cards()
    slots = load_slots()
    records = build_records(cards, slots)

    from emit import validate_records

    errors = validate_records(records)
    if errors:
        log(f"VALIDATION ERRORS ({len(errors)}):")
        for e in errors[:20]:
            log(f"  - {e}")
        raise SystemExit(1)

    cards_out = emit_course(COURSE_ID, course_meta(), records, out_root)

    categories = {}
    for card, r in zip(cards_out, records):
        if r.get("category"):
            categories[card["id"]] = r["category"]
    cat_path = os.path.join(out_root, COURSE_ID, "categories.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, separators=(",", ":"))

    log(f"categories.json written: {len(categories)} / {len(records)} cards have a category")
    return cards_out


def run_check() -> None:
    """一時ディレクトリに再ビルドし、出荷済みとバイト単位で比較する（冪等性の証明）。
    差分があれば非ゼロ終了する——'出荷物 ≠ 再ビルド結果' を機械的に検知するゲート。"""
    shipped_dir = os.path.join(OUT, COURSE_ID)
    if not os.path.isdir(shipped_dir):
        log("--check: 出荷済みディレクトリが無い（初回ビルドはまず通常モードで実行すること）")
        raise SystemExit(1)

    with tempfile.TemporaryDirectory() as tmp:
        build(tmp)
        tmp_dir = os.path.join(tmp, COURSE_ID)
        shipped_files = sorted(os.listdir(shipped_dir))
        tmp_files = sorted(os.listdir(tmp_dir))
        if shipped_files != tmp_files:
            log(f"--check FAILED: ファイル一覧が不一致 shipped={shipped_files} rebuilt={tmp_files}")
            raise SystemExit(1)

        _match, mismatch, errors = filecmp.cmpfiles(
            shipped_dir, tmp_dir, shipped_files, shallow=False
        )
        if mismatch or errors:
            log(f"--check FAILED: 差分あり mismatch={mismatch} errors={errors}")
            raise SystemExit(1)
        log(f"--check OK: {len(shipped_files)} files が完全に一致（冪等性を確認）")


def main():
    if "--check" in sys.argv:
        run_check()
        return

    t0 = time.time()
    cards_out = build(OUT)

    example_covered = sum(1 for c in cards_out if c.get("examples"))
    log(f"words with examples: {example_covered} / {len(cards_out)}")
    log(f"Done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
