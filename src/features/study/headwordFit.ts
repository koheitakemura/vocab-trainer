/**
 * 見出し語の長さに応じてタイル／フォーカスシートの文字サイズを1〜2段落とすための修飾クラス。
 *
 * 見出し語は固定サイズ（タイル 34px・シート 42px）で描いていたため、分割できない長い語
 * （英語の "parliament" 10字・"pharmaceutical" 14字など）がタイル幅に入らず、
 * overflow-wrap で "parliamen / t" のように語の途中で改行されて見苦しかった。
 * 特にスマホの2列（内寸約139px）では該当語が一気に増える。
 *
 * 訳語・例文の側は useFitText が実測して縮めているが、見出し語は「1行の幅」だけの問題なので
 * 実測（レイアウト2パス）を持ち込まず、字数から決め打ちで足りる。
 *
 * CJK（漢字・かな）は1文字の表示幅がラテン文字の約2倍なので2単位として数える。
 * 日本語コースの見出し語はほぼ1〜4文字＝8単位未満なので、この関数では一切縮まない
 * （＝既存の見た目を変えない）。
 */
// CJK 記号・かな・漢字・全角英数（いわゆる全角幅の範囲）
const WIDE_CHAR = /[　-ヿ㐀-䶿一-鿿＀-￯]/

/** ラテン文字1字を1単位、全角1字を2単位として数えた「表示上の長さ」 */
export function headwordUnits(headword: string): number {
  let units = 0
  for (const ch of headword) units += WIDE_CHAR.test(ch) ? 2 : 1
  return units
}

/**
 * className に足す修飾（空文字 / ' hw-lg' / ' hw-xl'）。
 * 閾値はスマホ2列の内寸 139px で1行に収まる境目から決めた（index.css の .hw-lg/.hw-xl 参照）。
 */
export function headwordFitClass(headword: string): string {
  const units = headwordUnits(headword)
  if (units >= 13) return ' hw-xl'
  if (units >= 9) return ' hw-lg'
  return ''
}
