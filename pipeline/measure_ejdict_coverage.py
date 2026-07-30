# -*- coding: utf-8 -*-
"""
Phase 5.1c 帯選定の判断材料: en-wordfreq-ranked.json（gen_en_wordfreq_ranked.py の
出力・候補69,913レンマ）に対する EJDict-hand 実カバレッジを rank帯ごとに測定する。

Phase 0.3 は524語のサンプルでの推定（74.0%〜実質約76%）だったが、これは全量での
実測に置き換える。「10k-30k帯は語数より実測で届いた範囲を正直に見せる」方針
（判断ログ#19/#22/#26/#27/#28）の判断材料として、1000語ごとの帯別カバレッジ推移を出す。
"""
import json
import time

import ejdict

CANDIDATES_PATH = "raw/en-wordfreq-ranked.json"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    t0 = time.time()
    index, stats = ejdict.build_index()
    log(f"EJDict-hand index: {stats}")

    candidates = json.load(open(CANDIDATES_PATH, encoding="utf-8"))
    log(f"候補プール: {len(candidates)} レンマ ({CANDIDATES_PATH})")

    for c in candidates:
        lemma_gloss = ejdict.resolve_gloss(c["lemma"], index)
        surface_gloss = None
        if c["surfaceForm"] != c["lemma"]:
            surface_gloss = ejdict.resolve_gloss(c["surfaceForm"], index)
        gloss = lemma_gloss or surface_gloss
        c["ejdictHit"] = gloss is not None
        c["ejdictSenseCount"] = len(gloss) if gloss else 0

    # ---------- 帯別カバレッジ（1000語刻み、rank30000まで＋全体） ----------
    log("=" * 70)
    log("candidateRank帯別 EJDict-hand カバレッジ:")
    band_size = 1000
    max_band_rank = 30_000
    for band_start in range(0, max_band_rank, band_size):
        band = [c for c in candidates if band_start < c["candidateRank"] <= band_start + band_size]
        if not band:
            continue
        hits = sum(1 for c in band if c["ejdictHit"])
        log(f"  {band_start+1:>6}-{band_start+band_size:<6}: {hits:>4}/{len(band)} "
            f"({hits/len(band)*100:5.1f}%)")

    for lo, hi in ((1, 10_000), (10_001, 20_000), (20_001, 30_000), (1, 30_000)):
        band = [c for c in candidates if lo <= c["candidateRank"] <= hi]
        hits = sum(1 for c in band if c["ejdictHit"])
        log(f"  合計 {lo}-{hi}: {hits}/{len(band)} ({hits/len(band)*100:.1f}%)")

    with open("raw/en-wordfreq-ranked.json", "w", encoding="utf-8") as f:
        json.dump(candidates, f, ensure_ascii=False, indent=1)
    log(f"ejdictHit/ejdictSenseCount フィールドを en-wordfreq-ranked.json に追記保存")
    log(f"Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
