# -*- coding: utf-8 -*-
"""
コース E（日本語 10,000→23,000・較正＋マイニング型）の構築パイプライン。
判断ログ #16/#18/#22・PLAN §4.3/§5.3/§7 Phase 4 準拠。

2段構成（build_ja_3_10k.py と同じ stage1/stage2 分割。このファイル1本で完結・再実行可能）:

- stage 1（build_skeleton）: 「見出し語＋読み＋品詞＋英語参照グロス＋絶対頻度ランク＋帯
  インデックス＋Tatoeba 例文（あれば cloze マークアップつき）」までを機械的に生成する。
  raw/ja-10-23k-skeleton.json に書く。

  判断ログ #22 の実測どおり、この帯（10k→23k）は N1 で尽きた JLPT 語彙リストに頼れない
  （N1/N2 は既に build_ja_3_10k.py がコース D で全量消費済み）ため、**JMdict 全件を
  wordfreq ja 頻度順に並べ、JMdict common フラグでゲート**する非JLPT頻度フィルだけで
  構築する（= build_ja_3_10k.build_nonjlpt_fill と同じ思想。本体ロジックはそのまま import
  して再利用し、このファイルでは重複させない）。

  ソース（全て再配布可能なオープンデータ）:
    - 見出し語プール: JMdict 全件（common フラグでゲート）。wordfreq ja 頻度順
    - 見出し語/読み/英訳/品詞: JMdict（jmdict-simplified・EDRDG licence）
    - 頻度順: wordfreq ja
    - 例文: Tatoeba（jpn-eng 対訳ペア・CC BY 2.0 FR）＋ MeCab トークン境界一致で cloze 化
    - 除外: 既存コース C（ja-0-3k）＋コース D（ja-3-10k）の見出し語は全除外（重複させない）

- stage 2（merge_and_emit）: raw/ja-10-30k-content-batches/ 配下の全 batch*.json（旧方式
  batch-06.json 1件＋新方式 batch2-000〜064.json 群・計12,735件必須）が LLM で確定させた
  「中身」（グロス(タガログ語)・pos(日本語ラベル)・category・例文の対訳・senseMismatch/
  aiGenerated フラグ）を frequencyRank でスケルトンと突合し、pos をコース C 準拠のタガログ語
  ラベルへ機械変換、senseMismatch フラグ付き例文を除外した上で public/data/courses/ja-10-30k/
  に VocabCard[]（+categories.json）として書き出す。

出力: raw/ja-10-23k-skeleton.json（中間成果物）／public/data/courses/ja-10-30k/（最終成果物）
"""
import glob
import json
import os
import sys
import time

sys.path.insert(0, ".")
import build_ja_0_3k as base  # load_jmdict_index / entry_gloss_and_pos / load_tatoeba_pairs 等
import build_ja_3_10k as d10  # build_nonjlpt_fill / attach_examples_with_cloze / FUNCTION_POS /
#                                POS_JA_TO_TL / POS_FALLBACK / convert_pos 相当を再利用
from emit import emit_course, validate_records  # noqa: E402  (stage 2: マージ・出力)

RAW = "raw"
COURSE_C_DIR = "../public/data/courses/ja-0-3k"
COURSE_D_DIR = "../public/data/courses/ja-3-10k"
OUT_PATH = f"{RAW}/ja-10-23k-skeleton.json"
OUT = "../public/data/courses"
COURSE_ID = "ja-10-30k"  # src/types.ts の CourseId に既存登録済みの値をそのまま使う（判断ログ#22: 表示titleのみ改称）
BATCH_DIR = f"{RAW}/ja-10-30k-content-batches"

RANK_START = 10001  # 絶対頻度ランクの開始位置（コース D が 1..10000 を占有済み）
RANK_CAP = 22999  # floor(rank/1000) <= 22 に収める上限ランク（判断ログ#22）
MAX_WORDS = RANK_CAP - RANK_START + 1  # = 12,999
BAND_START = RANK_START // 1000  # = 10（emit_course のファイル命名オフセット）

# 新旧命名方式の判別用プレフィックス（PLAN.md リスク表「並列バッチ処理で出力ファイル名が
# 衝突・混乱した」に対応する実データ: batch-06.json（旧・単一カウンタ）と
# batch2-NNN.json（新・担当範囲固定）が rank 13428 で1件だけ重複していた）
NEW_BATCH_PREFIX = "batch2-"

