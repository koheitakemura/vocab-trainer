import { toRomaji } from 'wanakana'

/**
 * reading → 変換結果のメモ。**検索の体感を決めているのはここ**——wordMatch は
 * 1キーストロークごとに全カード分 getRomaji を呼ぶため、素の toRomaji だと
 * ja-10-30k（12,622語）で 1打鍵あたり実測 55ms（PC）かかっていた。同じ reading の
 * 変換結果は不変なので一度だけ計算すれば足りる（実測 55ms → 5ms・結果は完全一致）。
 * 学習タイル・単語一覧の描画からも同じ関数が呼ばれるのでそちらも軽くなる。
 */
const romajiCache = new Map<string, string | null>()

/**
 * 際限なく貯めない上限。1コースの異なる reading 数（最大 12,622）を十分に上回る値で、
 * コースを何度も切り替えても数MB規模に育たないようにする。超えたら丸ごと捨てる
 * ——LRU にするほどの価値は無く（捨てても次の呼び出しで再計算されるだけ）、
 * 単純な方が事故らない。
 */
const ROMAJI_CACHE_MAX = 30_000

/**
 * かな読みをローマ字に変換して表示用に返す。既にローマ字/IPA等（かなを含まない）の
 * 場合は toRomaji が入力をそのまま返すため、reading と同じなら null にして
 * 「同じ内容を二重表示」しないようにする（将来の英語コース等で reading が
 * IPA 表記になっても壊れない）。
 *
 * 結果は reading 文字列をキーにメモ化する（純粋関数なので戻り値は変わらない）。
 */
export function getRomaji(reading: string | undefined): string | null {
  if (!reading) return null
  const cached = romajiCache.get(reading)
  // null も正当な結果なので has() ではなく undefined 判定で見分ける
  if (cached !== undefined) return cached
  const romaji = toRomaji(reading)
  const value = romaji && romaji !== reading ? romaji : null
  if (romajiCache.size >= ROMAJI_CACHE_MAX) romajiCache.clear()
  romajiCache.set(reading, value)
  return value
}
