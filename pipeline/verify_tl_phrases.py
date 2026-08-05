# -*- coding: utf-8 -*-
"""
タガログ語フレーズコース（tl-phrases-daily）の機械検証（Phase 3・LLM不使用パート）。

生成された450件（pipeline/data/tl-phrases-daily/batch_all_cards.json）に対し、
AI多段検証（Phase 3後半）に回す前の一次スクリーニングを行う。ここで機械的に
判定できることをAIレビューに丸投げしない（コストと見落としの両方を減らす）。

チェック項目:
  ① slotId が全件ちょうど1回ずつ出現し、450件のスロット表と一致する
  ② headword の重複が無い（同じ言い回しが複数スロットに割り当てられていないか）
  ③ register=polite の行に po/ho が実際に含まれるか
  ④ 語彙ゲート：headword の各トークンが tl-0-2k の見出し語（+活用形接頭辞の粗い正規化）
     に含まれる割合。既習語ベースでどれだけ組み立てられているかの目安
  ⑤ Tatoeba attestation：headword の隣接語ペア（bigram）が実際の79,040文コーパスに
     出現するか。0件のスロットは「実在の言い回しかどうか自信が無い」候補として
     AI検証に確実に回す
  ⑥ 文字種・NULバイト・examples必須フィールドの構造チェック

出力: pipeline/data/tl-phrases-daily/verify_report.json
  - passed: 問題なし
  - flagged: 何らかの理由でAI検証に回すべき候補（reasonsに理由を列挙）
"""
import bz2
import json
import re
import unicodedata

DATA_DIR = "data/tl-phrases-daily"
RAW = "raw"


def log(msg: str) -> None:
    print(f"[verify] {msg}", flush=True)


def load_cards():
    with open(f"{DATA_DIR}/batch_all_cards.json", encoding="utf-8") as f:
        return json.load(f)


def load_slots():
    with open(f"{DATA_DIR}/slots.json", encoding="utf-8") as f:
        return json.load(f)


def load_tl_0_2k_headwords() -> set[str]:
    words = set()
    for fname in ["words-00000-01000.json", "words-01000-02000.json"]:
        with open(f"../public/data/courses/tl-0-2k/{fname}", encoding="utf-8") as f:
            cards = json.load(f)
        for c in cards:
            words.add(c["headword"].lower())
    return words


