# -*- coding: utf-8 -*-
"""
コース B（タガログ語 0→2,000・Kohei向け）の最終マージ・出力パイプライン。

前段の成果物を headword で結合して VocabCard[] を組み立てる:
  - pipeline/raw/tl-skeleton.json
      McFarland 1989 (2,002語・全量) x kaikki.org Tagalog Wiktionary抽出 x Tatoeba TL-EN。
      headword / reading（アクセント位置付き表記。無ければ headword と同一）/ frequencyRank
      を持つ「骨格」。gloss/pos/examples/category はまだ確定していない。
  - pipeline/raw/tl-content-batches/batch-*.json （8並列バッチ・計2,005行）
      骨格を250語ずつに分けてLLMに渡し、gloss（日本語）・pos（日本語ラベル）・
      examples（Tatoeba由来+LLM補完）・category を確定させた「中身」。

この2つを headword で突合し、public/data/courses/tl-0-2k/ に書き出す。

既知のデータの穴（本スクリプトが自動処理する）:
  - 39見出し語がホモグラフ（同綴り別語・McFarland側で頻度ランクの異なる複数エントリ）
    を持つ。骨格側のランク昇順とコンテンツ側の出現順（バッチ処理順）が対応している前提で
    ペアリングする（目視サンプリングで確認済み）。
  - 4見出し語（aga/bintana/kasaysayan/sandata）はバッチの境界にまたがって二重生成されて
    いる（同じ語が隣接バッチ両方に出現）。category の有無・例文数で「より充実した方」を
    残し、もう一方は捨てる。
  - 1見出し語（pagkaroon, rank251）はどのバッチにも出現せず、コンテンツが存在しない
    （骨格側も pos=null・Tatoeba例文0件と薄いデータだった）。この語は最終出力から除外する。

出力: public/data/courses/tl-0-2k/ 配下の静的 JSON（VocabCard[] 形状）+ categories.json
"""
import json
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, ".")
from emit import emit_course, validate_records  # noqa: E402

RAW = "raw"
OUT = "../public/data/courses"
COURSE_ID = "tl-0-2k"

SKELETON_PATH = f"{RAW}/tl-skeleton.json"
BATCH_DIR = f"{RAW}/tl-content-batches"
# 処理順 = 生成順（batch-01 は "batch-rank252-502.json" という名前で存在する）。
BATCH_FILES = [
    "batch-00.json",
    "batch-rank252-502.json",
    "batch-02.json",
    "batch-03.json",
    "batch-04.json",
    "batch-05.json",
    "batch-06.json",
    "batch-07.json",
]

# バッチ間でフォーマットが揺れた pos 表記（英語ラベル+日本語併記など）を
# コース内で一貫した日本語ラベルへ正規化する。観測された40種類の表記を全て網羅。
POS_NORMALIZE = {
    "名詞": "名詞",
    "noun（名詞）": "名詞",
    "形容詞": "形容詞",
    "副詞": "副詞",
    "代名詞": "代名詞",
    "接続詞": "接続詞",
    "動詞": "動詞",
    "助詞": "助詞",
    "数詞": "数詞",
    "感動詞": "感動詞",
    "固有名詞": "固有名詞",
    "adj（形容詞）": "形容詞",
    "前置詞": "前置詞",
    "間投詞": "感動詞",
    "name（固有名詞）": "固有名詞",
    "noun（名詞・形容詞）": "名詞・形容詞",
    "疑問詞": "疑問詞",
    "接頭辞": "接頭辞",
    "num（数詞）": "数詞",
    "adverb（副詞）": "副詞",
    "限定詞": "限定詞",
    "conj（接続詞）": "接続詞",
    "intj（感動詞）": "感動詞",
    "連結辞": "連結辞",
    "動詞（語根）": "動詞（語根）",
    "代名詞（指示）": "代名詞（指示）",
    "副詞（疑問）": "副詞（疑問）",
    "形容詞（状態）": "形容詞（状態）",
    "名詞（序数）": "名詞（序数）",
    "名詞（語根）": "名詞（語根）",
    "pron（代名詞）": "代名詞",
    "adj（形容詞・状態動詞）": "形容詞・状態動詞",
    "verb（動詞、直前完了相）": "動詞（直前完了相）",
    "num（数詞、序数）": "数詞（序数）",
    "noun（形容詞的用法）": "名詞（形容詞的用法）",
    "adj（形容詞・副詞的）": "形容詞・副詞的",
    "particle（助詞・口語表現）": "助詞（口語表現）",
    "prep（前置詞）": "前置詞",
    "verb（動詞）": "動詞",
    "verb（動詞、状態的）": "動詞（状態的）",
}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def normalize_pos(pos: str) -> str:
    return POS_NORMALIZE.get(pos, pos)


def load_skeleton() -> list[dict]:
    with open(SKELETON_PATH, encoding="utf-8") as f:
        data = json.load(f)
    log(f"skeleton loaded: {len(data)} entries")
    return data


def load_content_batches() -> list[dict]:
    entries = []
    for fname in BATCH_FILES:
        path = os.path.join(BATCH_DIR, fname)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for d in data:
            entries.append(d)
        log(f"  {fname}: {len(data)} entries")
    log(f"content batches loaded: {len(entries)} entries total (raw, incl. duplicates)")
    return entries


def score_content_entry(entry: dict) -> tuple:
    """重複時に「より充実した方」を残すためのスコア（大きいほど良い）。"""
    return (
        1 if entry.get("category") else 0,
        len(entry.get("examples") or []),
        len((entry.get("gloss") or "")),
    )


