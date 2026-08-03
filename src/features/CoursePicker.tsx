import type { Course, CourseId } from '../types'
import type { CourseListing } from '../data/courseRegistry'
import { VocabLockup } from '../brand/Logo'
import { useStrings } from '../text/i18n'

/**
 * 画面左上のブランド＋コース選択（CourseScreen.tsx と CoursePreviewScreen.tsx の共通ヘッダー）。
 * 元は CourseScreen.tsx にだけあった実装をそのまま抽出したもの——動作は一切変えていない。
 *
 * 未割当（プレビュー専用）のコースは、可視ラベル・各 option とも末尾に coursePreviewSuffix を
 * 付けて区別する（Kohei 指定：専用UIへの作り替えはせず、素の select への最小変更で済ませる）。
 */
export function CoursePicker({
  course,
  allCourses,
  allowedIds,
  onSelectCourse,
}: {
  course: Course
  /** 選択肢として出す全コース（割当の有無を問わない） */
  allCourses: CourseListing[]
  /** 割り当て済み（フル機能で使える）コース ID の集合。含まれないコースには接尾辞を付ける */
  allowedIds: Set<CourseId>
  onSelectCourse: (id: CourseId) => void
}) {
  const t = useStrings(course.uiLanguage)
  const labelFor = (id: CourseId, title: string) => (allowedIds.has(id) ? title : `${title}${t.coursePreviewSuffix}`)

  return (
    <div className="course-head">
      {/* 画面左上。ブランドをコース名と同じ行の左に、コース名と同じ大きさで置く。
          マークは 26px なので 4×4 では潰れる＝compact（3×3）を使う */}
      <VocabLockup className="topbrand" size={26} variant="compact" />
      {/* コースが1つしかない間はドロップダウンを出さず見出しのまま（選ぶ意味がないUIを避ける） */}
      {allCourses.length > 1 ? (
        // 見えている文字は span（今のコース名の幅ちょうど）、その上に透明な
        // select を重ねる。select は最長の選択肢の幅になるので、そのまま出すと
        // ▾ が文字から離れてしまうため。選択 UI は OS ネイティブのまま。
        <span className="course-picker">
          <span className="course-picker-label" aria-hidden="true">
            {labelFor(course.id, course.title)}
          </span>
          <select
            className="course-select"
            aria-label={t.selectCourseAria}
            value={course.id}
            onChange={(e) => onSelectCourse(e.target.value as CourseId)}
          >
            {allCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {labelFor(c.id, c.title)}
              </option>
            ))}
          </select>
        </span>
      ) : (
        <h1 className="course-name">{course.title}</h1>
      )}
    </div>
  )
}
