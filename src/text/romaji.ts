import { toRomaji } from 'wanakana'

/**
 * かな読みをローマ字に変換して表示用に返す。既にローマ字/IPA等（かなを含まない）の
 * 場合は toRomaji が入力をそのまま返すため、reading と同じなら null にして
 * 「同じ内容を二重表示」しないようにする（将来の英語コース等で reading が
 * IPA 表記になっても壊れない）。
 */
export function getRomaji(reading: string | undefined): string | null {
  if (!reading) return null
  const romaji = toRomaji(reading)
  return romaji && romaji !== reading ? romaji : null
}
