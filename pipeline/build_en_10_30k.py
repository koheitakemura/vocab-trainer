# -*- coding: utf-8 -*-
"""
コース A（英語 10k→30k・較正＋マイニング型）の構築パイプライン stage1: スケルトン生成。
判断ログ#28 準拠。build_ja_10_23k.py / build_tl_skeleton.py と同じ stage1/stage2 分割
（このファイルは stage1＝機械的に生成できる部分のみ。グロス確定・カテゴリ分類・コーチ文は
5.4 の LLM コンテンツバッチで別途行う）。

入力:
  raw/en-wordfreq-ranked.json        （gen_en_wordfreq_ranked.py の出力・候補プール）
  raw/spike-en15-30k/ejdict_src/     （EJDict-hand・ejdict.py 経由）
  raw/eng_sentences_full.tsv.bz2 / raw/jpn-eng_links.tsv.bz2 / raw/jpn_sentences_detailed.tsv.bz2
                                      （Tatoeba・build_ja_0_3k.load_tatoeba_pairs を転置）
  raw/spike-en15-30k/jesc_raw.tar.gz （JESC・判断ログ#28で採用確定。例文第2源）
  raw/cmudict.dict                   （CMUdict・arpabet_to_ipa.py 経由）

出力:
  raw/en-10-30k-skeleton.json
"""
import bz2
import json
import re
import tarfile
import time

import ejdict
from arpabet_to_ipa import arpabet_to_ipa, load_cmudict

RAW = "raw"
CANDIDATES_PATH = f"{RAW}/en-wordfreq-ranked.json"
TATOEBA_ENG_PATH = f"{RAW}/eng_sentences_full.tsv.bz2"
TATOEBA_LINKS_PATH = f"{RAW}/jpn-eng_links.tsv.bz2"
TATOEBA_JPN_PATH = f"{RAW}/jpn_sentences_detailed.tsv.bz2"
JESC_PATH = f"{RAW}/spike-en15-30k/jesc_raw.tar.gz"
OUT_PATH = f"{RAW}/en-10-30k-skeleton.json"

MAX_CANDIDATE_RANK = 30_000  # 判断ログ#28: 実測で届いた語数で確定する前提の作業上限
MAX_EXAMPLES = 3
WORD_RE = re.compile(r"[A-Za-z']+")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------- 1. 候補プール読み込み ----------
def load_candidates() -> list[dict]:
    data = json.load(open(CANDIDATES_PATH, encoding="utf-8"))
    candidates = [c for c in data if c["candidateRank"] <= MAX_CANDIDATE_RANK]
    log(f"候補プール読み込み: {len(candidates)} レンマ（candidateRank<={MAX_CANDIDATE_RANK}）")
    return candidates


# ---------- 2. lemminflect の全屈折形（マッチ用のバリエーション集合） ----------
def build_variant_index(candidates: list[dict]) -> dict[str, str]:
    """表層形バリアント -> レンマ の逆引き辞書（例文コーパスの走査で使う）。
    候補プール自身の lemma/surfaceForm に加え、lemminflect の全屈折形も足す
    （gen_en_wordfreq_ranked.py の厳密なレンマ化と違い、ここは「例文中にこの語の
    どれかの活用形が出現するか」を測る緩いマッチ集合でよい）。"""
    from lemminflect import getAllInflectionsOOV

    variant_to_lemma: dict[str, str] = {}
    for c in candidates:
        lemma = c["lemma"]
        forms = {lemma, c["surfaceForm"]}
        for upos in ("NOUN", "VERB", "ADJ", "ADV"):
            infl = getAllInflectionsOOV(lemma, upos)
            for form_tuple in infl.values():
                forms.update(form_tuple)
        for f in forms:
            f = f.lower()
            # 短すぎる/既に別レンマに割り当て済みのバリアントは頻度の高い方(先勝ち=候補プールは
            # 既にrank昇順)を優先。曖昧な1-2文字の重複はまず起きない想定（フィルタ済み）。
            variant_to_lemma.setdefault(f, lemma)
    log(f"例文マッチ用バリアント辞書: {len(variant_to_lemma)} 表層形 -> {len(candidates)} レンマ")
    return variant_to_lemma


