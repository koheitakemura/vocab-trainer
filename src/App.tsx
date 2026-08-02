import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, CourseId, VocabCard } from './types'
import { repository } from './data/courseRepository'
import { CourseScreen } from './features/CourseScreen'
import { AVAILABLE_COURSES } from './data/courseRegistry'
import { BootBrand, VocabLockup } from './brand/Logo'
import { safeGet, safeSet } from './store/safeStorage'
import { db } from './store/db'
import { useStrings } from './text/i18n'

const COURSE_ID_KEY = 'vt:courseId'

/** 前回選んだコースを復元。レジストリから消えた/壊れた値は無視して先頭コースへ落とす。 */
function loadInitialCourseId(): CourseId {
  const saved = safeGet(COURSE_ID_KEY)
  const found = AVAILABLE_COURSES.find((c) => c.id === saved)
  return (found ?? AVAILABLE_COURSES[0]).id
}

/**
 * boot/loading 画面はコース本体（meta.json）を待たずに出る。uiLanguage だけは
 * レジストリ（同期・軽量）から先に分かるので、選択中コースの言語で出し分ける。
 */
function uiLanguageOf(courseId: CourseId) {
  return (AVAILABLE_COURSES.find((c) => c.id === courseId) ?? AVAILABLE_COURSES[0]).uiLanguage
}

/**
 * 管理者が「その人に使わせるコース」を設定していれば、コース一覧をそれに絞る。
 *
 * - 値は sync.ts が /api/me の応答から db.meta に保存する（オフラインでも直前の割り当てで動く）
 * - **未設定・未取得なら全コース**（サーバーに繋がらない状況で学習が止まらないようにするため）
 * - 絞った結果が空になる場合も全コースへ戻す（コースIDの改名などで全部消える事故を防ぐ）
 *
 * これは表示上の絞り込みであってセキュリティ境界ではない（語彙データは Access 配下の静的ファイル）。
 */
function useAvailableCourses() {
  const row = useLiveQuery(() => db.meta.get('allowedCourses'), [])
  const allowed = Array.isArray(row?.value) ? (row.value as string[]) : null
  return useMemo(() => {
    if (!allowed || allowed.length === 0) return AVAILABLE_COURSES
    const filtered = AVAILABLE_COURSES.filter((c) => allowed.includes(c.id))
    return filtered.length > 0 ? filtered : AVAILABLE_COURSES
  }, [allowed])
}

export default function App() {
  const [courseId, setCourseId] = useState<CourseId>(loadInitialCourseId)
  const [course, setCourse] = useState<Course | null>(null)
  const [cards, setCards] = useState<VocabCard[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const availableCourses = useAvailableCourses()
  const t = useStrings(uiLanguageOf(courseId))

  // 割り当てが変わって選択中コースが使えなくなったら、使えるコースの先頭へ移す
  useEffect(() => {
    if (!availableCourses.some((c) => c.id === courseId)) {
      safeSet(COURSE_ID_KEY, availableCourses[0].id)
      setCourseId(availableCourses[0].id)
    }
  }, [availableCourses, courseId])

  const handleSelectCourse = (id: CourseId) => {
    safeSet(COURSE_ID_KEY, id)
    setCourseId(id)
  }

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
        const [c, cs] = await Promise.all([repository.getCourse(courseId), repository.getCards(courseId)])
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
  }, [courseId, retryNonce])

  if (failed)
    return (
      <div className="boot">
        <div className="boot-msg">
          <VocabLockup direction="column" size={52} />
          <p>{t.bootError}</p>
          <button className="btn primary" onClick={() => setRetryNonce((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      </div>
    )
  if (loading || !course)
    return (
      <div className="boot">
        <BootBrand status={t.loading} />
      </div>
    )
  return (
    <CourseScreen
      course={course}
      cards={cards}
      courses={availableCourses}
      onSelectCourse={handleSelectCourse}
    />
  )
}