log = base.log


# ---------- 1. コース C / D 見出し語の除外セット ----------
def load_course_headwords(course_dir: str, label: str) -> set[str]:
    manifest = json.load(open(f"{course_dir}/manifest.json", encoding="utf-8"))
    hw = set()
    for band in manifest["bands"]:
        for card in json.load(open(f"{course_dir}/{band}", encoding="utf-8")):
            hw.add(card["headword"])
    log(f"{label} headwords to exclude: {len(hw)}")
    return hw


# ---------- 2. 除外前の common-gated 候補プール（統計専用の軽量ドライラン） ----------
def common_gated_candidate_headwords(jmdict_words: list[dict]) -> set[str]:
    """build_ja_3_10k.build_nonjlpt_fill と同じゲート条件（common フラグ・機能語POS除外・
    単一カナ断片除外・gloss必須）で候補見出し語を集める。zipf計算を省いた軽量版で、
    「コースC/D除外が無かったら何語が候補になり得たか」を報告するためだけに使う
    （実際のフィル構築は d10.build_nonjlpt_fill を素直に呼んで行う＝ロジックの重複はここだけ）。
    """
    heads = set()
    for w in jmdict_words:
        kanji_list = w.get("kanji", [])
        kana_list = w.get("kana", [])
        if kanji_list:
            common_kanji = [k for k in kanji_list if k.get("common")]
            if not common_kanji:
                continue
            headword = common_kanji[0]["text"]
        else:
            common_kana = [k for k in kana_list if k.get("common")]
            if not common_kana:
                continue
            headword = common_kana[0]["text"]
            if len(headword) == 1:
                continue
        gloss, pos = base.entry_gloss_and_pos(w)
        if not gloss:
            continue
        if pos in d10.FUNCTION_POS:
            continue
        heads.add(headword)
    return heads


# ---------- 3. 帯インデックス付与 ----------
def apply_rank_and_band(fill: list[dict]) -> list[dict]:
    for i, w in enumerate(fill, start=1):
        rank = RANK_START + i - 1
        w["frequencyRank"] = rank
        w["band"] = rank // 1000
    return fill


# ---------- stage 1: スケルトン構築 ----------
def build_skeleton() -> list[dict]:
    t0 = time.time()

    by_kanji, by_kana = base.load_jmdict_index()
    jmdict_words_full = d10._jmdict_words(by_kanji, by_kana)

    course_c = load_course_headwords(COURSE_C_DIR, "Course C (ja-0-3k)")
    course_d = load_course_headwords(COURSE_D_DIR, "Course D (ja-3-10k)")
    exclude = course_c | course_d
    log(f"Combined exclusion set (course C + D, deduped): {len(exclude)}")

    # 統計専用: 除外が無かったら候補になり得た見出し語の総数、うちコースC/Dと重複した数
    full_pool = common_gated_candidate_headwords(jmdict_words_full)
    n_excluded_by_course_cd = len(full_pool & exclude)
    log(
        f"Common-gated candidate pool (pre-exclusion): {len(full_pool)}; "
        f"overlap with course C/D (excluded): {n_excluded_by_course_cd}"
    )

    # 実際のフィル構築（needed を帯上限ぴったりに設定=判断ログ#22の打ち切り方針を
    # そのままキャップとして実装。候補がそれより少なければ自然に少ない数で尽きる）
    fill = d10.build_nonjlpt_fill(jmdict_words_full, exclude, MAX_WORDS)
    fill = apply_rank_and_band(fill)
    log(
        f"Headword pool built: {len(fill)} words "
        f"(cap={MAX_WORDS}, rank {RANK_START}..{fill[-1]['frequencyRank'] if fill else RANK_START - 1}, "
        f"band {fill[0]['band'] if fill else '-'}..{fill[-1]['band'] if fill else '-'})"
    )

    # Tatoeba 例文 + cloze
    pairs = base.load_tatoeba_pairs()
    ex_stats = d10.attach_examples_with_cloze(fill, pairs)

    # 出力レコード整形（PLAN 指示どおりのフィールドのみ）
    out = []
    for w in fill:
        out.append(
            {
                "headword": w["headword"],
                "reading": w.get("reading") or None,
                "pos": w["pos"],
                "referenceGlossEn": w["referenceGlossEn"],
                "frequencyRank": w["frequencyRank"],
                "band": w["band"],
                "examples": w["examples"],
            }
        )
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    _report(
        total=len(out),
        course_c_n=len(course_c),
        course_d_n=len(course_d),
        exclude_n=len(exclude),
        n_excluded_by_course_cd=n_excluded_by_course_cd,
        out=out,
        with_example=ex_stats["covered"],
        total_ex=ex_stats["total_examples"],
        cloze_ex=ex_stats["cloze_examples"],
    )
    log(f"Wrote {OUT_PATH}")
    log(f"Stage 1 (skeleton) done in {time.time()-t0:.1f}s")
    return out


