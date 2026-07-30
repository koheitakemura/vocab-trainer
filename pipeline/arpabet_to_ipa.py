# -*- coding: utf-8 -*-
"""
ARPABET（CMUdict の発音表記）-> IPA 変換テーブル。pos_map.py と同型の手書き静的辞書
（外部ライブラリ非依存・ライセンスリスクゼロ）。判断ログ#28: CMUdictはBSD類似ライセンスで
再配布可、ARPABET->IPA変換の「決定版」OSSは無いため自前実装が既存コードスタイルと一貫。

ARPABET は39音素の閉じた記号系（子音24＋母音15、母音にはさらに強勢数字 0(無強勢)/
1(第一強勢)/2(第二強勢) が付く）。強勢記号(ˈ/ˌ)は真の音節境界ではなく強勢母音の直前に
置く簡易近似（CMUdictが音節境界を明示しないための一般的な簡略化。厳密な音節解析はしない）。
"""
import re

# 子音（strippedなASCII表記 -> IPA）
CONSONANTS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

# 母音（強勢なし表記 -> (無強勢IPA, 強勢IPA)。AH と ER は無強勢/有強勢で別記号を使うのが慣行
# （無強勢AH=schwa ə、有強勢AH=ʌ／無強勢ER=ɚ、有強勢ER=ɝ）。他の母音は強勢の有無で
# 記号を変えない（単純化）。
VOWELS = {
    "AA": ("ɑ", "ɑ"), "AE": ("æ", "æ"), "AH": ("ə", "ʌ"), "AO": ("ɔ", "ɔ"),
    "AW": ("aʊ", "aʊ"), "AY": ("aɪ", "aɪ"), "EH": ("ɛ", "ɛ"), "ER": ("ɚ", "ɝ"),
    "EY": ("eɪ", "eɪ"), "IH": ("ɪ", "ɪ"), "IY": ("i", "i"), "OW": ("oʊ", "oʊ"),
    "OY": ("ɔɪ", "ɔɪ"), "UH": ("ʊ", "ʊ"), "UW": ("u", "u"),
}

STRESS_RE = re.compile(r"^([A-Z]+)([0-2])?$")


def arpabet_to_ipa(phonemes: list[str]) -> str:
    """CMUdictの音素リスト（例: ["P","R","EH1","Z","AH0","N","T"]）を
    IPA文字列（例: "pɹˈɛzənt"）へ変換する。"""
    out = []
    for ph in phonemes:
        m = STRESS_RE.match(ph)
        if not m:
            continue
        symbol, stress = m.group(1), m.group(2)
        if symbol in VOWELS:
            unstressed_ipa, stressed_ipa = VOWELS[symbol]
            if stress == "1":
                out.append("ˈ" + stressed_ipa)
            elif stress == "2":
                out.append("ˌ" + stressed_ipa)
            else:
                out.append(unstressed_ipa)
        elif symbol in CONSONANTS:
            out.append(CONSONANTS[symbol])
        # 未知記号は無視（ARPABETは閉じた記号系なので通常発生しない安全網）
    return "".join(out)


def strip_variant_suffix(word: str) -> str:
    """CMUdictの "a(2)" のような異表記番号サフィックスを取り除く。"""
    return re.sub(r"\(\d+\)$", "", word)


def load_cmudict(path: str = "raw/cmudict.dict") -> dict[str, list[str]]:
    """word(小文字) -> ARPABET音素リスト。同じ語に複数発音がある場合は
    サフィックス無しの主発音(word(2)等が付かない最初のエントリ)を優先する。"""
    index: dict[str, list[str]] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith(";;;"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            raw_word, phonemes = parts[0], parts[1:]
            is_variant = "(" in raw_word
            word = strip_variant_suffix(raw_word).lower()
            if word not in index or not is_variant:
                # 主発音（サフィックス無し）が来たら上書きし、無ければ最初に見た異形を保持
                if word not in index or not is_variant:
                    index[word] = phonemes
    return index


if __name__ == "__main__":
    cmu = load_cmudict()
    print(f"CMUdict loaded: {len(cmu)} unique words")
    for w in ("present", "record", "run", "beautiful", "psychology", "the", "run"):
        phonemes = cmu.get(w)
        if phonemes:
            print(f"{w}: {phonemes} -> /{arpabet_to_ipa(phonemes)}/")
        else:
            print(f"{w}: not found")
