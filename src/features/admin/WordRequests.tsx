import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  deleteWordCard,
  fetchWordRequests,
  promoteWordCard,
  type WordRequestCard,
  type WordRequestFailure,
} from './adminApi'
import { AVAILABLE_COURSES } from '../../data/courseRegistry'

/**
 * AI が生成した単語カードの一覧（docs/word-request-design.md §8「管理画面 = レベル感の門番」）。
 * 検索でも静的プールでも見つからず Workers AI が生成した語だけがここに出る
 * （worker/wordgen.ts）。誰が・どのコースで・どのモデルで作られたか、生成物の中身（訳・品詞・
 * 例文）を確認し、良いものは「昇格」＝次回のコース本体ビルドに回す候補として印を付け、
 * 質の低いものは削除できる。
 *
 * 「昇格」はここでは印を付けるだけ——実際にコース本体へ取り込む作業（pipeline/ 側のビルド）は
 * このアプリの範囲外（Kohei が別途 promoted=1 のカードを拾う）。
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

const RESULT_LABEL: Record<string, string> = {
  reused: '再利用',
  generated: '新規生成',
  rejected: '却下',
  error: 'エラー',
}

export function WordRequests() {
  const [cards, setCards] = useState<WordRequestCard[] | null>(null)
  const [failures, setFailures] = useState<WordRequestFailure[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const reload = useCallback(async () => {
    try {
      const res = await fetchWordRequests()
      setCards(res.cards)
      setFailures(res.failures)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleExpand = (cardId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const run = async (fn: () => Promise<string>) => {
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
      setConfirmDelete(null)
    }
  }

  return (
    <Fragment>
      <section className="admin-card">
        <div className="admin-cardhead">
          <h2 className="admin-h2">
            単語追加リクエスト <span className="admin-count">{cards ? cards.length : 0}</span>
          </h2>
          <button className="admin-btn ghost" onClick={() => void reload()} disabled={busy}>
            再読み込み
          </button>
        </div>
        <p className="admin-hint">
          検索でも辞書にも見つからず AI が生成した語の一覧です。良いものを「昇格」すると次回のコース本体ビルドに回す候補として記録されます（実際の取り込みは別作業）。
        </p>
        {loadError && <p className="admin-banner error">{loadError}</p>}
        {actionError && <p className="admin-banner error">{actionError}</p>}
        {notice && <p className="admin-banner ok">{notice}</p>}

        {!cards ? (
        <p className="admin-hint">読み込み中…</p>
      ) : cards.length === 0 ? (
        <p className="admin-hint">まだ AI が生成した語はありません。</p>
      ) : (
        <div className="admin-tablewrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>語</th>
                <th>内容</th>
                <th>依頼者</th>
                <th>モデル</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.cardId}>
                  <td>
                    <div className="admin-mono">{c.headword}</div>
                    <div className="admin-note">{courseTitle(c.courseId)}</div>
                    {c.promoted && <span className="admin-tag on">昇格済み</span>}
                  </td>
                  <td>
                    <div>
                      {c.gloss || <span className="admin-hint">（訳なし）</span>}
                      {c.pos && <span className="admin-note"> ・ {c.pos}</span>}
                    </div>
                    {c.examples.length > 0 && (
                      <>
                        <button type="button" className="admin-btn ghost small" onClick={() => toggleExpand(c.cardId)}>
                          例文{c.examples.length}件 {expanded.has(c.cardId) ? '閉じる' : '見る'}
                        </button>
                        {expanded.has(c.cardId) && (
                          <ul className="admin-examples">
                            {c.examples.map((ex, i) => (
                              <li key={i}>
                                <div>{ex.text}</div>
                                <div className="admin-note">{ex.translation}</div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {c.requesters.length === 0 ? (
                      <span className="admin-hint">—</span>
                    ) : (
                      <ul className="admin-requesters">
                        {c.requesters.slice(0, 5).map((r, i) => (
                          <li key={i}>
                            <span className="admin-mono">{r.email}</span>
                            <span className="admin-note">
                              {' '}
                              {RESULT_LABEL[r.result] ?? r.result} ・ {fmtDateTime(r.at)}
                            </span>
                          </li>
                        ))}
                        {c.requesters.length > 5 && <li className="admin-note">ほか{c.requesters.length - 5}件</li>}
                      </ul>
                    )}
                  </td>
                  <td className="admin-mono">{c.model}</td>
                  <td className="admin-actions">
                    {confirmDelete === c.cardId ? (
                      <div className="admin-confirm">
                        <span>この生成カードを削除します。次に誰かがこの語を引くと再生成されます。</span>
                        <button
                          className="admin-btn danger"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await deleteWordCard(c.cardId)
                              return `${c.headword} を削除しました`
                            })
                          }
                        >
                          実行
                        </button>
                        <button className="admin-btn ghost" disabled={busy} onClick={() => setConfirmDelete(null)}>
                          やめる
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="admin-btn small"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await promoteWordCard(c.cardId, !c.promoted)
                              return c.promoted ? `${c.headword} の昇格を解除しました` : `${c.headword} を昇格しました`
                            })
                          }
                        >
                          {c.promoted ? '昇格解除' : '昇格'}
                        </button>
                        <button className="admin-btn ghost small" disabled={busy} onClick={() => setConfirmDelete(c.cardId)}>
                          削除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

      {failures.length > 0 && (
        <details className="admin-card">
          <summary className="admin-h2">
            却下・失敗した試行 <span className="admin-count">{failures.length}</span>
          </summary>
          <ul className="admin-log">
            {failures.map((f, i) => (
              <li key={i}>
                <span className="admin-when">{fmtDateTime(f.at)}</span>
                <span className="admin-mono">{f.email}</span>
                <span>{courseTitle(f.courseId)}</span>
                <span className="admin-mono">{f.headword}</span>
                <span>{RESULT_LABEL[f.result] ?? f.result}</span>
                {f.detail && <span className="admin-note">{f.detail}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Fragment>
  )
}
