import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  deleteCorrection,
  fetchReports,
  setCorrection,
  updateReportStatus,
  type CardReport,
  type CorrectionPayload,
  type ReportExample,
  type ReportStatus,
} from './adminApi'
import { AVAILABLE_COURSES } from '../../data/courseRegistry'

/**
 * カードの誤り報告一覧（管理画面「カードの誤り報告」タブ）。
 *
 * card_reports は「誰が・いつ・どのカードに何が違うと言ったか」の生ログ（1件=1報告、
 * 同じカードに複数件つく）。card_corrections は「今はこれが正しい」という確定値（cardId主キー・
 * 1件のみ）——別テーブルなので、ここでは同じ courseId+cardId の報告を画面上でグループ化して
 * 表示しつつ、各報告の状態（未対応/対応予定/修正済み/却下）は個別に更新できるようにする。
 *
 * 「是正を確定」は直近の報告のスナップショットをフォームへ複製し、管理者が確認・編集してから
 * 保存する（worker/reports.ts の CorrectionInput はフルセット上書きなので、ここも常に全欄を送る）。
 * 保存しても各報告の状態は自動では変わらない——是正の確定と報告の後処理は別の操作として扱う
 * （是正だけ先に決めて、報告への返信（状態更新）は後でまとめて、という運用を妨げないため）。
 */

