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


# その かな で始まる短い実用フレーズを用例として付ける（Kohei 依頼）。
# 「あ！」のように1文字で成立する間投詞に加えて、「うっ」「ほー」「ごめん！」のように
# 2文字以上でも**その場でそのまま使える**ごく短い発話まで含める。
#
# 選定の方針:
#  - **その かな で始まる**こと（札の文字を思い出す手がかりになるため）。
#  - **1回の発話として完結**すること。単語の断片や活用の途中は入れない。
#  - **初学者がその日から使える**こと。文法説明が要る長文は入れない。
#  - **ひらがなだけに付ける。** 同じ音のカタカナ札（ア／エ…）には付けない——間投詞を
#    カタカナで書くのは漫画的な表記で、初学者に教える正書法としては不適切なため。
#    （カタカナ札には将来「その字で始まる外来語」を当てるほうが正書法として自然。未実装）
#  - 助詞（を・へ の格助詞用法など）そのものの説明は入れない。ここは発話の練習。
#  - 方言色・世代色が強いもの、乱暴な語（ばか！等）は入れない。
#  - 自然な言い回しが無い かな には**無理に付けない**（ぐ・ぞ・ぶ・ぼ・る・れ・ろ 等）。
#    ぎこちない例文を出すくらいなら、用例なしのほうが教材として良い。
#
# 訳は**タガログ語**（メンバー向けコースのグロスをタガログ語にする方針と揃える）。
# 右側のコメントに英語を残してあるのは、あとから語を足すときの照合用。
STANDALONE_KANA_EXAMPLES = {
    # あ行
    "あ": ("あ！", "Ah! (may napagtanto ka)"),                       # Ah! (you just realized something)
    "い": ("いいね！", "Ang galing! / Maganda 'yan!"),                # Nice! / Sounds good!
    "う": ("うっ…", "Aray! (biglang sakit)"),                        # Ugh! (a sudden pain)
    "え": ("え！？", "Ha!? (gulat o hindi makapaniwala)"),            # Huh?! (surprise or disbelief)
    "お": ("お！", "Oh! (may napansin ka)"),                          # Oh! (you noticed something)
    # か行
    "か": ("かわいい！", "Ang cute!"),                                # Cute!
    "き": ("きれい！", "Ang ganda! / Ang linis!"),                    # Beautiful! / So clean!
    "く": ("ください。", "Pahingi po nito."),                         # Please (give me that).
    "け": ("けっこうです。", "Hindi na po, salamat."),                 # No, thank you.
    "こ": ("こんにちは。", "Magandang araw po."),                      # Hello.
    # さ行
    "さ": ("さようなら。", "Paalam."),                                # Goodbye.
    "し": ("しまった！", "Naku! Nagkamali ako!"),                     # Oops! / I messed up!
    "す": ("すごい！", "Ang galing!"),                                # Wow! / Amazing!
    "せ": ("せーの！", "Isa, dalawa, tatlo!"),                        # Ready, set, go!
    "そ": ("そうそう！", "Oo, tama!"),                                # Yes, exactly!
    # た行
    "た": ("たいへん！", "Naku, grabe!"),                             # That's terrible!
    "ち": ("ちがう！", "Mali 'yan!"),                                 # That's not right!
    "つ": ("つかれた〜", "Pagod na pagod ako."),                      # I'm exhausted.
    "て": ("てつだって！", "Tulungan mo ako!"),                        # Help me!
    "と": ("とまって！", "Tigil! / Hinto!"),                          # Stop!
    # な行
    "な": ("なに？", "Ano?"),                                         # What?
    "に": ("にがい！", "Ang pait!"),                                  # It's bitter!
    "ぬ": ("ぬるい。", "Maligamgam."),                                # It's lukewarm.
    "ね": ("ね！", "Uy! / Di ba?"),                                   # Hey! / Right?
    "の": ("のどかわいた。", "Nauuhaw ako."),                          # I'm thirsty.
    # は行
    "は": ("はい。", "Oo. / Opo."),                                   # Yes.
    "ひ": ("ひどい！", "Ang sama naman!"),                            # That's awful!
    "ふ": ("ふーん。", "Ganun ba. (hindi masyadong interesado)"),      # Hmm, I see. (not impressed)
    "へ": ("へー！", "Talaga! (nakakainteres)"),                      # Oh, really! (interesting)
    "ほ": ("ほー。", "Aba! (humanga)"),                               # Oh! (impressed)
    # ま行
    "ま": ("ま、いいか。", "Hayaan mo na."),                           # Oh well, never mind.
    "み": ("みて！", "Tingnan mo!"),                                  # Look!
    "む": ("むずかしい。", "Mahirap 'yan."),                           # That's difficult.
    "め": ("めずらしい！", "Bihira 'yan!"),                            # That's rare!
    "も": ("もういちど。", "Isa pang beses."),                         # One more time.
    # や・ら・わ行
    "や": ("やった！", "Nagawa ko! / Yes!"),                          # I did it! / Yay!
    "ゆ": ("ゆっくり。", "Dahan-dahan lang."),                        # Slowly. / Take your time.
    "よ": ("よ！", "Uy! (pagbati sa kaibigan)"),                      # Yo! (casual greeting)
    "り": ("りょうかい！", "Naintindihan ko!"),                        # Got it! / Roger!
    "わ": ("わ！", "Wow! (nagulat)"),                                 # Wow! / Whoa! (surprise)
    "ん": ("ん？", "Ha? (hindi mo narinig)"),                         # Hm? (you didn't catch that)
    # 濁音・半濁音
    "が": ("がんばって！", "Kaya mo 'yan!"),                           # Good luck! / You can do it!
    "ぎ": ("ぎりぎり！", "Muntik na!"),                               # Just barely made it!
    "げ": ("げんき？", "Kumusta ka?"),                                # How are you?
    "ご": ("ごめん！", "Pasensya na!"),                               # Sorry!
    "ざ": ("ざんねん！", "Sayang!"),                                  # What a shame!
    "じ": ("じゃあね！", "Kita tayo!"),                               # See you!
    "ず": ("ずるい！", "Ang daya!"),                                  # That's not fair!
    "ぜ": ("ぜんぜん。", "Hindi talaga."),                            # Not at all.
    "だ": ("だいじょうぶ？", "Ayos ka lang?"),                        # Are you OK?
    "で": ("できた！", "Tapos na! / Nagawa ko!"),                     # I did it! / It's done!
    "ど": ("どうぞ。", "Sige, tuloy lang."),                          # Please, go ahead.
    "ば": ("ばんざい！", "Mabuhay!"),                                 # Hooray!
    "び": ("びっくり！", "Nagulat ako!"),                             # What a surprise!
    "べ": ("べつに。", "Wala lang."),                                 # Not really.
    "ぴ": ("ぴったり！", "Sakto!"),                                   # A perfect fit!
    # 拗音
    "きゃ": ("きゃー！", "Aaah! (sigaw)"),                            # Kyaa! (a scream)
}

