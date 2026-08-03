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
  /**
   * 未割当コースのプレビュー用。先頭 limit 件だけを返す軽量版——vite.config.ts の
   * 「コース JSON はオンデマンドで選んだ分だけ」方針を守るため、getCards のように
   * 全帯（コースによっては数MB）を取りに行かない（realRepository 側で先頭帯だけ fetch する）。
   */
  getCardsPreview(id: CourseId, limit: number): Promise<VocabCard[]>
}

export const mockRepository: CourseRepository = {
  async getCourse(id) {
    if (id !== mockCourse.id) throw new Error(`未実装のコース: ${id}`)
    return mockCourse
  },
  async getCards(id) {
    return mockCards.filter((c) => c.courseId === id).sort((a, b) => a.frequencyRank - b.frequencyRank)
  },
  async getCardsPreview(id, limit) {
    return mockCards
      .filter((c) => c.courseId === id)
      .sort((a, b) => a.frequencyRank - b.frequencyRank)
      .slice(0, limit)
  },
}

export const repository: CourseRepository = withRealFallback(realRepository, mockRepository)