function courseTitle(courseId: string): string {
  return AVAILABLE_COURSES.find((c) => c.id === courseId)?.title ?? courseId
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const REASON_LABEL: Record<string, string> = {
  gloss: '訳が違う',
  reading: '読み・発音が違う',
  pos: '品詞が違う',
  example: '例文がおかしい',
  inappropriate: 'コースに合わない語',
  other: 'その他',
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: '未対応',
  planned: '対応予定',
  fixed: '修正済み',
  rejected: '却下',
}

const STATUS_OPTIONS: ReportStatus[] = ['open', 'planned', 'fixed', 'rejected']

interface CardGroup {
  key: string
  courseId: string
  cardId: string
  latest: CardReport
  reports: CardReport[]
}

/** 同じ courseId+cardId の報告をまとめる。未対応件数の多い順→最新報告が新しい順 */
function groupReports(reports: CardReport[]): CardGroup[] {
  const map = new Map<string, CardGroup>()
  for (const r of reports) {
    const key = `${r.courseId}::${r.cardId}`
    const g = map.get(key)
    if (!g) {
      map.set(key, { key, courseId: r.courseId, cardId: r.cardId, latest: r, reports: [r] })
      continue
    }
    g.reports.push(r)
    if (r.at > g.latest.at) g.latest = r
  }
  return [...map.values()].sort((a, b) => {
    const openA = a.reports.filter((r) => r.status === 'open').length
    const openB = b.reports.filter((r) => r.status === 'open').length
    if (openA !== openB) return openB - openA
    return b.latest.at.localeCompare(a.latest.at)
  })
}

export function CardReports() {
  const [reports, setReports] = useState<CardReport[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [correctingKey, setCorrectingKey] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetchReports()
      setReports(res.reports)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const groups = useMemo(() => (reports ? groupReports(reports) : []), [reports])

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      try {
        const message = await fn()
        await reload()
        setNotice(message)
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  return (
    <section className="admin-card">
      <div className="admin-cardhead">
        <h2 className="admin-h2">
          カードの誤り報告 <span className="admin-count">{groups.length}</span>
        </h2>
        <button className="admin-btn ghost" onClick={() => void reload()} disabled={busy}>
          再読み込み
        </button>
      </div>
      <p className="admin-hint">
        利用者が報告したカードの誤りです。「是正を確定」すると、次回コースを開いたときから全利用者に反映されます（コース本体のファイルは書き換えません）。
      </p>
      {loadError && <p className="admin-banner error">{loadError}</p>}
      {actionError && <p className="admin-banner error">{actionError}</p>}
      {notice && <p className="admin-banner ok">{notice}</p>}

      {!reports ? (
        <p className="admin-hint">読み込み中…</p>
      ) : groups.length === 0 ? (
        <p className="admin-hint">まだ報告はありません。</p>
      ) : (
        <div className="admin-tablewrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>語</th>
                <th>報告</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isOpen = expanded.has(g.key)
                const isCorrecting = correctingKey === g.key
                const openCount = g.reports.filter((r) => r.status === 'open').length
                return (
                  <Fragment key={g.key}>
                    <tr>
                      <td>
                        <div className="admin-mono">{g.latest.headword}</div>
                        <div className="admin-note">{courseTitle(g.courseId)}</div>
                        {openCount > 0 && <span className="admin-tag warn">未対応 {openCount}</span>}
                      </td>
                      <td>
                        <button type="button" className="admin-btn ghost small" onClick={() => toggleExpand(g.key)}>
                          {g.reports.length}件 {isOpen ? '閉じる' : '見る'}
                        </button>
                      </td>
                      <td className="admin-actions">
                        <button
                          className="admin-btn small"
                          disabled={busy}
                          onClick={() => setCorrectingKey(isCorrecting ? null : g.key)}
                        >
                          {isCorrecting ? 'やめる' : '是正を確定'}
                        </button>
                      </td>
                    </tr>
                    {isCorrecting && (
                      <tr>
                        <td colSpan={3}>
                          <CorrectionForm
                            report={g.latest}
                            busy={busy}
                            onCancel={() => setCorrectingKey(null)}
                            onSubmit={(payload) =>
                              run(async () => {
                                const res = await setCorrection(payload)
                                setCorrectingKey(null)
                                return res.logged
                                  ? `${payload.headword} の是正を保存しました`
                                  : `${payload.headword} の是正を保存しました（⚠️ 操作ログには記録できませんでした）`
                              })
                            }
                            onDelete={() =>
                              run(async () => {
                                await deleteCorrection(g.cardId)
                                setCorrectingKey(null)
                                return `${g.latest.headword} の是正を解除しました（元のカードに戻ります）`
                              })
                            }
                          />
                        </td>
                      </tr>
                    )}
                    {isOpen && (
                      <tr>
                        <td colSpan={3}>
                          <ul className="admin-log">
                            {g.reports.map((r) => (
                              <ReportRow
                                key={r.id}
                                report={r}
                                busy={busy}
                                onSave={(status, adminNote) =>
                                  run(async () => {
                                    await updateReportStatus(r.id, status, adminNote)
                                    return '状態を更新しました'
                                  })
                                }
                              />
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ReportRow({
  report,
  busy,
  onSave,
}: {
  report: CardReport
  busy: boolean
  onSave: (status: ReportStatus, adminNote: string) => void
}) {
  const [status, setStatus] = useState<ReportStatus>(report.status)
  const [adminNote, setAdminNote] = useState(report.adminNote)
  const dirty = status !== report.status || adminNote !== report.adminNote

  return (
    <li className="report-log-row">
      <span className="admin-when">{fmtDateTime(report.at)}</span>
      <span className="admin-mono">{report.email}</span>
      <span>{REASON_LABEL[report.reason] ?? report.reason}</span>
      {report.note && <span className="admin-note">「{report.note}」</span>}
      <select
        className="admin-input"
        value={status}
        onChange={(e) => setStatus(e.target.value as ReportStatus)}
        disabled={busy}
        aria-label="状態"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <input
        className="admin-input"
        placeholder="管理者メモ（任意）"
        maxLength={200}
        value={adminNote}
        onChange={(e) => setAdminNote(e.target.value)}
        disabled={busy}
      />
      {dirty && (
        <button className="admin-btn small" disabled={busy} onClick={() => onSave(status, adminNote)}>
          保存
        </button>
      )}
    </li>
  )
}

function CorrectionForm({
  report,
  busy,
  onCancel,
  onSubmit,
  onDelete,
}: {
  report: CardReport
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: CorrectionPayload) => void
  onDelete: () => void
}) {
  const [headword, setHeadword] = useState(report.headword)
  const [reading, setReading] = useState(report.reading)
  const [gloss, setGloss] = useState(report.gloss)
  const [pos, setPos] = useState(report.pos)
  const [examples, setExamples] = useState<ReportExample[]>(
    report.examples.length > 0 ? report.examples : [{ text: '', translation: '' }],
  )

  const updateExample = (i: number, field: keyof ReportExample, value: string) => {
    setExamples((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)))
  }
  const addExample = () => setExamples((prev) => [...prev, { text: '', translation: '' }])
  const removeExample = (i: number) => setExamples((prev) => prev.filter((_, idx) => idx !== i))

  const submit = () => {
    const cleaned = examples.map((e) => ({ text: e.text.trim(), translation: e.translation.trim() })).filter((e) => e.text)
    onSubmit({
      courseId: report.courseId,
      cardId: report.cardId,
      headword: headword.trim(),
      reading: reading.trim(),
      gloss: gloss.trim(),
      pos: pos.trim(),
      examples: cleaned,
    })
  }

  return (
    <div className="admin-form correction-form">
      <p className="admin-hint">報告時点の内容を複製しています。正しい内容に直してから保存してください。</p>
      <input className="admin-input" placeholder="見出し語" value={headword} onChange={(e) => setHeadword(e.target.value)} disabled={busy} />
      <input className="admin-input" placeholder="読み（任意）" value={reading} onChange={(e) => setReading(e.target.value)} disabled={busy} />
      <input className="admin-input" placeholder="訳" value={gloss} onChange={(e) => setGloss(e.target.value)} disabled={busy} />
      <input className="admin-input" placeholder="品詞（任意）" value={pos} onChange={(e) => setPos(e.target.value)} disabled={busy} />
      <div className="correction-examples">
        {examples.map((ex, i) => (
          <div key={i} className="correction-example-row">
            <input
              className="admin-input"
              placeholder="例文"
              value={ex.text}
              onChange={(e) => updateExample(i, 'text', e.target.value)}
              disabled={busy}
            />
            <input
              className="admin-input"
              placeholder="例文の訳"
              value={ex.translation}
              onChange={(e) => updateExample(i, 'translation', e.target.value)}
              disabled={busy}
            />
            <button type="button" className="admin-btn ghost small" disabled={busy} onClick={() => removeExample(i)}>
              削除
            </button>
          </div>
        ))}
        <button type="button" className="admin-btn ghost small" disabled={busy} onClick={addExample}>
          + 例文を追加
        </button>
      </div>
      <div className="admin-confirm">
        <button className="admin-btn primary" disabled={busy || !headword.trim() || !gloss.trim()} onClick={submit}>
          保存
        </button>
        <button className="admin-btn ghost" disabled={busy} onClick={onDelete}>
          是正を解除
        </button>
        <button className="admin-btn ghost" disabled={busy} onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  )
}
