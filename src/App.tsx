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

  useEffect(() => {
    let active = true
    void (async () => {
      const [c, cs] = await Promise.all([repository.getCourse(COURSE_ID), repository.getCards(COURSE_ID)])
      if (!active) return
      setCourse(c)
      setCards(cs)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading || !course) return <div className="boot">Loading…</div>
  return <CourseScreen course={course} cards={cards} />
}
