import type { Course, CourseId, VocabCard } from '../types'
import { mockCourse, mockCards } from './mockCards'
import { realRepository, withRealFallback } from './realRepository'

/**
 * データ境界（seam）。UI はこのインターフェースだけに依存する。
 * real（静的 JSON パック）が未生成/一部帯のみのコースは mock で穴埋めする。
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

export const repository: CourseRepository = withRealFallback(realRepository, mockRepository)