def _report(total, course_c_n, course_d_n, exclude_n, n_excluded_by_course_cd, out,
            with_example, total_ex, cloze_ex):
    from collections import Counter

    band_counts = Counter(r["band"] for r in out)
    ex_cov = 100.0 * with_example / max(1, total)
    cloze_rate = 100.0 * cloze_ex / max(1, total_ex)
    no_example = total - with_example

    log("================ STATS ================")
    log(f"Total skeleton words              : {total}  (cap was {MAX_WORDS})")
    log(f"Frequency rank range               : {out[0]['frequencyRank'] if out else '-'}"
        f"..{out[-1]['frequencyRank'] if out else '-'}")
    log("Band distribution (band -> word count):")
    for band in sorted(band_counts):
        log(f"  band {band:>2}: {band_counts[band]}")
    log(f"Course C (ja-0-3k) headwords       : {course_c_n}")
    log(f"Course D (ja-3-10k) headwords      : {course_d_n}")
    log(f"Combined exclusion set (deduped)   : {exclude_n}")
    log(f"Common-gated candidates excluded   : {n_excluded_by_course_cd} "
        f"(would-be candidates that are already in course C/D)")
    log(f"Tatoeba example coverage           : {ex_cov:.1f}% ({with_example}/{total} words have >=1 example)")
    log(f"Words with ZERO examples (need LLM): {no_example} ({100.0*no_example/max(1,total):.1f}%)")
    log(f"Total examples                     : {total_ex}")
    log(f"Cloze generation rate              : {cloze_rate:.1f}% ({cloze_ex}/{total_ex} examples carry a cloze)")
    log("=======================================")


# ---------- stage 2: 全件カバレッジ検証 ----------
def check_full_coverage(skel_ranks: set, batch_ranks: set) -> None:
    """0. 全件カバレッジの機械検証（最重要）。スケルトン全件の frequencyRank 集合と、
    全 batch*.json（重複解決後）の frequencyRank 集合が完全一致することを確認する。
    1件でも過不足があれば具体的にリストして中断する（後続ファイルが揃っていない状態で
    不完全なコースを出力しない）。
    """
    missing = sorted(skel_ranks - batch_ranks)
    extra = sorted(batch_ranks - skel_ranks)
    if missing or extra:
        log("=========== COVERAGE CHECK FAILED ===========")
        if missing:
            log(
                f"MISSING from batches ({len(missing)} frequencyRank value(s) present in "
                f"skeleton but absent from all batch*.json): "
                f"{missing[:80]}{' ...(truncated)' if len(missing) > 80 else ''}"
            )
        if extra:
            log(
                f"EXTRA in batches ({len(extra)} frequencyRank value(s) present in batch*.json "
                f"but absent from skeleton): "
                f"{extra[:80]}{' ...(truncated)' if len(extra) > 80 else ''}"
            )
        raise SystemExit(
            "full-coverage check failed: batch*.json frequencyRank set != skeleton frequencyRank "
            "set, aborting merge (see MISSING/EXTRA above)"
        )
    log(
        f"COVERAGE CHECK OK: batch*.json frequencyRank set == skeleton frequencyRank set "
        f"(both {len(skel_ranks)} unique values, full match, no gaps / no excess)"
    )


