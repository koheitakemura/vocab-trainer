# -*- coding: utf-8 -*-
"""
漢字コース（基本・上級）共通の読み込み・組み立てヘルパー。
docs/new-courses-plan.md の Phase 2（漢字データ基盤）。

データ源:
  - pipeline/raw/kanji-data.json … davidluzgouveia/kanji-data（MIT license）。
    KANJIDIC（EDRDG）の読み・意味・画数と、tanos.co.uk（Jonathan Waller's JLPT
    Resources page）由来の新JLPT級（jlpt_new: 1-5）を統合済みの JSON データセット。
    取得元: https://github.com/davidluzgouveia/kanji-data
    （すでに採用済みの EDRDG・tanos の出典を、別データセット経由で参照する形になる）
  - public/data/courses/{ja-0-3k,ja-3-10k,ja-10-30k}/words-*.json … 自プロジェクトの
    既存語彙データ。単字見出し語のタガログ語グロス流用と、使用例の抽出に使う。

読みの選定方針（実装時の判断）:
  当初は「使用例の語に実際に現れる読みを優先する」逆引きを検討したが、部分文字列一致では
  「食」のように音読み複合語（食堂・食事…）が多い字で、誤って音読み側の文字列の一部が
  訓読みの候補にマッチしてしまう（例: 「く」が「しょく」の部分文字列と誤認識される）。
  信頼性の高い逆引きには形態素解析相当の処理が要り、費用対効果が見合わないため、
  KANJIDIC 自体の掲載順（辞書として確立された順序）をそのまま採用する。
  実際の使用場面は「使用例」フィールド（実データの語から正しい読みごと抽出）が担うので、
  読み一覧が主要な使い方を1つ落としても実用上のリスクは小さい。
"""
import glob
import json
import os
import re

RAW_KANJI_DATA = "raw/kanji-data.json"
SRC_ROOT = "../public/data/courses"

KANJI_RE = re.compile(r"[一-龯]")

# kanji-data.json（上流データ）に実際に見つかった誤り。245字を全件目視レビューし、
# 「別の字の読みが紛れ込んでいる」ものだけを対象に補正する（読みの並び替えはしない）。
#   姉(あね) の kun に「はは」（母の読み）が混入していた
#   道(みち) の kun に「いう」（言の「い.う」の語幹）が混入していた
# 逆引き（同じ語幹を複数の字が共有するケース）で全体を突き合わせたが、他は「うち」
# （家/中）「あき」（秋/明「あき.らか」）のように日本語として正当な同音異義だった。
KUN_READING_OVERRIDES: dict[str, list[str]] = {
    "姉": ["あね"],
    "道": ["みち"],
}

# ひらがな→カタカナ（音読み表記用）。Unicode 上ひらがな→カタカナは +0x60 で機械的に変換できる。
def _to_katakana(hiragana: str) -> str:
    return "".join(chr(ord(ch) + 0x60) if "ぁ" <= ch <= "ゖ" else ch for ch in hiragana)


def load_kanji_data() -> dict:
    """kanji-data.json を読む。キー=漢字1字、値=strokes/grade/freq/jlpt_new/meanings/readings_on/readings_kun 等。"""
    with open(RAW_KANJI_DATA, encoding="utf-8") as f:
        return json.load(f)


def load_all_course_words() -> list[dict]:
    """3つの日本語コースの見出し語を全部読む（漢字の出現・使用例の抽出元）。"""
    words = []
    for course_id in ("ja-0-3k", "ja-3-10k", "ja-10-30k"):
        pattern = os.path.join(SRC_ROOT, course_id, "words-*.json")
        for path in sorted(glob.glob(pattern)):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            words.extend(data["words"] if isinstance(data, dict) else data)
    return words


def build_single_kanji_gloss_index(words: list[dict]) -> dict[str, str]:
    """1文字だけの見出し語（＝その字自体が既存コースで語として学習される場合）のタガログ語グロスを集める。
    複数コースに同じ字があれば先に見つかった方（より基礎的な帯）を残す。"""
    index: dict[str, str] = {}
    for w in words:
        if len(w["headword"]) == 1 and KANJI_RE.match(w["headword"]) and w["headword"] not in index:
            index[w["headword"]] = w["gloss"]
    return index


