# -*- coding: utf-8 -*-
"""
コース「ja-kana」（かな導入・ja-0-3k の前段プレースメント）の静的データパイプライン。

かな文字そのもの（ひらがな・カタカナ各104字＝清音46＋濁音/半濁音25＋拗音33。
促音「っ」・長音記号「ー」は単独の音価を持たない修飾記号のため対象外）を、
五十音順→濁音/半濁音→拗音の順でひらがな→カタカナの順に並べたカード列として出力する。

かな→ローマ字→カタカナの対応表は JMdict 等の外部データに依存せず、標準の五十音表を
このファイルに直接埋め込む。値は app 本体が表示に使う wanakana（package.json の
既存依存）の toRomaji/toKatakana で1件ずつ検算済み（手打りローマ字の誤記防止）。

出力: public/data/courses/ja-kana/ 配下の静的 JSON（VocabCard[] 形状）
"""
import json
import os
import sys

sys.path.insert(0, ".")
from emit import emit_course, validate_records

OUT = "../public/data/courses"
COURSE_ID = "ja-kana"

# (hiragana, katakana, romaji) — wanakana.toKatakana()/toRomaji() で検算済み。
KANA_TABLE = [
    ("あ", "ア", "a"), ("い", "イ", "i"), ("う", "ウ", "u"), ("え", "エ", "e"), ("お", "オ", "o"),
    ("か", "カ", "ka"), ("き", "キ", "ki"), ("く", "ク", "ku"), ("け", "ケ", "ke"), ("こ", "コ", "ko"),
    ("さ", "サ", "sa"), ("し", "シ", "shi"), ("す", "ス", "su"), ("せ", "セ", "se"), ("そ", "ソ", "so"),
    ("た", "タ", "ta"), ("ち", "チ", "chi"), ("つ", "ツ", "tsu"), ("て", "テ", "te"), ("と", "ト", "to"),
    ("な", "ナ", "na"), ("に", "ニ", "ni"), ("ぬ", "ヌ", "nu"), ("ね", "ネ", "ne"), ("の", "ノ", "no"),
    ("は", "ハ", "ha"), ("ひ", "ヒ", "hi"), ("ふ", "フ", "fu"), ("へ", "ヘ", "he"), ("ほ", "ホ", "ho"),
    ("ま", "マ", "ma"), ("み", "ミ", "mi"), ("む", "ム", "mu"), ("め", "メ", "me"), ("も", "モ", "mo"),
    ("や", "ヤ", "ya"), ("ゆ", "ユ", "yu"), ("よ", "ヨ", "yo"),
    ("ら", "ラ", "ra"), ("り", "リ", "ri"), ("る", "ル", "ru"), ("れ", "レ", "re"), ("ろ", "ロ", "ro"),
    ("わ", "ワ", "wa"), ("を", "ヲ", "wo"),
    ("ん", "ン", "n"),
    # 濁音
    ("が", "ガ", "ga"), ("ぎ", "ギ", "gi"), ("ぐ", "グ", "gu"), ("げ", "ゲ", "ge"), ("ご", "ゴ", "go"),
    ("ざ", "ザ", "za"), ("じ", "ジ", "ji"), ("ず", "ズ", "zu"), ("ぜ", "ゼ", "ze"), ("ぞ", "ゾ", "zo"),
    ("だ", "ダ", "da"), ("ぢ", "ヂ", "ji"), ("づ", "ヅ", "zu"), ("で", "デ", "de"), ("ど", "ド", "do"),
    ("ば", "バ", "ba"), ("び", "ビ", "bi"), ("ぶ", "ブ", "bu"), ("べ", "ベ", "be"), ("ぼ", "ボ", "bo"),
    # 半濁音
    ("ぱ", "パ", "pa"), ("ぴ", "ピ", "pi"), ("ぷ", "プ", "pu"), ("ぺ", "ペ", "pe"), ("ぽ", "ポ", "po"),
    # 拗音（ぢゃ行は現代語でほぼ使われないため標準どおり除外）
    ("きゃ", "キャ", "kya"), ("きゅ", "キュ", "kyu"), ("きょ", "キョ", "kyo"),
    ("ぎゃ", "ギャ", "gya"), ("ぎゅ", "ギュ", "gyu"), ("ぎょ", "ギョ", "gyo"),
    ("しゃ", "シャ", "sha"), ("しゅ", "シュ", "shu"), ("しょ", "ショ", "sho"),
    ("じゃ", "ジャ", "ja"), ("じゅ", "ジュ", "ju"), ("じょ", "ジョ", "jo"),
    ("ちゃ", "チャ", "cha"), ("ちゅ", "チュ", "chu"), ("ちょ", "チョ", "cho"),
    ("にゃ", "ニャ", "nya"), ("にゅ", "ニュ", "nyu"), ("にょ", "ニョ", "nyo"),
    ("ひゃ", "ヒャ", "hya"), ("ひゅ", "ヒュ", "hyu"), ("ひょ", "ヒョ", "hyo"),
    ("びゃ", "ビャ", "bya"), ("びゅ", "ビュ", "byu"), ("びょ", "ビョ", "byo"),
    ("ぴゃ", "ピャ", "pya"), ("ぴゅ", "ピュ", "pyu"), ("ぴょ", "ピョ", "pyo"),
    ("みゃ", "ミャ", "mya"), ("みゅ", "ミュ", "myu"), ("みょ", "ミョ", "myo"),
    ("りゃ", "リャ", "rya"), ("りゅ", "リュ", "ryu"), ("りょ", "リョ", "ryo"),
]


