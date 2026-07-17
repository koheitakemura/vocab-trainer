import { useEffect, useRef, useState } from 'react'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel } from '../../srs/levels'
import { pickClozeExample } from '../../srs/cloze'
import { getRomaji } from '../../text/romaji'
import type { BoardTile } from './useStudyBoard'
import { TileMark } from './TileMark'
import { useStrings, type UiLanguage } from '../../text/i18n'

/**
 * スマホ片手フォーカスモード（ボトムシート採点）。
 * タッチ端末でタイルをタップすると開き、大きなカードと親指ゾーンの大きな3ボタンで採点する。
 * 「採点したら自動で次へ」は**しない**（Kohei の要望＝自動遷移なし）——Next ボタンで手動送り。
 * めくり前の I know = easy／めくり後 = good の意味論はグリッドのタイルと同一
 * （最初から訳を見せると easy が消え、端末によって採点分布が変わるのを防ぐ）。
 * 呼び出し側は key={card.id} を付けてカードごとに再マウントする（revealed が確実に表面へ戻る。
 * effect でのリセットは paint 後に走るため、次のカードの答えが1フレーム見えてしまう）。
 */
export function FocusSheet({
  tile,
  hasNext,
  onGrade,
  onNext,
  onClose,
  uiLanguage,
}: {
  tile: BoardTile
  hasNext: boolean
  onGrade: (g: ReviewGrade, rect: DOMRect) => void
  onNext: () => void
  onClose: () => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const [revealed, setRevealed] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  // ダイアログ契約：Esc で閉じる・背面のスクロールを止める・フォーカスをシートへ移す。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const c = tile.card
  const romaji = getRomaji(c.reading)
  // 枠線の色はセッション中に実採点したときだけ（グリッドのタイルと同じ規則）。
  const gradedThisSession = tile.state !== 'pending'
  const level = gradedThisSession && tile.grade ? gradeLevel(tile.grade) : null
  const example = c.examples[0]
  // 文脈クローズ提示（PLAN §4.2）。昇格対象でクローズ可能な例文があるときだけ。
  const cloze = tile.clozePromoted ? pickClozeExample(c.examples) : undefined

  const fire = (g: ReviewGrade) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  return (
    <>
      <div className="focus-backdrop" onClick={onClose} />
      <div className="focus-sheet" role="dialog" aria-modal="true" aria-label={c.headword} ref={sheetRef} tabIndex={-1}>
        <div
          className={`focus-card${level ? ` g-${level}` : ''}${cloze ? ' cloze' : ''}`}
          ref={cardRef}
          onClick={() => setRevealed(true)}
        >
          <TileMark grade={tile.grade} levelCounts={tile.levelCounts} uiLanguage={uiLanguage} />
          {cloze ? (
            // ── 文脈クローズ提示 ──
            revealed ? (
              <>
                <div className="focus-hw">{c.headword}</div>
                <div className="focus-reading">
                  {c.reading}
                  {romaji && <span className="focus-romaji"> · {romaji}</span>}
                </div>
                <div className="focus-gloss">{c.gloss}</div>
                <div className="focus-example">
                  <div>{cloze.example.text}</div>
                  <div className="focus-example-tr">{cloze.example.translation}</div>
                </div>
              </>
            ) : (
              <>
                <span className="focus-cloze-badge">{t.clozeBadge}</span>
                <div className="focus-cloze-gloss">{c.gloss}</div>
                <div className="focus-cloze-sentence">
                  {cloze.parts.before}
                  <span className="focus-cloze-blank" />
                  {cloze.parts.after}
                </div>
                <div className="focus-tap-hint">{t.tapToReveal}</div>
              </>
            )
          ) : (
            <>
              <div className="focus-hw">{c.headword}</div>
              {revealed ? (
                <>
                  <div className="focus-reading">
                    {c.reading}
                    {romaji && <span className="focus-romaji"> · {romaji}</span>}
                  </div>
                  <div className="focus-gloss">{c.gloss}</div>
                  {c.root && (
                    <div className="focus-root">
                      {t.rootLabel}: {c.root}
                    </div>
                  )}
                  {example && (
                    <div className="focus-example">
                      <div>{example.text}</div>
                      <div className="focus-example-tr">{example.translation}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="focus-tap-hint">{t.tapToReveal}</div>
              )}
            </>
          )}
        </div>
        <div className="focus-levels">
          <button type="button" className="focus-level lvl-good" onClick={() => fire(revealed ? 'good' : 'easy')}>
            {t.gradeKnown}
          </button>
          <button type="button" className="focus-level lvl-hard" onClick={() => fire('hard')}>
            {t.gradeFuzzy}
          </button>
          <button type="button" className="focus-level lvl-again" onClick={() => fire('again')}>
            {t.gradeStudying}
          </button>
        </div>
        <div className="focus-footer">
          {hasNext && (
            <button type="button" className="btn primary focus-next" onClick={onNext}>
              {t.nextCard}
            </button>
          )}
          <button type="button" className="btn ghost focus-close" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </>
  )
}
