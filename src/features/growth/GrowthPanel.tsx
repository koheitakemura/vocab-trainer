import { useLiveQuery } from 'dexie-react-hooks'
import type { Course } from '../../types'
import { db } from '../../store/db'
import { localDate } from '../../store/progress'
import { buildGrowth } from './growth'
import { GrowthView } from './GrowthView'
import { useStrings } from '../../text/i18n'

/**
 * 成長タブのコンテナ。dailyStats（日次ログ）＋summary（現在の真値）を読み、
 * 成長曲線データを組み立てて GrowthView に渡す。DB を読むのはこのタブを開いている間だけ。
 * summary は末尾（today）の端点を真値に固定するために使う（ヘッダーの数字と揃う）。
 */
export function GrowthPanel({ course }: { course: Course }) {
  const t = useStrings(course.uiLanguage)
  const series = useLiveQuery(async () => {
    const [stats, summary] = await Promise.all([
      db.dailyStats.where('courseId').equals(course.id).toArray(),
      db.summary.get(course.id),
    ])
    const byGrade = summary?.byGrade
    const now = {
      introduced: summary?.introduced ?? 0,
      known: (byGrade?.good ?? 0) + (byGrade?.easy ?? 0) + (summary?.burned ?? 0),
      mastered: summary?.burned ?? 0,
    }
    return buildGrowth(stats, now, localDate(new Date()))
  }, [course.id])

  if (!series) return <div className="hint">{t.loadingGrowth}</div>
  return <GrowthView series={series} uiLanguage={course.uiLanguage} />
}
