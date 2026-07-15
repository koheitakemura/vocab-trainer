import { Fragment, useEffect, useState } from 'react'
import type { CourseId, DailyStat } from '../types'
import { db } from '../store/db'
import { localDate } from '../store/progress'
import { safeGet, safeSet } from '../store/safeStorage'
import { useStrings, type UiLanguage } from '../text/i18n'

interface WeeklySummary {
  /** タイトルの文言選択（this week / last week）。翻訳は描画時に uiLanguage で行う */
  kind: 'thisWeek' | 'lastWeek'
  activeDays: number
  reviews: number
  newWords: number
  /** 前週比のレビュー増分。マイナス週は表示しない（責めない設計）ため正のときだけ入る */
  up?: number
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function sum(rows: DailyStat[]): { activeDays: number; reviews: number; newWords: number } {
  let activeDays = 0
  let reviews = 0
  let newWords = 0
  for (const r of rows) {
    if (r.reviews > 0) activeDays++
    reviews += r.reviews
    newWords += r.newStarted
  }
  return { activeDays, reviews, newWords }
}

/**
 * 週次ふりかえりカード（セッション完了画面に週1回だけ差し込む）。
 * 日曜の完了時は「今週」、週が明けて最初の完了時は「先週」のまとめを出す。
 * 小さな前進の可視化（Amabile: 進捗の原理）＋達成の儀式にバックアップを同梱する
 * （テンプテーション・バンドリング。ローカルファースト構成で進捗消失は唯一の破滅的事故）。
 */
export function WeeklyCard({
  courseId,
  onBackup,
  uiLanguage,
}: {
  courseId: CourseId
  onBackup?: () => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const [data, setData] = useState<WeeklySummary | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const today = new Date()
      const dowMon = (today.getDay() + 6) % 7 // 0=月 .. 6=日
      const thisMonday = addDays(today, -dowMon)
      const weekKey = localDate(thisMonday)
      const shownKey = safeGet(`vt:weeklyShown:${courseId}`)
      if (shownKey === weekKey) return

      const range = (from: Date, to: Date) =>
        db.dailyStats
          .where('[courseId+date]')
          .between([courseId, localDate(from)], [courseId, localDate(to)], true, true)
          .toArray()

      const isSunday = dowMon === 6
      if (isSunday) {
        // 今週のまとめ（月〜今日）＋先週比
        const [cur, prev] = await Promise.all([
          range(thisMonday, today),
          range(addDays(thisMonday, -7), addDays(thisMonday, -1)),
        ])
        if (!active) return
        const c = sum(cur)
        if (c.reviews === 0) return
        const p = sum(prev)
        safeSet(`vt:weeklyShown:${courseId}`, weekKey)
        setData({ kind: 'thisWeek', ...c, up: c.reviews > p.reviews && p.reviews > 0 ? c.reviews - p.reviews : undefined })
      } else {
        // 新しい週の最初の完了時に、先週のまとめ（先週に活動があったときだけ）
        const prevMonday = addDays(thisMonday, -7)
        const rows = await range(prevMonday, addDays(prevMonday, 6))
        if (!active) return
        const p = sum(rows)
        if (p.reviews === 0) return
        safeSet(`vt:weeklyShown:${courseId}`, weekKey)
        setData({ kind: 'lastWeek', ...p })
      }
    })()
    return () => {
      active = false
    }
  }, [courseId])

  if (!data) return null
  return (
    <div className="weekly-card">
      <div className="weekly-title">{data.kind === 'thisWeek' ? t.weeklyThisWeek : t.weeklyLastWeek}</div>
      <div className="weekly-line">
        {t.weeklyLine(data.activeDays, data.reviews, data.newWords).map((p, i) =>
          p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>,
        )}
        {data.up !== undefined && <span className="weekly-up">{t.weeklyUp(data.up)}</span>}
      </div>
      {onBackup && (
        <button type="button" className="btn ghost weekly-backup" onClick={onBackup}>
          ⭳ {t.weeklyBackup}
        </button>
      )}
    </div>
  )
}
