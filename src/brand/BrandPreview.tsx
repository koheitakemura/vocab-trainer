import { BootBrand, VocabLockup, VocabMark } from './Logo'
import { ThemeToggle } from '../theme/ThemeToggle'
import './brand.css'

/**
 * `#brand` — ロゴの確認画面（`#design` / `#tones` と同じ流儀の内部プレビュー）。
 *
 * ロゴはアプリのテーマトークンで塗っているので、ライト/ダークの切り替えでそのまま追従する。
 * 右上のトグルで両方を見て、どちらでも地に馴染むか確認するためのページ。
 * 書き出し済みの PNG も並べてあるので、生成スクリプトを回したあとの差分確認もここでできる。
 */

const SIZES = [128, 64, 40, 32, 24, 16]

const TOKENS = [
  { name: '地（アイコンPNGのみ焼き込み）', value: '#0b1120', css: '--bg' },
  { name: '習得済みのマス', value: '#6ea8fe / #2563eb', css: '--accent' },
  { name: '学習中のマス', value: 'accent 45%', css: '--accent + opacity' },
  { name: 'いま出題中のマス', value: '#e8edf7 / #182038', css: '--text' },
  { name: '未学習のマス', value: '#263250 / #c3cddd', css: '--border' },
]

const FILES = [
  { src: 'pwa-512.png', label: 'pwa-512', note: 'PWA / any' },
  { src: 'pwa-512-maskable.png', label: 'pwa-512-maskable', note: 'Android 円マスク用' },
  { src: 'apple-touch-icon.png', label: 'apple-touch-icon', note: 'iOS ホーム画面' },
  { src: 'favicon-32.png', label: 'favicon-32', note: 'タブ（3×3）' },
]

export function BrandPreview() {
  return (
    <div className="brand-page">
      <header className="brand-head">
        <div>
          <h1>Vocab Trainer — ロゴ</h1>
          <p className="brand-sub">
            Coverage Grid：マス目 1 つが 1 語。左下から順に埋まり、白い 1 マスが「いま出題中の語」。
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="brand-sec">
        <h2>マーク</h2>
        <div className="brand-row">
          <figure className="brand-fig">
            <VocabMark size={128} />
            <figcaption>standard 4×4</figcaption>
          </figure>
          <figure className="brand-fig">
            <VocabMark size={128} variant="compact" />
            <figcaption>compact 3×3</figcaption>
          </figure>
        </div>
      </section>

      <section className="brand-sec">
        <h2>縮小（上＝standard / 下＝compact）</h2>
        <p className="brand-note">
          4×4 は 32px 以下で模様に潰れる。タブ・小アイコンは compact に切り替える。
        </p>
        <div className="brand-ramp">
          {SIZES.map((s) => (
            <figure key={s} className="brand-fig">
              <VocabMark size={s} />
              <figcaption>{s}</figcaption>
            </figure>
          ))}
        </div>
        <div className="brand-ramp">
          {SIZES.map((s) => (
            <figure key={s} className="brand-fig">
              <VocabMark size={s} variant="compact" />
              <figcaption>{s}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="brand-sec">
        <h2>ロックアップ</h2>
        <div className="brand-row brand-row--baseline">
          <VocabLockup />
          <VocabLockup size={28} />
          <VocabLockup direction="column" size={52} />
        </div>
      </section>

      <section className="brand-sec">
        <h2>起動画面</h2>
        <div className="brand-boot">
          <BootBrand status="Loading…" />
        </div>
      </section>

      <section className="brand-sec">
        <h2>書き出し済みファイル</h2>
        <p className="brand-note">
          すべて <code>python scripts/gen_brand_assets.py</code> の生成物。手で描き直さない。
        </p>
        <div className="brand-files">
          {FILES.map((f) => (
            <figure key={f.src} className="brand-file">
              <img src={`./${f.src}`} alt={f.label} width={96} height={96} />
              <figcaption>
                <b>{f.label}</b>
                <span>{f.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="brand-sec">
        <h2>色</h2>
        <table className="brand-tokens">
          <tbody>
            {TOKENS.map((t) => (
              <tr key={t.css}>
                <td>{t.name}</td>
                <td>
                  <code>{t.css}</code>
                </td>
                <td className="brand-hex">{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
