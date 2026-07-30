# -*- coding: utf-8 -*-
"""
コース A（英語 10k→30k・較正＋マイニング型）Phase 5.1a: 見出し語プールの新規列挙。

日本語コース（C/D/E）は JMdict という権威的な見出し語集合を wordfreq で並べ替える
だけで済んだが、英語には対応する権威集合が無い。このスクリプトは
「wordfreq の頻度順リストそのものから見出し語プールを新規に作る」処理を担う
（Phase 0.3 スパイクではこの列挙コード自体が対話セッションで書き捨てられ repo に
残っていなかった＝判断ログ#28で確認された最重要ギャップ。本スクリプトで再現可能にする）。

処理:
  1. wordfreq('en', wordlist='large') を rank 1..MAX_RAW_RANK まで列挙
  2. アルファベットのみ（^[a-z]+$・長さ2以上）でフィルタ（数字・アポストロフィ・
     ハイフン入りの表層形を除外。Phase 0.3 の alpha_band.txt と同じ基準）
  3. lemminflect で見出し語化。spike.py は getLemma(word, upos=X) を NOUN 優先で試す
     方式だったが、これは未知語に対して品詞を問わず複数形/現在形ルールを盲目適用してしまい
     "was"->"wa"・"has"->"ha" のような誤レンマを生む実バグが判明した（is/was/has/were等の
     最頻機能語が既知語底面カットをすり抜けて候補プール先頭に混入）。本スクリプトは
     getAllLemmas(word)（＝その語が実際にその品詞の屈折形として辞書登録されている場合のみ
     候補を返す・未知語への盲目適用をしない関数）を使い、複数品詞が競合した場合のみ
     VERB→NOUN→ADJ→ADV→AUX の優先順位で決定する
  4. レンマ単位で重複排除（同じレンマに複数表層形が集まる場合は最頻の表層形を代表とする）
  5. 既知語底面（NGSL 1.2 + NAWL 1.2・判断ログ#28でCEFR-Jは不採用確定）をレンマ単位で除外
  6. 残った候補をレンマの元rankで昇順ソートし、1始まりの連番 candidateRank を新規付与
     （この連番が後続の帯選定・emit.py の frequencyRank の元になる）

出力: raw/en-wordfreq-ranked.json
  [{candidateRank, lemma, surfaceForm, rawWordfreqRank, zipf}, ...]

このスクリプトは候補プールの列挙のみを行う。EJDict-hand グロス・Tatoeba例文・
CMUdict発音・固有名詞ノイズの機械/AI除去は後続の build_en_10_30k.py（stage1）が担う。
"""
import json
import re
import time

from lemminflect import getAllLemmas
from wordfreq import iter_wordlist, zipf_frequency

RAW = "raw"
NGSL_PATH = f"{RAW}/ngsl-1.2-lemmatized.csv"
NAWL_PATH = f"{RAW}/nawl-1.2-lemmatized.csv"
OUT_PATH = f"{RAW}/en-wordfreq-ranked.json"

MAX_RAW_RANK = 100_000  # 既知語底面カット＋レンマ重複統合後も30k語に十分な余裕を持たせる
ALPHA_RE = re.compile(r"^[a-z]+$")
LEMMA_UPOS_PRIORITY = ("VERB", "NOUN", "ADJ", "ADV", "AUX")

# ---------- 5.1d: 確実にノイズと判定できるものだけを機械的に除去 ----------
# 固有名詞・ブランド名等の意味的な判定は正規表現では安全に行えない（誤って実在語を
# 落とすリスクが高い）ため、5.4のLLMコンテンツバッチ生成ステージ（各語の日本語グロス
# 生成時に「一般語彙として不適切なら除外」と判定させる・判断ログ#18のAI相互検証方針
# に合致）に委ねる。ここでは100%誤検出なしと言い切れる3パターンのみを機械的に除去する。
LAUGH_RE = re.compile(r"^(a*(ha|he){2,}h?|l+o+l+|h+a+h*)$")
APOSTROPHE_LESS_CONTRACTIONS = {
    "dont", "cant", "wont", "isnt", "arent", "doesnt", "didnt", "wasnt", "werent",
    "hasnt", "havent", "hadnt", "wouldnt", "couldnt", "shouldnt", "im", "youre",
    "theyre", "weve", "ive", "youve", "theyve", "thats", "whats", "lets", "shes",
    "hes", "theres", "wheres", "whos", "youll", "theyll", "youd", "hed", "shed",
    "theyd", "aint", "yall",
}


