# -*- coding: utf-8 -*-
"""
cardId の採番。**全ビルドの唯一の採番経路**。

以前は同じ「並び位置から作る」式が 4 箇所（emit.py / emit_en_10_30k.py と、
categories.json を書く build_*.py 3 本）に手書きでコピーされていて、
互いに「相手も同じ式のはず」と信じ合う構造になっていた。ここに一本化する。

採番の規則:
  1. レジストリ（pipeline/id_registry/）を内容キーで引き、**既存語は同じ ID を再利用**
  2. 引けなかった語（＝新語）だけ、そのコースの既存最大番号 + 1 を採る
  3. 新語はレジストリへ追記して保存する（次回以降そのIDが凍結される）

## ドリフト検知（このモジュールを作った本当の理由）

「新しい ID を振った語がある（new > 0）」だけでは異常と言えない——語を追加すれば当然そうなる。
異常なのは **new > 0 かつ orphaned > 0**（レジストリにあるのに今回のビルドで一度も引かれなかった
エントリがある）の組み合わせ。これは「同じ語なのにキーが変わって引けず、新しい ID が振られた」
＝進捗が切れる事故の署名そのもの。

  - 語の追加のみ        → new > 0, orphaned = 0   … 正常
  - 語の削除のみ        → new = 0, orphaned > 0   … 正常（#34 のようなフィルタ）
  - headword/reading 改変 → new > 0, orphaned > 0 … 異常。ビルドを落とす
"""
import sys

from id_registry import KEY_SEP, Registry, load_registry, norm, save_registry


class AssignReport:
    def __init__(self, course_id: str):
        self.course_id = course_id
        self.reused = 0
        self.new = 0
        self.orphaned = 0
        self.new_samples: list[str] = []
        self.orphan_samples: list[str] = []

    @property
    def has_drift(self) -> bool:
        """既存語のキーが変わって引けなくなった疑い（冒頭の説明を参照）"""
        return self.new > 0 and self.orphaned > 0

    def render(self) -> str:
        lines = [
            f"[card_id] {self.course_id}: 再利用 {self.reused} / 新規採番 {self.new} / "
            f"レジストリ未使用 {self.orphaned}"
        ]
        if self.has_drift:
            lines.append(
                "[card_id] !! 既存語のIDが動いた可能性があります"
                "（新規採番と未使用エントリが同時に出ています）"
            )
            if self.new_samples:
                lines.append("   新しいIDが振られた語: " + ", ".join(self.new_samples[:5]))
            if self.orphan_samples:
                lines.append("   引かれなかった既存語: " + ", ".join(self.orphan_samples[:5]))
            lines.append(
                "   headword / reading を直したのであれば、pipeline/id_registry/"
                f"{self.course_id}.json の該当行の key を新しい表記へ書き換えてください"
                "（旧IDが引き継がれ、学習進捗が切れません）"
            )
        return "\n".join(lines)


def assign_ids(
    course_id: str,
    records: list[dict],
    pipeline_root: str | None = None,
    id_width: int = 4,
    persist: bool = True,
    strict: bool = True,
) -> tuple[list[str], AssignReport]:
    """records と同じ並びの cardId 一覧を返す。

    persist=False にすると、レジストリを書き換えずに採番結果だけ見られる（dry-run 用）。
    strict=True でドリフトを検知したら、レポートを出して SystemExit(1) する。
    """
    reg = load_registry(course_id, pipeline_root)
    if reg is None:
        reg = Registry(course_id, [], id_width, 0)
    known_ids = {e["id"] for e in reg.entries}

    report = AssignReport(course_id)
    used_ids: set[str] = set()
    ids: list[str] = []

    for r in records:
        headword, reading = r.get("headword"), r.get("reading")
        gloss, rank = r.get("gloss"), r.get("frequencyRank")
        found = reg.lookup(headword, reading, gloss, rank)
        if found is not None:
            ids.append(found)
            used_ids.add(found)
            report.reused += 1
            continue
        new_id = reg.next_id()
        reg.add(headword, reading, gloss, new_id, rank)
        ids.append(new_id)
        used_ids.add(new_id)
        report.new += 1
        if len(report.new_samples) < 5:
            report.new_samples.append(f"{norm(headword)}({new_id})")

    for e in reg.entries:
        if e["id"] in known_ids and e["id"] not in used_ids:
            report.orphaned += 1
            if len(report.orphan_samples) < 5:
                report.orphan_samples.append(f"{e['key'].split(KEY_SEP)[0]}({e['id']})")

    print(report.render())

    if strict and report.has_drift:
        raise SystemExit(1)
    if persist and report.new > 0:
        save_registry(reg, pipeline_root)

    return ids, report
