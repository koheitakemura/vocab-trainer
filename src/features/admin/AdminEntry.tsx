import { useEffect, useState } from 'react'
import { fetchMe } from './adminApi'
import { SlidersIcon } from '../../ui/icons'
import './admin.css'

/**
 * フッターの Backup/Restore と同じ並びに出る「管理者画面へ」の入口。**管理者にだけ**表示する
 * （Kohei 指定：2026-08-01、右下フローティングから Backup/Restore と同じ行へ変更）。
 *
 * 判定ロジックは自己完結（この場所だけ気にすれば良い）：CourseScreen 側は <AdminEntry />
 * を置くだけで、管理者かどうかの判定・非表示はこのコンポーネント内で完結する。
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
      <SlidersIcon /> 管理者画面
    </a>
  )
}
