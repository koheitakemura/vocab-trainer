import type { CourseId } from '../types'

/**
 * コース選択 UI 向けの軽量メタ情報。
 * フル情報（glossLanguage・type・band 等）は repository.getCourse() が
 * public/data/courses/<id>/meta.json から非同期に取る（実データの正）。
 * ここは「選択肢としてどのコースが今あるか」を同期的に列挙するためだけの一覧。
 */
export interface CourseListing {
  id: CourseId
  title: string
  learningLanguage: string
  uiLanguage: 'ja' | 'en'
}

/**
 * 現在利用可能なコースの一覧（コース一覧の唯一の参照点）。
 * コースを追加するときはここに1件足すだけでよい（コード分岐は増やさない）。
 * 実データ（meta.json）が未生成のコースはここに含めない。
 */
export const AVAILABLE_COURSES: CourseListing[] = [
  {
    id: 'ja-0-3k',
    title: 'Japanese 0 → 3,000',
    learningLanguage: 'Japanese',
    uiLanguage: 'en',
  },
]
