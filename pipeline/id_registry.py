# -*- coding: utf-8 -*-
"""
cardId レジストリ＝「単語の内容 → cardId」の対応表。

## なぜ要るのか

cardId は元々 `f"{course_id}-{i:04d}"`（= 並び位置そのもの）で採番していた。
この方式だと語彙データを作り直すたびに同じ ID が別の単語を指す。実際に発火済み:

- a7b9dee (2026-07-31): en-10-30k で共通 ID 20,532 件のうち **20,531 件**が別の単語へ
  （en-10-30k-00002: american → grind）。壊れたまま本番デプロイ済み
- 8aaeee4 → d29955c: 上級漢字コースで 740 件中 **664 件**が別の字へ

学習進捗（IndexedDB）は cardId を主キーに持つので、ID が動くと「覚えた」判定が
まるごと別の単語に付く。しかも画面上は正常に見えるので誰も気づけない。

## 方針：内容ハッシュへの作り替えではなく「現行 ID の凍結」

出荷済みの ID をこの対応表に固定し、以後のビルドは表を引いて**既存 ID を再利用**、
新語だけ新しい番号を採る。この方式を選んだ理由は移行コストがゼロだから:

- 各端末の IndexedDB を一切触らない（進捗の移行が 0 件）
- coach-sentences.json の cardId 参照 2,108 件も書き換え不要
- categories.json のキー付け替えも不要

## content_key に何を含めるか

**(headword, reading) だけ**。gloss / pos / examples は含めない。

- gloss/pos: aae580b「translate ja-0-3k gloss/pos/examples from English to Tagalog」で
  一括書き換えた実績がある。キーに入れると、その時点で全語の ID が飛ぶ
- examples: 今後も追加していく運用なので、キーに入れると追加のたびに壊れる

裏を返すと **headword か reading を直したときだけ**未一致になる（年に数語のオーダー）。
そのときは registry の該当行の key を新表記に書き換えれば旧 ID を引き継げる。
ビルドは未一致を検出したら赤くなるので、気づかず素通りすることはない。
"""
import json
import os
import unicodedata

# 見出し語と読みの区切り。Unicode の UNIT SEPARATOR 記号（U+241F）を使う。
# 語彙データに現れないことが確実な文字なら何でもよいが、'|' や '\t' のような
# 実データに紛れ込みうる文字を選ぶと、別の語が同じキーに潰れる事故になる。
KEY_SEP = "␟"

REGISTRY_DIRNAME = "id_registry"


def registry_dir(pipeline_root: str | None = None) -> str:
    root = pipeline_root or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(root, REGISTRY_DIRNAME)


def registry_path(course_id: str, pipeline_root: str | None = None) -> str:
    return os.path.join(registry_dir(pipeline_root), f"{course_id}.json")


def norm(value: str | None) -> str:
    """NFC 正規化して前後の空白を落とす。合成済み/分解済みの揺れでキーが割れるのを防ぐ。"""
    return unicodedata.normalize("NFC", (value or "").strip())


def content_key(headword: str | None, reading: str | None) -> str:
    """単語の同一性キー。gloss/pos/examples は**意図的に含めない**（冒頭の説明を参照）。"""
    return norm(headword) + KEY_SEP + norm(reading)


def id_number(card_id: str, course_id: str) -> int:
    """'en-10-30k-00042' → 42。採番の続きを決めるために使う。"""
    suffix = card_id[len(course_id) + 1 :] if card_id.startswith(course_id + "-") else ""
    return int(suffix) if suffix.isdigit() else -1