# カタカナ札には「その字で始まる外来語」を当てる（Kohei 依頼）。
#
# ひらがな側の間投詞をカタカナで書くのは漫画的な表記になってしまうが、外来語は
# **カタカナで書くのが正しい表記**なので、字を覚えると同時に「カタカナはこういうときに使う」
# という文字種の役割まで学べる。英語由来の語が多く、意味も推測しやすい。
#
# 選定の方針:
#  - その字で始まること。拗音（シャ・チョ 等）は拗音の札に寄せ、清音の札には別語を当てる
#    （例: シ＝システム／シャ＝シャツ、チ＝チーズ／チョ＝チョコレート）。
#  - 日常語であること。専門語・カタカナ英語の造語は避ける。
#  - 外来語が作れない字（ヌ・ヤ・ヲ・ン・ザ・ヂ・ヅ・拗音の多く）は**空のまま**にする。
KATAKANA_LOANWORDS = {
    # 清音
    "ア": ("アイス", "sorbetes"),                  # ice cream
    "イ": ("イベント", "kaganapan"),               # event
    "ウ": ("ウイルス", "virus"),                   # virus
    "エ": ("エアコン", "aircon"),                  # air conditioner
    "オ": ("オレンジ", "kahel"),                   # orange
    "カ": ("カメラ", "kamera"),                    # camera
    "キ": ("キッチン", "kusina"),                  # kitchen
    "ク": ("クラス", "klase"),                     # class
    "ケ": ("ケーキ", "cake"),                      # cake
    "コ": ("コーヒー", "kape"),                    # coffee
    "サ": ("サラダ", "salad"),                     # salad
    "シ": ("システム", "sistema"),                 # system
    "ス": ("スープ", "sabaw / sopas"),             # soup
    "セ": ("セット", "set"),                       # set
    "ソ": ("ソース", "sarsa"),                     # sauce
    "タ": ("タクシー", "taksi"),                   # taxi
    "チ": ("チーズ", "keso"),                      # cheese
    "ツ": ("ツアー", "tour / paglilibot"),         # tour
    "テ": ("テレビ", "telebisyon"),                # TV
    "ト": ("トマト", "kamatis"),                   # tomato
    "ナ": ("ナイフ", "kutsilyo"),                  # knife
    "ニ": ("ニット", "damit na niniting"),         # knitwear
    "ネ": ("ネクタイ", "kurbata"),                 # necktie
    "ノ": ("ノート", "kuwaderno"),                 # notebook
    "ハ": ("ハンバーガー", "hamburger"),            # hamburger
    "ヒ": ("ヒーター", "pampainit"),               # heater
    "フ": ("フォーク", "tinidor"),                 # fork
    "ヘ": ("ヘルメット", "helmet"),                # helmet
    "ホ": ("ホテル", "hotel"),                     # hotel
    "マ": ("マンゴー", "mangga"),                  # mango
    "ミ": ("ミルク", "gatas"),                     # milk
    "ム": ("ムード", "mood / damdamin"),           # mood
    "メ": ("メニュー", "menu"),                    # menu
    "モ": ("モデル", "modelo"),                    # model
    "ユ": ("ユニフォーム", "uniporme"),             # uniform
    "ヨ": ("ヨーグルト", "yogurt"),                # yogurt
    "ラ": ("ラジオ", "radyo"),                     # radio
    "リ": ("リモコン", "remote ng TV"),            # TV remote
    "ル": ("ルール", "patakaran"),                 # rule
    "レ": ("レモン", "limon"),                     # lemon
    "ロ": ("ロボット", "robot"),                   # robot
    "ワ": ("ワイン", "alak (wine)"),               # wine
    # 濁音・半濁音
    "ガ": ("ガス", "gas"),                         # gas
    "ギ": ("ギター", "gitara"),                    # guitar
    "グ": ("グループ", "grupo"),                   # group
    "ゲ": ("ゲーム", "laro"),                      # game
    "ゴ": ("ゴルフ", "golf"),                      # golf
    "ジ": ("ジーンズ", "maong"),                   # jeans
    "ズ": ("ズボン", "pantalon"),                  # trousers
    "ゼ": ("ゼロ", "sero"),                        # zero
    "ゾ": ("ゾーン", "sona"),                      # zone
    "ダ": ("ダンス", "sayaw"),                     # dance
    "デ": ("デザート", "panghimagas"),             # dessert
    "ド": ("ドア", "pinto"),                       # door
    "バ": ("バス", "bus"),                         # bus
    "ビ": ("ビール", "serbesa"),                   # beer
    "ブ": ("ブラシ", "brush"),                     # brush
    "ベ": ("ベッド", "kama"),                      # bed
    "ボ": ("ボール", "bola"),                      # ball
    "パ": ("パン", "tinapay"),                     # bread
    "ピ": ("ピアノ", "piyano"),                    # piano
    "プ": ("プール", "swimming pool"),             # swimming pool
    "ペ": ("ペン", "pen / panulat"),               # pen
    "ポ": ("ポケット", "bulsa"),                   # pocket
    # 拗音
    "キャ": ("キャンプ", "kamping"),               # camp
    "ギャ": ("ギャラリー", "galerya"),             # gallery
    "シャ": ("シャツ", "kamiseta"),                # shirt
    "シュ": ("シューズ", "sapatos"),               # shoes
    "ショ": ("ショップ", "tindahan"),              # shop
    "ジャ": ("ジャム", "palaman"),                 # jam
    "ジュ": ("ジュース", "juice"),                 # juice
    "ジョ": ("ジョギング", "jogging"),             # jogging
    "チャ": ("チャンス", "pagkakataon"),           # chance
    "チュ": ("チューリップ", "tulip"),             # tulip
    "チョ": ("チョコレート", "tsokolate"),         # chocolate
    "ニュ": ("ニュース", "balita"),                # news
    "ミュ": ("ミュージック", "musika"),            # music
    "リュ": ("リュック", "backpack"),              # backpack
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
            # ひらがな札＝その字で始まる短い発話 ／ カタカナ札＝その字で始まる外来語
            phrase = KATAKANA_LOANWORDS.get(kata) if katakana_flag else STANDALONE_KANA_EXAMPLES.get(hira)
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
        "title": "Japanese Hiragana & Katakana",
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
