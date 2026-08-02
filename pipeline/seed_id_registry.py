# -*- coding: utf-8 -*-
"""
cardId レジストリの初期作成（ワンショット）。

**出荷済みの public/data/courses/ を「正」として読み取り、対応表に写すだけ**。
出荷データは 1 バイトも書き換えない。実行後に `git status --porcelain public/` が
空であることが、この工程が正しく動いた証明になる。

なぜ「再ビルドして作り直す」ではなく「出荷物から写す」なのか:
出荷データはコミット済みパイプラインから再現できない。実測で、
- ja-10-30k は語数 12,622 に対し id の最大値が 12,735 ＝ 欠番 113。
  filter_easy_words_ja_10_30k.py が「build の再実行が重いので出荷 JSON を直接編集し、
  id・frequencyRank は詰め直さない」方式で消した結果で、build 側に反映されていない
- en-10-30k も同様に filter で 8,072 語を除去済み（49a4c70）
- pipeline/raw/ は .gitignore 対象で Kohei の PC にしかない
したがって「再ビルドしてゼロ diff」は原理的に達成できない。出荷物こそが唯一の正。

使い方: python pipeline/seed_id_registry.py
"""
import json
import os
import sys

from id_registry import Registry, content_key, id_number, norm, save_registry

PIPELINE_ROOT = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(PIPELINE_ROOT)
COURSES_ROOT = os.path.join(REPO_ROOT, "public", "data", "courses")


def list_course_ids(courses_root: str = COURSES_ROOT) -> list[str]:
    return sorted(
        d
        for d in os.listdir(courses_root)
        if os.path.isfile(os.path.join(courses_root, d, "manifest.json"))
    )


def load_course_cards(course_id: str, courses_root: str = COURSES_ROOT) -> list[dict]:
    """manifest.json の bands 順に全カードを読む（出荷されている順序をそのまま保つ）。"""
    course_dir = os.path.join(courses_root, course_id)
    with open(os.path.join(course_dir, "manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    cards: list[dict] = []
    for band in manifest["bands"]:
        with open(os.path.join(course_dir, band), "r", encoding="utf-8") as f:
            cards.extend(json.load(f))
    return cards


def seed_course(course_id: str) -> dict:
    cards = load_course_cards(course_id)

    # id の桁数は既存表記を踏襲する。既存の採番は f"{i:04d}"（en-10-30k のみ :05d）＝
    # **ゼロ埋めの最小桁数**なので、1 万を超える語では自然に桁が伸びる
    # （実測: ja-10-30k は 4 桁と 5 桁が混在）。したがって「桁数が一意」を前提にしてはいけない。
    # 最小桁数を実データから読み取り、その書式で全 id を再現できることをここで確かめる。
    id_width = min(len(c["id"]) - len(course_id) - 1 for c in cards)
    for c in cards:
        n = id_number(c["id"], course_id)
        if n < 0 or f"{course_id}-{n:0{id_width}d}" != c["id"]:
            raise SystemExit(f"[{course_id}] id を最小桁数 {id_width} で再現できません: {c['id']}")

    # 採番の続き。**語数ではなく実際の id 最大値**から採る。
    # フィルタで中抜きされたコースは語数 < 最大値なので、語数から採ると既存 id と衝突する。
    max_id_number = max(id_number(c["id"], course_id) for c in cards)

    # 同一 (headword, reading) の衝突グループを先に洗い出す
    by_key: dict[str, list[dict]] = {}
    for c in cards:
        by_key.setdefault(content_key(c.get("headword"), c.get("reading")), []).append(c)
    collided = {k: v for k, v in by_key.items() if len(v) > 1}

    entries = []
    for c in cards:
        key = content_key(c.get("headword"), c.get("reading"))
        disambig = norm(c.get("gloss")) if key in collided else None
        entries.append(
            {
                "key": key,
                "id": c["id"],
                "frequencyRank": c.get("frequencyRank"),
                "disambig": disambig,
                "rankKey": None,
            }
        )

    # gloss まで同じ完全重複（同じ語が2回収録されている）は第2キーでも分離できない。
    # 第3キーとして frequencyRank を立てる。黙って通すと「既存語なのに新語扱いで
    # 新しい id が振られる」＝進捗が切れるので、必ずここで一意化しておく。
    grouped: dict[tuple[str, str | None], list[dict]] = {}
    for e in entries:
        grouped.setdefault((e["key"], e["disambig"]), []).append(e)
    still_dup = {sig: es for sig, es in grouped.items() if len(es) > 1}
    for es in still_dup.values():
        for e in es:
            e["rankKey"] = e["frequencyRank"]

    # frequencyRank まで同じなら本当に区別が付かない（そのときだけ失敗させる）
    unresolved = [
        sig
        for sig, es in still_dup.items()
        if len({e["rankKey"] for e in es}) != len(es)
    ]

    reg = Registry(course_id, entries, id_width, max_id_number)
    path = save_registry(reg, PIPELINE_ROOT)

    return {
        "courseId": course_id,
        "words": len(cards),
        "idWidth": id_width,
        "maxIdNumber": max_id_number,
        "gaps": max_id_number - len(cards),
        "collisionGroups": len(collided),
        "collisionWords": sum(len(v) for v in collided.values()),
        "unresolved": len(unresolved),
        "path": path,
    }


def main() -> int:
    course_ids = list_course_ids()
    print(f"[seed] {len(course_ids)} courses: {', '.join(course_ids)}\n")
    total_words = total_unresolved = 0
    for cid in course_ids:
        r = seed_course(cid)
        total_words += r["words"]
        total_unresolved += r["unresolved"]
        print(
            f"  {r['courseId']:<20} words={r['words']:>6}  idWidth={r['idWidth']}  "
            f"maxId={r['maxIdNumber']:>6}  gaps={r['gaps']:>5}  "
            f"collisions={r['collisionGroups']}grp/{r['collisionWords']}w  "
            f"unresolved={r['unresolved']}"
        )
    print(f"\n[seed] total {total_words} words -> pipeline/{os.path.basename(os.path.dirname(r['path']))}/")
    if total_unresolved:
        print(
            f"[seed] !! 完全重複（headword+reading+gloss まで同一）が {total_unresolved} 組あります。"
            "この語は引けないため新語扱いになります。verify で必ず落ちます。"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
