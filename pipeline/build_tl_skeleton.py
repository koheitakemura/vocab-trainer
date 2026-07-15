# -*- coding: utf-8 -*-
"""
コース B（タガログ語 0→2k）のスケルトンデータ構築。
McFarland 1989 頻度リスト × kaikki.org Tagalog Wiktionary抽出 × Tatoeba TL-EN を統合し、
次段（8並列バッチ）が読み込む基礎データ pipeline/raw/tl-skeleton.json を書き出す。

このスクリプトはグロス確定・例文の最終選定は行わない（スケルトンのみ）。
- 英語参照訳（referenceGlossEn）は McFarland の alt/pos 優先ロジックで組み立てる
- kaikki からは IPA・より詳しい英語語義・品詞タグを補助情報として付与する
- reading はアクセント位置付き表記（kaikki の "canonical" タグ付き forms から抽出。
  無ければ素の見出し語をそのまま使う＝デフォルトの語末から2音節目アクセントで
  表記不要という Tagalog 正書法の慣行に合わせる）
- Tatoeba は単語境界(\\b)の正規表現一致のみ（タガログ語はラテン文字なので
  日本語のような形態素境界チェックは不要）

入力:
  pipeline/raw/spike-tl/mcfarland_2000.json
  pipeline/raw/spike-tl-gloss/kaikki-tagalog.jsonl（115MB・ストリーム処理）
  pipeline/raw/tgl_sentences.tsv.bz2 （Tatoeba）
  pipeline/raw/tgl-eng_links.tsv.bz2 （Tatoeba）
  pipeline/raw/eng_sentences_full.tsv.bz2 （Tatoeba）

出力:
  pipeline/raw/tl-skeleton.json
"""
import bz2
import json
import re
import time
import unicodedata

RAW = "raw"
MCFARLAND_PATH = f"{RAW}/spike-tl/mcfarland_2000.json"
KAIKKI_PATH = f"{RAW}/spike-tl-gloss/kaikki-tagalog.jsonl"
TGL_SENTENCES_PATH = f"{RAW}/tgl_sentences.tsv.bz2"
TGL_ENG_LINKS_PATH = f"{RAW}/tgl-eng_links.tsv.bz2"
ENG_SENTENCES_PATH = f"{RAW}/eng_sentences_full.tsv.bz2"
OUT_PATH = f"{RAW}/tl-skeleton.json"

# kaikki の pos タグのうち、語彙カードの見出し語として不適切なもの（1文字/記号見出し・
# 慣用句・句読点）。pipeline/raw/spike-tl-gloss/select_words.py の spike と同じ除外リスト。
EXCLUDED_KAIKKI_POS = {"character", "phrase", "proverb", "punctuation"}

CONTENT_POS_PRIORITY = [
    "noun", "verb", "adj", "adjective", "adv", "adverb", "pron", "pronoun",
    "num", "numeral", "prep", "preposition", "conj", "conjunction",
    "intj", "interjection", "det", "determiner", "particle", "prt",
]

STOPWORDS = {
    "a", "an", "the", "to", "of", "in", "on", "for", "with", "by", "or",
    "and", "is", "be", "being", "been", "as", "at", "it", "this", "that",
    "one", "someone", "something", "used", "also", "e.g", "etc",
}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def tokenize(text: str) -> set[str]:
    if not text:
        return set()
    words = re.findall(r"[a-zA-Z']+", text.lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 1}


# ---------- 1. McFarland: referenceGlossEn の組み立て ----------
def load_mcfarland() -> list[dict]:
    with open(MCFARLAND_PATH, encoding="utf-8") as f:
        data = json.load(f)

    records = []
    no_ref = 0
    for d in data:
        alt = (d.get("alt") or "").strip() or None
        gloss = (d.get("gloss") or "").strip() or None
        pos = (d.get("pos") or "").strip() or None
        # 指示どおりの優先順位: alt があれば alt、無ければ pos の説明文。
        # gloss 列は McFarland では t= パラメータの直接指定（rank68 "para" の1件のみ）
        # なので、alt も無い場合のみのフォールバックとして拾う（安全網。通常は発火しない）。
        if alt:
            reference_gloss_en = alt
            gloss_source = "mcfarland_alt"
        elif gloss:
            reference_gloss_en = gloss
            gloss_source = "mcfarland_gloss"
        elif pos:
            reference_gloss_en = pos
            gloss_source = "mcfarland_pos_description"
        else:
            reference_gloss_en = None
            gloss_source = None
            no_ref += 1
        records.append(
            {
                "rank": d["rank"],
                "headword": d["word"],
                "mcfarlandAlt": alt,
                "mcfarlandGloss": gloss,
                "mcfarlandPos": pos,
                "referenceGlossEn": reference_gloss_en,
                "glossSource": gloss_source,
            }
        )
    log(f"McFarland loaded: {len(records)} entries ({no_ref} with no derivable reference gloss)")
    return records


