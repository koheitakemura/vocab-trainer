# -*- coding: utf-8 -*-
"""
EJDict-hand（CC0・kujirahand/EJDict、全45,609件）の読み込み・見出し語インデックス化。
判断ログ#28 準拠のコースA専用パーサ（既存 pos_map.py 等は JMdict 前提のため転用不可）。

- 見出し語データは raw/spike-en15-30k/ejdict_src/ をそのまま本番ソースとして参照する
  （build_tl_skeleton.py が spike-tl/ を本番rawとして直接参照するのと同じ既存コンベンション。
  ファイルを「昇格」移動する必要はない）
- カンマ区切りの複数スペル/略記見出し（例: "E,E.,e,e." の4見出し）を分割する
- 大文字小文字違いの重複（例: E と e で別行）は小文字キーへの統合で自動的に解消される
  （正規化のための特別なロジックは不要——lower() したキーで引く時点で吸収される）
- "XXXの過去形/複数形/比較級..." のようなクロスリファレンスのみで実質的な語義を持たない
  エントリ（3.5%）は、参照先の語義へ1段だけ解決する。ただし本プロジェクトの候補プールは
  gen_en_wordfreq_ranked.py の時点で lemminflect によりレンマ化済みのため、"ate"のような
  屈折形が候補として直接引かれることは通常ない（既に候補は "eat" になっている）——この
  解決ロジックは lemminflect が正規化しきれない稀なケースの保険
- フレーズ（複数語・ハイフン含む）見出し語（14.8%）は除外しない（判断ログ#28: Koheiが
  明示的に採用を選択。コロケーション・熟語は上級英語学習の価値が高いため）
"""
import re

EJDICT_DIR = "raw/spike-en15-30k/ejdict_src"
LETTERS = "abcdefghijklmnopqrstuvwxyz"

CROSS_REF_RE = re.compile(
    r"^([A-Za-z][A-Za-z '\-]*)の(過去形|過去分詞形|現在分詞形|複数形|比較級|最上級|異形|省略形|短縮形)$"
)


class Entry:
    __slots__ = ("headword", "senses", "is_cross_ref_only", "cross_ref_target")

    def __init__(self, headword: str, senses: list[str]):
        self.headword = headword
        self.senses = senses
        m = CROSS_REF_RE.match(senses[0]) if len(senses) == 1 else None
        if m:
            self.is_cross_ref_only = True
            self.cross_ref_target = m.group(1).lower()
        else:
            self.is_cross_ref_only = False
            self.cross_ref_target = None


def load_raw_rows() -> list[tuple[list[str], list[str]]]:
    """26ファイルを読み、(見出し語バリアントのリスト, 語義のリスト) を行単位で返す。"""
    rows = []
    for c in LETTERS:
        path = f"{EJDICT_DIR}/{c}.txt"
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) < 2:
                    continue
                headwords = [h.strip() for h in parts[0].split(",") if h.strip()]
                senses = [s.strip() for s in parts[1].split(" / ") if s.strip()]
                if headwords and senses:
                    rows.append((headwords, senses))
    return rows


def build_index() -> tuple[dict[str, list[Entry]], dict[str, int]]:
    rows = load_raw_rows()
    index: dict[str, list[Entry]] = {}
    n_entries = 0
    n_phrase = 0
    n_cross_ref_only = 0
    for headwords, senses in rows:
        for hw in headwords:
            key = hw.lower()
            entry = Entry(hw, senses)
            index.setdefault(key, []).append(entry)
            n_entries += 1
            if " " in key or "-" in key:
                n_phrase += 1
            if entry.is_cross_ref_only:
                n_cross_ref_only += 1
    stats = {
        "n_rows": len(rows),
        "n_entries": n_entries,
        "n_unique_headwords": len(index),
        "n_phrase_headwords": n_phrase,
        "n_cross_ref_only": n_cross_ref_only,
    }
    return index, stats


def resolve_gloss(key: str, index: dict[str, list[Entry]], _depth: int = 0) -> list[str] | None:
    """見出し語(小文字)の語義リストを返す。クロスリファレンスのみのエントリは
    参照先の語義へ1段だけ解決する（循環・多段参照は安全側に倒してNone）。"""
    entries = index.get(key)
    if not entries:
        return None
    senses: list[str] = []
    for e in entries:
        if e.is_cross_ref_only:
            if _depth == 0 and e.cross_ref_target and e.cross_ref_target != key:
                resolved = resolve_gloss(e.cross_ref_target, index, _depth=1)
                if resolved:
                    senses.extend(resolved)
        else:
            senses.extend(e.senses)
    return senses or None


if __name__ == "__main__":
    import time

    t0 = time.time()
    index, stats = build_index()
    print(stats)
    for w in ("run", "ate", "automata", "a cappella", "absentee ballot", "arrow"):
        print(w, "->", resolve_gloss(w, index))
    print(f"{time.time()-t0:.2f}s")
