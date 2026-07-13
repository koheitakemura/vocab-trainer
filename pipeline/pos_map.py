# -*- coding: utf-8 -*-
"""JMdict の品詞タグコード → 表示用ラベル。未知タグは None を返す（呼び出し側でフォールバック）。"""

POS_MAP = {
    "n": "noun",
    "n-adv": "noun",
    "n-t": "noun",
    "n-pref": "prefix",
    "n-suf": "suffix",
    "pn": "pronoun",
    "adj-i": "い-adjective",
    "adj-na": "な-adjective",
    "adj-no": "adjective (no)",
    "adj-pn": "adjective",
    "adj-t": "adjective",
    "adj-f": "adjective",
    "adj-ix": "い-adjective",
    "adv": "adverb",
    "adv-to": "adverb",
    "aux": "auxiliary",
    "aux-v": "auxiliary verb",
    "aux-adj": "auxiliary adjective",
    "conj": "conjunction",
    "cop": "copula",
    "ctr": "counter",
    "exp": "expression",
    "int": "interjection",
    "num": "numeric",
    "pref": "prefix",
    "prt": "particle",
    "suf": "suffix",
    "vs": "verb (suru)",
    "vs-i": "verb (suru)",
    "vs-s": "verb (suru)",
    "vk": "verb (kuru)",
    "v1": "verb",
    "v1-s": "verb",
    "v5aru": "verb",
    "v5b": "verb",
    "v5g": "verb",
    "v5k": "verb",
    "v5k-s": "verb",
    "v5m": "verb",
    "v5n": "verb",
    "v5r": "verb",
    "v5r-i": "verb",
    "v5s": "verb",
    "v5t": "verb",
    "v5u": "verb",
    "v5u-s": "verb",
    "vi": "verb",
    "vt": "verb",
    "vz": "verb",
}


def pos_label(codes: list[str]) -> str:
    for c in codes:
        label = POS_MAP.get(c)
        if label:
            return label
    return codes[0] if codes else "other"
