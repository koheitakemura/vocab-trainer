import type { CourseType, Example } from '../types'
import { State, type Card } from './scheduler'

/**
 * 文脈クローズ（PLAN §4.2）。
 *
 * cloze は「別カード」ではなく、既存レールカードの**提示モードの切り替え**である
 * （カード総数は増やさない）。ある語の FSRS 安定度がしきい値を超えると、次の復習から
 * フラッシュカード（語→意味の受容）でなく、文中に空欄を作って語そのものを産出させる
 * 提示（意味→語の産出）に自動昇格する。採点・スケジューリングは一切変えない＝純粋に表示層。
 */

/**
 * cloze 昇格の安定度しきい値（日）。この安定度を超えた既習語を文脈クローズへ回す。
 * 卒業（BURN_STABILITY_DAYS=120）の十分手前に置き、卒業までの長い区間を文脈で鍛える。
 */
export const CLOZE_PROMOTION_STABILITY_DAYS = 21

/** cloze 提示を使うコース種別（3k-10k=cloze・10k-30k=較正）。rail(0-3k) は常にフラッシュカード。 */
export function isClozeCourse(type: CourseType): boolean {
  return type === 'cloze' || type === 'calibrate-mine'
}

/**
 * この FSRS 状態のカードを、いま cloze 提示に昇格すべきか。
 * 未習（New）・学習中（Learning/Relearning）は false＝まず語自体を覚える段階。
 * 安定した復習カード（Review かつ stability≥しきい値）だけ文脈クローズへ回す。
 */
export function shouldClozePromote(type: CourseType, fsrs: Card): boolean {
  return isClozeCourse(type) && fsrs.state === State.Review && fsrs.stability >= CLOZE_PROMOTION_STABILITY_DAYS
}

/** cloze 文中の空欄 sentinel。データパイプラインが見出し語の位置に埋める。 */
export const CLOZE_BLANK = '｟＿｠'

export interface ClozeParts {
  before: string
  after: string
}

/**
 * cloze 文字列を空欄の前後に分割する。sentinel を含まなければ null を返す
 * （＝この例文はクローズに使えない。呼び出し側はフラッシュカードにフォールバックする）。
 */
export function splitCloze(cloze: string): ClozeParts | null {
  const i = cloze.indexOf(CLOZE_BLANK)
  if (i === -1) return null
  return { before: cloze.slice(0, i), after: cloze.slice(i + CLOZE_BLANK.length) }
}

/**
 * カードの例文から、クローズ提示に使える最初の1つを返す（cloze フィールドがあり sentinel を含むもの）。
 * 昇格対象カードでもクローズ可能な例文が無ければ undefined＝フラッシュカードにフォールバックする。
 */
export function pickClozeExample(examples: Example[]): { example: Example; parts: ClozeParts } | undefined {
  for (const example of examples) {
    if (!example.cloze) continue
    const parts = splitCloze(example.cloze)
    if (parts) return { example, parts }
  }
  return undefined
}