def build_kanji_usage_index(words: list[dict]) -> dict[str, list[dict]]:
    """各漢字を含む語（2文字以上。単字自体は使用例に使わない）を頻度順に集める。"""
    index: dict[str, list[dict]] = {}
    for w in words:
        if len(w["headword"]) <= 1:
            continue
        for ch in set(w["headword"]):
            if KANJI_RE.match(ch):
                index.setdefault(ch, []).append(w)
    for ch in index:
        index[ch].sort(key=lambda w: w["frequencyRank"])
    return index


def format_reading(readings_kun: list[str], readings_on: list[str], max_each: int = 2) -> str:
    """
    表示用の読み文字列を組み立てる。訓読みはひらがな（送り仮名は '.' を '-' に変える）、
    音読みはカタカナに変換して、あわせて「・」区切りで並べる（訓/音の区別は文字種で示す
    ＝日本語辞書の慣習どおり）。例: 山 → 'やま・サン'　食 → 'く-う・た-べる・ショク・ジキ'
    """
    # kanji-data には「みず」「みず-」（送り仮名の有無違いだけの異表記）が並んで入っていることがある。
    # 表示形に変換すると同じ文字列になって重複するので、追加時に既出チェックする。
    seen: set[str] = set()
    parts: list[str] = []

    def add(s: str) -> None:
        if s and s not in seen:
            seen.add(s)
            parts.append(s)

    kun_added = 0
    for r in readings_kun:
        if kun_added >= max_each:
            break
        before = len(parts)
        add(r.replace(".", "-").strip("-"))
        if len(parts) > before:
            kun_added += 1

    on_added = 0
    for r in readings_on:
        if on_added >= max_each:
            break
        before = len(parts)
        add(_to_katakana(r.strip("-")))
        if len(parts) > before:
            on_added += 1

    return "・".join(parts)


def build_examples_field(usage_words: list[dict], max_words: int = 2) -> list[dict]:
    """
    使用例フィールドを組み立てる。学習画面は examples[0] の1件しか表示しないため、
    複数語を**1件の example にまとめる**（docs/new-courses-plan.md §3.3 の B-a 案。
    UI 改修ゼロで「使用例を複数載せる」指定を満たす）。
    頻度上位 max_words 語を「見出し語（読み）」の形で連結し、対訳も同じ順で連結する。
    """
    top = usage_words[:max_words]
    if not top:
        return []
    text = "・".join(f"{w['headword']}（{w['reading']}）" for w in top)
    translation = "・".join(w["gloss"] for w in top)
    return [{"text": text, "translation": translation, "aiGenerated": True}]


def build_kanji_records(
    chars: list[str],
    kanji_data: dict,
    single_gloss: dict[str, str],
    usage_index: dict[str, list[dict]],
    manual_gloss: dict[str, str],
    jlpt_level_of: "callable[[str], str | None]",
    manual_examples: dict[str, list[dict]] | None = None,
) -> list[dict]:
    """
    漢字1文字ずつのレコード（emit.py の records 形状）を組み立てる。
    gloss は ①既存の単字見出しグロスを流用 → ②無ければ manual_gloss（手動翻訳の表）を使う。
    manual_gloss にも無い字はここで例外にする（生成漏れをサイレントに欠落させない）。
    使用例も同様に ①自コース語彙からの実例 → ②無ければ manual_examples（AI生成の実在単語表）。
    どちらにも無い字は examples が空になり得るため、呼び出し側で検証すること
    （カードは意味＋読み＋使用例を全部載せる方針のため、空はデータ不備として扱う）。
    """
    manual_examples = manual_examples or {}
    records = []
    for ch in chars:
        info = kanji_data[ch]
        gloss = single_gloss.get(ch) or manual_gloss.get(ch)
        if not gloss:
            raise SystemExit(f"漢字 '{ch}' のタガログ語グロスが単字流用・手動表のどちらにも無い")
        usage = usage_index.get(ch) or manual_examples.get(ch, [])
        readings_kun = KUN_READING_OVERRIDES.get(ch, info.get("readings_kun") or [])
        records.append({
            "headword": ch,
            "reading": format_reading(readings_kun, info.get("readings_on") or []),
            "gloss": gloss,
            "pos": "kanji",
            "examples": build_examples_field(usage),
            "jlptLevel": jlpt_level_of(ch),
            "_freq": info.get("freq") or 99999,  # 出現頻度（並び順の決定にのみ使う内部フィールド）
        })
    return records
