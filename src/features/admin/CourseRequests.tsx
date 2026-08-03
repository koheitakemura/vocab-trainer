import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchCourseRequests, resolveCourseRequest, type CourseRequest } from './adminApi'
import { AVAILABLE_COURSES } from '../../data/courseRegistry'

/**
 * 未割当コースのプレビュー画面から送られた「利用したい」リクエストの一覧（管理画面）。
 * CardReports.tsx と同じ reload/run/busy の型を踏襲（WordRequests.tsx の昇格/削除型ではなく、
 * pending→承認/却下という状態遷移に近いこちら）。承認すると worker 側でその人の
 * allowedCourses に courseId が追加される（次回同期で端末に反映される）。
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

const STATUS_LABEL: Record<CourseRequest['status'], string> = {
  pending: '未対応',
  approved: '承認済み',
  dismissed: '却下',
}

export function CourseRequests() {
  const [requests, setRequests] = useState<CourseRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await fetchCourseRequests()
      setRequests(res.requests)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

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

  const pendingCount = requests?.filter((r) => r.status === 'pending').length ?? 0

  return (
    <section className="admin-card">
      <div className="admin-cardhead">
        <h2 className="admin-h2">
          コース利用リクエスト <span className="admin-count">{pendingCount}</span>
        </h2>
        <button className="admin-btn ghost" onClick={() => void reload()} disabled={busy}>
          再読み込み
        </button>
      </div>
      <p className="admin-hint">
        未割当コースのプレビュー画面から送られた「利用したい」リクエストです。承認すると、その人がすぐにコースを使えるようになります（次回の端末同期で反映）。
      </p>
      {loadError && <p className="admin-banner error">{loadError}</p>}
      {actionError && <p className="admin-banner error">{actionError}</p>}
      {notice && <p className="admin-banner ok">{notice}</p>}

      {!requests ? (
        <p className="admin-hint">読み込み中…</p>
      ) : requests.length === 0 ? (
        <p className="admin-hint">まだリクエストはありません。</p>
      ) : (
        <div className="admin-tablewrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>依頼者</th>
                <th>コース</th>
                <th>依頼日時</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="admin-mono">{r.email}</td>
                  <td>{courseTitle(r.courseId)}</td>
                  <td className="admin-note">{fmtDateTime(r.at)}</td>
                  <td className="admin-actions">
                    {r.status === 'pending' ? (
                      <>
                        <button
                          className="admin-btn small"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await resolveCourseRequest(r.id, 'approve')
                              return `Allowed ${r.email} to use ${courseTitle(r.courseId)}`
                            })
                          }
                        >
                          承認
                        </button>
                        <button
                          className="admin-btn ghost small"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await resolveCourseRequest(r.id, 'dismiss')
                              return `Dismissed ${r.email}'s request`
                            })
                          }
                        >
                          却下
                        </button>
                      </>
                    ) : (
                      <span className={`admin-tag${r.status === 'approved' ? ' on' : ''}`}>
                        {STATUS_LABEL[r.status]}
                        {r.resolvedAt && ` ・ ${fmtDateTime(r.resolvedAt)}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
