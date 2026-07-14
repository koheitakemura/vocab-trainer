/** 数値の桁区切り表示（UI は英語なので en-US 固定）。全画面でこの1関数を使い表記を揃える。 */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}