# ---------- stage 2: 全 batch*.json の読み込み（新旧命名混在の吸収） ----------
def load_content_batches() -> dict:
    """全 batch*.json（旧方式 batch-NN.json ＋ 新方式 batch2-NNN.json、命名規則混在）を
    frequencyRank をキーに正規化して読み込む。1つも見つからなければ中断する。

    frequencyRank が複数ファイルにまたがって重複した場合、新方式(batch2-*)を正として
    採用し、旧方式(batch-*)側を捨てる（実データで1件確認済み: rank 13428「鯉」が
    batch-06.json と batch2-016.json の境界で重複——旧方式は単一カウンタの使い捨て初回
    バッチ、新方式は担当範囲固定の再実行。PLAN.md リスク表「並列バッチ処理で出力ファイル名
    が衝突・混乱した」の実例そのもの）。新方式どうし／旧方式どうしの重複は原因不明の真の
    衝突として扱い、決定的に解決できないため中断する。
    """
    paths = sorted(glob.glob(os.path.join(BATCH_DIR, "batch*.json")))
    if not paths:
        raise SystemExit(f"no batch*.json files found under {BATCH_DIR}, aborting")

    by_rank: dict = {}
    resolved_dupes: list = []  # (rank, fnameA, fnameB, winner)
    for path in paths:
        fname = os.path.basename(path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for item in data:
            rank = item["frequencyRank"]
            if rank in by_rank:
                prev_fname, _prev_item = by_rank[rank]
                prev_is_new = prev_fname.startswith(NEW_BATCH_PREFIX)
                cur_is_new = fname.startswith(NEW_BATCH_PREFIX)
                if cur_is_new and not prev_is_new:
                    resolved_dupes.append((rank, prev_fname, fname, fname))
                    by_rank[rank] = (fname, item)
                elif prev_is_new and not cur_is_new:
                    resolved_dupes.append((rank, prev_fname, fname, prev_fname))
                    # prev（新方式）を維持
                else:
                    raise SystemExit(
                        f"unresolvable duplicate frequencyRank {rank}: both {prev_fname} and "
                        f"{fname} are the same naming scheme (cannot deterministically pick a "
                        "winner), aborting"
                    )
            else:
                by_rank[rank] = (fname, item)
        log(f"  {fname}: {len(data)} entries")

    log(f"content batches loaded: {len(paths)} file(s), {len(by_rank)} unique frequencyRank entries")
    if resolved_dupes:
        log(
            f"DUPLICATE frequencyRank resolved (new-scheme batch2-* wins over legacy batch-*, "
            f"{len(resolved_dupes)} case(s)):"
        )
        for rank, a, b, winner in resolved_dupes:
            log(f"  rank {rank}: {a} vs {b} -> kept {winner}")

    return by_rank


# ---------- stage 2: マージ・POS変換・出力 ----------
def merge_and_emit(skeleton: list | None = None) -> None:
    """スケルトン(stage1)と全 batch*.json(content)を frequencyRank で結合して VocabCard[] を
    組み立て、public/data/courses/ja-10-30k/ に書き出す。headword は同音異義語で重複しうる
    ため、結合キーは frequencyRank 単独とする（headword は整合性チェックにのみ使う）。
    """
    t0 = time.time()

    if skeleton is None:
        with open(OUT_PATH, encoding="utf-8") as f:
            skeleton = json.load(f)
    skel_by_rank = {w["frequencyRank"]: w for w in skeleton}
    if len(skel_by_rank) != len(skeleton):
        raise SystemExit("skeleton has duplicate frequencyRank values, aborting")
    skel_ranks = set(skel_by_rank)
    log(f"skeleton loaded: {len(skeleton)} entries (rank {min(skel_ranks)}..{max(skel_ranks)})")

    # ---- 0. 全件カバレッジの機械検証（最優先。ズレがあればここで中断する） ----
    by_rank = load_content_batches()
    check_full_coverage(skel_ranks, set(by_rank))

    merged: list = []
    headword_mismatches: list = []
    unmapped_pos: list = []
    excluded_example_level: list = []  # (rank, headword, excluded example text)
    excluded_card_level: list = []  # 同上・カード全体の senseMismatch カスケード除外
    ai_example_count = 0

    for s in sorted(skeleton, key=lambda w: w["frequencyRank"]):
        rank = s["frequencyRank"]
        _fname, c = by_rank[rank]
        if s["headword"] != c["headword"]:
            headword_mismatches.append((rank, s["headword"], c["headword"]))
            continue

        unmapped_here: list = []
        pos_tl = d10.convert_pos(c["pos"], unmapped_here)
        if unmapped_here:
            unmapped_pos.append((rank, c["headword"], c["pos"]))

        # senseMismatch フラグは「例文単位」と「カード単位」の2粒度で実データに存在する
        # （カード単位＝そのカードの全例文が語根違いの誤爆で、個々の example には
        # フラグが立っていないケースを実測で確認済み）。カード単位のときはカード単位で従い
        # 全例文を除外する。
        card_level_mismatch = bool(c.get("senseMismatch"))
        examples: list = []
        if card_level_mismatch:
            for ex in c.get("examples", []):
                excluded_card_level.append((rank, c["headword"], ex.get("text", "")))
        else:
            for ex in c.get("examples", []):
                if ex.get("senseMismatch"):
                    excluded_example_level.append((rank, c["headword"], ex.get("text", "")))
                    continue
                ex_out = {"text": ex["text"], "translation": ex["translation"]}
                cloze = ex.get("cloze")
                if cloze:
                    ex_out["cloze"] = cloze
                if ex.get("aiGenerated"):
                    ex_out["aiGenerated"] = True
                    ai_example_count += 1
                examples.append(ex_out)

        merged.append(
            {
                "headword": c["headword"],
                "reading": s.get("reading") or None,
                "gloss": c["gloss"],
                "pos": pos_tl,
                "examples": examples,
                "frequencyRank": rank,
                "band": s.get("band"),
                "category": c.get("category"),
            }
        )

    if headword_mismatches:
        log(f"HEADWORD MISMATCHES between skeleton and content batches ({len(headword_mismatches)}):")
        for rank, sh, ch in headword_mismatches[:30]:
            log(f"  rank {rank}: skeleton={sh!r} vs batch={ch!r}")
        raise SystemExit("headword mismatches found, aborting merge (see log above)")

    if len(merged) != len(skeleton):
        raise SystemExit(f"merged count {len(merged)} != skeleton count {len(skeleton)}, aborting")

    merged.sort(key=lambda r: r["frequencyRank"])
    if [r["frequencyRank"] for r in merged] != sorted(skel_ranks):
        raise SystemExit("merged frequencyRank sequence does not match the skeleton rank set, aborting")

    if unmapped_pos:
        log(f"POS labels with no explicit mapping (fell back to {d10.POS_FALLBACK!r}, {len(unmapped_pos)}):")
        for rank, hw, pos_ja in unmapped_pos:
            log(f"  rank {rank} {hw!r}: pos={pos_ja!r}")

    course_c_pos = d10._load_course_c_pos_values()
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
        "title": "Japanese 10,000 → 23,000",
        "learningLanguage": "Japanese",
        "glossLanguage": "Tagalog",
        "uiLanguage": "en",
        "type": "calibrate-mine",
        "band": {"from": 10000, "to": 23000},
        "sources": [
            {
                "name": "JMdict/EDICT dictionary files",
                "url": "https://www.edrdg.org/edrdg/licence.html",
                "license": "EDRDG licence",
                "note": (
                    "Property of the Electronic Dictionary Research and Development Group "
                    "(EDRDG); used in conformance with the Group's licence. Headwords, readings, "
                    "and part-of-speech are sourced from JMdict; Tagalog glosses are LLM-"
                    "translated from JMdict's English glosses (JMdict has no Tagalog gloss data) "
                    "and cross-checked by a second AI pass — no native-speaker human review "
                    "(project policy, see PLAN.md judgment log #18)."
                ),
            },
            {
                "name": "Tatoeba.org",
                "url": "https://tatoeba.org",
                "license": "CC BY 2.0 FR",
                "licenseUrl": "https://creativecommons.org/licenses/by/2.0/fr/",
                "note": (
                    "Example sentences. Where Tatoeba coverage was insufficient for this "
                    "frequency band (10,000-23,000), additional example sentences were "
                    "generated by LLM; these carry aiGenerated:true on the individual example."
                ),
            },
            {
                "name": "wordfreq",
                "url": "https://github.com/rspeer/wordfreq",
                "license": "MIT",
                "note": "Word frequency ordering.",
            },
        ],
    }
    emit_course(COURSE_ID, course_meta, merged, OUT, band_start=BAND_START)

    # categories.json（cardId → category）を emit_course と同じ ID 採番規則で別途書く
    categories: dict = {}
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
    zero_example_cards = total - with_example
    log("================ STAGE 2 STATS ================")
    log(f"Total words                        : {total}")
    log(f"Category coverage                  : {len(categories)}/{total} ({100.0*len(categories)/total:.1f}%)")
    log(f"Example coverage (>=1 example)     : {with_example}/{total} ({100.0*with_example/total:.1f}%)")
    log(f"Cards with ZERO examples            : {zero_example_cards} ({100.0*zero_example_cards/max(1,total):.1f}%)")
    log(f"Total examples                     : {total_ex}")
    log(f"Cards with >=1 cloze example        : {with_cloze_example}/{total} ({100.0*with_cloze_example/total:.1f}%)")
    log(
        f"aiGenerated examples                : {ai_example_count}/{total_ex} "
        f"({100.0*ai_example_count/max(1,total_ex):.1f}%)"
    )
    log(f"senseMismatch excluded (example-level): {len(excluded_example_level)}")
    for rank, hw, text in excluded_example_level:
        log(f"  excluded (example-level) {COURSE_ID}-rank{rank} ({hw}): {text}")
    card_level_ranks = sorted({r for r, _, _ in excluded_card_level})
    log(
        f"senseMismatch excluded (card-level cascade): {len(excluded_card_level)} example(s) "
        f"across {len(card_level_ranks)} card(s): {card_level_ranks}"
    )
    for rank, hw, text in excluded_card_level:
        log(f"  excluded (card-level) {COURSE_ID}-rank{rank} ({hw}): {text}")
    log("=================================================")
    log(f"Wrote {os.path.join(OUT, COURSE_ID)}")
    log(f"Stage 2 (merge+emit) done in {time.time()-t0:.1f}s")


