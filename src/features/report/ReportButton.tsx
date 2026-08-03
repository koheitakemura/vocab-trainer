import { useState } from 'react'
import type { VocabCard, ReportReason } from '../../types'
import { ReportRejected, submitReport } from '../../store/reports'
import { useStrings, type UiLanguage } from '../../text/i18n'
import './report.css'

/**
 * カードの誤り報告ボタン＋インライン報告フォーム。
 * FocusSheet（裏面）・AllWords（展開行）の両方から同じ形で使う——モーダル/ポータルは使わず、
 * 呼び出し側の DOM にそのまま差し込める小さな disclosure にしてある（両者の重ね合わせ文脈が
 * 違う——片方は既にモーダル、片方は行内展開——ので、これ自身が新たに層を作らないようにするため）。
 * 親要素にクリックハンドラ（FocusSheet の裏返し・AllWords の行展開）があるため、
 * 内側のクリックは常に stopPropagation する。
 */

const REASONS: ReportReason[] = ['gloss', 'reading', 'pos', 'example', 'inappropriate', 'other']

type Status = 'idle' | 'busy' | 'done' | 'error'

export function ReportButton({
  card,
  uiLanguage,
  className,
}: {
  card: VocabCard
  uiLanguage: UiLanguage
  className?: string
}) {
  const t = useStrings(uiLanguage)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('gloss')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  const reasonLabel: Record<ReportReason, string> = {
    gloss: t.reportReasonGloss,
    reading: t.reportReasonReading,
    pos: t.reportReasonPos,
    example: t.reportReasonExample,
    inappropriate: t.reportReasonInappropriate,
    other: t.reportReasonOther,
  }

  const reset = () => {
    setOpen(false)
    setStatus('idle')
    setReason('gloss')
    setNote('')
    setMessage('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setStatus('busy')
    try {
      const result = await submitReport({
        courseId: card.courseId,
        cardId: card.id,
        // コースの正確な idEpoch はここまで届いていない（診断用の補助情報に過ぎず、
        // 未取得時のサーバー既定値と同じ 1 を送るのは無害——worker/reports.ts の既定と一致させる）。
        idEpoch: 1,
        headword: card.headword,
        reading: card.reading ?? '',
        gloss: card.gloss,
        pos: card.pos,
        examples: card.examples,
        reason,
        note,
      })
      setStatus('done')
      setMessage(result === 'sent' ? t.reportSent : t.reportQueued)
    } catch (err) {
      setStatus('error')
      setMessage(t.reportFailed(err instanceof ReportRejected ? err.message : String(err)))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`report-toggle${className ? ` ${className}` : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        ⚑ {t.reportButton}
      </button>
    )
  }

  return (
    <div className={`report-widget${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
      {status === 'done' || status === 'error' ? (
        <div className={`report-result${status === 'error' ? ' error' : ''}`}>
          <span>{message}</span>
          <button type="button" className="btn ghost report-btn" onClick={reset}>
            {t.close}
          </button>
        </div>
      ) : (
        <form className="report-form" onSubmit={(e) => void submit(e)}>
          <p className="report-title">{t.reportSheetTitle}</p>
          <div className="report-reasons">
            {REASONS.map((r) => (
              <label key={r} className="report-reason">
                <input
                  type="radio"
                  name={`report-reason-${card.id}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                />
                {reasonLabel[r]}
              </label>
            ))}
          </div>
          <textarea
            className="report-note"
            placeholder={t.reportNotePlaceholder}
            maxLength={200}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="report-actions">
            <button type="submit" className="btn primary report-btn" disabled={status === 'busy'}>
              {status === 'busy' ? t.reportSubmitting : t.reportSubmit}
            </button>
            <button type="button" className="btn ghost report-btn" disabled={status === 'busy'} onClick={reset}>
              {t.reportCancel}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