class Registry:
    """1 コース分の対応表。

    entries は {key, id, frequencyRank, disambig} のリスト。
    disambig は「同じ (headword, reading) が複数ある衝突グループ」にだけ入る第2キー（seed 時点の gloss）。

    衝突の扱いを「衝突したときだけキーを延ばす」条件付きにしていないのは、
    他の行の存在に依存する設計だと、片方の語が消えた瞬間にもう片方のキーが変わって
    ID が飛ぶため。所属グループを registry 側に固定記録して、他行から独立させている。
    """

    def __init__(self, course_id: str, entries: list[dict], id_width: int, max_id_number: int):
        self.course_id = course_id
        self.entries = entries
        self.id_width = id_width
        self.max_id_number = max_id_number
        # key -> [entry, ...]（衝突グループは複数件になる）
        self._by_key: dict[str, list[dict]] = {}
        for e in entries:
            self._by_key.setdefault(e["key"], []).append(e)

    def lookup(
        self,
        headword: str | None,
        reading: str | None,
        gloss: str | None,
        frequency_rank: int | None = None,
    ) -> str | None:
        """既存 ID を引く。見つからなければ None（＝新語なので新しい番号を採る）。

        絞り込みは3段階。上の段で一意に決まればそこで終わり、決まらないときだけ下へ降りる:
          1. (headword, reading)
          2. + gloss          … 同じ語で訳語が違う多義語（実測: tl-0-2k に 24 グループ 50 語）
          3. + frequencyRank  … 見出し語・読み・訳語まで完全に同じ重複収録
                                （実測: tl-0-2k に 3 組。taon/silid/mura が2回ずつ入っている）
        """
        hits = self._by_key.get(content_key(headword, reading))
        if not hits:
            return None
        if len(hits) == 1:
            return hits[0]["id"]

        g = norm(gloss)
        narrowed = [e for e in hits if e.get("disambig") == g]
        if len(narrowed) == 1:
            return narrowed[0]["id"]
        if not narrowed:
            return None

        for e in narrowed:
            if e.get("rankKey") is not None and e["rankKey"] == frequency_rank:
                return e["id"]
        return None

    def next_id(self) -> str:
        self.max_id_number += 1
        return f"{self.course_id}-{self.max_id_number:0{self.id_width}d}"

    def add(self, headword: str | None, reading: str | None, gloss: str | None, card_id: str, frequency_rank: int) -> None:
        entry = {
            "key": content_key(headword, reading),
            "id": card_id,
            "frequencyRank": frequency_rank,
            "disambig": None,
            "rankKey": None,
        }
        self.entries.append(entry)
        self._by_key.setdefault(entry["key"], []).append(entry)

    def to_json(self) -> dict:
        return {
            "courseId": self.course_id,
            "idWidth": self.id_width,
            "maxIdNumber": self.max_id_number,
            "entries": self.entries,
        }


def load_registry(course_id: str, pipeline_root: str | None = None) -> Registry | None:
    path = registry_path(course_id, pipeline_root)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return Registry(data["courseId"], data["entries"], data["idWidth"], data["maxIdNumber"])


def save_registry(reg: Registry, pipeline_root: str | None = None) -> str:
    """**1 語 = 1 行**で書く。

    出荷 JSON（1 行に全部）とも、素の indent=2（1 語 7 行・全体 5.8MB）とも違う書き方をするのは、
    この表が「人と git が読むもの」だから。1 語 1 行なら、語を 1 つ足した差分が
    `+1 行` として出る＝ID が動いた事故をレビューで目視検知できる。
    entries は id 昇順で固定するので、再生成しても順序由来の差分は出ない。
    """
    os.makedirs(registry_dir(pipeline_root), exist_ok=True)
    path = registry_path(reg.course_id, pipeline_root)
    data = reg.to_json()
    entries = sorted(data["entries"], key=lambda e: id_number(e["id"], reg.course_id))
    with open(path, "w", encoding="utf-8") as f:
        f.write("{\n")
        for key in ("courseId", "idWidth", "maxIdNumber"):
            f.write(f' "{key}": {json.dumps(data[key], ensure_ascii=False)},\n')
        f.write(' "entries": [\n')
        for i, e in enumerate(entries):
            line = json.dumps(e, ensure_ascii=False, separators=(",", ":"))
            f.write(f"  {line}{',' if i < len(entries) - 1 else ''}\n")
        f.write(" ]\n}\n")
    return path