# ---------- 2. kaikki: IPA・詳細語義・品詞・アクセント表記の突合 ----------
def load_kaikki_index(needed_words: set[str]) -> dict[str, list[dict]]:
    """必要な見出し語だけを対象にストリーム処理でインデックス化する
    （115MB を一度に全部メモリへロードしない）。"""
    index: dict[str, list[dict]] = {}
    total_lines = 0
    kept = 0
    with open(KAIKKI_PATH, encoding="utf-8") as f:
        for line in f:
            total_lines += 1
            # 1行=1エントリの JSON Lines なので、行ごとに読んでは要らない行を即捨てる
            # （全体を1つの巨大 JSON として一括ロードしない＝メモリに115MBを載せない）。
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("lang_code") != "tl":
                continue
            word = obj.get("word", "")
            word_lower = word.lower()
            if word_lower not in needed_words:
                continue
            pos = obj.get("pos")
            if pos in EXCLUDED_KAIKKI_POS:
                continue
            senses = obj.get("senses", [])
            glosses = []
            for s in senses:
                gl = s.get("glosses") or s.get("raw_glosses")
                if gl:
                    glosses.append(gl[0])
            if not glosses:
                continue

            ipa = None
            for snd in obj.get("sounds", []):
                if snd.get("ipa") and "Standard-Tagalog" in (snd.get("tags") or []):
                    ipa = snd["ipa"]
                    break
            if ipa is None:
                for snd in obj.get("sounds", []):
                    if snd.get("ipa"):
                        ipa = snd["ipa"]
                        break

            canonical = None
            for form in obj.get("forms", []):
                if "canonical" in (form.get("tags") or []):
                    canonical = form.get("form")
                    break

            try:
                etym_num = int(obj.get("etymology_number") or 1)
            except (TypeError, ValueError):
                etym_num = 1

            entry = {
                "word": word,
                "pos": pos,
                "glosses": glosses[:4],
                "ipa": ipa,
                "canonical": canonical,
                "etymologyNumber": etym_num,
            }
            index.setdefault(word_lower, []).append(entry)
            kept += 1
    log(f"kaikki streamed: {total_lines} lines -> {kept} candidate entries indexed "
        f"for {len(index)} / {len(needed_words)} needed headwords")
    return index


def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def pick_best_kaikki_entry(candidates: list[dict], reference_gloss_en: str | None, gloss_source: str | None) -> dict | None:
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    if gloss_source == "mcfarland_alt" or gloss_source == "mcfarland_gloss":
        ref_tokens = tokenize(reference_gloss_en)
        if ref_tokens:
            scored = []
            for c in candidates:
                cand_tokens = set()
                for g in c["glosses"]:
                    cand_tokens |= tokenize(g)
                overlap = len(ref_tokens & cand_tokens)
                scored.append((overlap, c))
            best_overlap = max(s for s, _ in scored)
            if best_overlap > 0:
                tied = [c for s, c in scored if s == best_overlap]
                if len(tied) == 1:
                    return tied[0]
                candidates = tied  # 複数タイ → 下の etymology/pos タイブレークへ

    # タイブレーク: etymology_number 昇順（Wiktionary は主要語義を語源1に置く慣行）
    # → 内容語 pos を優先
    def sort_key(c: dict):
        pos_rank = CONTENT_POS_PRIORITY.index(c["pos"]) if c["pos"] in CONTENT_POS_PRIORITY else len(CONTENT_POS_PRIORITY)
        return (c["etymologyNumber"], pos_rank)

    return sorted(candidates, key=sort_key)[0]


def apply_kaikki_match(records: list[dict], index: dict[str, list[dict]]) -> None:
    matched = 0
    for r in records:
        candidates = index.get(r["headword"].lower(), [])
        best = pick_best_kaikki_entry(candidates, r["referenceGlossEn"], r["glossSource"])
        if best is None:
            r["kaikkiMatched"] = False
            r["pos"] = r["mcfarlandPos"]
            r["ipa"] = None
            r["kaikkiGlossEn"] = None
            r["reading"] = r["headword"]
            continue
        matched += 1
        r["kaikkiMatched"] = True
        r["pos"] = best["pos"] or r["mcfarlandPos"]
        r["ipa"] = best["ipa"]
        r["kaikkiGlossEn"] = best["glosses"]
        canonical = best["canonical"]
        if canonical and strip_accents(canonical).lower() != canonical.lower():
            # 平仮名同様の理屈: アクセント記号があって初めて意味が出る非デフォルト表記
            r["reading"] = canonical
        elif canonical and canonical.lower() != r["headword"].lower():
            # アクセント記号は無いが見出し語と綴りが違う（大文字化など）ケースの保険
            r["reading"] = canonical
        else:
            r["reading"] = r["headword"]
    log(f"kaikki matched: {matched} / {len(records)} ({matched / len(records) * 100:.1f}%)")


