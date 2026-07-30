# -*- coding: utf-8 -*-
"""
コース A（英語・calibrate-mine）の stage2: 5.4のLLMコンテンツバッチ出力を統合し、
public/data/courses/en-10-30k/ へ最終データを書き出す。

判断ログ#28/#29/#30を反映:
- 既知語底面はNGSL+NAWLのみ（3,772語）
- isValidVocabulary=falseの語（固有名詞ノイズ等）とpos=数詞（NGSL漏れの数詞59語）を除外
- 表示名・band は実データ（既知語底面3,772語 + 収録語数）に合わせる。「10k→30k」ではなく
  「学習者が最終的に到達する累積語彙数」でsibling courses（ja-3-10k/ja-10-30k）と同じ命名規則に揃える

入力:
  raw/en-wordfreq-ranked.json（rawWordfreqRank・reading付きの候補全量）
  raw/en-10-30k-skeleton.json（reading(IPA)付きスケルトン。gen_en_wordfreq_ranked.pyの出力とは別ファイル）
  raw/en-10-30k-content-000-019.json, raw/en-10-30k-content-020-399.json（5.4 LLMバッチ結果）

出力:
  public/data/courses/en-10-30k/{meta,manifest,categories}.json
  public/data/courses/en-10-30k/words-XXXX-YYYY.json（1000語区切り）
"""
import json
import os

RAW = "raw"
OUT_DIR = "../public/data/courses/en-10-30k"

KNOWN_BASELINE_COUNT = 3772  # NGSL 2,809 + NAWL 963（判断ログ#28）
EXCLUDED_POS = {"数詞"}  # NGSLが数字を収録していないため漏れた基礎語（判断ログ#30）
BAND_SIZE = 1000


def log(msg: str) -> None:
    print(f"[emit_en_10_30k] {msg}", flush=True)


def main():
    skeleton = json.load(open(f"{RAW}/en-10-30k-skeleton.json", encoding="utf-8"))
    freq_index = json.load(open(f"{RAW}/en-wordfreq-ranked.json", encoding="utf-8"))
    raw_rank_by_lemma = {d["lemma"]: d["rawWordfreqRank"] for d in freq_index}

    content_files = [
        f"{RAW}/en-10-30k-content-000-019.json",
        f"{RAW}/en-10-30k-content-020-399.json",
    ]
    all_items = []
    for cf in content_files:
        d = json.load(open(cf, encoding="utf-8"))
        for b in d["batches"]:
            all_items.extend(b["items"])
    log(f"総アイテム数: {len(all_items)}")

    skeleton_by_headword = {s["headword"]: s for s in skeleton}

    valid = []
    excluded_pos = 0
    excluded_invalid = 0
    for it in all_items:
        if not it.get("isValidVocabulary"):
            excluded_invalid += 1
            continue
        if it.get("pos") in EXCLUDED_POS:
            excluded_pos += 1
            continue
        s = skeleton_by_headword.get(it["headword"])
        if not s:
            continue
        raw_rank = raw_rank_by_lemma.get(it["headword"])
        if raw_rank is None:
            continue
        valid.append((raw_rank, it, s))

    log(f"有効: {len(valid)} (除外: isValidVocabulary=false {excluded_invalid}件, pos=数詞 {excluded_pos}件)")

    valid.sort(key=lambda x: x[0])

    cards = []
    categories = {}
    for i, (raw_rank, it, s) in enumerate(valid):
        freq_rank = KNOWN_BASELINE_COUNT + 1 + i
        card_id = f"en-10-30k-{i + 1:05d}"
        examples = []
        for ex in it.get("examples", []):
            e = {"text": ex["text"], "translation": ex["translation"]}
            if ex.get("cloze"):
                e["cloze"] = ex["cloze"]
            if ex.get("aiGenerated"):
                e["aiGenerated"] = True
            examples.append(e)
        card = {
            "id": card_id,
            "courseId": "en-10-30k",
            "headword": it["headword"],
            "reading": s.get("reading"),
            "gloss": it["gloss"],
            "pos": it["pos"],
            "examples": examples,
            "frequencyRank": freq_rank,
        }
        cards.append(card)
        if it.get("category"):
            categories[card_id] = it["category"]

    log(f"カード生成: {len(cards)}件")

    os.makedirs(OUT_DIR, exist_ok=True)

    # ---------- words-*.json（1000語区切り） ----------
    band_files = []
    start_rank = KNOWN_BASELINE_COUNT + 1
    for band_start in range(start_rank, start_rank + len(cards), BAND_SIZE):
        band_end = band_start + BAND_SIZE
        band_cards = [c for c in cards if band_start <= c["frequencyRank"] < band_end]
        if not band_cards:
            continue
        fname = f"words-{band_start}-{band_end}.json"
        with open(f"{OUT_DIR}/{fname}", "w", encoding="utf-8") as f:
            json.dump(band_cards, f, ensure_ascii=False, indent=1)
        band_files.append(fname)
    log(f"words-*.json: {len(band_files)}ファイル")

    # ---------- categories.json ----------
    with open(f"{OUT_DIR}/categories.json", "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=1)
    log(f"categories.json: {len(categories)}件")

    # ---------- manifest.json ----------
    manifest = {"bands": band_files, "wordCount": len(cards)}
    with open(f"{OUT_DIR}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # ---------- meta.json ----------
    final_total = KNOWN_BASELINE_COUNT + len(cards)
    title = f"English {KNOWN_BASELINE_COUNT:,} → {final_total:,}"
    meta = {
        "id": "en-10-30k",
        "title": title,
        "learningLanguage": "English",
        "glossLanguage": "Japanese",
        "uiLanguage": "ja",
        "type": "calibrate-mine",
        "band": {"from": KNOWN_BASELINE_COUNT, "to": final_total},
        "sources": [
            {
                "name": "EJDict-hand",
                "url": "https://github.com/kujirahand/EJDict",
                "license": "CC0 1.0 Universal",
                "note": "英和辞典データ。日本語グロスの一次ソース。EJDict-handに見出しが無い語はLLM生成（複数AI相互検証のみ・人手ネイティブレビュー無し。判断ログ#18）。",
            },
            {
                "name": "New General Service List (NGSL) / New Academic Word List (NAWL)",
                "url": "https://www.newgeneralservicelist.com",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "note": "既知語底面（3,772語）。この帯を超える語を新規収録語として扱う（判断ログ#28）。",
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": "例文の第一ソース。",
            },
            {
                "name": "JESC (Japanese-English Subtitle Corpus)",
                "url": "https://nlp.stanford.edu/projects/jesc/",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "note": "Tatoebaで不足した例文の第二ソース（判断ログ#28。字幕由来の対訳コーパス）。それでも不足した語はLLM生成（aiGenerated:trueを個々の例文に付与）。",
            },
            {
                "name": "CMUdict",
                "url": "https://github.com/cmusphinx/cmudict",
                "license": "BSD-like (CMU license)",
                "note": "発音表記（IPA）。ARPABET→IPA変換はプロジェクト内の自前実装（pipeline/arpabet_to_ipa.py）。",
            },
            {
                "name": "wordfreq",
                "url": "https://github.com/rspeer/wordfreq",
                "license": "MIT",
                "note": "頻度順序付け。",
            },
        ],
    }
    with open(f"{OUT_DIR}/meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    log("=" * 60)
    log(f"タイトル: {title}")
    log(f"band: {meta['band']}")
    log(f"総カード数: {len(cards)}")
    log("Done.")


if __name__ == "__main__":
    main()