def dedupe_content_by_headword(content_by_hw: dict[str, list[dict]], skel_count: dict[str, int]) -> None:
    """content 側の出現数が skeleton 側の出現数を超える見出し語について、
    スコアの低いエントリを間引いて件数を一致させる（バッチ境界での二重生成対策）。"""
    for hw, entries in content_by_hw.items():
        target = skel_count.get(hw, 0)
        if len(entries) <= target or target == 0:
            continue
        ranked = sorted(entries, key=score_content_entry, reverse=True)
        kept = ranked[:target]
        dropped = ranked[target:]
        for d in dropped:
            log(f"  dedupe: dropping weaker duplicate content entry for '{hw}' "
                f"(gloss={d.get('gloss', '')[:24]!r})")
        content_by_hw[hw] = kept


def merge(skeleton: list[dict], content_entries: list[dict]) -> tuple[list[dict], list[str]]:
    skel_by_hw: dict[str, list[dict]] = defaultdict(list)
    for s in skeleton:
        skel_by_hw[s["headword"]].append(s)
    skel_count = {hw: len(v) for hw, v in skel_by_hw.items()}

    content_by_hw: dict[str, list[dict]] = defaultdict(list)
    for c in content_entries:
        content_by_hw[c["headword"]].append(c)

    dedupe_content_by_headword(content_by_hw, skel_count)

    merged = []
    unmatched_headwords = []
    for hw, slist in skel_by_hw.items():
        slist_sorted = sorted(slist, key=lambda s: s["frequencyRank"])
        clist = content_by_hw.get(hw, [])
        if not clist:
            unmatched_headwords.append(hw)
            continue
        if len(clist) < len(slist_sorted):
            # content が skeleton の重複数に届かない: 埋まった分だけペアにし、
            # 残りの skeleton エントリ（低頻度側のホモグラフ）は欠損として扱う。
            for extra in slist_sorted[len(clist):]:
                unmatched_headwords.append(f"{hw} (rank {extra['frequencyRank']})")
            slist_sorted = slist_sorted[: len(clist)]
        for s, c in zip(slist_sorted, clist):
            merged.append(
                {
                    "headword": s["headword"],
                    "reading": s.get("reading") or s["headword"],
                    "gloss": c["gloss"],
                    "pos": normalize_pos(c["pos"]),
                    "examples": c.get("examples", []),
                    "frequencyRank": s["frequencyRank"],
                    "category": c.get("category"),
                }
            )

    merged.sort(key=lambda r: r["frequencyRank"])
    return merged, unmatched_headwords


def main():
    t0 = time.time()
    skeleton = load_skeleton()
    content_entries = load_content_batches()

    merged, unmatched = merge(skeleton, content_entries)

    if unmatched:
        log(f"UNMATCHED skeleton entries (no content found, excluded from output): {len(unmatched)}")
        for u in unmatched:
            log(f"  - {u}")

    # frequencyRank を 1..N の連番に振り直す（ja-0-3k と同じ規約。元のMcFarlandランクは
    # ホモグラフのため歯抜けがあるので、出力では欠損を含まない連番にする）。
    for i, r in enumerate(merged, start=1):
        r["frequencyRank"] = i

    errors = validate_records(merged)
    if errors:
        log(f"VALIDATION ERRORS ({len(errors)}):")
        for e in errors[:20]:
            log(f"  - {e}")
        raise SystemExit(1)

    # categories.json 用に、emit_course が振るのと同じ規則で id を先に確定する。
    categories: dict[str, str] = {}
    with_category = 0
    for i, r in enumerate(merged, start=1):
        card_id = f"{COURSE_ID}-{i:04d}"
        cat = r.get("category")
        if cat:
            categories[card_id] = cat
            with_category += 1

    course_meta = {
        "id": COURSE_ID,
        "title": "Tagalog 0 → 2,000",
        "learningLanguage": "Tagalog",
        "glossLanguage": "Japanese",
        "uiLanguage": "ja",
        "type": "rail",
        "band": {"from": 0, "to": 2000},
        "sources": [
            {
                "name": "McFarland (1989) Tagalog frequency list",
                "url": "https://en.wiktionary.org/wiki/Wiktionary:Frequency_lists/Tagalog/Top_2,000_most_frequent_headwords_(1989)",
                "license": "CC BY-SA",
                "licenseUrl": "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
                "note": "Curtis D. McFarland's 1989 frequency list of the 2,000 most frequent Tagalog "
                "headwords, republished on Wiktionary. Word selection and frequency ranking for this "
                "course come from this list (it is the structural upper bound: the original has 2,000 "
                "entries).",
            },
            {
                "name": "kaikki.org (Wiktextract structured extract of Wiktionary)",
                "url": "https://kaikki.org/dictionary/Tagalog/index.html",
                "license": "CC BY-SA",
                "licenseUrl": "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
                "note": "Machine-readable extraction of the Tagalog Wiktionary, used for IPA, reference "
                "glosses, and accent-marked headword forms.",
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": "Tagalog-English example sentence pairs.",
            },
        ],
    }
    emit_course(COURSE_ID, course_meta, merged, OUT)

    cat_path = os.path.join(OUT, COURSE_ID, "categories.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=None, separators=(",", ":"))
    log(f"categories.json written: {len(categories)} / {len(merged)} cards have a category "
        f"({with_category / len(merged) * 100:.1f}%)")

    example_covered = sum(1 for r in merged if r.get("examples"))
    example_total = sum(len(r.get("examples") or []) for r in merged)
    log(f"words with >=1 example: {example_covered} / {len(merged)} "
        f"({example_covered / len(merged) * 100:.1f}%), avg {example_total / len(merged):.2f}/word")

    log(f"Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
