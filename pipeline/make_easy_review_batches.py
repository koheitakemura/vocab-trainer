# -*- coding: utf-8 -*-
"""analyze_easy_words_en.py のグレーバンドを AI レビュー用バッチに割る（判断ログ#34・層3の準備）。

バッチ設計は memory `workflow-subagent-model-default` の実測に従う:
  - 1バッチ 150-200語（これを超えるとエージェントが自主的にチャンク分割＋複数回
    proofread を始めて 137K出力トークン/1体 のような暴走をする）
  - データは Workflow の args ではなくファイル経由で渡す（argsに大きな配列を渡すと
    実行時に文字列化される既知の不具合がある）

score>=3 のみを対象にする。score2（2,612語）は abolish/abyss/acquaintance/adversity
のような正当な中級語が大半で、弱いシグナル1個しか立っていない＝レビューの歩留まりが低い。

実行: python make_easy_review_batches.py
"""
import json
import os
import shutil

RAW = "raw"
OUT_DIR = f"{RAW}/en-easy-review-batches"
MIN_SCORE = 3
BATCH_SIZE = 180


def log(msg: str) -> None:
    print(f"[make_easy_review_batches] {msg}", flush=True)


def main():
    gray = json.load(open(f"{RAW}/en-easy-gray-band.json", encoding="utf-8"))["items"]
    items = [g for g in gray if g["score"] >= MIN_SCORE]
    # 見出し語のアルファベット順に均す（score順のまま割ると難易度が偏り、
    # バッチ間で判定基準がぶれる。同じ基準で判断させたいので混ぜる）
    items.sort(key=lambda x: x["headword"])
    log(f"score>={MIN_SCORE} の対象: {len(items)}語（グレーバンド全体 {len(gray)}語）")

    if os.path.exists(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)

    n_batches = 0
    for i in range(0, len(items), BATCH_SIZE):
        chunk = items[i : i + BATCH_SIZE]
        path = f"{OUT_DIR}/batch-{n_batches:03d}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                [{"id": c["id"], "headword": c["headword"], "pos": c["pos"],
                  "gloss": c["gloss"], "signals": c["signals"]} for c in chunk],
                f, ensure_ascii=False, indent=1)
        n_batches += 1
    log(f"{n_batches}バッチ（1バッチ最大{BATCH_SIZE}語）-> {OUT_DIR}/")
    log("Done.")


if __name__ == "__main__":
    main()