# ---------- stage 2: 出力の独立検証パス ----------
def verify_output() -> None:
    """6. public/data/courses/ja-10-30k/ をディスクから読み直し、VocabCard スキーマ・
    id/rank連番整合・重複id・pos妥当性を機械検証する。
    """
    course_dir = os.path.join(OUT, COURSE_ID)
    manifest = json.load(open(os.path.join(course_dir, "manifest.json"), encoding="utf-8"))
    cards = []
    for band_file in manifest["bands"]:
        cards.extend(json.load(open(os.path.join(course_dir, band_file), encoding="utf-8")))

    errors = []
    seen_ids = set()
    course_c_pos = d10._load_course_c_pos_values()
    for i, c in enumerate(cards, start=1):
        expected_id = f"{COURSE_ID}-{i:04d}"
        if c.get("id") != expected_id:
            errors.append(f"card[{i}] id mismatch: expected {expected_id!r}, got {c.get('id')!r}")
        if c.get("id") in seen_ids:
            errors.append(f"card[{i}] duplicate id: {c.get('id')!r}")
        seen_ids.add(c.get("id"))
        if c.get("courseId") != COURSE_ID:
            errors.append(f"card[{i}] courseId != {COURSE_ID!r}: {c.get('courseId')!r}")
        for field in ("headword", "gloss", "pos", "frequencyRank"):
            if c.get(field) in (None, ""):
                errors.append(f"card[{i}] ({c.get('id')}) missing/empty required field: {field}")
        if c.get("pos") not in course_c_pos:
            errors.append(f"card[{i}] ({c.get('id')}) pos not a known Tagalog label: {c.get('pos')!r}")
        if not isinstance(c.get("examples"), list):
            errors.append(f"card[{i}] ({c.get('id')}) examples is not a list")

    ranks = [c["frequencyRank"] for c in cards]
    if ranks != sorted(ranks):
        errors.append("frequencyRank is not sorted ascending across emitted band files")
    if len(set(ranks)) != len(ranks):
        errors.append("duplicate frequencyRank values across emitted cards")
    expected_ranks = set(range(RANK_START, RANK_START + len(cards)))
    if set(ranks) != expected_ranks:
        errors.append(
            f"frequencyRank set is not a clean contiguous run {RANK_START}..{RANK_START + len(cards) - 1}"
        )

    if errors:
        log(f"VERIFY: SCHEMA VALIDATION FAILED ({len(errors)} error(s)):")
        for e in errors[:40]:
            log(f"  - {e}")
        raise SystemExit(1)
    log(
        f"VERIFY: OK — {len(cards)} cards, all id/rank/pos/schema checks passed "
        f"({len(manifest['bands'])} band file(s))"
    )


# ---------- main ----------
def main():
    skeleton = build_skeleton()
    merge_and_emit(skeleton)
    verify_output()


if __name__ == "__main__":
    import sys as _sys

    if "--merge-only" in _sys.argv:
        merge_and_emit()
        verify_output()
    else:
        main()
