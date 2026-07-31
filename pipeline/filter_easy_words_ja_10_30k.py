# -*- coding: utf-8 -*-
"""
コース E（ja-10-30k）から明らかに基礎すぎる語 113 語を除去する（判断ログ#32）。

英語コース(en-10-30k)と同根の問題——頻度順の帯構築では、熊(くま)のような早期習得の
具体語と宇宙飛行士のような本当に稀な語がこの頻度帯では同じzipf値に張り付いてしまい、
統計だけでは分離できない（実測確認済み）。日本語コースはzipfでの機械的な事前絞り込みが
効かないため、全12,735語をWorkflow（バッチ判定→独立verifyパス）でレビューし、113語を
確定した。

この帯（ja-10-30k）はbuild_ja_10_23k.py（MeCab・JMdict・LLMコンテンツバッチ）の再実行が
重いため、英語コースのようにexclusion setを足して再生成する方式ではなく、確定済みの
public/data/courses/ja-10-30k/ を直接編集する。id・frequencyRankは詰め直さない
（欠番のまま。進捗ロジックはカード配列の位置ベースでrankの連続性に依存しないため
安全——CourseScreen.tsxのmilestone計算はcards.length基準）。

実行: python filter_easy_words_ja_10_30k.py
"""
import glob
import json
import os

OUT_DIR = "../public/data/courses/ja-10-30k"

# 判断ログ#32で確定した削除id（Workflowのバッチ判定→独立verifyパスで確認済み）
REMOVE_IDS = frozenset({
    "ja-10-30k-0005", "ja-10-30k-0010", "ja-10-30k-0014", "ja-10-30k-0080",
    "ja-10-30k-0156", "ja-10-30k-0180", "ja-10-30k-0190", "ja-10-30k-0230",
    "ja-10-30k-0235", "ja-10-30k-0282", "ja-10-30k-0290", "ja-10-30k-0390",
    "ja-10-30k-0475", "ja-10-30k-0529", "ja-10-30k-0582", "ja-10-30k-0590",
    "ja-10-30k-0603", "ja-10-30k-0710", "ja-10-30k-0826", "ja-10-30k-0906",
    "ja-10-30k-0918", "ja-10-30k-0928", "ja-10-30k-0971", "ja-10-30k-0974",
    "ja-10-30k-10092", "ja-10-30k-10169", "ja-10-30k-10407", "ja-10-30k-1050",
    "ja-10-30k-1060", "ja-10-30k-11158", "ja-10-30k-11263", "ja-10-30k-1171",
    "ja-10-30k-12036", "ja-10-30k-12044", "ja-10-30k-12163", "ja-10-30k-12185",
    "ja-10-30k-12189", "ja-10-30k-12457", "ja-10-30k-12520", "ja-10-30k-1284",
    "ja-10-30k-1308", "ja-10-30k-1527", "ja-10-30k-1566", "ja-10-30k-1587",
    "ja-10-30k-1707", "ja-10-30k-1795", "ja-10-30k-1865", "ja-10-30k-1925",
    "ja-10-30k-1960", "ja-10-30k-1976", "ja-10-30k-2006", "ja-10-30k-2048",
    "ja-10-30k-2125", "ja-10-30k-2174", "ja-10-30k-2199", "ja-10-30k-2215",
    "ja-10-30k-2389", "ja-10-30k-2446", "ja-10-30k-2496", "ja-10-30k-2567",
    "ja-10-30k-2580", "ja-10-30k-2619", "ja-10-30k-2623", "ja-10-30k-2650",
    "ja-10-30k-2652", "ja-10-30k-2654", "ja-10-30k-2731", "ja-10-30k-2757",
    "ja-10-30k-2782", "ja-10-30k-2798", "ja-10-30k-2809", "ja-10-30k-2880",
    "ja-10-30k-3046", "ja-10-30k-3220", "ja-10-30k-3242", "ja-10-30k-3249",
    "ja-10-30k-3274", "ja-10-30k-3503", "ja-10-30k-3525", "ja-10-30k-3682",
    "ja-10-30k-3820", "ja-10-30k-3899", "ja-10-30k-3941", "ja-10-30k-3942",
    "ja-10-30k-3997", "ja-10-30k-4029", "ja-10-30k-4082", "ja-10-30k-4107",
    "ja-10-30k-4162", "ja-10-30k-4187", "ja-10-30k-4236", "ja-10-30k-4611",
    "ja-10-30k-4667", "ja-10-30k-4985", "ja-10-30k-5001", "ja-10-30k-5042",
    "ja-10-30k-5224", "ja-10-30k-5225", "ja-10-30k-5273", "ja-10-30k-5320",
    "ja-10-30k-5340", "ja-10-30k-5499", "ja-10-30k-5577", "ja-10-30k-5956",
    "ja-10-30k-5981", "ja-10-30k-6480", "ja-10-30k-6816", "ja-10-30k-7024",
    "ja-10-30k-7712", "ja-10-30k-7713", "ja-10-30k-9017", "ja-10-30k-9296",
    "ja-10-30k-9802",
})


def log(msg: str) -> None:
    print(f"[filter_easy_words_ja_10_30k] {msg}", flush=True)


def main():
    manifest = json.load(open(f"{OUT_DIR}/manifest.json", encoding="utf-8"))
    removed_total = 0
    kept_total = 0

    for band in manifest["bands"]:
        path = f"{OUT_DIR}/{band}"
        cards = json.load(open(path, encoding="utf-8"))
        before = len(cards)
        cards = [c for c in cards if c["id"] not in REMOVE_IDS]
        removed_here = before - len(cards)
        if removed_here:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cards, f, ensure_ascii=False, indent=1)
            log(f"{band}: {before} -> {len(cards)} ({removed_here}件削除)")
        removed_total += removed_here
        kept_total += len(cards)

    log(f"削除合計: {removed_total}/{len(REMOVE_IDS)}件（一致確認）")

    categories = json.load(open(f"{OUT_DIR}/categories.json", encoding="utf-8"))
    before_cat = len(categories)
    categories = {k: v for k, v in categories.items() if k not in REMOVE_IDS}
    with open(f"{OUT_DIR}/categories.json", "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=1)
    log(f"categories.json: {before_cat} -> {len(categories)}")

    manifest["wordCount"] = kept_total
    with open(f"{OUT_DIR}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    log(f"manifest.json wordCount: {kept_total}")

    if removed_total != len(REMOVE_IDS):
        raise SystemExit(
            f"警告: 削除件数が確定リストと一致しない（削除{removed_total}件 / "
            f"確定{len(REMOVE_IDS)}件）。idの綴りやband範囲を確認すること。"
        )
    log("Done.")


if __name__ == "__main__":
    main()
