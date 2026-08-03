import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, CourseId, VocabCard } from './types'
import { repository } from './data/courseRepository'
import { CourseScreen } from './features/CourseScreen'
import { CoursePreviewScreen } from './features/preview/CoursePreviewScreen'
import { AVAILABLE_COURSES } from './data/courseRegistry'
import { DEFAULT_BOARD_SIZE } from './features/study/boardSize'
import { BootBrand, VocabLockup } from './brand/Logo'
import { safeGet, safeSet } from './store/safeStorage'
import { db } from './store/db'
import { applyCorrections, fetchCorrections } from './store/corrections'
import { startReportFlush } from './store/reports'
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
  // 未割当コース＝プレビュー（読み取り専用）。選択自体は正式な状態なので、以前のような
  // 「割当外へ強制的に戻す」リダイレクトはしない（未割当コースのプレビュー機能）。
  const isPreview = useMemo(() => !availableCourses.some((c) => c.id === courseId), [availableCourses, courseId])
  const allowedIds = useMemo(() => new Set(availableCourses.map((c) => c.id)), [availableCourses])

  const handleSelectCourse = (id: CourseId) => {
    safeSet(COURSE_ID_KEY, id)
    setCourseId(id)
  }

  // オフライン時に送れなかったカード誤り報告を再送する（アプリ起動時に1回だけ）
  useEffect(() => {
    startReportFlush()
  }, [])

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
        // プレビュー（未割当コース）は先頭帯だけの軽量フェッチ——コース全体（コースによっては
        // 数MB〜十数MB）を、覗いただけの未割当コースのために毎回取りに行かない
        // （vite.config.ts の「コース JSON はオンデマンドで選んだ分だけ」方針を守る）。
        const [c, cs, corrections] = await Promise.all([
          repository.getCourse(courseId),
          isPreview ? repository.getCardsPreview(courseId, DEFAULT_BOARD_SIZE) : repository.getCards(courseId),
          fetchCorrections(courseId),
        ])
        if (!active) return
        setCourse(c)
        // 管理者が確定させた誤り是正を重ねる（是正が0件・未デプロイ・オフラインなら cs をそのまま返す）
        setCards(applyCorrections(cs, corrections))
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
    // isPreview を依存に含める：管理者の承認/剥奪が同一セッション中に同期されて割当が変わったとき、
    // 正しい方（全件 or プレビュー用の先頭帯だけ）を取り直すため。
  }, [courseId, retryNonce, isPreview])

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
  return isPreview ? (
    <CoursePreviewScreen
      course={course}
      cards={cards}
      allCourses={AVAILABLE_COURSES}
      allowedIds={allowedIds}
      onSelectCourse={handleSelectCourse}
    />
  ) : (
    <CourseScreen
      course={course}
      cards={cards}
      allCourses={AVAILABLE_COURSES}
      allowedIds={allowedIds}
      onSelectCourse={handleSelectCourse}
    />
  )
}
