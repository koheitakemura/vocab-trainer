# -*- coding: utf-8 -*-
"""
コースA（en-10-30k）の「未使用の生成済みカード」を検索→追加リクエスト機能の在庫として書き出す。

## 背景

5.4のLLMコンテンツバッチ生成（emit_en_10_30k.py の入力）は29,990語ぶん作ったが、実際に
コース本体として出荷したのは12,460語だけ。残り8,324語は訳・例文が完成済みのまま
pipeline/raw/ に眠っている（emit_en_10_30k.py の `excluded_headwords`（判断ログ#32の193語
＋#34の多指標フィルタ8,072語）＋ EXCLUDED_POS（数詞59語）で出荷から外れた分）。

出荷（コース本体の構成）から外す判断と、個人が検索して「知らない語だから追加したい」と
opt-in する判断は別物なので、ここではそれらの除外リストを再適用しない——
「フィルタが行き過ぎて消した語を拾い直す」導線として、有効判定された語は全部プールに入れる。
docs/word-request-design.md §6 参照。

## 出力

public/data/courses/en-10-30k/extra-pool/
  index.json           検索用の軽量インデックス（id・headword・reading のみ）
  shard-<a-z|other>.json  見出し語の先頭文字ごとのフルカード（VocabCard 形状）

cardId は既存の cardId レジストリ（連番・4桁ゼロ埋め）とは別名前空間にする
（`-x` + FNV-1a ハッシュ8桁。id_number() は非数字サフィックスを -1 として無視するため、
連番の採番シーケンスに一切影響しない）。
"""
import json
import os

RAW = "raw"
OUT_DIR = "../public/data/courses/en-10-30k/extra-pool"
SHIPPED_DIR = "../public/data/courses/en-10-30k"
COURSE_ID = "en-10-30k"

KEY_SEP = "␟"  # id_registry.py の KEY_SEP と同じ区切り文字（見出し語/読みの結合に使う）


def log(msg: str) -> None:
    print(f"[build_extra_pool] {msg}", flush=True)


def fnv1a_hex8(s: str) -> str:
    """FNV-1a 32bit。暗号強度は不要（衝突耐性ではなくコース内の内容アドレス化が目的）。"""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def shard_key(headword: str) -> str:
    first = headword[:1].lower()
    return first if "a" <= first <= "z" else "other"


def load_shipped_headwords() -> frozenset[str]:
    headwords = set()
    for fname in os.listdir(SHIPPED_DIR):
        if not fname.startswith("words-") or not fname.endswith(".json"):
            continue
        cards = json.load(open(f"{SHIPPED_DIR}/{fname}", encoding="utf-8"))
        for c in cards:
            headwords.add(c["headword"])
    return frozenset(headwords)


def main() -> None:
    skeleton = json.load(open(f"{RAW}/en-10-30k-skeleton.json", encoding="utf-8"))
    skeleton_by_headword = {s["headword"]: s for s in skeleton}

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

    shipped = load_shipped_headwords()
    log(f"出荷済み見出し語: {len(shipped)}語")

    seen = set()
    cards_by_shard: dict[str, list[dict]] = {}
    n_invalid = 0
    n_shipped = 0
    n_no_skeleton = 0
    n_dup = 0
    for it in all_items:
        headword = it["headword"]
        if not it.get("isValidVocabulary"):
            n_invalid += 1
            continue
        if headword in shipped:
            n_shipped += 1
            continue
        if headword in seen:
            n_dup += 1
            continue
        s = skeleton_by_headword.get(headword)
        if not s:
            n_no_skeleton += 1
            continue
        seen.add(headword)

        reading = s.get("reading")
        card_id = f"{COURSE_ID}-x{fnv1a_hex8(headword + KEY_SEP + (reading or ''))}"
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
            "courseId": COURSE_ID,
            "headword": headword,
            "reading": reading,
            "gloss": it["gloss"],
            "pos": it["pos"],
            "examples": examples,
            "frequencyRank": s.get("frequencyRank", 999999),
        }
        cat = it.get("category")
        if cat and cat != "other":
            card["category"] = cat
        cards_by_shard.setdefault(shard_key(headword), []).append(card)

    total = sum(len(v) for v in cards_by_shard.values())
    log(
        f"プール生成: {total}件 "
        f"(除外: isValidVocabulary=false {n_invalid}件, 出荷済み {n_shipped}件, "
        f"見出し語重複 {n_dup}件, skeleton不在 {n_no_skeleton}件)"
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    index = []
    for shard, cards in sorted(cards_by_shard.items()):
        cards.sort(key=lambda c: c["frequencyRank"])
        with open(f"{OUT_DIR}/shard-{shard}.json", "w", encoding="utf-8") as f:
            json.dump(cards, f, ensure_ascii=False, indent=1)
        for c in cards:
            entry = {"id": c["id"], "headword": c["headword"]}
            if c.get("reading"):
                entry["reading"] = c["reading"]
            index.append(entry)
    log(f"shard-*.json: {len(cards_by_shard)}ファイル")

    index.sort(key=lambda e: e["headword"].lower())
    with open(f"{OUT_DIR}/index.json", "w", encoding="utf-8") as f:
        # 検索用の軽量インデックスなので改行・空白を削る（読む対象ではなく配信対象のため）
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    log(f"index.json: {len(index)}件")


if __name__ == "__main__":
    main()
