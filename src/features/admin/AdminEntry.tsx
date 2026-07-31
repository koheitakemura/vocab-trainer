import { useEffect, useState } from 'react'
import { fetchMe } from './adminApi'
import './admin.css'

/**
 * 学習画面の隅に出る「管理者画面へ」の入口。**管理者にだけ**表示する。
 *
 * 学習画面のコンポーネント（CourseScreen）には手を入れず、main.tsx から独立して重ねている
 * ——学習体験のコードと管理機能を混ぜないため、かつ別セッションが同じファイルを編集していても
 * ぶつからないようにするため。
 *
 * 管理者判定はサーバー（/api/me）に聞く。ここで隠していることはあくまで見た目の話で、
 * 非管理者が /admin を直接開いても管理APIが 403 を返すので実害は無い。
 */
export function AdminEntry() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let alive = true
    // 失敗（未デプロイ・オフライン・未ログイン）は黙って諦める。学習画面には一切影響させない
    void fetchMe()
      .then((me) => {
        if (alive && me.isAdmin) setShow(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!show) return null
  return (
    <a className="admin-entry" href="./admin" title="利用者の登録・削除と進捗確認">
      ⚙ 管理者画面
    </a>
  )
}