def is_definite_noise(word: str) -> bool:
    """長さ2以下（この帯まで来て残っている2文字語はNGSL/NAWLで拾われなかった時点で
    twitterハンドル・略語・タイポの類。実在の2文字英単語は既知語底面で既に除外済み）・
    アポストロフィ抜け短縮形・笑い表現("haha"等)のみを対象にした確実な除去。"""
    return len(word) <= 2 or word in APOSTROPHE_LESS_CONTRACTIONS or bool(LAUGH_RE.match(word))


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def lemmatize(word: str) -> str:
    """getAllLemmas は「その語が実際にその品詞の屈折形として辞書登録されている場合のみ」
    候補を返す（getLemma(word, upos=X) と違い、未知語に対してNOUN複数形ルールを
    盲目適用して "was"->"wa" のような誤ったレンマを作らない）。
    語自身と同じ（＝その品詞では屈折していない恒等写像）候補より、実質的に短縮される
    候補を優先する（例: "better" は VERB/NOUN では恒等だが ADJ では "good" に短縮される。
    ADJ を優先しないと "better" が独立候補として base層フィルタをすり抜けてしまう）。
    複数品詞が競合する場合のみ LEMMA_UPOS_PRIORITY で決定する。"""
    candidates = getAllLemmas(word)
    if not candidates:
        return word
    reducing = {upos: lm[0] for upos, lm in candidates.items() if lm[0] != word}
    pool = reducing or {upos: lm[0] for upos, lm in candidates.items()}
    for upos in LEMMA_UPOS_PRIORITY:
        if upos in pool:
            return pool[upos]
    return next(iter(pool.values()))


def load_known_baseline() -> set[str]:
    """NGSL 1.2 + NAWL 1.2（レンマ形CSV・1行=1レンマ・先頭列が代表形、残りの列は
    そのレンマの活用/派生バリエーション。例: "I,me,my,mine" は代名詞 I の格変化）。
    判断ログ#28: CEFR-Jはライセンスが再配布を明示許可しないため不採用。

    行内の全列を既知集合に入れる（先頭列＝代表形だけだと "I,me,my,mine" の
    me/my/mine が既知語として拾えず、候補プールに漏れてしまう。lemminflect の
    語彙辞書ではカバーされない代名詞・不規則変化のこうしたケースをNGSL/NAWL
    自体の列挙が補ってくれる）。"""
    known: set[str] = set()
    for path, label in ((NGSL_PATH, "NGSL"), (NAWL_PATH, "NAWL")):
        n_rows = 0
        # NAWL の配布CSVには cp1252 由来の非UTF-8バイト（例: "\xe9lite"）が混じっているため
        # errors="replace" で読み飛ばす（アクセント付き異綴りは既に同じレンマ内の別スペルとして
        # カンマ区切りで並んでいるため、1バイトの文字化けが既知語判定の漏れには繋がらない）
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("##"):
                    continue
                forms = [w.strip().lower() for w in line.split(",") if w.strip()]
                known.update(forms)
                if forms:
                    n_rows += 1
        log(f"{label}: {n_rows} lemma rows loaded from {path}")
    log(f"既知語底面（NGSL+NAWL 全活用形統合・重複排除後）: {len(known)} 語形")
    return known


def main():
    t0 = time.time()
    known = load_known_baseline()

    raw_total = 0
    alpha_kept = 0
    # lemma -> (best_raw_rank, surface_form)
    best_by_lemma: dict[str, tuple[int, str]] = {}

    for raw_rank, word in enumerate(iter_wordlist("en", wordlist="large"), start=1):
        if raw_rank > MAX_RAW_RANK:
            break
        raw_total += 1
        if not ALPHA_RE.match(word) or len(word) < 2:
            continue
        alpha_kept += 1
        lemma = lemmatize(word)
        if lemma not in best_by_lemma or raw_rank < best_by_lemma[lemma][0]:
            best_by_lemma[lemma] = (raw_rank, word)

    log(f"wordfreq 'en' large: raw_rank 1..{raw_total} を走査")
    log(f"アルファベットのみフィルタ通過: {alpha_kept}/{raw_total} ({alpha_kept/raw_total*100:.1f}%)")
    log(f"レンマ単位への統合: {len(best_by_lemma)} ユニークレンマ")

    excluded_known = sum(1 for lm in best_by_lemma if lm in known)
    excluded_noise = sum(1 for lm in best_by_lemma if lm not in known and is_definite_noise(lm))
    candidates = [
        (lemma, raw_rank, surface)
        for lemma, (raw_rank, surface) in best_by_lemma.items()
        if lemma not in known and not is_definite_noise(lemma)
    ]
    candidates.sort(key=lambda x: x[1])
    log(f"既知語底面（NGSL+NAWL）除外: {excluded_known} レンマ")
    log(f"確実なノイズ（2文字以下/アポストロフィ抜け短縮形/笑い表現）除外: {excluded_noise} レンマ")
    log(f"候補プール確定: {len(candidates)} レンマ")

    out = []
    for candidate_rank, (lemma, raw_rank, surface) in enumerate(candidates, start=1):
        out.append(
            {
                "candidateRank": candidate_rank,
                "lemma": lemma,
                "surfaceForm": surface,
                "rawWordfreqRank": raw_rank,
                "zipf": round(zipf_frequency(surface, "en"), 2),
            }
        )

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # ---------- 統計 ----------
    log("=" * 60)
    log(f"出力候補数: {len(out)} -> {OUT_PATH}")
    for lo, hi in ((1, 10_000), (10_001, 20_000), (20_001, 30_000), (30_001, len(out))):
        band = [c for c in out if lo <= c["candidateRank"] <= hi]
        if not band:
            continue
        log(f"  candidateRank {lo}-{hi}: {len(band)}語 "
            f"(rawWordfreqRank {band[0]['rawWordfreqRank']}-{band[-1]['rawWordfreqRank']})")
    log(f"Done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
