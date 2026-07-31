# -*- coding: utf-8 -*-
"""
コース A（英語・calibrate-mine）の stage2: 5.4のLLMコンテンツバッチ出力を統合し、
public/data/courses/en-10-30k/ へ最終データを書き出す。

判断ログ#28/#29/#30/#31/#32を反映:
- 既知語底面はNGSL+NAWLのみ（3,772語。引用元meta.jsonのsourcesには正確な値を残す）
- isValidVocabulary=falseの語（固有名詞ノイズ等）とpos=数詞（NGSL漏れの数詞59語）を除外
- 表示名・band・frequencyRankの起点は DISPLAY_BASELINE（10,000）を使う（判断ログ#31・Kohei判断で
  「英語10k→30k」という当初の企画名の座りの良さを優先し、技術的な既知語底面の実数(3,772)より
  丸めた開始番号を表示する）。収録語数(len(cards))自体は実データのまま変えない
- 193語を追加除外（判断ログ#32）。#30の数詞除外と同根の問題——NGSL/NAWLは月・曜日名/国名・
  国籍語/卑語・間投詞も収録していないため、"american"・"shit"・"london"・"june"のような
  最基礎語が「未知語」としてすり抜けて帯の先頭に混入していた。zipf(wordfreqの頻度指標)でまず
  455語に絞り込み、58エージェントのWorkflow（バッチ判定→独立verifyパスで誤検出を除去）で
  最終193語に確定。zipfの素の閾値だけでは"infrastructure"「インフラ」"congress"「議会」
  等の正当な中級語まで誤って巻き込むため不採用——zipfは学習者にとっての難易度ではなく
  コーパス出現頻度（時事語・地名が理由もなく高くなる）を測る指標だと実測で判明したため。
  EXCLUDED_HEADWORDSは確定リストそのもの（閾値の再計算ではなく固定集合として保持）

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

NGSL_NAWL_COUNT = 3772  # NGSL 2,809 + NAWL 963（判断ログ#28・技術的な既知語底面の実数。sources引用元用）
DISPLAY_BASELINE = 10000  # タイトル・band・frequencyRankの起点（判断ログ#31・Kohei判断）
EXCLUDED_POS = {"数詞"}  # NGSLが数字を収録していないため漏れた基礎語（判断ログ#30）

# NGSL/NAWL漏れの基礎語193語（判断ログ#32）。zipf>=4.3の455候補をWorkflowでAIレビュー
# ＋独立verifyパスにかけて確定した最終リスト（false positive除去済み）。
EXCLUDED_HEADWORDS = frozenset({
    "adam", "africa", "airport", "amazon", "america", "american", "americans", "anne",
    "april", "arizona", "arthur", "asia", "asleep", "ass", "asshole", "atlanta",
    "atlantic", "aug", "august", "austin", "australia", "australian", "awesome",
    "baseball", "basketball", "bathroom", "bbc", "berlin", "birthday", "bitch",
    "boston", "boyfriend", "brazil", "britain", "british", "bro", "bullshit",
    "butter", "bye", "california", "cambridge", "canada", "canadian", "carolina",
    "chicago", "china", "chinese", "christ", "christmas", "clinton", "colorado",
    "columbia", "congratulations", "crap", "cute", "dallas", "daniel", "december",
    "detroit", "dick", "dude", "egypt", "england", "english", "etc", "europe",
    "fbi", "feb", "february", "florida", "france", "french", "friday", "fuck",
    "fucked", "fuckin", "fucking", "georgia", "german", "germany", "girlfriend",
    "goodbye", "gym", "hey", "hockey", "hollywood", "houston", "hungry", "illinois",
    "india", "indiana", "iowa", "iphone", "iran", "iraq", "ireland", "israel",
    "italian", "italy", "jackson", "january", "japan", "japanese", "jason", "jesus",
    "jordan", "juice", "july", "june", "kansas", "kentucky", "korea", "lincoln",
    "liverpool", "london", "luke", "mac", "madrid", "manchester", "massachusetts",
    "matthew", "melbourne", "mexico", "miami", "michigan", "minnesota", "monday",
    "moscow", "mrs", "mum", "nah", "nigeria", "nov", "november", "obama", "oct",
    "october", "ohio", "oregon", "oscar", "oxford", "pacific", "pakistan", "paris",
    "pennsylvania", "pet", "philadelphia", "pizza", "prince", "princess", "purple",
    "queen", "rio", "rome", "russia", "russian", "santa", "saturday", "sauce",
    "scotland", "seattle", "sept", "september", "shit", "singapore", "soccer",
    "spain", "spanish", "sunday", "sweden", "sydney", "syria", "texas", "thursday",
    "tiger", "toilet", "toronto", "tuesday", "turkey", "ukraine", "usa", "vacation",
    "vegas", "victoria", "vietnam", "virginia", "washington", "wednesday",
    "wisconsin", "wow", "yep", "youtube", "zero",
})

# band.to・タイトルの終点（判断ログ#33・Kohei判断）。#31時点では実収録語数(len(cards))に
# 連動してスライドする方式だったが、#32のクリーンアップで語数が変わるたびに
# 30,725→30,532のように半端な数字になり続けるため、実収録語数から切り離した固定値に
# 変更——当初の企画名「英語10k→30k」の座りの良さをそのまま採用。実際のカード数が
# これと多少ずれても（現状20,532語=DISPLAY_BASELINE+20,532）実害はない
# ——band.toはタイトル・courseRegistry.ts表示にのみ使われ、進捗計算はcards.length基準
DISPLAY_END = 30000

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
    excluded_easy = 0
    for it in all_items:
        if not it.get("isValidVocabulary"):
            excluded_invalid += 1
            continue
        if it.get("pos") in EXCLUDED_POS:
            excluded_pos += 1
            continue
        if it["headword"] in EXCLUDED_HEADWORDS:
            excluded_easy += 1
            continue
        s = skeleton_by_headword.get(it["headword"])
        if not s:
            continue
        raw_rank = raw_rank_by_lemma.get(it["headword"])
        if raw_rank is None:
            continue
        valid.append((raw_rank, it, s))

    log(
        f"有効: {len(valid)} (除外: isValidVocabulary=false {excluded_invalid}件, "
        f"pos=数詞 {excluded_pos}件, 基礎語(判断ログ#32) {excluded_easy}件"
        f"/{len(EXCLUDED_HEADWORDS)}件中)"
    )

    valid.sort(key=lambda x: x[0])

    cards = []
    categories = {}
    for i, (raw_rank, it, s) in enumerate(valid):
        freq_rank = DISPLAY_BASELINE + 1 + i
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
    start_rank = DISPLAY_BASELINE + 1
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
    title = f"English {DISPLAY_BASELINE:,} → {DISPLAY_END:,}"
    meta = {
        "id": "en-10-30k",
        "title": title,
        "learningLanguage": "English",
        "glossLanguage": "Japanese",
        "uiLanguage": "en",
        "type": "calibrate-mine",
        "band": {"from": DISPLAY_BASELINE, "to": DISPLAY_END},
        "sources": [
            {
                "name": "EJDict-hand",
                "url": "https://github.com/kujirahand/EJDict",
                "license": "CC0 1.0 Universal",
                "note": "English-Japanese dictionary data, the primary source for Japanese glosses. Words missing from EJDict-hand have LLM-generated glosses (cross-checked by a second AI pass only, no native-speaker human review).",
            },
            {
                "name": "New General Service List (NGSL) / New Academic Word List (NAWL)",
                "url": "https://www.newgeneralservicelist.com",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "note": f"Known-word baseline ({NGSL_NAWL_COUNT:,} words). Words beyond this baseline are treated as new course content. The course title displays a rounded starting point ({DISPLAY_BASELINE:,}) rather than this exact figure.",
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": "Primary example sentence source.",
            },
            {
                "name": "JESC (Japanese-English Subtitle Corpus)",
                "url": "https://nlp.stanford.edu/projects/jesc/",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
                "note": "Secondary example sentence source for words Tatoeba didn't cover (subtitle-derived parallel corpus). Words still missing an example after this have an LLM-generated one (aiGenerated:true on the individual example).",
            },
            {
                "name": "CMUdict",
                "url": "https://github.com/cmusphinx/cmudict",
                "license": "BSD-like (CMU license)",
                "note": "Pronunciation (IPA). ARPABET→IPA conversion is a custom implementation in this project (pipeline/arpabet_to_ipa.py).",
            },
            {
                "name": "wordfreq",
                "url": "https://github.com/rspeer/wordfreq",
                "license": "MIT",
                "note": "Frequency ordering.",
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