# その1文字だけで実際の発話として成立する かな に、短い用例を付ける（Kohei 依頼）。
# 「あ！」「え！？」のように、初学者がその場で使える間投詞・呼びかけに限定する。
#
# 選定の方針:
#  - **ひらがなだけに付ける。** 同じ音のカタカナ札（ア／エ…）には付けない——間投詞を
#    カタカナで書くのは漫画的な表記で、初学者に教える正書法としては不適切なため。
#  - 助詞（を・か など）は単独の発話にならないので入れない。
#  - 「う〜ん」「ふ〜ん」のように長音や複数文字が要るものは、1文字で成立しないので入れない。
#  - 方言色・世代色が強いもの（や！＝関西寄りの挨拶 など）は、標準的でないので入れない。
STANDALONE_KANA_EXAMPLES = {
    "あ": ("あ！", "Ah! (you just realized something)"),
    "え": ("え！？", "Huh?! (surprise or disbelief)"),
    "お": ("お！", "Oh! (you noticed something)"),
    "へ": ("へ？", "Huh? (you didn't expect that)"),
    "ね": ("ね！", "Hey! / Right? (calling out or seeking agreement)"),
    "ん": ("ん？", "Hm? (you didn't catch that)"),
    "よ": ("よ！", "Yo! (casual greeting between friends)"),
    "わ": ("わ！", "Wow! / Whoa! (surprise)"),
}


def build_records() -> list[dict]:
    records = []
    rank = 1
    # ひらがなを完走してからカタカナ（同じ並び順）——教材として一般的な順序。
    for script_headword_index, katakana_flag in ((0, False), (1, True)):
        for hira, kata, romaji in KANA_TABLE:
            headword = kata if katakana_flag else hira
            cross_ref = hira if katakana_flag else kata
            cross_label = "hiragana" if katakana_flag else "katakana"
            # 用例はひらがな札にだけ付ける（上の STANDALONE_KANA_EXAMPLES の方針）
            phrase = None if katakana_flag else STANDALONE_KANA_EXAMPLES.get(hira)
            examples = []
            if phrase:
                text, translation = phrase
                # 対訳コーパス由来ではなく書き起こしたものなので、他コースと同じく明示する（PLAN §3.4）
                examples.append({"text": text, "translation": translation, "aiGenerated": True})
            records.append({
                "headword": headword,
                "reading": headword,
                "gloss": f"{romaji} ({cross_label}: {cross_ref})",
                "pos": "kana",
                "examples": examples,
                "frequencyRank": rank,
            })
            rank += 1
    return records


def main() -> None:
    records = build_records()
    errors = validate_records(records)
    if errors:
        for e in errors[:20]:
            print(f"[error] {e}")
        raise SystemExit(f"{len(errors)} validation error(s)")

    course_meta = {
        "id": COURSE_ID,
        "title": "Japanese Kana (Hiragana & Katakana)",
        "learningLanguage": "Japanese",
        "glossLanguage": "Romaji",
        "uiLanguage": "en",
        "type": "kana",
        "band": {"from": 0, "to": len(records)},
        "sources": [],
    }
    emit_course(COURSE_ID, course_meta, records, OUT)

    # category は使わないが、他コースと同じく実ファイルとして {} を置く（存在しないファイルへの
    # fetch は Vite dev サーバーの SPA フォールバックで 200+HTML が返り JSON.parse が例外になるため）。
    cat_path = os.path.join(OUT, COURSE_ID, "categories.json")
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump({}, f)

    with_examples = sum(1 for r in records if r["examples"])
    print(f"[build_ja_kana] {len(records)} kana cards built "
          f"({len(KANA_TABLE)} hiragana + {len(KANA_TABLE)} katakana), "
          f"{with_examples} with a standalone phrase.")


if __name__ == "__main__":
    main()
