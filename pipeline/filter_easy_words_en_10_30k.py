# -*- coding: utf-8 -*-
"""コース A（en-10-30k）から「簡単すぎる語」を除去する（判断ログ#34）。

判断ログ#32 は zipf>=4.3 の455候補をAIレビューして193語を除去したが、閾値ゲートで
recall が頭打ちになっていた（zipf<4.3 の簡単語は一度も見られていない）。#34 では
単一軸をやめ、直交する4指標の機械フィルタ（analyze_easy_words_en.py）＋グレーバンドの
AIレビュー（make_easy_review_batches.py → Workflow）に置き換えた。

■ id を詰め直さない（重要）
emit_en_10_30k.py は `card_id = f"en-10-30k-{i+1:05d}"` ＝ **IDが並び位置そのもの**で、
再生成すると既存ユーザーの progress 行（Dexie の主キーが cardId・src/store/db.ts:26）が
別の単語に付け替わる（memory: cardid-position-based-fragility。上級漢字コースで
740件中664件の付け替わりを実測済み）。よって emit の再実行ではなく、確定済みの
public/data/courses/en-10-30k/ を**直接編集**して該当カードだけを抜く。
id・frequencyRank は欠番のまま詰めない（進捗計算は cards.length 基準なので安全）。
除去された語の progress 行は孤児になるが、参照されなくなるだけで害はない。

■ 再ビルドしても効くようにする
除去した見出し語は raw/en-10-30k-easy-removed.json に残し、emit_en_10_30k.py が
存在すれば読んで除外する（凍結リストを .py に書き足していく方式をやめる）。

実行: python filter_easy_words_en_10_30k.py [--dry-run]
"""
import glob
import json
import os
import sys

RAW = "raw"
OUT_DIR = "../public/data/courses/en-10-30k"
BATCH_DIR = f"{RAW}/en-easy-review-batches"
REMOVED_MANIFEST = f"{RAW}/en-10-30k-easy-removed.json"


def log(msg: str) -> None:
    print(f"[filter_easy_words_en_10_30k] {msg}", flush=True)


def load_auto_remove() -> dict[str, str]:
    """機械フィルタ（F1/F2/F4/F5）の確定分。id -> headword。"""
    data = json.load(open(f"{RAW}/en-easy-auto-remove.json", encoding="utf-8"))
    out = {v["id"]: w for w, v in data["words"].items()}
    log(f"機械フィルタ確定: {len(out)}語")
    return out


def load_ai_verdicts() -> tuple[dict[str, str], int]:
    """AIレビューの REMOVE 判定。id -> headword。

    出力は REMOVE と判定した語だけを持つ（KEEP を全件エコーさせると1バッチ180語の
    出力が肥大してセッション利用上限に当たるため。初回はそれで11体全滅した）。
    全件を見た証拠が無くなる代わりに、次の2点で整合を検査する:
      - 出力の inputCount が入力の実件数と一致すること（＝ファイル全体を読んだ証拠）
      - REMOVE の id が入力の id 集合の部分集合であること（＝でっち上げが無いこと）
    """
    inputs = sorted(glob.glob(f"{BATCH_DIR}/batch-[0-9][0-9][0-9].json"))
    if not inputs:
        raise SystemExit(f"{BATCH_DIR} にバッチが無い。make_easy_review_batches.py を先に実行すること。")
    remove: dict[str, str] = {}
    reviewed = 0
    missing = []
    for src in inputs:
        dst = src.replace(".json", ".out.json")
        if not os.path.exists(dst):
            missing.append(os.path.basename(src))
            continue
        src_items = json.load(open(src, encoding="utf-8"))
        src_ids = {i["id"] for i in src_items}
        result = json.load(open(dst, encoding="utf-8"))
        name = os.path.basename(dst)
        if isinstance(result, list):
            # 旧形式（全件エコー・[{id, headword, verdict, reason}]）。
            # セッション上限で「失敗」扱いになった初回ランでも Write 自体は完了していた
            # バッチがあり、それを捨てずに使う（memory: workflow-subagent-model-default 追記2）。
            result = {
                "inputCount": len(result),
                "remove": [
                    {"id": it["id"], "headword": it["headword"], "reason": it.get("reason", "")}
                    for it in result
                    if it.get("verdict") == "REMOVE"
                ],
            }
        if result.get("inputCount") != len(src_items):
            raise SystemExit(
                f"{name}: inputCount={result.get('inputCount')} が入力の実件数 {len(src_items)} と"
                f"一致しない（＝一部しか読んでいない疑い）。該当バッチだけ再実行すること。"
            )
        stray = [it["id"] for it in result.get("remove", []) if it["id"] not in src_ids]
        if stray:
            raise SystemExit(
                f"{name}: 入力に存在しないidが{len(stray)}件ある（例 {stray[:3]}）。"
                f"該当バッチだけ再実行すること。"
            )
        reviewed += len(src_items)
        for it in result.get("remove", []):
            remove[it["id"]] = it["headword"]
    if missing:
        raise SystemExit(f"未判定のバッチがある: {', '.join(missing)}")
    log(f"AIレビュー: {reviewed}語を判定 -> REMOVE {len(remove)}語 / KEEP {reviewed - len(remove)}語")
    return remove, reviewed


