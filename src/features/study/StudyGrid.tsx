import { useRef, useState } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel, LEVEL_LABEL } from '../../srs/levels'
import { useStudyBoard, type BoardTile } from './useStudyBoard'
import { useFitText } from './useFitText'
import { getRomaji } from '../../text/romaji'
import { FocusSheet } from './FocusSheet'
import { WeeklyCard } from '../WeeklyCard'

export function StudyGrid({
  cards,
  onWordStarted,
  onReviewed,
  onProgressReset,
  onBackup,
}: {
  cards: VocabCard[]
  /** スパークル演出の発火（初採点・昇格・卒業）。カードの座標と金色フラグを渡すだけで、ヘッダーの存在は知らない。 */
  onWordStarted?: (rect: DOMRect, gold?: boolean) => void
  /** 採点1回ごとの推定語彙数（retrievability）増分。ヘッダーのメーターが O(1) で追従するため */
  onReviewed?: (deltaR: number) => void
  /** デモリセット完了の通知（ヘッダー側の推定語彙数を再計算させる） */
  onProgressReset?: () => void
  /** 週次ふりかえりカードのバックアップボタン */
  onBackup?: () => void
}) {
  const b = useStudyBoard(cards)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const courseId = cards[0]?.courseId

  const handleGrade = async (id: string, g: ReviewGrade, rect: DOMRect) => {
    const res = await b.grade(id, g)
    if (res.sparkle) onWordStarted?.(rect, res.gold)
    onReviewed?.(res.deltaR)
  }

  if (b.loading) return <div className="hint">Preparing your session…</div>
  if (b.empty)
    return (
      <div className="done">
        <div className="done-emoji">✓</div>
        <h2>All caught up</h2>
        <p>Nothing is due right now.</p>
        <button
          className="btn ghost"
          onClick={async () => {
            await b.reset()
            onProgressReset?.()
          }}
        >
          Reset progress (demo)
        </button>
      </div>
    )
  if (b.finished)
    return (
      <div className="done">
        <div className="done-emoji">🎉</div>
        <h2>Session complete</h2>
        <p>
          {b.reviewed} reviews{b.again > 0 ? ` · ${b.again} marked “Studying”` : ''}
        </p>
        {courseId && <WeeklyCard courseId={courseId} onBackup={onBackup} />}
        <button className="btn primary" onClick={b.restart}>
          Start another session
        </button>
      </div>
    )

  const sheetTile = sheetId ? (b.tiles.find((t) => t.card.id === sheetId) ?? null) : null
  // 次のカード＝キュー内の「現在位置の次」（現在が採点済みでキューに無ければ先頭）。
  // queue.find(x => x !== sheetId) だと常にキュー先頭に戻り、未採点のまま送ると
  // 先頭2枚を往復して3枚目に到達できない。末尾からは先頭へ循環する。
  const nextId = (() => {
    if (!sheetId || b.queue.length === 0) return null
    const i = b.queue.indexOf(sheetId)
    if (i === -1) return b.queue[0] ?? null
    const candidate = b.queue[(i + 1) % b.queue.length]
    return candidate !== sheetId ? candidate : null
  })()

  const refreshButton = (
    <button type="button" className="btn ghost board-refresh" onClick={b.restart}>
      ↻ Start another session
    </button>
  )

  return (
    <>
      {/* いつでも別のカードに入れ替えられる常設ボタン（採点し終える前でも押せる）。
          スクロールせず届くよう盤面の上にも置く（下にも同じものを残す）。 */}
      <div className="board-actions top">{refreshButton}</div>
      <div className="board">
        {b.tiles.map((t) => (
          <Tile
            key={t.card.id}
            tile={t}
            onGrade={(g, rect) => void handleGrade(t.card.id, g, rect)}
            onOpenSheet={() => setSheetId(t.card.id)}
          />
        ))}
      </div>
      <div className="board-actions">{refreshButton}</div>
      {sheetTile && (
        <FocusSheet
          key={sheetTile.card.id}
          tile={sheetTile}
          hasNext={nextId !== null}
          onGrade={(g, rect) => void handleGrade(sheetTile.card.id, g, rect)}
          onNext={() => nextId && setSheetId(nextId)}
          onClose={() => setSheetId(null)}
        />
      )}
    </>
  )
}

