import { useEffect, useRef, useState } from 'react'
import type { CourseType, Example, VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel } from '../../srs/levels'
import { pickClozeExample } from '../../srs/cloze'
import { useStudyBoard, type BoardTile, type GradeOutcome } from './useStudyBoard'
import { useFitText } from './useFitText'
import { getRomaji } from '../../text/romaji'
import { playTapSound } from '../../audio/tapSound'
import { FocusSheet } from './FocusSheet'
import { TileMark } from './TileMark'
import { WeeklyCard } from '../WeeklyCard'
import { useStrings, type UiLanguage } from '../../text/i18n'

export function StudyGrid({
  cards,
  courseType,
  onWordStarted,
  onReviewed,
  onProgressReset,
  onBackup,
  onExposeRestart,
  uiLanguage,
}: {
  cards: VocabCard[]
  /** コース種別。cloze/較正コースでは安定した既習語が文脈クローズ提示へ昇格する（PLAN §4.2）。 */
  courseType: CourseType
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
  const b = useStudyBoard(cards, courseType)
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
            // 取り返しのつかない全消去なので必ず確認を挟む。このボタンは毎日必ず通る
            // 「すべて完了」画面に常設されており、確認が無いと誤タップ1回で全消えする。
            // サーバー同期を足すと、その誤操作が控えの側にも伝播して復旧不能になる。
            if (!window.confirm(t.resetProgressConfirm)) return
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

  // カーソルが採点ボタンの帯（カード下端）に入っているか。読んでいる間はボタンを出さず、
  // 採点しようと下へ動かした瞬間だけ出す（下の unified の説明を参照）。
  const [overButtons, setOverButtons] = useState(false)

  const fire = (g: ReviewGrade) => {
    playTapSound()
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  // 文脈クローズ提示（PLAN §4.2）：安定した既習語のみ、フラッシュカードでなく「意味＋空欄文」から
  // 語を産出させる。昇格対象でもクローズ可能な例文が無ければ undefined＝通常のフラッシュカードに戻す。
  const cloze = tile.clozePromoted ? pickClozeExample(c.examples) : undefined

  // めくった面に出す例文。FocusSheet と同じく examples[0] 固定。
  // cloze 昇格カードのめくり後は本文が既に .tile-cloze-sentence.revealed に出ているため、
  // 例文欄では訳文だけ出す（同じ文を二重に見せない）。
  const example: Example | undefined = cloze ? cloze.example : c.examples[0]
  const showSource = !cloze

  // 枠線の色は「このセッションで実際に採点した」ときだけ付ける（state !== 'pending'）。
  // pending（前回までの評価が残っているだけで今回はまだ触っていないカード）は他の未採点カードと
  // 同じ既定色にする（前回の色が残っていると「もう採点済み」に見えて紛らわしい・Kohei 指定）。
  const gradedThisSession = tile.state !== 'pending'
  const level = gradedThisSession && tile.grade ? gradeLevel(tile.grade) : null
  /**
   * めくったら採点ボタンの区画を廃止し、カード全体を「単語・読み・訳・例文」の
   * ひと続きの1区画にする（内側が 108px→155px に広がり、例文に実寸を与えられる）。
   * 採点ボタンはカード下端に近づけたときだけ絶対配置で例文の上に重ねる——区画を出し入れ
   * すると中身がガタつくため、重ねる方式にした（盤面も中身も1pxも動かない）。
   * 例文が無いカード（ja-3-10k で約2割）は明け渡す中身が無いので従来どおりボタンのまま。
   */
  const unified = flipped && Boolean(example)
  const cls =
    `tile s-${tile.state}${flipped ? ' revealed' : ''}${level ? ` g-${level}` : ''}${cloze ? ' cloze' : ''}` +
    (unified ? ' unified' : '')

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
        {cloze ? (
          // ── 文脈クローズ提示 ──
          flipped ? (
            <>
              <div className="tile-hw sm">{c.headword}</div>
              <span className="tile-reading">
                {c.reading}
                {romaji && <span className="tile-romaji"> · {romaji}</span>}
              </span>
              <div className="tile-cloze-sentence revealed">{cloze.example.text}</div>
              <TileExample example={example} showSource={false} />
            </>
          ) : (
            <>
              <span className="tile-cloze-badge">{t.clozeBadge}</span>
              <FitGloss text={c.gloss} className="hint" />
              <div className="tile-cloze-sentence">
                {cloze.parts.before}
                <span className="tile-cloze-blank" />
                {cloze.parts.after}
              </div>
            </>
          )
        ) : flipped ? (
          <>
            <div className="tile-hw sm">{c.headword}</div>
            <span className="tile-reading">
              {c.reading}
              {romaji && <span className="tile-romaji"> · {romaji}</span>}
            </span>
            <FitGloss text={c.gloss} />
            {c.root && (
              <div className="tile-root">
                {t.rootLabel}: {c.root}
              </div>
            )}
            <TileExample example={example} showSource={showSource} />
          </>
        ) : (
          <div className="tile-hw">{c.headword}</div>
        )}
      </div>
      <div
        className={unified ? `tile-grade-dock${overButtons ? ' open' : ''}` : 'tile-btn-zone'}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setOverButtons(true)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setOverButtons(false)
        }}
      >
        {/* 1区画のとき、この帯はふだん空＝透明な当たり判定だけ。カーソルが下端に来たら
            ボタンを例文の上に重ねる。1区画でないカード（例文なし・めくる前）は従来どおり常設。 */}
        {(!unified || overButtons) && (
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
        )}
      </div>
    </div>
  )
}

/**
 * めくった面の最後に置く例文（本文＋訳文）。1区画レイアウトの一部なので、
 * 例文が無いカードでは何も描かない（枠を予約しない＝1区画が自然に詰まるだけ）。
 * cloze 昇格カードは本文が既に上に出ているので showSource=false で訳文だけ出す。
 */
function TileExample({ example, showSource }: { example: Example | undefined; showSource: boolean }) {
  if (!example) return null
  return (
    <div className="tile-example">
      {showSource && <div className="tile-example-src">{example.text}</div>}
      {example.translation && <div className="tile-example-tr">{example.translation}</div>}
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