def main():
    dry_run = "--dry-run" in sys.argv
    auto = load_auto_remove()
    ai, reviewed = load_ai_verdicts()
    remove_ids = {**auto, **ai}
    log("=" * 70)
    log(f"除去合計: {len(remove_ids)}語（機械 {len(auto)} + AI {len(ai)}）")

    manifest = json.load(open(f"{OUT_DIR}/manifest.json", encoding="utf-8"))

    # 既に一部が適用済みでも再実行できるようにする（フィルタを1本足して差分だけ流す運用が
    # 実際に必要になった——pos=固有名詞のF6を後から追加したケース）。
    present_ids = set()
    for band in manifest["bands"]:
        present_ids.update(c["id"] for c in json.load(open(f"{OUT_DIR}/{band}", encoding="utf-8")))
    applicable = {i for i in remove_ids if i in present_ids}
    if len(applicable) < len(remove_ids):
        log(f"うち今回適用する分: {len(applicable)}語"
            f"（残り {len(remove_ids) - len(applicable)}語は適用済みで既にコースに無い）")
    if not applicable:
        log("適用対象が無い（既に全て適用済み）。何もしない。")
        return

    before_total = 0
    kept_total = 0
    removed_total = 0
    surviving_bands = []
    writes: list[tuple[str, list]] = []

    for band in manifest["bands"]:
        path = f"{OUT_DIR}/{band}"
        cards = json.load(open(path, encoding="utf-8"))
        before_total += len(cards)
        kept = [c for c in cards if c["id"] not in remove_ids]
        removed_here = len(cards) - len(kept)
        removed_total += removed_here
        kept_total += len(kept)
        if kept:
            surviving_bands.append(band)
            writes.append((path, kept))
        else:
            log(f"{band}: 全カードが除去対象 -> このバンドファイルは削除する")
        if removed_here:
            log(f"  {band}: {len(cards)} -> {len(kept)} ({removed_here}件除去)")

    log("=" * 70)
    log(f"収録語数: {before_total} -> {kept_total} ({removed_total}件除去)")
    if removed_total != len(applicable):
        raise SystemExit(
            f"警告: 除去件数が適用対象と一致しない（実際{removed_total}件 / 対象{len(applicable)}件）。"
            f"id の対応が壊れている可能性がある。"
        )

    if dry_run:
        log("--dry-run のため書き込みはしない。")
        return

    for path, kept in writes:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(kept, f, ensure_ascii=False, indent=1)
    for band in manifest["bands"]:
        if band not in surviving_bands:
            os.remove(f"{OUT_DIR}/{band}")

    categories = json.load(open(f"{OUT_DIR}/categories.json", encoding="utf-8"))
    before_cat = len(categories)
    categories = {k: v for k, v in categories.items() if k not in remove_ids}
    with open(f"{OUT_DIR}/categories.json", "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=1)
    log(f"categories.json: {before_cat} -> {len(categories)}")

    manifest["bands"] = surviving_bands
    manifest["wordCount"] = kept_total
    with open(f"{OUT_DIR}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    log(f"manifest.json: bands {len(surviving_bands)}件 / wordCount {kept_total}")

    # 再ビルド用の除外リストは累積させる（差分適用で上書きすると、前回分が
    # emit の再実行で復活してしまう）。
    previous = set()
    if os.path.exists(REMOVED_MANIFEST):
        previous = set(json.load(open(REMOVED_MANIFEST, encoding="utf-8"))["headwords"])
    headwords = sorted(previous | set(remove_ids.values()))
    with open(REMOVED_MANIFEST, "w", encoding="utf-8") as f:
        json.dump({"count": len(headwords), "headwords": headwords}, f, ensure_ascii=False, indent=1)
    log(f"再ビルド用の除外リスト（累積 {len(headwords)}語） -> {REMOVED_MANIFEST}")
    log("Done.")


if __name__ == "__main__":
    main()
