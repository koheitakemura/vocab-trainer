/**
 * Vocab Trainer のロゴ "Coverage Grid"。
 *
 * マス目 1 つが 1 語。左下から順に埋まり、白い 1 マスが「いま出題中の語」を表す。
 * 語彙のカバレッジ可視化＝このアプリの中核を、そのまま紋章にしている。
 *
 * ⚠️ 座標は scripts/gen_brand_assets.py の STANDARD / COMPACT と同じ値。
 *    形を変えるときは両方を直して `python scripts/gen_brand_assets.py` を回すこと
 *    （アイコン PNG・favicon・OGP はそのスクリプトが唯一の出所）。
 *
 * 色はテーマトークンを参照するので、ライト/ダークどちらでも地に馴染む。
 * PNG アイコンだけは濃紺の地を焼き込んである（OS 側で背景が選べないため）。
 */

/** 0=未学習 1=学習中 2=習得済み 9=いま出題中 */
type Cell = 0 | 1 | 2 | 9

type Layout = { grid: Cell[][]; origin: number; cell: number; gap: number; radius: number }

const STANDARD: Layout = {
  grid: [
    [1, 0, 0, 0],
    [2, 1, 0, 0],
    [2, 2, 9, 0],
    [2, 2, 2, 1],
  ],
  origin: 96,
  cell: 62,
  gap: 24,
  radius: 16,
}

const COMPACT: Layout = {
  grid: [
    [1, 0, 0],
    [2, 9, 0],
    [2, 2, 2],
  ],
  origin: 78,
  cell: 96,
  gap: 34,
  radius: 22,
}

/**
 * 未学習は --border（テーマごとの「まだ何もない面」の色）を借りる。
 * いま出題中だけは専用トークン（--logo-active）。ライトで --text をそのまま使うと
 * ほぼ黒になり、青いマスの中で「穴」に見えてしまうため。
 */
const FILL: Record<Cell, { fill: string; opacity?: number }> = {
  0: { fill: 'var(--border)' },
  1: { fill: 'var(--accent)', opacity: 0.45 },
  2: { fill: 'var(--accent)' },
  9: { fill: 'var(--logo-active)' },
}

type MarkProps = {
  size?: number
  /** 16〜32px で使うときは 3×3 に間引いた compact を選ぶ（4×4 は小さいと模様になる） */
  variant?: 'standard' | 'compact'
  className?: string
}

export function VocabMark({ size = 40, variant = 'standard', className }: MarkProps) {
  const l = variant === 'compact' ? COMPACT : STANDARD
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Vocab Trainer"
    >
      {l.grid.map((row, r) =>
        row.map((state, c) => {
          const { fill, opacity } = FILL[state]
          return (
            <rect
              key={`${r}-${c}`}
              x={l.origin + c * (l.cell + l.gap)}
              y={l.origin + r * (l.cell + l.gap)}
              width={l.cell}
              height={l.cell}
              rx={l.radius}
              fill={fill}
              fillOpacity={opacity}
            />
          )
        }),
      )}
    </svg>
  )
}

/**
 * 起動中／起動失敗の画面に出すブロック。App と #brand プレビューの両方がこれを使う
 * （プレビューだけ別マークアップにすると、片方だけ直して気づかない事故が起きる）。
 */
export function BootBrand({ status }: { status?: string }) {
  return (
    <div className="boot-brand">
      <VocabLockup direction="column" size={52} />
      {status && <span className="boot-status">{status}</span>}
    </div>
  )
}

/** マーク＋ワードマーク。縦組み（起動画面）と横組み（管理者画面）を切り替える。 */
export function VocabLockup({
  size = 44,
  direction = 'row',
}: {
  size?: number
  direction?: 'row' | 'column'
}) {
  return (
    <span className={`vt-lockup vt-lockup--${direction}`}>
      <VocabMark size={size} />
      <span className="vt-wordmark">
        <b>Vocab</b> Trainer
      </span>
    </span>
  )
}
