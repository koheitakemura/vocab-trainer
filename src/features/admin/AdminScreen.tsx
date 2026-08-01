import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  addUser,
  fetchAdminLog,
  fetchMe,
  fetchUsers,
  removeUser,
  setAllowedCourses,
  updateUser,
  type AdminCourseProgress,
  type AdminLogEntry,
  type AdminUser,
  type Me,
  type UsersResponse,
} from './adminApi'
import { AVAILABLE_COURSES } from '../../data/courseRegistry'
import { fmtNum } from '../../text/format'
import './admin.css'

/**
 * 管理者画面（#admin）。管理者だけが使うので UI は日本語。
 *
 * ここでできること：
 *  - 利用者の登録・削除（＝ Cloudflare Access のログイン許可リストの追加・削除そのもの）
 *  - 各利用者の簡単な進捗確認（コース別に 始めた語数 / 覚えた語数 / 卒業 / 連続日数 / 最終学習日）
 *
 * 権限判定はサーバー側（Worker）が Access の JWT を検証して行う。この画面の出し分けは
 * あくまで見た目の話で、管理者でない人が直接 API を叩いても 403 で弾かれる。
 */

type ConfirmTarget = { email: string; purge: boolean } | null

/**
 * 操作ログに残せなかったことを結果メッセージに添える。
 * 管理操作は取り消しづらいので「記録が無い」ことは黙って流さない。
 */
function withLogWarning(message: string, logged: boolean): string {
  return logged ? message : `${message}（⚠️ 操作ログには記録できませんでした）`
}

export function AdminScreen() {
  const [me, setMe] = useState<Me | null>(null)
  const [data, setData] = useState<UsersResponse | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null)

  const reload = useCallback(async () => {
    setData(await fetchUsers())
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const who = await fetchMe()
        setMe(who)
        if (who.isAdmin) await reload()
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [reload])

  /** 変更操作の共通処理：実行 → 一覧を取り直し → 失敗はメッセージ表示（画面は壊さない） */
  const run = useCallback(
    async (fn: () => Promise<string | void>) => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      try {
        const message = await fn()
        await reload()
        if (message) setNotice(message)
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : String(err))
      } finally {
        setBusy(false)
        setConfirmTarget(null)
      }
    },
    [reload],
  )

  if (bootError) return <AdminMessage title="表示できませんでした" body={bootError} />
  if (!me) return <AdminMessage title="読み込み中…" body="" />
  if (!me.isAdmin)
    return (
      <AdminMessage
        title="権限がありません"
        body={`${me.email} は管理者として登録されていません。Worker の ADMIN_EMAILS に追加してください。`}
      />
    )

  return (
    <div className="admin">
      <header className="admin-header">
        <div>
          <h1 className="admin-title">管理者画面</h1>
          <p className="admin-sub">Vocab Trainer — 利用者とその進捗</p>
        </div>
        <div className="admin-meta">
          <span className="admin-who">{me.email}</span>
          <a className="admin-back" href="./">
            学習画面へ
          </a>
        </div>
      </header>

      {data?.accessListError && (
        <p className="admin-banner warn">
          ⚠️ ログイン許可リストに接続できません：{data.accessListError}
          <br />
          <span className="admin-banner-sub">
            進捗の確認はできますが、登録・削除は Cloudflare の設定が終わるまで使えません。
          </span>
        </p>
      )}
      {actionError && <p className="admin-banner error">{actionError}</p>}
      {notice && <p className="admin-banner ok">{notice}</p>}

      <section className="admin-card">
        <h2 className="admin-h2">利用者を追加</h2>
        <AddUserForm
          disabled={busy || !data?.canManageAccess}
          onSubmit={(email, name, note) =>
            run(async () => {
              const res = await addUser(email, name, note)
              return withLogWarning(`${email} を追加しました（ワンタイムPINでログインできます）`, res.logged)
            })
          }
        />
        <p className="admin-hint">
          追加すると Cloudflare Access の許可リストに載り、そのメール宛のワンタイムPINでログインできるようになります。
        </p>
      </section>

      <section className="admin-card">
        <div className="admin-cardhead">
          <h2 className="admin-h2">
            利用者 <span className="admin-count">{data ? data.users.length : 0}</span>
          </h2>
          <button className="admin-btn ghost" onClick={() => void run(async () => undefined)} disabled={busy}>
            再読み込み
          </button>
        </div>
        {!data ? (
          <p className="admin-hint">読み込み中…</p>
        ) : data.users.length === 0 ? (
          <p className="admin-hint">まだ誰も登録されていません。</p>
        ) : (
          <div className="admin-tablewrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>利用者</th>
                  <th>状態</th>
                  <th>使えるコース</th>
                  <th>進捗</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <UserRow
                    key={u.email}
                    user={u}
                    busy={busy}
                    canManageAccess={data.canManageAccess}
                    confirmTarget={confirmTarget}
                    onConfirm={setConfirmTarget}
                    onRename={(name) =>
                      run(async () => {
                        const res = await updateUser(u.email, name, u.note)
                        return res.logged ? undefined : withLogWarning('表示名を更新しました', false)
                      })
                    }
                    onRestore={() =>
                      run(async () => {
                        const res = await addUser(u.email, u.displayName, u.note)
                        return withLogWarning(`${u.email} を再登録しました`, res.logged)
                      })
                    }
                    onSetCourses={(courseIds) =>
                      run(async () => {
                        const res = await setAllowedCourses(u.email, courseIds)
                        const label =
                          courseIds.length === 0
                            ? `${u.email} は全コースを使えます`
                            : `${u.email} に ${courseIds.length} コースを割り当てました`
                        return withLogWarning(label, res.logged)
                      })
                    }
                    onRemove={(purge) =>
                      run(async () => {
                        const res = await removeUser(u.email, purge)
                        const message = purge
                          ? `${u.email} を完全に削除しました`
                          : res.sessionRevoked
                            ? `${u.email} のアクセスを取り消しました`
                            : `${u.email} を許可リストから削除しました（既存のログインセッションはセッション有効期間まで残ります）`
                        return withLogWarning(message, res.logged)
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data && data.unregistered.length > 0 && (
        <section className="admin-card">
          <h2 className="admin-h2">名簿に無い許可メール</h2>
          <p className="admin-hint">
            Cloudflare のダッシュボードで直接追加されたメールです。名簿に載せると進捗も追跡できます。
          </p>
          <ul className="admin-unreg">
            {data.unregistered.map((email) => (
              <li key={email}>
                <span className="admin-mono">{email}</span>
                <button
                  className="admin-btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const res = await addUser(email, '', '')
                      return withLogWarning(`${email} を名簿に追加しました`, res.logged)
                    })
                  }
                >
                  名簿に追加
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AdminLog />
    </div>
  )
}

function AdminMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="admin">
      <div className="admin-card admin-center">
        <h1 className="admin-title">{title}</h1>
        {body && <p className="admin-hint">{body}</p>}
        <a className="admin-back" href="./">
          学習画面へ
        </a>
      </div>
    </div>
  )
}

function AddUserForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit: (email: string, name: string, note: string) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')

  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!email.trim()) return
        onSubmit(email.trim(), name.trim(), note.trim())
        setEmail('')
        setName('')
        setNote('')
      }}
    >
      <input
        className="admin-input"
        type="email"
        required
        placeholder="メールアドレス"
        aria-label="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="admin-input"
        placeholder="表示名（任意）"
        aria-label="表示名"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="admin-input"
        placeholder="メモ（任意）"
        aria-label="メモ"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="admin-btn primary" type="submit" disabled={disabled}>
        追加
      </button>
    </form>
  )
}

