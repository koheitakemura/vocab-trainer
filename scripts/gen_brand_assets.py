"""Vocab Trainer のブランド資産（アイコン SVG / PNG / OGP）を 1 つの定義から書き出す。

ロゴ = "Coverage Grid"。マス目が 1 語で、左下から順に埋まり、白い 1 マスが「いま出題中の語」。
語彙のカバレッジ可視化＝このアプリの中核を、そのまま紋章にしている。

なぜ生成スクリプトにしてあるか:
  手で描いた PNG は「あとで少しだけ直す」ができない。色・マスの数・余白はすべて下の
  定数から決まるので、変えたい時はここを直して `python scripts/gen_brand_assets.py` で
  全サイズを作り直す。SVG と PNG が同じ定義から出るので、両者がズレることもない。

使い方:
  python scripts/gen_brand_assets.py          # 既定の出力先へ全部書き出す
  python scripts/gen_brand_assets.py --check  # 書き出さず、現在のファイルと一致するかだけ見る

必要なもの: Pillow（PNG 描画）。SVG はテキスト生成なので依存なし。
"""

from __future__ import annotations

import argparse
import io
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
BRAND_SRC = ROOT / "src" / "brand"

# ---------------------------------------------------------------------------
# 色（src/design/themes.css のトークンと同じ値。ここだけ独自の色を作らない）
# ---------------------------------------------------------------------------
BG = (11, 17, 32)  # --bg        #0b1120  地
ACCENT = (110, 168, 254)  # --accent    #6ea8fe  習得済みのマス
INK = (232, 237, 247)  # --text      #e8edf7  いま出題中の 1 マス
DIM = (34, 48, 78)  # 未学習のマス（--surface と --border の中間）
LEARNING_ALPHA = 0.45  # 学習中のマス = アクセントをこの不透明度で地に重ねた色

BG_HEX = "#0b1120"
ACCENT_HEX = "#6ea8fe"
INK_HEX = "#e8edf7"
DIM_HEX = "#22304e"


def blend(fg: tuple[int, int, int], bg: tuple[int, int, int], a: float) -> tuple[int, int, int]:
    """fg を不透明度 a で bg に重ねた色。PNG は不透明で書き出すので先に潰しておく。"""
    return tuple(round(f * a + b * (1 - a)) for f, b in zip(fg, bg))  # type: ignore[return-value]


LEARNING = blend(ACCENT, BG, LEARNING_ALPHA)

# ---------------------------------------------------------------------------
# マスの状態
#   2 = 習得済み（アクセント）/ 1 = 学習中（半透明アクセント）/ 9 = いま出題中（白）/ 0 = 未学習
# 左下から右上へ波が進む形。0 と 9 の位置は「進行中」に見えるかを実サイズで確認して決めた。
# ---------------------------------------------------------------------------
GRID_4 = [
    [1, 0, 0, 0],  # 上段
    [2, 1, 0, 0],
    [2, 2, 9, 0],
    [2, 2, 2, 1],  # 下段
]
GRID_3 = [
    [1, 0, 0],
    [2, 9, 0],
    [2, 2, 2],
]

STATE_COLOR = {0: DIM, 1: LEARNING, 2: ACCENT, 9: INK}
STATE_SVG = {
    0: (DIM_HEX, 1.0),
    1: (ACCENT_HEX, LEARNING_ALPHA),
    2: (ACCENT_HEX, 1.0),
    9: (INK_HEX, 1.0),
}


@dataclass(frozen=True)
class Layout:
    """512 を基準にした座標。実際の書き出しサイズには比率で拡大する。"""

    grid: list[list[int]]
    origin: float  # 左上のマスの原点
    cell: float
    gap: float
    radius: float  # マスの角丸

    @property
    def n(self) -> int:
        return len(self.grid)

    @property
    def extent(self) -> float:
        return self.n * self.cell + (self.n - 1) * self.gap


# 通常アイコン: 中身は canvas の 62.5%。ホーム画面で見たときに痩せて見えない大きさ。
STANDARD = Layout(grid=GRID_4, origin=96, cell=62, gap=24, radius=16)

# maskable: Android は canvas の内接円 80%（= 中心から半径 204.8）の外を削る。
# 中身 284 角 → 対角の半分 201 < 204.8 なので、円に切られても 4 隅が欠けない。
MASKABLE = Layout(grid=GRID_4, origin=114, cell=56, gap=20, radius=14)

# favicon 用（16〜32px）: 4×4 だと潰れて模様になるので 3×3 に間引き、1 マスを大きく取る。
COMPACT = Layout(grid=GRID_3, origin=78, cell=96, gap=34, radius=22)

BASE = 512.0  # Layout の座標系


# ---------------------------------------------------------------------------
# PNG
# ---------------------------------------------------------------------------
def render_icon(layout: Layout, size: int, supersample: int = 4) -> Image.Image:
    """アイコンを 1 枚描く。角丸なしの正方形＝各 OS が自前のマスクを掛けるため。"""
    s = max(size * supersample, 1024)
    scale = s / BASE
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    for row, states in enumerate(layout.grid):
        for col, state in enumerate(states):
            x = (layout.origin + col * (layout.cell + layout.gap)) * scale
            y = (layout.origin + row * (layout.cell + layout.gap)) * scale
            d.rounded_rectangle(
                [x, y, x + layout.cell * scale, y + layout.cell * scale],
                radius=layout.radius * scale,
                fill=STATE_COLOR[state],
            )
    return img.resize((size, size), Image.LANCZOS)