# ---------- 3. Tatoeba TL-EN 例文マイニング ----------
def load_tatoeba_pairs() -> list[tuple[str, str]]:
    log("Tatoeba: parsing tgl-eng links...")
    tgl_to_eng: dict[str, list[str]] = {}
    with bz2.open(TGL_ENG_LINKS_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 2:
                continue
            tgl_id, eng_id = parts
            tgl_to_eng.setdefault(tgl_id, []).append(eng_id)
    needed_tgl = set(tgl_to_eng.keys())
    needed_eng = {eid for ids in tgl_to_eng.values() for eid in ids}
    log(f"Tatoeba: {len(needed_tgl)} tgl ids, {len(needed_eng)} eng ids needed")

    tgl_text: dict[str, str] = {}
    with bz2.open(TGL_SENTENCES_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_tgl:
                tgl_text[sid] = parts[2]
    log(f"Tatoeba: {len(tgl_text)} tgl sentence texts resolved")

    eng_text: dict[str, str] = {}
    with bz2.open(ENG_SENTENCES_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_eng:
                eng_text[sid] = parts[2]
    log(f"Tatoeba: {len(eng_text)} eng sentence texts resolved")

    pairs = []
    for tgl_id, ttext in tgl_text.items():
        for eng_id in tgl_to_eng[tgl_id]:
            if eng_id in eng_text:
                pairs.append((ttext, eng_text[eng_id]))
                break  # 1文につき1訳
    log(f"Tatoeba: {len(pairs)} tl-en sentence pairs assembled")
    return pairs


MAX_EXAMPLES = 3


def attach_examples(records: list[dict], pairs: list[tuple[str, str]]) -> None:
    headwords = sorted({r["headword"] for r in records}, key=len, reverse=True)
    pattern = re.compile(
        r"\b(?:" + "|".join(re.escape(h) for h in headwords) + r")\b",
        re.IGNORECASE,
    )
    by_headword: dict[str, list[dict]] = {h: [] for h in headwords}

    # 短めの自然文を優先（学習者に読みやすい）
    pairs_sorted = sorted(pairs, key=lambda p: len(p[0]))
    for ttext, etext in pairs_sorted:
        found = {m.group(0).lower() for m in pattern.finditer(ttext)}
        if not found:
            continue
        for h in found:
            if h in by_headword and len(by_headword[h]) < MAX_EXAMPLES:
                by_headword[h].append({"tl": ttext, "en": etext})

    for r in records:
        r["matchedTatoebaExamples"] = list(by_headword.get(r["headword"].lower(), []))

    covered = sum(1 for r in records if r["matchedTatoebaExamples"])
    log(f"Tatoeba examples attached: {covered} / {len(records)} words have >=1 example")


# ---------- main ----------
def main():
    t0 = time.time()
    records = load_mcfarland()
    needed_words = {r["headword"].lower() for r in records}

    kaikki_index = load_kaikki_index(needed_words)
    apply_kaikki_match(records, kaikki_index)

    pairs = load_tatoeba_pairs()
    attach_examples(records, pairs)

    out = []
    for r in records:
        out.append(
            {
                "headword": r["headword"],
                "referenceGlossEn": r["referenceGlossEn"],
                "pos": r["pos"],
                "ipa": r["ipa"],
                "reading": r["reading"],
                "frequencyRank": r["rank"],
                "matchedTatoebaExamples": r["matchedTatoebaExamples"],
                # 追加の来歴情報（downstream の8並列バッチが必要に応じて使う。
                # 必須7フィールドを壊さない追加フィールドとして付与）
                "kaikkiMatched": r["kaikkiMatched"],
                "kaikkiGlossEn": r["kaikkiGlossEn"],
                "glossSource": r["glossSource"],
                "mcfarlandAlt": r["mcfarlandAlt"],
                "mcfarlandGloss": r["mcfarlandGloss"],
                "mcfarlandPos": r["mcfarlandPos"],
            }
        )
    out.sort(key=lambda x: x["frequencyRank"])

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # ---------- 統計 ----------
    total = len(out)
    kaikki_matched = sum(1 for r in out if r["kaikkiMatched"])
    ipa_covered = sum(1 for r in out if r["ipa"])
    accented_reading = sum(1 for r in out if r["reading"] != r["headword"])
    tatoeba_covered = sum(1 for r in out if r["matchedTatoebaExamples"])
    tatoeba_total_examples = sum(len(r["matchedTatoebaExamples"]) for r in out)
    no_reference_gloss = sum(1 for r in out if r["referenceGlossEn"] is None)

    log("=" * 60)
    log(f"総語数: {total}")
    log(f"kaikki突合率: {kaikki_matched}/{total} ({kaikki_matched/total*100:.1f}%)")
    log(f"IPA取得率: {ipa_covered}/{total} ({ipa_covered/total*100:.1f}%)")
    log(f"アクセント表記あり（headwordと異なるreading）: {accented_reading}/{total} ({accented_reading/total*100:.1f}%)")
    log(f"Tatoebaマッチ率（>=1例文）: {tatoeba_covered}/{total} ({tatoeba_covered/total*100:.1f}%)")
    log(f"Tatoeba例文総数: {tatoeba_total_examples} (平均 {tatoeba_total_examples/total:.2f}/語)")
    log(f"referenceGlossEn 欠損: {no_reference_gloss}/{total}")
    log(f"Done in {time.time()-t0:.1f}s -> {OUT_PATH}")


if __name__ == "__main__":
    main()