function UserRow({
  user,
  busy,
  canManageAccess,
  confirmTarget,
  onConfirm,
  onRename,
  onRestore,
  onRemove,
  onSetCourses,
}: {
  user: AdminUser
  busy: boolean
  canManageAccess: boolean
  confirmTarget: ConfirmTarget
  onConfirm: (t: ConfirmTarget) => void
  onRename: (name: string) => void
  onRestore: () => void
  onRemove: (purge: boolean) => void
  onSetCourses: (courseIds: string[]) => void
}) {
  const [name, setName] = useState(user.displayName)
  useEffect(() => setName(user.displayName), [user.displayName])
  const confirming = confirmTarget?.email === user.email

  return (
    <tr className={user.status === 'removed' ? 'removed' : undefined}>
      <td>
        <input
          className="admin-input name"
          value={name}
          placeholder="（表示名なし）"
          aria-label={`${user.email} の表示名`}
          maxLength={60}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== user.displayName && onRename(name.trim())}
        />
        <div className="admin-mono admin-email">{user.email}</div>
        {user.note && <div className="admin-note">{user.note}</div>}
        <div className="admin-when">最終アクセス {fmtDateTime(user.lastSeenAt)}</div>
      </td>
      <td>
        {user.isAdmin && <span className="admin-tag admin">管理者</span>}
        {user.status === 'removed' ? (
          <span className="admin-tag off">停止中</span>
        ) : user.inAccessList === false ? (
          // 名簿は active なのに許可リストに無い＝ログインできない状態。放置すると原因不明の
          // 「入れません」問い合わせになるので明示する
          <span className="admin-tag warn">ログイン不可</span>
        ) : (
          <span className="admin-tag on">利用中</span>
        )}
      </td>
      <td>
        <CourseAccess allowed={user.allowedCourses} busy={busy} onChange={onSetCourses} />
      </td>
      <td>
        <ProgressSummary courses={user.courses} />
      </td>
      <td className="admin-actions">
        {confirming ? (
          <div className="admin-confirm">
            <span>{confirmTarget?.purge ? '進捗ごと完全に削除します。元に戻せません。' : 'ログインを取り消します。進捗は残ります。'}</span>
            <button className="admin-btn danger" disabled={busy} onClick={() => onRemove(confirmTarget?.purge ?? false)}>
              実行
            </button>
            <button className="admin-btn ghost" disabled={busy} onClick={() => onConfirm(null)}>
              やめる
            </button>
          </div>
        ) : user.isAdmin ? (
          <span className="admin-hint">—</span>
        ) : (
          <>
            {user.status === 'removed' ? (
              // 停止中の人に「アクセス取消」を出しても意味がない。ここでの正しい操作は再登録
              <button className="admin-btn" disabled={busy || !canManageAccess} onClick={onRestore}>
                再登録
              </button>
            ) : (
              <button
                className="admin-btn"
                disabled={busy || !canManageAccess}
                onClick={() => onConfirm({ email: user.email, purge: false })}
              >
                アクセス取消
              </button>
            )}
            <button
              className="admin-btn ghost small"
              disabled={busy || !canManageAccess}
              onClick={() => onConfirm({ email: user.email, purge: true })}
            >
              完全削除
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

/**
 * コース名を詰めて表示する（「Japanese 10,000 → 23,000」→「Japanese 10k→23k」）。
 * 割り当てチップを何個も並べるので、原題のままだと横に伸びすぎるため。
 */
function shortCourseLabel(title: string): string {
  return title
    .replace(/\s*→\s*/, '→')
    .replace(/(\d),(\d{3})/g, (_m, head: string, tail: string) => (tail === '000' ? `${head}k` : `${head},${tail}`))
    .replace(/\s*\(Hiragana & Katakana\)/, '')
    .trim()
}

/**
 * その人が使えるコースの割り当て。**何も選んでいない＝全コース利用可**。
 * 「全コース」チップを明示的に置いているのは、空＝無制限という意味が
 * チップの消灯だけでは伝わらないため。
 */
function CourseAccess({
  allowed,
  busy,
  onChange,
}: {
  allowed: string[] | null
  busy: boolean
  onChange: (courseIds: string[]) => void
}) {
  const unrestricted = !allowed || allowed.length === 0
  const toggle = (id: string) => {
    const next = new Set(allowed ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // 全部外したら「全コース」に戻す（誰も何も使えない状態は作らない）
    onChange([...next])
  }
  return (
    <div className="admin-access">
      <button
        type="button"
        className={`admin-coursechip${unrestricted ? ' on' : ''}`}
        disabled={busy}
        onClick={() => onChange([])}
        title="コースを制限しない"
      >
        全コース
      </button>
      {AVAILABLE_COURSES.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`admin-coursechip${!unrestricted && allowed?.includes(c.id) ? ' on' : ''}`}
          disabled={busy}
          onClick={() => toggle(c.id)}
          title={c.title}
        >
          {shortCourseLabel(c.title)}
        </button>
      ))}
    </div>
  )
}

/**
 * 進捗は利用者ごとに1行だけ。コース別に3行ずつ出すと縦に伸びすぎて
 * 「誰がどれだけ進んでいるか」の見比べがしづらいため、要約に寄せている。
 */
function ProgressSummary({ courses }: { courses: AdminCourseProgress[] }) {
  const active = courses.filter((c) => c.started > 0)
  if (active.length === 0) return <span className="admin-hint">まだ学習の記録がありません</span>

  const known = active.reduce((n, c) => n + c.known, 0)
  const started = active.reduce((n, c) => n + c.started, 0)
  const streak = Math.max(...active.map((c) => c.streak))
  const last = active.map((c) => c.lastStudiedDate).filter(Boolean).sort().pop()
  // 主に進めているコース（開始語数が最大）だけ名前を出す
  const top = active.reduce((a, b) => (b.started > a.started ? b : a))
  const topTitle = AVAILABLE_COURSES.find((c) => c.id === top.courseId)?.title ?? top.courseId

  return (
    <div className="admin-progress">
      <span className="admin-progress-main">
        覚えた <strong>{fmtNum(known)}</strong> / 始めた <strong>{fmtNum(started)}</strong>
      </span>
      <span className="admin-progress-sub">
        {shortCourseLabel(topTitle)}
        {active.length > 1 && ` ほか${active.length - 1}`}
        {streak > 0 && ` ・ 🔥${streak}日`}
        {last && ` ・ 最終 ${last.slice(5)}`}
      </span>
    </div>
  )
}

function AdminLog() {
  const [entries, setEntries] = useState<AdminLogEntry[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || entries) return
    void fetchAdminLog()
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]))
  }, [open, entries])

  return (
    <details className="admin-card" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="admin-h2">操作ログ</summary>
      {entries === null ? (
        <p className="admin-hint">読み込み中…</p>
      ) : entries.length === 0 ? (
        <p className="admin-hint">まだ操作はありません。</p>
      ) : (
        <ul className="admin-log">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="admin-when">{fmtDateTime(e.at)}</span>
              <span className="admin-mono">{e.actor}</span>
              <span>{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="admin-mono">{e.target}</span>
              {e.detail && <span className="admin-note">{e.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

const ACTION_LABEL: Record<string, string> = {
  add_user: '追加',
  update_user: '更新',
  remove_user: 'アクセス取消',
  purge_user: '完全削除',
}

/** ISO 文字列を端末ローカルの「YYYY-MM-DD HH:mm」に。未取得は「—」 */
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