def radial_ground(w: int, h: int) -> Image.Image:
    """OGP の地。アプリの --bg-grad（上中央から淡く広がる濃紺）を再現する。

    楕円を描いて強くぼかす方式。radial_gradient を変形して貼る方法だと左右の対称が崩れやすい。
    """
    base = Image.new("RGB", (w, h), BG)
    glow = Image.new("RGB", (w, h), (24, 37, 66))  # #182542
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse(
        [w / 2 - 560, -300, w / 2 + 560, 210], fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(150))
    return Image.composite(glow, base, mask)


def load_font(names: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    raise SystemExit(f"フォントが見つかりません: {names}")


TAGLINE = "語彙特化の学習アプリ｜英語・日本語"


def render_og(w: int = 1200, h: int = 630) -> Image.Image:
    """リンク共有時のカード。マーク＋ワードマーク＋一行説明を、面の中央に置く。"""
    img = radial_ground(w, h)
    d = ImageDraw.Draw(img)

    bold = load_font(["segoeuib.ttf", "arialbd.ttf"], 76)
    regular = load_font(["segoeui.ttf", "arial.ttf"], 76)
    jp = load_font(["YuGothM.ttc", "meiryo.ttc"], 28)

    tile, gap = 180, 54
    lead_w = d.textlength("Vocab ", font=bold)
    wm_w = lead_w + d.textlength("Trainer", font=regular)
    text_w = max(wm_w, d.textlength(TAGLINE, font=jp))
    x = (w - (tile + gap + text_w)) / 2
    cy = h / 2

    mark = render_icon(STANDARD, tile)
    rounded = Image.new("L", (tile, tile), 0)
    ImageDraw.Draw(rounded).rounded_rectangle([0, 0, tile - 1, tile - 1], radius=40, fill=255)
    img.paste(mark, (round(x), round(cy - tile / 2)), rounded)

    tx = x + tile + gap
    d.text((tx, cy - 30), "Vocab", font=bold, fill=INK, anchor="lm")
    d.text((tx + lead_w, cy - 30), "Trainer", font=regular, fill=(154, 167, 194), anchor="lm")
    d.text((tx + 3, cy + 52), TAGLINE, font=jp, fill=(154, 167, 194), anchor="lm")
    return img


# ---------------------------------------------------------------------------
# SVG（リポジトリに残すマスター。React コンポーネントもこの座標を使う）
# ---------------------------------------------------------------------------
def render_svg(layout: Layout, title: str, background: bool = True) -> str:
    cells = []
    for row, states in enumerate(layout.grid):
        for col, state in enumerate(states):
            x = layout.origin + col * (layout.cell + layout.gap)
            y = layout.origin + row * (layout.cell + layout.gap)
            color, alpha = STATE_SVG[state]
            op = "" if alpha == 1.0 else f' fill-opacity="{alpha}"'
            cells.append(
                f'  <rect x="{x:g}" y="{y:g}" width="{layout.cell:g}" height="{layout.cell:g}"'
                f' rx="{layout.radius:g}" fill="{color}"{op} />'
            )
    bg = f'  <rect width="512" height="512" fill="{BG_HEX}" />\n' if background else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"'
        ' role="img" aria-label="Vocab Trainer">\n'
        f"  <title>{title}</title>\n"
        f"{bg}" + "\n".join(cells) + "\n</svg>\n"
    )


# ---------------------------------------------------------------------------
OUTPUTS: list[tuple[Path, str, object]] = [
    (PUBLIC / "pwa-192.png", "png", (STANDARD, 192)),
    (PUBLIC / "pwa-512.png", "png", (STANDARD, 512)),
    (PUBLIC / "pwa-512-maskable.png", "png", (MASKABLE, 512)),
    (PUBLIC / "apple-touch-icon.png", "png", (STANDARD, 180)),
    (PUBLIC / "favicon-32.png", "png", (COMPACT, 32)),
    (PUBLIC / "favicon-16.png", "png", (COMPACT, 16)),
    (PUBLIC / "og.png", "og", None),
    (PUBLIC / "favicon.svg", "svg", (COMPACT, "Vocab Trainer (favicon)")),
    (BRAND_SRC / "logo.svg", "svg", (STANDARD, "Vocab Trainer")),
    (BRAND_SRC / "logo-maskable.svg", "svg", (MASKABLE, "Vocab Trainer (maskable)")),
    (BRAND_SRC / "logo-compact.svg", "svg", (COMPACT, "Vocab Trainer (compact)")),
]


def build(kind: str, arg) -> bytes:
    if kind == "png":
        layout, size = arg
        buf = io.BytesIO()
        render_icon(layout, size).save(buf, "PNG", optimize=True)
        return buf.getvalue()
    if kind == "og":
        buf = io.BytesIO()
        render_og().save(buf, "PNG", optimize=True)
        return buf.getvalue()
    layout, title = arg
    return render_svg(layout, title).encode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="書き出さず既存ファイルとの差分だけ報告する")
    args = ap.parse_args()

    BRAND_SRC.mkdir(parents=True, exist_ok=True)
    changed = []
    for path, kind, arg in OUTPUTS:
        data = build(kind, arg)
        current = path.read_bytes() if path.exists() else None
        if current == data:
            print(f"  same  {path.relative_to(ROOT)}")
            continue
        changed.append(path)
        if args.check:
            print(f"  DIFF  {path.relative_to(ROOT)}")
        else:
            path.write_bytes(data)
            print(f"  wrote {path.relative_to(ROOT)}  ({len(data):,} B)")

    if args.check and changed:
        print(f"\n{len(changed)} 件が生成結果と一致しません。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
