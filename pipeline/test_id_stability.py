# -*- coding: utf-8 -*-
"""
採番の安定性テスト（Phase 2 の合格ゲート）。

出荷済みのカードをそのまま「ビルドの入力」に見立てて assign_ids に通し、
**全語が既存 ID を再利用する（新規採番 0・未一致 0）**ことを確かめる。

フルリビルドを合格条件にしないのは、出荷データがコミット済みパイプラインから
再現できないため（pipeline/raw/ は .gitignore 対象、フィルタは出荷 JSON を直接編集）。
採番ロジックだけを切り出して検証すれば、再現性の問題と切り離せる。

使い方: python pipeline/test_id_stability.py
"""
import sys

from card_id import assign_ids
from id_registry import KEY_SEP, load_registry
from seed_id_registry import list_course_ids, load_course_cards

# headword/reading でなく idKey（不変のスロットID）で採番するコース。
# card_id.py の assign_ids() の idKey 対応（判断ログ#36）を参照。
IDKEY_COURSES = {"tl-phrases-daily"}


def records_of(course_id: str) -> list[dict]:
    """出荷カードを、ビルドが assign_ids に渡すのと同じ形へ落とす"""
    cards = load_course_cards(course_id)
    if course_id in IDKEY_COURSES:
        reg = load_registry(course_id)
        id_to_key = {e["id"]: e["key"].split(KEY_SEP)[0] for e in reg.entries} if reg else {}
        return [
            {
                "idKey": id_to_key.get(c["id"]),
                "headword": c.get("headword"),
                "reading": c.get("reading"),
                "gloss": c.get("gloss"),
                "frequencyRank": c.get("frequencyRank"),
            }
            for c in cards
        ]
    return [
        {
            "headword": c.get("headword"),
            "reading": c.get("reading"),
            "gloss": c.get("gloss"),
            "frequencyRank": c.get("frequencyRank"),
        }
        for c in cards
    ]


def test_all_reused() -> list[str]:
    """① 出荷データを入力にすると全語が既存 ID を再利用する"""
    failures = []
    for cid in list_course_ids():
        cards = load_course_cards(cid)
        ids, report = assign_ids(cid, records_of(cid), persist=False, strict=False)
        if report.new or report.orphaned:
            failures.append(f"[{cid}] 新規採番={report.new} 未使用={report.orphaned}（どちらも 0 のはず）")
        mismatched = sum(1 for got, c in zip(ids, cards) if got != c["id"])
        if mismatched:
            failures.append(f"[{cid}] id 不一致 {mismatched} 件")
    return failures


def test_drift_detected() -> list[str]:
    """② 見出し語を1語書き換えると「新規採番>0 かつ 未使用>0」で異常として検知される"""
    cid = "ja-katakana"
    records = records_of(cid)
    records[10]["headword"] = records[10]["headword"] + "ZZZ"
    _ids, report = assign_ids(cid, records, persist=False, strict=False)
    if not report.has_drift:
        return [f"[{cid}] 見出し語を書き換えてもドリフトを検知できていない "
                f"(new={report.new}, orphaned={report.orphaned})"]
    if report.new != 1 or report.orphaned != 1:
        return [f"[{cid}] 検知はしたが件数が想定外 (new={report.new}, orphaned={report.orphaned}, 期待は 1/1)"]
    return []


def test_pure_add_is_ok() -> list[str]:
    """③ 語の追加だけならドリフト扱いにしない（正常な語彙拡張を赤くしない）"""
    cid = "ja-katakana"
    records = records_of(cid)
    records.append({"headword": "テスト新語ZZZ", "reading": "テストシンゴ", "gloss": "test", "frequencyRank": 9999})
    _ids, report = assign_ids(cid, records, persist=False, strict=False)
    if report.has_drift:
        return [f"[{cid}] 語の追加だけでドリフト誤検知 (new={report.new}, orphaned={report.orphaned})"]
    if report.new != 1:
        return [f"[{cid}] 追加語が新規採番されていない (new={report.new})"]
    return []


def test_pure_delete_is_ok() -> list[str]:
    """④ 語の削除だけならドリフト扱いにしない（#34 のようなフィルタを赤くしない）"""
    cid = "ja-katakana"
    records = records_of(cid)[:-5]
    _ids, report = assign_ids(cid, records, persist=False, strict=False)
    if report.has_drift:
        return [f"[{cid}] 語の削除だけでドリフト誤検知 (new={report.new}, orphaned={report.orphaned})"]
    if report.orphaned != 5:
        return [f"[{cid}] 削除語が未使用として数えられていない (orphaned={report.orphaned})"]
    return []


def main() -> int:
    all_failures = []
    for name, fn in [
        ("① 出荷データは全語が既存IDを再利用", test_all_reused),
        ("② 見出し語の改変をドリフトとして検知", test_drift_detected),
        ("③ 語の追加だけなら誤検知しない", test_pure_add_is_ok),
        ("④ 語の削除だけなら誤検知しない", test_pure_delete_is_ok),
    ]:
        failures = fn()
        print(f"{'OK ' if not failures else 'NG '} {name}")
        all_failures.extend(failures)

    if all_failures:
        print(f"\n[test] 失敗 {len(all_failures)} 件:")
        for f in all_failures:
            print("   -", f)
        return 1
    print("\n[test] 採番は安定しています。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