function Tile({
  tile,
  onGrade,
  onOpenSheet,
}: {
  tile: BoardTile
  onGrade: (g: ReviewGrade, rect: DOMRect) => void
  /** タッチのタップで呼ぶ（片手フォーカスモードを開く）。マウスクリックはその場でピン留めめくり。 */
  onOpenSheet?: () => void
}) {
  const c: VocabCard = tile.card
  const romaji = getRomaji(c.reading)
  // どのカードも採点後もボタンを残し、いつでも採点しなおせる（3ボタン共通の挙動）。
  // 意味（訳語）は常時表示せず、本体にホバー/タップしてめくったときだけ見せる。
  // ホバーめくりは「マウスのポインターイベント」だけに反応させる：タッチはタップ時に
  // mouseenter をエミュレートするくせに mouseleave を出さないため、デバイス単位の判定では
  // ハイブリッド端末（タッチ付きラップトップ等）で「めくれたまま戻せない」が残る。
  // pointerType でイベント単位に見分ければ全端末で正しい。タッチのタップはフォーカスモードへ。
  const [flippedByHover, setFlippedByHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const flipped = pinned || flippedByHover
  const rootRef = useRef<HTMLDivElement>(null)
  const lastPointerType = useRef<string>('mouse')

  const fire = (g: ReviewGrade) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  // 直近に押したボタンの評価から表示レベル（色・枠線）を決める。未採点は null（枠は既定色）。
  const level = tile.grade ? gradeLevel(tile.grade) : null
  // 右上マークは未採点なら "New"（グレー）、採点済みならその評価の色・ラベル。
  const markKind = level ?? 'new'
  const markLabel = level ? LEVEL_LABEL[level] : 'New'
  const cls = `tile s-${tile.state}${flipped ? ' revealed' : ''}${level ? ` g-${level}` : ''}`

  return (
    <div className={cls} ref={rootRef} onMouseLeave={() => setFlippedByHover(false)}>
      <span className={`tile-mark tile-mark--${markKind}`}>
        <span className="tile-mark-label">{markLabel}</span>
        <span className="tile-mark-dot" />
      </span>
      <div
        className="tile-content"
        onPointerDown={(e) => {
          lastPointerType.current = e.pointerType
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setFlippedByHover(true)
        }}
        onClick={() => {
          if (lastPointerType.current === 'touch' && onOpenSheet) onOpenSheet()
          else setPinned((p) => !p)
        }}
        role="button"
        aria-label={c.headword}
      >
        {flipped ? (
          <>
            <div className="tile-hw sm">{c.headword}</div>
            <span className="tile-reading">
              {c.reading}
              {romaji && <span className="tile-romaji"> · {romaji}</span>}
            </span>
            <FitGloss text={c.gloss} />
          </>
        ) : (
          <div className="tile-hw">{c.headword}</div>
        )}
      </div>
      <div className="tile-btn-zone">
        <div className="tile-levels">
          <button type="button" className="tile-level lvl-good" onClick={() => fire(flipped ? 'good' : 'easy')}>
            I know
          </button>
          <button type="button" className="tile-level lvl-hard" onClick={() => fire('hard')}>
            Fuzzy
          </button>
          <button type="button" className="tile-level lvl-again" onClick={() => fire('again')}>
            Studying
          </button>
        </div>
      </div>
    </div>
  )
}

/** 訳語（可変長）を固定の高さ枠に収める。長い訳語は自動でフォントを縮める。 */
function FitGloss({ text, className }: { text: string; className?: string }) {
  const { boxRef, fontSize } = useFitText(text)
  return (
    <div ref={boxRef} className="tile-gloss-box">
      <div className={`tile-gloss${className ? ` ${className}` : ''}`} style={{ fontSize }}>
        {text}
      </div>
    </div>
  )
}
