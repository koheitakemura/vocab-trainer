/** 数値の桁区切り表示（UI は英語なので en-US 固定）。全画面でこの1関数を使い表記を揃える。 */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * 「3分前」のような相対時刻の**数値+単位**部分だけを返す（文言テンプレートに埋め込む前提）。
 * フッターの同期状態表示のように、頻繁に再レンダーされる小さな表示のための軽量実装。
 * Intl.RelativeTimeFormat を使わないのは、"3 minutes ago" 形式の完全文が欲しいのではなく
 * 言語ごとの文言テンプレート（strings.*.ts）に差し込む断片が欲しいため。
 */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(diffMs) || diffMs < 0) return ''
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return '<1m'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}
