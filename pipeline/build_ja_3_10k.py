# -*- coding: utf-8 -*-
"""
コース D（日本語 3,000→10,000・cloze 主軸）の構築パイプライン。判断ログ #16/#18/#21・PLAN §5.3/§7 準拠。

2 段構成（このファイル1本で完結・再実行可能）:

- stage 1（build_skeleton）: 「見出し語＋読み＋品詞＋英語参照グロス＋頻度順＋Tatoeba 例文
  （cloze マークアップつき）」までを機械的に生成する。raw/ja-3-10k-skeleton.json に書く。
  ソース（全て再配布可能なオープンデータ）:
    - 見出し語プール:
        - tanos JLPT N2（raw/n2.csv）＋ N1（raw/n1.csv）— tanos.co.uk 由来・CC BY
          ⚠️ kanji==reading かつ 長さ1 の単一カナ断片行は除外（N2 に7件・N1 に2件混入）
        - 非JLPT 語: JMdict 全件を wordfreq ja 頻度順に並べ、**JMdict common フラグでゲート**して
          不足分を補充（Phase 0.4 実測: common ゲート方式で混入率 0.2%台）
        - 既存コース C（public/data/courses/ja-0-3k）の見出し語は**全除外**
    - 見出し語/読み/英訳/品詞: JMdict（jmdict-simplified・EDRDG licence）
    - 頻度順: wordfreq ja
    - 例文: Tatoeba（jpn-eng 対訳ペア・CC BY 2.0 FR）＋ MeCab トークン境界一致で cloze 化
  build_ja_0_3k.py のロジックを最大限そのまま再利用する（import して呼ぶ）。

- stage 2（merge_and_emit）: raw/ja-3-10k-content-batches/batch-00〜13.json（LLM が
  グロス(タガログ語)・pos(日本語ラベル)・category・例文の対訳を確定させた「中身」・
  全14ファイル計7,000件必須）を frequencyRank でスケルトンと突合し、pos を
  コース C 準拠のタガログ語ラベルへ機械変換、senseMismatch フラグ付き例文を除外した上で
  public/data/courses/ja-3-10k/ に VocabCard[]（+categories.json）として書き出す。

出力: raw/ja-3-10k-skeleton.json（中間成果物）／public/data/courses/ja-3-10k/（最終成果物）
"""
import csv
import json
import os
import re
import sys
import time
from collections import defaultdict

sys.path.insert(0, ".")
import build_ja_0_3k as base  # load_jmdict_index / match_jmdict / entry_gloss_and_pos /
#                               load_tatoeba_pairs / _token_spans / _is_natural_sentence /
#                               TARGET_LEN / SENTENCE_END を再利用
from emit import emit_course, validate_records  # noqa: E402  (stage 2: マージ・出力)
from pos_map import pos_label  # noqa: F401  (base 経由でも使うが明示 import して意図を残す)

RAW = "raw"
COURSE_C_DIR = "../public/data/courses/ja-0-3k"
OUT_PATH = f"{RAW}/ja-3-10k-skeleton.json"
OUT = "../public/data/courses"
COURSE_ID = "ja-3-10k"
BATCH_DIR = f"{RAW}/ja-3-10k-content-batches"
N_BATCHES = 14

TARGET_TOTAL = 7000

# ---------- stage 2: 品詞（日本語ラベル）→ タガログ語ラベル変換 ----------
# コース C（ja-0-3k）準拠のタガログ語 pos ラベルへの決定的変換。バッチは日本語ラベルで
# 出力しているため、ここで機械変換する（LLM判断を挟まない）。マップに無いラベルは
# pangngalan にフォールバックする（呼び出し側が該当語を報告する）。
POS_JA_TO_TL = {
    "名詞": "pangngalan",
    "固有名詞": "pangngalan",
    "代名詞": "panghalip",
    "動詞": "pandiwa",
    "サ変動詞": "pandiwa (suru)",
    "する動詞": "pandiwa (suru)",
    "カ変動詞": "pandiwa (kuru)",
    "来る": "pandiwa (kuru)",
    "形容詞": "pang-uri (i)",
    "い形容詞": "pang-uri (i)",
    "形容動詞": "pang-uri (na)",
    "な形容詞": "pang-uri (na)",
    "の形容詞": "pang-uri (no)",
    "連体詞": "pang-uri",
    "副詞": "pang-abay",
    "接続詞": "pangatnig",
    "数詞": "bilang",
    "数字": "bilang",
    "助数詞": "bilang",
    "感動詞": "pandamdam",
    "接頭辞": "unlapi",
    "接頭語": "unlapi",
    "接尾辞": "hulapi",
    "接尾語": "hulapi",
    "助詞": "kataga",
    "助動詞": "pantulong",
    "連語": "parirala",
    "表現": "parirala",
    "慣用句": "parirala",
}
POS_FALLBACK = "pangngalan"

