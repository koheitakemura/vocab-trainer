import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CourseType, Example, VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel } from '../../srs/levels'
import { pickClozeExample } from '../../srs/cloze'
import { useStudyBoard, type BoardTile, type GradeOutcome } from './useStudyBoard'
import { useFitText } from './useFitText'
import { headwordFitClass } from './headwordFit'
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
            courseType={courseType}
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
  courseType,
  onGrade,
  onOpenSheet,
  uiLanguage,
}: {
  tile: BoardTile
  courseType: CourseType
  onGrade: (g: ReviewGrade, rect: DOMRect) => void
  /** タッチのタップで呼ぶ（片手フォーカスモードを開く）。マウスクリックはその場でピン留めめくり。 */
  onOpenSheet?: () => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const c: VocabCard = tile.card
  const romaji = getRomaji(c.reading)
  // フレーズコース（tl-phrases-daily）は見出し語が単語よりずっと長く、字数決め打ちの
  // headwordFitClass では収まらない（実測で判明・判断ログ#36）。実測フィット（useFitText）
  // に切り替える。単語コースの既存パスはここで分岐するだけで一切変更しない。
  const isPhrase = courseType === 'phrase'
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
    (unified ? ' unified' : '') +
    (isPhrase ? ' phrase' : '')

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
              <div className={`tile-hw sm${headwordFitClass(c.headword)}`}>{c.headword}</div>
              <span className="tile-reading">
                {c.reading}
                {c.ipa && <span className="tile-ipa"> {c.ipa}</span>}
                {romaji && <span className="tile-romaji"> · {romaji}</span>}
              </span>
              <TileBack fitKey={`${cloze.example.text}\u0000${example?.translation ?? ''}`}>
                <div className="tile-cloze-sentence revealed">{cloze.example.text}</div>
                <TileExample example={example} showSource={false} />
              </TileBack>
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
            {isPhrase ? (
              <FitHeadword text={c.headword} steps={HW_STEPS_BACK} maxHeight={56} small />
            ) : (
              <div className={`tile-hw sm${headwordFitClass(c.headword)}`}>{c.headword}</div>
            )}
            <span className="tile-reading">
              {c.reading}
              {c.ipa && <span className="tile-ipa"> {c.ipa}</span>}
              {romaji && <span className="tile-romaji"> · {romaji}</span>}
            </span>
            <TileBack
              fitKey={`${c.gloss}\u0000${c.root ?? ''}\u0000${showSource ? (example?.text ?? '') : ''}\u0000${example?.translation ?? ''}`}
            >
              <div className="tile-gloss">{c.gloss}</div>
              {c.root && (
                <div className="tile-root">
                  {t.rootLabel}: {c.root}
                </div>
              )}
              <TileExample example={example} showSource={showSource} />
            </TileBack>
          </>
        ) : isPhrase ? (
          <FitHeadword text={c.headword} steps={HW_STEPS_FACE} maxHeight={130} />
        ) : (
          <div className={`tile-hw${headwordFitClass(c.headword)}`}>{c.headword}</div>
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
            {/* ラベルは通常版と短縮版の両方を描いて CSS（.tile-level-full / -short）で
                出し分ける。スマホ2列ではボタン幅が 46px しかなく通常ラベルが省略記号で
                潰れるため。読み上げには aria-label の通常ラベルだけが渡るようにする。 */}
            <button
              type="button"
              className="tile-level lvl-good"
              aria-label={t.gradeKnown}
              onClick={() => fire(flipped ? 'good' : 'easy')}
            >
              <span className="tile-level-full">{t.gradeKnown}</span>
              <span className="tile-level-short">{t.gradeKnownShort}</span>
            </button>
            <button type="button" className="tile-level lvl-hard" aria-label={t.gradeFuzzy} onClick={() => fire('hard')}>
              <span className="tile-level-full">{t.gradeFuzzy}</span>
              <span className="tile-level-short">{t.gradeFuzzyShort}</span>
            </button>
            <button type="button" className="tile-level lvl-again" aria-label={t.gradeStudying} onClick={() => fire('again')}>
              <span className="tile-level-full">{t.gradeStudying}</span>
              <span className="tile-level-short">{t.gradeStudyingShort}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * めくった面の下半分（訳語・語根・例文、cloze なら本文＋訳文）に使うフォントサイズの段階。
 * 中身は 1em 基準の em で組んであるので、この 1 値でブロック全体が相似に縮む。
 * 下限 9px は「訳文（0.81em）が 7.3px まで落ちる」ところ＝実用的に読める最小として置いた。
 */
const BACK_STEPS = [13, 12.25, 11.5, 10.75, 10, 9.5, 9]

/**
 * めくった面の下半分をカードの残り高さに「ブロックごと」収める枠。
 *
 * 以前は要素ごとに行数で切り捨てていた（訳語 2行・例文本文 2行・**訳文 1行**）が、
 * 訳文 1行は日本語コースでは足りない：例文訳（タガログ語）が 1 行に収まらない語は
 * 実測で ja-0-3k 57%／ja-3-10k 62%／ja-10-30k 68%／ja-kanji-advanced 65%（PC 4列・
 * 内寸212px）。つまり大半のカードで訳文が途中で切れていた。
 *
 * そこで行数での切り捨てをやめ、収まらないときはブロック全体のフォントを段階的に
 * 縮めて**全文を出す**ことを優先する（Kohei 要望 2026-08-02）。カードの高さは
 * 従来どおり固定（158px）なので盤面は 1px も動かない。
 *
 * 最小段階でもなお溢れる極端に長い1件（全コースで 1% 未満）だけ、切り口が文の途中で
 * スパッと切れて壊れて見えないよう下端をフェードさせる（.tile-back.clipped）。
 */
function TileBack({ fitKey, children }: { fitKey: string; children: ReactNode }) {
  const { boxRef, fontSize, overflowing } = useFitText(fitKey, BACK_STEPS)
  return (
    <div ref={boxRef} className={`tile-back${overflowing ? ' clipped' : ''}`} style={{ fontSize }}>
      {children}
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

/**
 * フレーズコース（tl-phrases-daily）専用の見出し語表示。単語コースの headwordFitClass
 * は「1行の幅」だけを想定した字数の決め打ちで、複数行に渡るフレーズには対応できない
 * （実測で長い見出し語が21pxのままタイルからはみ出すことを確認・判断ログ#36）。
 * useFitText で maxHeight に収まるまでフォントを段階的に縮める。
 */
const HW_STEPS_FACE = [21, 18, 16, 14, 12.5, 11, 10]
const HW_STEPS_BACK = [17, 15, 13, 11.5, 10, 9]

function FitHeadword({
  text,
  steps,
  maxHeight,
  small,
}: {
  text: string
  steps: number[]
  maxHeight: number
  small?: boolean
}) {
  const { boxRef, fontSize, overflowing } = useFitText(text, steps)
  return (
    <div ref={boxRef} className={`tile-hw-fit-box${overflowing ? ' clipped' : ''}`} style={{ maxHeight }}>
      <div className={`tile-hw${small ? ' sm' : ''}`} style={{ fontSize }}>
        {text}
      </div>
    </div>
  )
}
