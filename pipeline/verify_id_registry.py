# -*- coding: utf-8 -*-
"""
cardId レジストリの検証。この計画の**唯一の合格ゲート**。

検査内容（1 つでも外れたら非ゼロ終了）:
 1. レジストリだけから出荷 JSON の id を全件復元できるか（1 件でも違えば失敗）
 2. コース内で id が重複していないか
 3. 語数が manifest.json の wordCount と一致するか
 4. maxIdNumber が実データの最大値以上か（採番の続きが既存 id と衝突しないこと）

「9 コース再ビルドしてバイト単位ゼロ diff」は合格条件にしない——出荷データは
コミット済みパイプラインから再現できないため、原理的に達成不可能だから
（seed_id_registry.py の冒頭を参照）。

使い方: python pipeline/verify_id_registry.py
"""
import json
import os
import sys

from id_registry import id_number, load_registry
from seed_id_registry import COURSES_ROOT, PIPELINE_ROOT, list_course_ids, load_course_cards


def verify_course(course_id: str) -> tuple[int, int, list[str]]:
    """(一致件数, 総件数, エラー) を返す"""
    errors: list[str] = []
    reg = load_registry(course_id, PIPELINE_ROOT)
    if reg is None:
        return 0, 0, [f"[{course_id}] レジストリがありません（seed を先に実行してください）"]

    cards = load_course_cards(course_id)

    with open(os.path.join(COURSES_ROOT, course_id, "manifest.json"), "r", encoding="utf-8") as f:
        word_count = json.load(f)["wordCount"]
    if word_count != len(cards):
        errors.append(f"[{course_id}] manifest.wordCount={word_count} だが実データは {len(cards)} 件")

    seen_ids: set[str] = set()
    matched = 0
    for c in cards:
        if c["id"] in seen_ids:
            errors.append(f"[{course_id}] id 重複: {c['id']}")
        seen_ids.add(c["id"])

        got = reg.lookup(c.get("headword"), c.get("reading"), c.get("gloss"), c.get("frequencyRank"))
        if got == c["id"]:
            matched += 1
        elif got is None:
            if len(errors) < 20:
                errors.append(f"[{course_id}] 引けない: {c['id']} ({c.get('headword')!r})")
        else:
            if len(errors) < 20:
                errors.append(
                    f"[{course_id}] id 不一致: {c.get('headword')!r} は {c['id']} のはずが {got}"
                )

    actual_max = max((id_number(c["id"], course_id) for c in cards), default=0)
    if reg.max_id_number < actual_max:
        errors.append(
            f"[{course_id}] maxIdNumber={reg.max_id_number} が実データの最大 {actual_max} より小さい"
            "（次の採番が既存 id と衝突します）"
        )

    return matched, len(cards), errors


def main() -> int:
    course_ids = list_course_ids()
    total_matched = total_cards = 0
    all_errors: list[str] = []

    for cid in course_ids:
        matched, total, errors = verify_course(cid)
        total_matched += matched
        total_cards += total
        all_errors.extend(errors)
        mark = "OK " if (not errors and matched == total) else "NG "
        print(f"  {mark} {cid:<20} id一致 {matched}/{total}")

    print(f"\n[verify] id一致 {total_matched}/{total_cards}")
    if all_errors:
        print(f"[verify] エラー {len(all_errors)} 件:")
        for e in all_errors[:30]:
            print("   -", e)
        return 1
    if total_matched != total_cards:
        return 1
    print("[verify] 全コースで id を完全再現できました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