# ---------- 3. Tatoeba（転置）: 英語見出し語 -> 日本語訳ペア ----------
def load_tatoeba_pairs() -> list[tuple[str, str]]:
    log("Tatoeba: jpn-eng links を解析中...")
    eng_to_jpn: dict[str, list[str]] = {}
    with bz2.open(TATOEBA_LINKS_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 2:
                continue
            jpn_id, eng_id = parts
            eng_to_jpn.setdefault(eng_id, []).append(jpn_id)
    needed_eng = set(eng_to_jpn.keys())
    needed_jpn = {jid for ids in eng_to_jpn.values() for jid in ids}
    log(f"Tatoeba: {len(needed_eng)} eng ids, {len(needed_jpn)} jpn ids needed")

    jpn_text: dict[str, str] = {}
    with bz2.open(TATOEBA_JPN_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_jpn:
                jpn_text[sid] = parts[2]
    log(f"Tatoeba: {len(jpn_text)} jpn sentence texts resolved")

    eng_text: dict[str, str] = {}
    with bz2.open(TATOEBA_ENG_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sid = parts[0]
            if sid in needed_eng:
                eng_text[sid] = parts[2]
    log(f"Tatoeba: {len(eng_text)} eng sentence texts resolved")

    pairs = []
    for eng_id, etext in eng_text.items():
        for jpn_id in eng_to_jpn[eng_id]:
            if jpn_id in jpn_text:
                pairs.append((etext, jpn_text[jpn_id]))
                break  # 1文につき1訳
    log(f"Tatoeba: {len(pairs)} en-ja sentence pairs assembled")
    return pairs


def attach_examples_from_pairs(
    by_lemma: dict[str, list[dict]],
    pairs: list[tuple[str, str]],
    variant_to_lemma: dict[str, str],
    source: str,
) -> int:
    """(英文,日本語文) のペア群から、まだ MAX_EXAMPLES 未満のレンマへ例文を追加する。
    短い自然文を優先（学習者に読みやすい）。1件のペアにつき複数レンマへ紐付く場合もある。"""
    pairs_sorted = sorted(pairs, key=lambda p: len(p[0]))
    attached = 0
    for etext, jtext in pairs_sorted:
        tokens = {t.lower() for t in WORD_RE.findall(etext)}
        matched_lemmas = {variant_to_lemma[t] for t in tokens if t in variant_to_lemma}
        for lemma in matched_lemmas:
            slots = by_lemma.get(lemma)
            if slots is not None and len(slots) < MAX_EXAMPLES:
                slots.append({"en": etext, "ja": jtext, "source": source})
                attached += 1
    return attached


def attach_examples_from_jesc(
    by_lemma: dict[str, list[dict]], variant_to_lemma: dict[str, str]
) -> int:
    """JESC(raw.tar.gz, "英文\\t日本語文" 形式・280万行)をストリームで1回走査し、
    Tatoebaで埋まらなかったレンマへ例文を補完する（判断ログ#28: 採用確定）。
    充足済みレンマの除去は「未充足レンマ数」自体が閾値を下回るまで一括で行い
    （行ごとの逐次 dict 再構築は 147k エントリ規模で O(行数×未充足数) に爆発するため避ける）、
    完全に埋まったレンマの variant は set の差分削除だけで軽く落とす。"""
    still_needed = {lm for lm, slots in by_lemma.items() if len(slots) < MAX_EXAMPLES}
    if not still_needed:
        return 0
    needed_variants = {v: lm for v, lm in variant_to_lemma.items() if lm in still_needed}
    log(f"JESC走査: {len(still_needed)} レンマが未充足 -> {len(needed_variants)} バリアントで検索")

    attached = 0
    n_lines = 0
    filled_since_prune = 0
    PRUNE_EVERY = 500  # 充足レンマが一定数溜まったらまとめて variant 辞書から間引く
    filled_lemmas: set[str] = set()
    t0 = time.time()
    with tarfile.open(JESC_PATH, "r:gz") as tf:
        member = next(m for m in tf.getmembers() if m.isfile())
        f = tf.extractfile(member)
        for raw_line in f:
            n_lines += 1
            if n_lines % 1_000_000 == 0:
                log(f"  ...JESC {n_lines}行処理済み・未充足{len(still_needed)}レンマ ({time.time()-t0:.0f}s)")
            line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            etext, jtext = parts[0], parts[1]
            tokens = {t.lower() for t in WORD_RE.findall(etext)}
            matched = {needed_variants[t] for t in tokens if t in needed_variants}
            for lemma in matched:
                slots = by_lemma[lemma]
                if len(slots) < MAX_EXAMPLES:
                    slots.append({"en": etext, "ja": jtext, "source": "jesc"})
                    attached += 1
                    if len(slots) >= MAX_EXAMPLES:
                        still_needed.discard(lemma)
                        filled_lemmas.add(lemma)
                        filled_since_prune += 1
            if filled_since_prune >= PRUNE_EVERY:
                needed_variants = {v: lm for v, lm in needed_variants.items() if lm not in filled_lemmas}
                filled_lemmas.clear()
                filled_since_prune = 0
            if not still_needed:
                log(f"  ...全レンマ充足につき走査打ち切り ({n_lines}行, {time.time()-t0:.0f}s)")
                break
    log(f"JESC走査完了: {n_lines}行 ({time.time()-t0:.0f}s)")
    return attached


# ---------- main ----------
def main():
    t0 = time.time()
    candidates = load_candidates()
    variant_to_lemma = build_variant_index(candidates)

    log("EJDict-hand index 構築中...")
    ejdict_index, ejdict_stats = ejdict.build_index()
    log(f"EJDict-hand: {ejdict_stats}")

    log("CMUdict 読み込み中...")
    cmu = load_cmudict()
    log(f"CMUdict: {len(cmu)} words")

    by_lemma: dict[str, list[dict]] = {c["lemma"]: [] for c in candidates}

    tatoeba_pairs = load_tatoeba_pairs()
    n_tatoeba = attach_examples_from_pairs(by_lemma, tatoeba_pairs, variant_to_lemma, "tatoeba")
    log(f"Tatoeba例文アタッチ: {n_tatoeba}件")

    n_jesc = attach_examples_from_jesc(by_lemma, variant_to_lemma)
    log(f"JESC例文アタッチ: {n_jesc}件")

    out = []
    for c in candidates:
        lemma = c["lemma"]
        gloss = ejdict.resolve_gloss(lemma, ejdict_index) or ejdict.resolve_gloss(
            c["surfaceForm"], ejdict_index
        )
        phonemes = cmu.get(lemma) or cmu.get(c["surfaceForm"])
        ipa = arpabet_to_ipa(phonemes) if phonemes else None
        out.append(
            {
                "headword": lemma,
                "surfaceForm": c["surfaceForm"],
                "frequencyRank": c["candidateRank"],
                "zipf": c["zipf"],
                "ejdictGlossEn": gloss,
                "reading": f"/{ipa}/" if ipa else None,
                "examples": by_lemma[lemma],
            }
        )

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # ---------- 統計 ----------
    total = len(out)
    gloss_covered = sum(1 for r in out if r["ejdictGlossEn"])
    ipa_covered = sum(1 for r in out if r["reading"])
    example_covered = sum(1 for r in out if r["examples"])
    both_covered = sum(1 for r in out if r["ejdictGlossEn"] and r["examples"])

    log("=" * 70)
    log(f"総語数: {total}")
    log(f"EJDictグロス充足: {gloss_covered}/{total} ({gloss_covered/total*100:.1f}%)")
    log(f"CMUdict発音充足: {ipa_covered}/{total} ({ipa_covered/total*100:.1f}%)")
    log(f"例文充足(Tatoeba+JESC): {example_covered}/{total} ({example_covered/total*100:.1f}%)")
    log(f"グロス+例文の両方充足: {both_covered}/{total} ({both_covered/total*100:.1f}%)")
    for lo, hi in ((1, 10_000), (10_001, 20_000), (20_001, 30_000)):
        band = [r for r in out if lo <= r["frequencyRank"] <= hi]
        g = sum(1 for r in band if r["ejdictGlossEn"])
        e = sum(1 for r in band if r["examples"])
        b = sum(1 for r in band if r["ejdictGlossEn"] and r["examples"])
        log(f"  rank{lo}-{hi}: グロス{g}/{len(band)}({g/len(band)*100:.1f}%) "
            f"例文{e}/{len(band)}({e/len(band)*100:.1f}%) "
            f"両方{b}/{len(band)}({b/len(band)*100:.1f}%)")
    log(f"Done in {time.time()-t0:.1f}s -> {OUT_PATH}")


if __name__ == "__main__":
    main()
