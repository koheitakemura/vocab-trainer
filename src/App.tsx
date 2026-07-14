import { useEffect, useState } from 'react'
import type { Course, VocabCard } from './types'
import { repository } from './data/courseRepository'
import { CourseScreen } from './features/CourseScreen'

/** MVP はまず ja-0-3k（リリース①候補）を表示。コース選択は後で追加。 */
const COURSE_ID = 'ja-0-3k' as const

export default function App() {
  const [course, setCourse] = useState<Course | null>(null)
  const [cards, setCards] = useState<VocabCard[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let active = true
    // 状態遷移は effect が一元管理する（Retry ボタンは nonce を進めるだけ）
    setLoading(true)
    setFailed(false)
    void (async () => {
      // 初回訪問をオフラインで開いた等、fetch がネットワークエラーで reject すると
      // ここで catch しない限り「Loading…」のまま永久に固まる（実際に発生していたバグ）。
      // 2回目以降は Service Worker の precache が効くのでオフラインでもここには来ない。
      try {
        const [c, cs] = await Promise.all([repository.getCourse(COURSE_ID), repository.getCards(COURSE_ID)])
        if (!active) return
        setCourse(c)
        setCards(cs)
        setLoading(false)
      } catch (err) {
        // オフライン以外（壊れた JSON 等）もここに来る。現地調査できるよう必ずログに残す。
        console.error('Course data load failed:', err)
        if (!active) return
        setFailed(true)
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [retryNonce])

  if (failed)
    return (
      <div className="boot">
        <div className="boot-msg">
          <p>Couldn’t load the course data. Check your connection and retry.</p>
          <button className="btn primary" onClick={() => setRetryNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      </div>
    )
  if (loading || !course) return <div className="boot">Loading…</div>
  return <CourseScreen course={course} cards={cards} />
}
