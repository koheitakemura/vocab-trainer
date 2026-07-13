import type { Course, CourseId, VocabCard } from '../types'
import { mockCourse, mockCards } from './mockCards'

/**
 * データ境界（seam）。UI はこのインターフェースだけに依存する。
 * 今は mock（バンドル JSON）を返し、後で real（静的 JSON パックを fetch）に差し替える。
 * 差し替えは「実装の入れ替え」だけで、UI・型は一切変えない。
 */
export interface CourseRepository {
  getCourse(id: CourseId): Promise<Course>
  getCards(id: CourseId): Promise<VocabCard[]>
}

export const mockRepository: CourseRepository = {
  async getCourse(id) {
    if (id !== mockCourse.id) throw new Error(`未実装のコース: ${id}`)
    return mockCourse
  },
  async getCards(id) {
    return mockCards.filter((c) => c.courseId === id).sort((a, b) => a.frequencyRank - b.frequencyRank)
  },
}

// TODO(real): 静的 JSON パック（コース別・1k帯別・遅延読込）を fetch する実装に差し替え。
export const repository: CourseRepository = mockRepository