# コース D の見出し語プールの level 一次ソート順（コース C の N5<N4<N3 の続き）。
# 非JLPT（None）は最後尾。二次ソートは wordfreq zipf 降順。
LEVEL_ORDER = {"N2": 0, "N1": 1, None: 2}

# cloze 空欄 sentinel（src/srs/cloze.ts CLOZE_BLANK と一致・U+FF5F U+FF3F U+FF60）
SENTINEL = "｟＿｠"

# 非JLPT 頻度フィルから除外する機能語（文法語）の pos ラベル。
# common フラグだけでは、は/が/を（助詞）・だ/です/である（コピュラ・助動詞）・
# とは/のだ/にしても（連語=expression）等の超高頻度な文法語が頻度順の先頭に殺到する
# （実測: 無フィルタだと fill 上位 40+ がほぼ機能語）。JLPT リストは curated なのでこの
# 汚染は fill 側だけに出る。語彙コースの見出し語＝内容語に限るため pos で機能語を落とす。
FUNCTION_POS = {
    "particle",
    "copula",
    "auxiliary",
    "auxiliary verb",
    "auxiliary adjective",
    "expression",
    "conjunction",
    "prefix",
    "suffix",
}

log = base.log


# ---------- 1. JLPT N2/N1 見出し語プール ----------
def load_jlpt_n2_n1() -> list[dict]:
    """N2→N1 の順で (kanji, reading, level) を読み込む。
    単一カナ断片行（kanji==reading かつ len==1）を除外し、(kanji,reading) で重複排除。
    """
    words = []
    seen = set()
    dropped_frag = 0
    for level, fname in [("N2", "n2.csv"), ("N1", "n1.csv")]:
        with open(f"{RAW}/{fname}", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                kanji = row["Kanji"].strip()
                reading = row["Reading"].strip()
                if not kanji:
                    continue
                # ⚠️必須フィルタ: 単一カナ断片（「た」「い」等）は JMdict の無関係語に誤マッチする
                if kanji == reading and len(kanji) == 1:
                    dropped_frag += 1
                    continue
                key = (kanji, reading)
                if key in seen:
                    continue
                seen.add(key)
                words.append({"kanji": kanji, "reading": reading, "level": level})
    log(
        f"JLPT N2/N1 loaded: {len(words)} "
        f"(N2={sum(1 for w in words if w['level']=='N2')}, "
        f"N1={sum(1 for w in words if w['level']=='N1')}; "
        f"single-kana fragments dropped={dropped_frag})"
    )
    return words


# ---------- 2. コース C 見出し語の除外セット ----------
def load_course_c_headwords() -> set[str]:
    manifest = json.load(open(f"{COURSE_C_DIR}/manifest.json", encoding="utf-8"))
    hw = set()
    for band in manifest["bands"]:
        for card in json.load(open(f"{COURSE_C_DIR}/{band}", encoding="utf-8")):
            hw.add(card["headword"])
    log(f"Course C headwords to exclude: {len(hw)}")
    return hw


# ---------- 3. 非JLPT 頻度フィル（JMdict common ゲート） ----------
def build_nonjlpt_fill(jmdict_words: list[dict], exclude: set[str], needed: int) -> list[dict]:
    """JMdict 全件から common フラグの立つエントリの代表見出しを取り、wordfreq ja 頻度順に
    並べ、exclude を除いた上位 `needed` 語を返す。各 dict は
    {headword, reading, referenceGlossEn, pos, jlptLevel=None, _zipf}。
    """
    from wordfreq import zipf_frequency

    n_fn_filtered = 0
    n_kana_frag = 0
    candidates = []  # (zipf, headword, reading, gloss, pos)
    for w in jmdict_words:
        kanji_list = w.get("kanji", [])
        kana_list = w.get("kana", [])
        if kanji_list:
            common_kanji = [k for k in kanji_list if k.get("common")]
            if not common_kanji:
                continue  # common ゲート: 常用でない漢字見出しは採らない
            headword = common_kanji[0]["text"]
            common_kana = [k for k in kana_list if k.get("common")]
            reading = (
                common_kana[0]["text"]
                if common_kana
                else (kana_list[0]["text"] if kana_list else headword)
            )
        else:
            # かな専用語（外来語・一部の文法/機能語など）
            common_kana = [k for k in kana_list if k.get("common")]
            if not common_kana:
                continue  # common ゲート
            headword = common_kana[0]["text"]
            reading = headword
            # 単一かな見出しは（コピュラ/助詞/間投詞など）内容語ではないので落とす
            # ＝JLPT 側の「単一カナ断片」フィルタを fill 側にも水平展開
            if len(headword) == 1:
                n_kana_frag += 1
                continue
        gloss, pos = base.entry_gloss_and_pos(w)
        if not gloss:
            continue
        # 機能語（助詞・コピュラ・助動詞・連語・接続詞・接辞）は語彙見出しにしない
        if pos in FUNCTION_POS:
            n_fn_filtered += 1
            continue
        z = zipf_frequency(headword, "ja")
        if z == 0:
            z = zipf_frequency(reading, "ja")
        candidates.append((z, headword, reading, gloss, pos))

    candidates.sort(key=lambda c: -c[0])

    fill = []
    used = set(exclude)
    for z, headword, reading, gloss, pos in candidates:
        if len(fill) >= needed:
            break
        if headword in used:
            continue
        used.add(headword)
        fill.append(
            {
                "headword": headword,
                "reading": reading,
                "referenceGlossEn": gloss,
                "pos": pos,
                "jlptLevel": None,
                "_zipf": z,
            }
        )
    log(
        f"Non-JLPT fill: {len(fill)} words (needed {needed}; "
        f"common-gated candidate pool={len(candidates)}; "
        f"function-word pos filtered={n_fn_filtered}, single-kana filtered={n_kana_frag})"
    )
    return fill


# ---------- 4. 頻度順（level 一次・wordfreq 二次） ----------
def apply_frequency_order(words: list[dict]) -> list[dict]:
    from wordfreq import zipf_frequency

    for w in words:
        if "_zipf" not in w:
            z = zipf_frequency(w["headword"], "ja")
            if z == 0:
                z = zipf_frequency(w["reading"] or w["headword"], "ja")
            w["_zipf"] = z
    words.sort(key=lambda w: (LEVEL_ORDER[w["jlptLevel"]], -w["_zipf"]))
    for i, w in enumerate(words, start=1):
        w["frequencyRank"] = i
    log("Frequency ordering applied (level-primary N2<N1<non-JLPT, wordfreq-secondary)")
    return words


# ---------- 5. Tatoeba 例文 + cloze マークアップ ----------
def _make_cloze(headword: str, text: str, starts: set[int], ends: set[int]) -> str | None:
    """text 中で headword が形態素境界に一致して出現する箇所を全て sentinel に置換した
    cloze 文字列を返す。境界一致する出現が1つも無ければ None（＝クリーンにクローズ不可）。
    """
    out = []
    last = 0
    replaced = False
    for m in re.finditer(re.escape(headword), text):
        if m.start() in starts and m.end() in ends:
            out.append(text[last:m.start()])
            out.append(SENTINEL)
            last = m.end()
            replaced = True
    if not replaced:
        return None
    out.append(text[last:])
    return "".join(out)


def attach_examples_with_cloze(words: list[dict], pairs, max_examples: int = 2) -> dict:
    """各語に Tatoeba 例文を 1〜2 文紐づけ、同時に cloze を生成する。

    例文は「見出し語が MeCab トークン境界に一致して出現する文」だけを採用する
    （build_ja_0_3k.attach_examples と同じ厳密マッチ）。採用された例文は必ず
    その境界一致スパンを sentinel 化した cloze を持つ（＝境界チェックを cloze 生成と
    一体化したので、採用例文の cloze 化率は構造上 100%）。
    """
    all_headwords = {w["headword"] for w in words}
    pattern = re.compile("|".join(re.escape(h) for h in sorted(all_headwords, key=len, reverse=True)))
    by_headword: dict[str, list[dict]] = defaultdict(list)

    def try_sentence(jtext: str, etext: str, allowed: set | None) -> None:
        cands = set(pattern.findall(jtext))
        if allowed is not None:
            cands &= allowed
        if not cands:
            return
        # まだ埋まっていない候補だけ残す
        cands = {h for h in cands if len(by_headword[h]) < max_examples}
        if not cands:
            return
        spans = base._token_spans(jtext)
        starts = {s for s, _ in spans}
        ends = {e for _, e in spans}
        for h in cands:
            # Tatoeba には同一の日本語文が別IDで重複投稿されている（訳違い）ケースが
            # 多く、素朴に採用すると同じ語に「同じ文が2回」という無意味な重複例文が
            # 生まれる（実測: 対策前は語の10%で発生。コースC相当の0.7%程度まで抑える）。
            if any(ex["text"] == jtext for ex in by_headword[h]):
                continue
            cloze = _make_cloze(h, jtext, starts, ends)
            if cloze is None:
                continue  # 境界一致しない部分文字列マッチ（例: 「中」in「田中」）→ 不採用
            by_headword[h].append({"text": jtext, "en": etext, "cloze": cloze})

    # Pass 1: 句点等で終わる自然文を、学習者が読みやすい文長ターゲット順に優先
    natural = [p for p in pairs if base._is_natural_sentence(p[0]) and len(p[0]) <= 40]
    natural.sort(key=lambda p: abs(len(p[0]) - base.TARGET_LEN))
    for jtext, etext in natural:
        try_sentence(jtext, etext, None)

    # Pass 2: まだ埋まらない語を、文長・句点条件を緩めて補完
    remaining = {w["headword"] for w in words if len(by_headword[w["headword"]]) < max_examples}
    if remaining:
        for jtext, etext in sorted(pairs, key=lambda p: len(p[0])):
            try_sentence(jtext, etext, remaining)

    for w in words:
        w["examples"] = by_headword[w["headword"]]

    covered = sum(1 for w in words if w["examples"])
    total_ex = sum(len(w["examples"]) for w in words)
    cloze_ex = sum(1 for w in words for ex in w["examples"] if ex.get("cloze"))
    log(f"Examples attached: {covered}/{len(words)} words have >=1 example; "
        f"{total_ex} examples total; {cloze_ex} carry cloze")
    return {"covered": covered, "total_examples": total_ex, "cloze_examples": cloze_ex}


# ---------- stage 1: スケルトン構築 ----------
def build_skeleton() -> list[dict]:
    """見出し語＋読み＋品詞＋英語参照グロス＋頻度順＋Tatoeba例文(cloze付き)のスケルトンを
    構築し、raw/ja-3-10k-skeleton.json に書いた上でそのレコード列（dict のリスト）を返す。
    グロスのタガログ語訳・意味カテゴリは stage 2（merge_and_emit）で overlay する。
    """
    t0 = time.time()

    # 1. 見出し語プール（N2/N1）
    jlpt_words = load_jlpt_n2_n1()
    n_jlpt_input = len(jlpt_words)
    by_kanji, by_kana = base.load_jmdict_index()
    jlpt_matched = base.match_jmdict(jlpt_words, by_kanji, by_kana)
    n_jlpt_matched = len(jlpt_matched)
    # base.match_jmdict は {headword, reading, gloss, pos, jlptLevel} を返す。gloss→referenceGlossEn へ改名。
    for r in jlpt_matched:
        r["referenceGlossEn"] = r.pop("gloss")

    # 2. コース C 除外
    course_c = load_course_c_headwords()
    jlpt_matched = [r for r in jlpt_matched if r["headword"] not in course_c]
    # プール内の見出し語重複も排除（N2/N1 内の別読み重複や漢字重複）
    seen_hw = set()
    deduped = []
    for r in jlpt_matched:
        if r["headword"] in seen_hw:
            continue
        seen_hw.add(r["headword"])
        deduped.append(r)
    jlpt_matched = deduped
    log(f"JLPT after course-C exclusion + dedup: {len(jlpt_matched)} "
        f"(removed {n_jlpt_matched - len(jlpt_matched)})")

    # 3. 非JLPT 頻度フィル
    with_jmdict_full = _jmdict_words(by_kanji, by_kana)
    exclude = course_c | {r["headword"] for r in jlpt_matched}
    needed = max(0, TARGET_TOTAL - len(jlpt_matched))
    fill = build_nonjlpt_fill(with_jmdict_full, exclude, needed)

    # 4. 合流 + 頻度順 + rank
    pool = jlpt_matched + fill
    pool = apply_frequency_order(pool)
    if len(pool) > TARGET_TOTAL:
        pool = pool[:TARGET_TOTAL]
        for i, w in enumerate(pool, start=1):
            w["frequencyRank"] = i
    log(f"Combined pool: {len(pool)} words "
        f"(N2={sum(1 for w in pool if w['jlptLevel']=='N2')}, "
        f"N1={sum(1 for w in pool if w['jlptLevel']=='N1')}, "
        f"non-JLPT={sum(1 for w in pool if w['jlptLevel'] is None)})")

    # 5. Tatoeba 例文 + cloze
    pairs = base.load_tatoeba_pairs()
    ex_stats = attach_examples_with_cloze(pool, pairs)

    # 6. 出力レコード整形
    out = []
    for w in pool:
        out.append(
            {
                "headword": w["headword"],
                "reading": w.get("reading") or None,
                "pos": w["pos"],
                "referenceGlossEn": w["referenceGlossEn"],
                "frequencyRank": w["frequencyRank"],
                "jlptLevel": w["jlptLevel"],
                "examples": w["examples"],
            }
        )
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    # 7. 統計
    _report(
        total=len(out),
        n_jlpt_input=n_jlpt_input,
        n_jlpt_matched=n_jlpt_matched,
        n_jlpt_kept=len(jlpt_matched),
        fill_n=len(fill),
        with_example=ex_stats["covered"],
        total_ex=ex_stats["total_examples"],
        cloze_ex=ex_stats["cloze_examples"],
    )
    log(f"Wrote {OUT_PATH}")
    log(f"Stage 1 (skeleton) done in {time.time()-t0:.1f}s")
    return out


def _jmdict_words(by_kanji, by_kana):
    """load_jmdict_index が返すインデックスから全 JMdict エントリ（重複なし）を復元する。"""
    seen = set()
    words = []
    for entries in by_kanji.values():
        for w in entries:
            wid = id(w)
            if wid in seen:
                continue
            seen.add(wid)
            words.append(w)
    for entries in by_kana.values():
        for w, _common in entries:
            wid = id(w)
            if wid in seen:
                continue
            seen.add(wid)
            words.append(w)
    return words


def _report(total, n_jlpt_input, n_jlpt_matched, n_jlpt_kept, fill_n, with_example, total_ex, cloze_ex):
    jlpt_match_rate = 100.0 * n_jlpt_matched / max(1, n_jlpt_input)
    ex_cov = 100.0 * with_example / max(1, total)
    cloze_rate = 100.0 * cloze_ex / max(1, total_ex)
    log("================ STATS ================")
    log(f"Total skeleton words           : {total}")
    log(f"  from JLPT N2/N1 (post-exclude): {n_jlpt_kept}")
    log(f"  from non-JLPT freq fill       : {fill_n}")
    log(f"JLPT JMdict match rate          : {jlpt_match_rate:.1f}% ({n_jlpt_matched}/{n_jlpt_input} N2/N1 words matched w/ gloss)")
    log(f"Tatoeba example coverage        : {ex_cov:.1f}% ({with_example}/{total} words have >=1 example)")
    log(f"Total examples                  : {total_ex}")
    log(f"Cloze generation rate           : {cloze_rate:.1f}% ({cloze_ex}/{total_ex} examples carry a cloze)")
    log("=======================================")


# ---------- stage 2: マージ・POS変換・出力 ----------
def convert_pos(pos_ja: str, unmapped_out: list[str]) -> str:
    """日本語 pos ラベル → コース C 準拠のタガログ語ラベル。
    マップに無いラベルは pangngalan にフォールバックし、unmapped_out に積んで呼び出し側へ報告する。
    """
    label = POS_JA_TO_TL.get(pos_ja)
    if label is None:
        unmapped_out.append(pos_ja)
        return POS_FALLBACK
    return label


def _load_course_c_pos_values() -> set[str]:
    manifest = json.load(open(f"{COURSE_C_DIR}/manifest.json", encoding="utf-8"))
    values = set()
    for band in manifest["bands"]:
        for card in json.load(open(f"{COURSE_C_DIR}/{band}", encoding="utf-8")):
            values.add(card["pos"])
    return values


def load_content_batches() -> list[dict]:
    """全14バッチを読み込む。1つでも欠けていたら報告して停止する。"""
    entries = []
    missing = []
    for i in range(N_BATCHES):
        fname = f"batch-{i:02d}.json"
        path = os.path.join(BATCH_DIR, fname)
        if not os.path.exists(path):
            missing.append(fname)
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        entries.extend(data)
        log(f"  {fname}: {len(data)} entries")
    if missing:
        raise SystemExit(f"missing content batch file(s), aborting: {missing}")
    dupe_ranks = len(entries) - len({e["frequencyRank"] for e in entries})
    if dupe_ranks:
        raise SystemExit(f"content batches contain {dupe_ranks} duplicate frequencyRank value(s), aborting")
    log(f"content batches loaded: {len(entries)} entries total ({N_BATCHES}/{N_BATCHES} files present)")
    return entries


def merge_and_emit(skeleton: list[dict] | None = None) -> None:
    """スケルトン(stage1)と14バッチ(content)を frequencyRank で結合して VocabCard[] を組み立て、
    public/data/courses/ja-3-10k/ に書き出す。headword は同音異義語で重複しうるため、結合キーは
    frequencyRank 単独とする（headword は整合性チェックにのみ使う）。
    """
    t0 = time.time()

    if skeleton is None:
        with open(OUT_PATH, encoding="utf-8") as f:
            skeleton = json.load(f)
    skel_by_rank = {w["frequencyRank"]: w for w in skeleton}
    if len(skel_by_rank) != len(skeleton):
        raise SystemExit("skeleton has duplicate frequencyRank values, aborting")
    log(f"skeleton loaded: {len(skeleton)} entries")

    content = load_content_batches()

    merged: list[dict] = []
    headword_mismatches: list[tuple[int, str, str]] = []
    unmapped_pos: list[tuple[int, str, str]] = []
    excluded_mismatch: list[tuple[int, str, str]] = []  # (frequencyRank, headword, excluded example text)

    for c in sorted(content, key=lambda w: w["frequencyRank"]):
        rank = c["frequencyRank"]
        s = skel_by_rank.get(rank)
        if s is None:
            headword_mismatches.append((rank, "<no skeleton entry>", c["headword"]))
            continue
        if s["headword"] != c["headword"]:
            headword_mismatches.append((rank, s["headword"], c["headword"]))
            continue

        unmapped_here: list[str] = []
        pos_tl = convert_pos(c["pos"], unmapped_here)
        if unmapped_here:
            unmapped_pos.append((rank, c["headword"], c["pos"]))

        examples = []
        for ex in c.get("examples", []):
            if ex.get("senseMismatch"):
                excluded_mismatch.append((rank, c["headword"], ex.get("text", "")))
                continue
            ex_out = {"text": ex["text"], "translation": ex["translation"]}
            cloze = ex.get("cloze")
            if cloze:
                ex_out["cloze"] = cloze
            examples.append(ex_out)

        merged.append(
            {
                "headword": c["headword"],
                "reading": s.get("reading") or None,
                "gloss": c["gloss"],
                "pos": pos_tl,
                "examples": examples,
                "frequencyRank": rank,
                "jlptLevel": s.get("jlptLevel"),
                "category": c.get("category"),
            }
        )

    if headword_mismatches:
        log(f"HEADWORD MISMATCHES between skeleton and content batches ({len(headword_mismatches)}):")
        for rank, sh, ch in headword_mismatches[:30]:
            log(f"  rank {rank}: skeleton={sh!r} vs batch={ch!r}")
        raise SystemExit("headword mismatches found, aborting merge (see log above)")

    if len(merged) != len(skeleton):
        raise SystemExit(
            f"merged count {len(merged)} != skeleton count {len(skeleton)}, aborting "
            "(content batches must cover every skeleton frequencyRank exactly once)"
        )

    merged.sort(key=lambda r: r["frequencyRank"])
    if [r["frequencyRank"] for r in merged] != list(range(1, len(merged) + 1)):
        raise SystemExit("merged frequencyRank sequence is not a clean 1..N run, aborting")

    if unmapped_pos:
        log(f"POS labels with no explicit mapping (fell back to {POS_FALLBACK!r}, {len(unmapped_pos)}):")
        for rank, hw, pos_ja in unmapped_pos:
            log(f"  rank {rank} {hw!r}: pos={pos_ja!r}")

    course_c_pos = _load_course_c_pos_values()
    produced_pos = {r["pos"] for r in merged}
    unknown_pos = produced_pos - course_c_pos
    if unknown_pos:
        log(f"WARNING: pos values not present in course C after conversion: {sorted(unknown_pos)}")
    else:
        log(f"pos conversion check OK: all {len(produced_pos)} distinct pos values exist in course C")

    errors = validate_records(merged)
    if errors:
        log(f"VALIDATION ERRORS ({len(errors)}):")
        for e in errors[:20]:
            log(f"  - {e}")
        raise SystemExit(1)

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese 3,000 → 10,000",
        "learningLanguage": "Japanese",
        "glossLanguage": "Tagalog",
        "uiLanguage": "en",
        "type": "cloze",
        "band": {"from": 3000, "to": 10000},
        "sources": [
            {
                "name": "JMdict/EDICT dictionary files",
                "url": "https://www.edrdg.org/edrdg/licence.html",
                "license": "EDRDG licence",
                "note": "Property of the Electronic Dictionary Research and Development Group (EDRDG); "
                "used in conformance with the Group's licence.",
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": "Example sentences.",
            },
            {
                "name": "tanos.co.uk JLPT vocabulary list",
                "url": "https://www.tanos.co.uk/jlpt/",
                "license": "CC BY",
                "note": "By Jonathan Waller, via Bluskyo/JLPT_Vocabulary (github.com/Bluskyo/JLPT_Vocabulary).",
            },
            {
                "name": "wordfreq",
                "url": "https://github.com/rspeer/wordfreq",
                "license": "MIT",
                "note": "Word frequency ordering.",
            },
        ],
    }
    emit_course(COURSE_ID, course_meta, merged, OUT)

    # categories.json（cardId → category）を emit_course と同じ ID 採番規則で別途書く
    categories: dict[str, str] = {}
    for i, r in enumerate(merged, start=1):
        cat = r.get("category")
        if cat:
            categories[f"{COURSE_ID}-{i:04d}"] = cat
    cat_path = os.path.join(OUT, COURSE_ID, "categories.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(categories, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    # ---- 報告 ----
    total = len(merged)
    with_example = sum(1 for r in merged if r["examples"])
    total_ex = sum(len(r["examples"]) for r in merged)
    with_cloze_example = sum(1 for r in merged if any(ex.get("cloze") for ex in r["examples"]))
    log("================ STAGE 2 STATS ================")
    log(f"Total words                      : {total}")
    log(f"Category coverage                : {len(categories)}/{total} ({100.0*len(categories)/total:.1f}%)")
    log(f"Example coverage (>=1 example)   : {with_example}/{total} ({100.0*with_example/total:.1f}%)")
    log(f"Total examples                   : {total_ex}")
    log(f"Cards with >=1 cloze example      : {with_cloze_example}/{total} ({100.0*with_cloze_example/total:.1f}%)")
    log(f"senseMismatch examples excluded   : {len(excluded_mismatch)}")
    for rank, hw, text in excluded_mismatch:
        log(f"  excluded {COURSE_ID}-{rank:04d} ({hw}): {text}")
    log("=================================================")
    log(f"Wrote {os.path.join(OUT, COURSE_ID)}")
    log(f"Stage 2 (merge+emit) done in {time.time()-t0:.1f}s")


# ---------- main ----------
def main():
    skeleton = build_skeleton()
    merge_and_emit(skeleton)


if __name__ == "__main__":
    main()
