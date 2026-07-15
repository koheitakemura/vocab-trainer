import { useEffect, useRef, useState } from 'react'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel } from '../../srs/levels'
import { getRomaji } from '../../text/romaji'
import type { BoardTile } from './useStudyBoard'
import { TileMark } from './TileMark'

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
}: {
  tile: BoardTile
  hasNext: boolean
  onGrade: (g: ReviewGrade, rect: DOMRect) => void
  onNext: () => void
  onClose: () => void
}) {
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

  const fire = (g: ReviewGrade) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  return (
    <>
      <div className="focus-backdrop" onClick={onClose} />
      <div className="focus-sheet" role="dialog" aria-modal="true" aria-label={c.headword} ref={sheetRef} tabIndex={-1}>
        <div className={`focus-card${level ? ` g-${level}` : ''}`} ref={cardRef} onClick={() => setRevealed(true)}>
          <TileMark grade={tile.grade} levelCounts={tile.levelCounts} />
          <div className="focus-hw">{c.headword}</div>
          {revealed ? (
            <>
              <div className="focus-reading">
                {c.reading}
                {romaji && <span className="focus-romaji"> · {romaji}</span>}
              </div>
              <div className="focus-gloss">{c.gloss}</div>
              {example && (
                <div className="focus-example">
                  <div>{example.text}</div>
                  <div className="focus-example-tr">{example.translation}</div>
                </div>
              )}
            </>
          ) : (
            <div className="focus-tap-hint">Tap to reveal</div>
          )}
        </div>
        <div className="focus-levels">
          <button type="button" className="focus-level lvl-good" onClick={() => fire(revealed ? 'good' : 'easy')}>
            I know
          </button>
          <button type="button" className="focus-level lvl-hard" onClick={() => fire('hard')}>
            Fuzzy
          </button>
          <button type="button" className="focus-level lvl-again" onClick={() => fire('again')}>
            Studying
          </button>
        </div>
        <div className="focus-footer">
          {hasNext && (
            <button type="button" className="btn primary focus-next" onClick={onNext}>
              Next card →
            </button>
          )}
          <button type="button" className="btn ghost focus-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  )
}
