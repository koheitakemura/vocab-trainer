# -*- coding: utf-8 -*-
"""
コース C（日本語 0→3,000・メンバー系）の本物データパイプライン。

ソース（全て再配布可能なオープンデータ・PLAN.md §5.3/§5.4 準拠）:
- JLPT語彙骨格: Bluskyo/JLPT_Vocabulary（tanos.co.uk 由来・CC BY）N5+N4+N3
- 見出し語/読み/英訳/品詞: JMdict（jmdict-simplified・EDRDG licence）
- 頻度順: wordfreq ja
- 例文: Tatoeba（jpn-eng 対訳ペア・CC BY 2.0 FR）
- ふりがな: 不要（reading は JMdict の kana フィールドで足りる。調査で確認済み）

出力: public/data/courses/ja-0-3k/ 配下の静的 JSON（VocabCard[] 形状）
"""
import bz2
import csv
import json
import re
import sys
import time
import zipfile
from collections import defaultdict

sys.path.insert(0, ".")
from emit import emit_course, validate_records
from pos_map import pos_label

RAW = "raw"
OUT = "../public/data/courses"
COURSE_ID = "ja-0-3k"

LEVELS = [("N5", "n5.csv"), ("N4", "n4.csv"), ("N3", "n3.csv")]
LEVEL_ORDER = {"N5": 0, "N4": 1, "N3": 2}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------- 1. JLPT 語彙骨格 ----------
def load_jlpt() -> list[dict]:
    words = []
    seen = set()
    for level, fname in LEVELS:
        with open(f"{RAW}/{fname}", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                kanji = row["Kanji"].strip()
                reading = row["Reading"].strip()
                key = (kanji, reading)
                if not kanji or key in seen:
                    continue
                seen.add(key)
                words.append({"kanji": kanji, "reading": reading, "level": level})
    log(f"JLPT words loaded: {len(words)} (N5={sum(1 for w in words if w['level']=='N5')}, "
        f"N4={sum(1 for w in words if w['level']=='N4')}, N3={sum(1 for w in words if w['level']=='N3')})")
    return words


# ---------- 2. JMdict ----------
def load_jmdict_index():
    with zipfile.ZipFile(f"{RAW}/jmdict-eng.json.zip") as z:
        name = [n for n in z.namelist() if n.endswith(".json")][0]
        with z.open(name) as f:
            data = json.load(f)
    by_kanji = defaultdict(list)
    # 読み文字列 -> [(entry, その読みが common か), ...]。漢字の有無を問わず全エントリを対象にする。
    # JLPT リストが「なる」「これ」のようにかな表記していても、実際は 成る/此れ のように
    # 漢字見出しを持つ常用語であることが多いため、見出しの有無で検索範囲を絞ってはいけない。
    by_kana = defaultdict(list)
    for w in data["words"]:
        for k in w["kanji"]:
            by_kanji[k["text"]].append(w)
        for k in w["kana"]:
            by_kana[k["text"]].append((w, k["common"]))
    log(f"JMdict indexed: {len(data['words'])} entries, {len(by_kanji)} kanji headwords, "
        f"{len(by_kana)} kana readings")
    return by_kanji, by_kana


def entry_gloss_and_pos(entry: dict) -> tuple[str, str]:
    sense = entry["sense"][0]
    glosses = [g["text"] for g in sense["gloss"] if g["lang"] == "eng"][:3]
    gloss = "; ".join(glosses) if glosses else ""
    pos = pos_label(sense.get("partOfSpeech", []))
    return gloss, pos


def match_jmdict(jlpt_words: list[dict], by_kanji: dict, by_kana: dict) -> list[dict]:
    matched = []
    unmatched = 0
    for w in jlpt_words:
        kanji, reading, level = w["kanji"], w["reading"], w["level"]
        entry = None
        if kanji == reading:
            # かな表記の語: 読みで全エントリを引き、その読みが common なものを優先
            # （同音の稀な語尾・接尾辞エントリなどに誤って一致するのを防ぐ）
            candidates = by_kana.get(reading, [])
            common = [e for e, is_common in candidates if is_common]
            entry = common[0] if common else (candidates[0][0] if candidates else None)
        else:
            # 漢字見出しの語: 同じ漢字を持つ候補の中から、読みが一致しかつ common な
            # エントリを優先。無ければ読み一致のみ、それも無ければ先頭候補。
            candidates = by_kanji.get(kanji, [])
            best = None
            for c in candidates:
                kana_hit = next((k for k in c["kana"] if k["text"] == reading), None)
                if kana_hit and kana_hit["common"]:
                    best = c
                    break
                if kana_hit and best is None:
                    best = c
            entry = best or (candidates[0] if candidates else None)
        if entry is None:
            unmatched += 1
            continue
        gloss, pos = entry_gloss_and_pos(entry)
        if not gloss:
            unmatched += 1
            continue
        matched.append(
            {
                "headword": kanji,
                "reading": reading,
                "gloss": gloss,
                "pos": pos,
                "jlptLevel": level,
            }
        )
    log(f"JMdict matched: {len(matched)} / {len(jlpt_words)} (unmatched/no-gloss: {unmatched})")
    return matched


# ---------- 3. wordfreq による頻度順 ----------
def apply_frequency_order(words: list[dict]) -> list[dict]:
    from wordfreq import zipf_frequency

    for w in words:
        z = zipf_frequency(w["headword"], "ja")
        if z == 0:
            z = zipf_frequency(w["reading"], "ja")
        w["_zipf"] = z

    words.sort(key=lambda w: (LEVEL_ORDER[w["jlptLevel"]], -w["_zipf"]))
    for i, w in enumerate(words, start=1):
        w["frequencyRank"] = i
    log("Frequency ordering applied (level-primary, wordfreq-secondary)")
    return words


# ---------- 4. Tatoeba 例文マイニング ----------
def load_tatoeba_pairs() -> list[tuple[str, str]]:
    log("Tatoeba: parsing links...")
    jpn_to_eng = defaultdict(list)
    with bz2.open(f"{RAW}/jpn-eng_links.tsv.bz2", "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 2:
                continue
            jpn_id, eng_id = parts
            jpn_to_eng[jpn_id].append(eng_id)
    needed_jpn = set(jpn_to_eng.keys())
    needed_eng = {eid for ids in jpn_to_eng.values() for eid in ids}
    log(f"Tatoeba: {len(needed_jpn)} jpn ids, {len(needed_eng)} eng ids needed")

    jpn_text = {}
    with bz2.open(f"{RAW}/jpn_sentences_detailed.tsv.bz2", "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_jpn:
                jpn_text[sid] = parts[2]
    log(f"Tatoeba: {len(jpn_text)} jpn sentence texts resolved")

    eng_text = {}
    with bz2.open(f"{RAW}/eng_sentences_detailed.tsv.bz2", "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_eng:
                eng_text[sid] = parts[2]
    log(f"Tatoeba: {len(eng_text)} eng sentence texts resolved")

    pairs = []
    for jpn_id, jtext in jpn_text.items():
        for eng_id in jpn_to_eng[jpn_id]:
            if eng_id in eng_text:
                pairs.append((jtext, eng_text[eng_id]))
                break  # 1文につき1訳（重複っぽい例文の増殖を避ける）
    log(f"Tatoeba: {len(pairs)} ja-en sentence pairs assembled")
    return pairs


SENTENCE_END = ("。", "！", "？", "!", "?")
TARGET_LEN = 16  # 初級学習者に読みやすい文長の目安


def _is_natural_sentence(text: str) -> bool:
    # 句点/疑問符/感嘆符で終わらないものは慣用句・四字熟語の単独登録が多く、例文として不適
    return text.endswith(SENTENCE_END) and len(text) >= 4


def _load_tagger():
    import MeCab
    import unidic_lite

    dicdir = unidic_lite.DICDIR.replace("\\", "/")
    return MeCab.Tagger(f'-d "{dicdir}"')


_TAGGER = None


def _token_spans(text: str) -> list[tuple[int, int]]:
    """全文を隙間なく覆うトークンの (start, end) 文字オフセット一覧。"""
    global _TAGGER
    if _TAGGER is None:
        _TAGGER = _load_tagger()
    spans = []
    pos = 0
    node = _TAGGER.parseToNode(text)
    while node:
        surf = node.surface
        if surf:
            idx = text.find(surf, pos)
            if idx == -1:
                idx = pos
            spans.append((idx, idx + len(surf)))
            pos = idx + len(surf)
        node = node.next
    return spans


def _aligned_headwords(candidates: set[str], text: str) -> set[str]:
    """candidates のうち、text 中で単なる部分文字列ではなく、形態素境界に
    一致する（=語として実際に出現している）ものだけを返す。

    素朴な部分文字列一致だと「港」が「香港」に、「中」が「田中」に、
    「島」が「広島」に誤ヒットし、見出し語の意味と無関係な例文が
    紐付いてしまう（2026-07 に3,075語中516語で実際に発生した不具合）。
    """
    if not candidates:
        return set()
    spans = _token_spans(text)
    starts = {s for s, _ in spans}
    ends = {e for _, e in spans}
    aligned = set()
    for h in candidates:
        for m in re.finditer(re.escape(h), text):
            if m.start() in starts and m.end() in ends:
                aligned.add(h)
                break
    return aligned


def attach_examples(words: list[dict], pairs: list[tuple[str, str]], max_examples: int = 2) -> None:
    headwords = sorted({w["headword"] for w in words}, key=len, reverse=True)
    pattern = re.compile("|".join(re.escape(h) for h in headwords))
    by_headword = defaultdict(list)

    # 自然な文（句点等で終わる）を長さのターゲットに近い順で優先 → 慣用句/断片より
    # 「学習者が読める短い完全文」を先に埋める。届かない語は後段で範囲を緩和。
    natural = [p for p in pairs if _is_natural_sentence(p[0]) and len(p[0]) <= 40]
    natural.sort(key=lambda p: abs(len(p[0]) - TARGET_LEN))
    for jtext, etext in natural:
        candidates = set(pattern.findall(jtext))
        for m in _aligned_headwords(candidates, jtext):
            if len(by_headword[m]) < max_examples:
                by_headword[m].append({"text": jtext, "translation": etext})

    # 上記だけでは埋まらなかった語は、文長・句点条件を緩めて補完
    remaining_words = {w["headword"] for w in words if len(by_headword[w["headword"]]) < max_examples}
    if remaining_words:
        pattern2 = re.compile("|".join(re.escape(h) for h in sorted(remaining_words, key=len, reverse=True)))
        fallback = sorted(pairs, key=lambda p: len(p[0]))
        for jtext, etext in fallback:
            candidates = set(pattern2.findall(jtext)) & remaining_words
            for m in _aligned_headwords(candidates, jtext):
                if len(by_headword[m]) < max_examples:
                    by_headword[m].append({"text": jtext, "translation": etext})

    covered = sum(1 for w in words if by_headword[w["headword"]])
    log(f"Examples attached: {covered} / {len(words)} words have >=1 example")

    for w in words:
        w["examples"] = by_headword[w["headword"]]


# ---------- main ----------
def main():
    t0 = time.time()
    jlpt_words = load_jlpt()
    by_kanji, by_kana = load_jmdict_index()
    matched = match_jmdict(jlpt_words, by_kanji, by_kana)
    matched = apply_frequency_order(matched)

    pairs = load_tatoeba_pairs()
    attach_examples(matched, pairs)

    for w in matched:
        w.pop("_zipf", None)

    errors = validate_records(matched)
    if errors:
        log(f"VALIDATION ERRORS ({len(errors)}):")
        for e in errors[:20]:
            log(f"  - {e}")
        raise SystemExit(1)

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese 0 → 3,000",
        "learningLanguage": "Japanese",
        "glossLanguage": "English",
        "uiLanguage": "en",
        "type": "rail",
        "band": {"from": 0, "to": 3000},
    }
    emit_course(COURSE_ID, course_meta, matched, OUT)
    log(f"Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