def load_tatoeba_bigrams() -> set[tuple]:
    """Tatoebaタガログ語コーパス（79,040文）から隣接語bigramの集合を作る。"""
    bigrams = set()
    with bz2.open(f"{RAW}/tgl_sentences.tsv.bz2", "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            text = parts[2].lower()
            tokens = re.findall(r"[a-z']+", text)
            for i in range(len(tokens) - 1):
                bigrams.add((tokens[i], tokens[i + 1]))
    return bigrams


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z']+", text.lower())


def strip_affixes_rough(word: str) -> list[str]:
    """タガログ語の代表的な接辞を粗く剥がした候補形を返す（見出し語一致判定の補助）。
    完全な形態素解析ではないので、あくまで語彙ゲートの目安値を上げる目的。"""
    candidates = {word}
    prefixes = ["nakaka", "naka", "nagpa", "pinag", "mapag", "mag", "nag", "pag", "ma", "na", "ka", "i", "pa"]
    for p in prefixes:
        if word.startswith(p) and len(word) > len(p) + 2:
            candidates.add(word[len(p):])
    if word.endswith("in") and len(word) > 4:
        candidates.add(word[:-2])
    if word.endswith("an") and len(word) > 4:
        candidates.add(word[:-2])
    return list(candidates)


STOPWORDS_EN = {
    "the", "a", "an", "of", "in", "on", "for", "with", "by", "or", "and", "is",
    "hi", "hello", "sorry", "ok", "okay",
}


def main():
    cards = load_cards()
    slots = load_slots()
    slot_ids = [s["slotId"] for s in slots]
    slot_by_id = {s["slotId"]: s for s in slots}

    log(f"cards loaded: {len(cards)}, slots: {len(slots)}")

    tl_headwords = load_tl_0_2k_headwords()
    log(f"tl-0-2k headwords loaded: {len(tl_headwords)}")

    log("loading Tatoeba bigrams (this streams the bz2 corpus)...")
    bigrams = load_tatoeba_bigrams()
    log(f"Tatoeba bigrams loaded: {len(bigrams)}")

    # ① slotId 完全性チェック
    card_slot_ids = [c["slotId"] for c in cards]
    dupe_slot_ids = [s for s in set(card_slot_ids) if card_slot_ids.count(s) > 1]
    missing_slot_ids = set(slot_ids) - set(card_slot_ids)
    extra_slot_ids = set(card_slot_ids) - set(slot_ids)

    # ② headword 重複チェック
    hw_norm = {}
    for c in cards:
        key = unicodedata.normalize("NFC", c["headword"]).strip().lower()
        hw_norm.setdefault(key, []).append(c["slotId"])
    dupe_headwords = {k: v for k, v in hw_norm.items() if len(v) > 1}

    flagged = []
    passed = []

    for c in cards:
        reasons = []
        slot = slot_by_id.get(c["slotId"])

        # ③ register=polite の po/ho チェック
        if slot and slot["register"] == "polite":
            hw_lower = c["headword"].lower()
            if not re.search(r"\b(po|ho)\b", hw_lower):
                reasons.append("register=politeだがpo/hoが見当たらない")

        # ⑥ 構造チェック
        if "\x00" in json.dumps(c, ensure_ascii=False):
            reasons.append("NULバイト混入")
        if not c.get("examples") or len(c["examples"]) < 1:
            reasons.append("examplesが空")
        else:
            for ex in c["examples"]:
                if not ex.get("text") or not ex.get("translation"):
                    reasons.append("exampleにtext/translation欠落")
                    break

        # ④ 語彙ゲート
        tokens = [t for t in tokenize(c["headword"]) if t not in STOPWORDS_EN and len(t) > 1]
        if tokens:
            covered = 0
            for t in tokens:
                candidates = strip_affixes_rough(t)
                if any(cand in tl_headwords for cand in candidates):
                    covered += 1
            coverage = covered / len(tokens)
            c["_vocabCoverage"] = round(coverage, 2)
            if coverage < 0.4:
                reasons.append(f"語彙ゲート低め(既習語カバレッジ{coverage:.0%})")
        else:
            c["_vocabCoverage"] = None

        # ⑤ Tatoeba attestation（bigram一致数）
        hw_tokens = tokenize(c["headword"])
        attested = 0
        total_bigrams = max(len(hw_tokens) - 1, 0)
        for i in range(total_bigrams):
            if (hw_tokens[i], hw_tokens[i + 1]) in bigrams:
                attested += 1
        c["_attestedBigrams"] = attested
        c["_totalBigrams"] = total_bigrams
        if total_bigrams > 0 and attested == 0:
            reasons.append("Tatoeba attestation 0件（実在の言い回しか要確認）")

        if reasons:
            flagged.append({"slotId": c["slotId"], "headword": c["headword"], "reasons": reasons})
        else:
            passed.append(c["slotId"])

    report = {
        "totalCards": len(cards),
        "integrity": {
            "dupeSlotIds": dupe_slot_ids,
            "missingSlotIds": sorted(missing_slot_ids),
            "extraSlotIds": sorted(extra_slot_ids),
            "dupeHeadwords": dupe_headwords,
        },
        "passedCount": len(passed),
        "flaggedCount": len(flagged),
        "flagged": flagged,
    }

    with open(f"{DATA_DIR}/verify_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    # cards自体にも診断フィールド(_vocabCoverage, _attestedBigrams等)を付けて保存し直す
    with open(f"{DATA_DIR}/batch_all_cards.json", "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)

    log(f"passed: {len(passed)} / flagged: {len(flagged)}")
    log(f"integrity: dupe_slot_ids={len(dupe_slot_ids)} missing={len(missing_slot_ids)} extra={len(extra_slot_ids)} dupe_headwords={len(dupe_headwords)}")
    log("done -> verify_report.json")


if __name__ == "__main__":
    main()
