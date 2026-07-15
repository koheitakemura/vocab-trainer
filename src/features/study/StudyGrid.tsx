import { useEffect, useRef, useState } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel } from '../../srs/levels'
import { useStudyBoard, type BoardTile, type GradeOutcome } from './useStudyBoard'
import { useFitText } from './useFitText'
import { getRomaji } from '../../text/romaji'
import { FocusSheet } from './FocusSheet'
import { TileMark } from './TileMark'
import { WeeklyCard } from '../WeeklyCard'
import { useStrings, type UiLanguage } from '../../text/i18n'

export function StudyGrid({
  cards,
  onWordStarted,
  onReviewed,
  onProgressReset,
  onBackup,
  onExposeRestart,
  uiLanguage,
}: {
  cards: VocabCard[]
  /** スパークル演出の発火（初採点・昇格・卒業）。カードの座標と金色フラグを渡すだけで、ヘッダーの存在は知らない。 */
  onWordStarted?: (rect: DOMRect, gold?: boolean) => void
  /** 採点1回ごとの結果。ヘッダーのメーター・コーチ文の解禁判定が O(1) で追従するため */
  onReviewed?: (res: GradeOutcome) => void
  /** デモリセット完了の通知（ヘッダー側の推定語彙数を再計算させる） */
  onProgressReset?: () => void
  /** 週次ふりかえりカードのバックアップボタン */
  onBackup?: () => void
  /** restart（Start another session）をタブ行のボタンから呼べるよう親へ渡す。アンマウントで null。 */
  onExposeRestart?: (fn: (() => void) | null) => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const b = useStudyBoard(cards)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const courseId = cards[0]?.courseId

  // タブ行の「Start another session」から restart を呼べるように登録する。
  useEffect(() => {
    onExposeRestart?.(b.restart)
    return () => onExposeRestart?.(null)
  }, [b.restart, onExposeRestart])

  const handleGrade = async (id: string, g: ReviewGrade, rect: DOMRect) => {
    const res = await b.grade(id, g)
    if (res.sparkle) onWordStarted?.(rect, res.gold)
    onReviewed?.(res)
  }

  if (b.loading) return <div className="hint">{t.preparingSession}</div>
  if (b.empty)
    return (
      <div className="done">
        <div className="done-emoji">✓</div>
        <h2>{t.allCaughtUp}</h2>
        <p>{t.nothingDue}</p>
        <button
          className="btn ghost"
          onClick={async () => {
            await b.reset()
            onProgressReset?.()
          }}
        >
          {t.resetProgressDemo}
        </button>
      </div>
    )
  if (b.finished)
    return (
      <div className="done">
        <div className="done-emoji">🎉</div>
        <h2>{t.sessionComplete}</h2>
        <p>{t.sessionSummary(b.reviewed, b.again)}</p>
        {courseId && <WeeklyCard courseId={courseId} onBackup={onBackup} uiLanguage={uiLanguage} />}
        <button className="btn primary" onClick={b.restart}>
          {t.startAnotherSession}
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
      ↻ {t.startAnotherSession}
    </button>
  )

  return (
    <>
      <div className="board">
        {b.tiles.map((tile) => (
          <Tile
            key={tile.card.id}
            tile={tile}
            onGrade={(g, rect) => void handleGrade(tile.card.id, g, rect)}
            onOpenSheet={() => setSheetId(tile.card.id)}
            uiLanguage={uiLanguage}
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
          uiLanguage={uiLanguage}
        />
      )}
    </>
  )
}

function Tile({
  tile,
  onGrade,
  onOpenSheet,
  uiLanguage,
}: {
  tile: BoardTile
  onGrade: (g: ReviewGrade, rect: DOMRect) => void
  /** タッチのタップで呼ぶ（片手フォーカスモードを開く）。マウスクリックはその場でピン留めめくり。 */
  onOpenSheet?: () => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
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

  // 枠線の色は「このセッションで実際に採点した」ときだけ付ける（state !== 'pending'）。
  // pending（前回までの評価が残っているだけで今回はまだ触っていないカード）は他の未採点カードと
  // 同じ既定色にする（前回の色が残っていると「もう採点済み」に見えて紛らわしい・Kohei 指定）。
  const gradedThisSession = tile.state !== 'pending'
  const level = gradedThisSession && tile.grade ? gradeLevel(tile.grade) : null
  const cls = `tile s-${tile.state}${flipped ? ' revealed' : ''}${level ? ` g-${level}` : ''}`

  return (
    <div className={cls} ref={rootRef} onMouseLeave={() => setFlippedByHover(false)}>
      <TileMark grade={tile.grade} levelCounts={tile.levelCounts} uiLanguage={uiLanguage} />
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
            {t.gradeKnown}
          </button>
          <button type="button" className="tile-level lvl-hard" onClick={() => fire('hard')}>
            {t.gradeFuzzy}
          </button>
          <button type="button" className="tile-level lvl-again" onClick={() => fire('again')}>
            {t.gradeStudying}
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
