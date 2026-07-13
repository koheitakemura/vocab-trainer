import { ThemePreview } from './ThemePreview'
import './design.css'
import './themes.css'

const TONES = [
  { n: 1, key: 'navy', label: '濃紺 × 青（現行）' },
  { n: 2, key: 'teal', label: 'ダーク × ティール/緑' },
  { n: 3, key: 'light', label: 'ライトモード（白基調）' },
  { n: 4, key: 'warm', label: 'ダーク × 暖色（オレンジ）' },
]

/**
 * カラートーン比較ギャラリー（`#tones` でのみ表示）。
 * 同じ Study 画面を4トーンで並べ、番号で選んでもらう。テーマは CSS 変数の差し替えだけ。
 */
export function ThemeGallery() {
  return (
    <div className="tone-gallery">
      <div className="gallery-top">
        <h1>カラートーン比較 — 番号で選択</h1>
        <p>同じ Study 画面を4トーンで表示。レイアウトは確定済み・色だけ選びます。</p>
      </div>
      {TONES.map((t) => (
        <section className="tone-sec" key={t.key}>
          <div className="glabel">
            <span className="gnum">{t.n}</span>
            <span className="gtitle">{t.label}</span>
          </div>
          <div className={`theme-scope theme-${t.key}`}>
            <ThemePreview />
          </div>
        </section>
      ))}
    </div>
  )
}
