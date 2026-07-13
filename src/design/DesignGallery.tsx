import type { ReactNode } from 'react'
import { mockCards } from '../data/mockCards'
import { VariantGrid, VariantQueueFocus, VariantDeckStack, VariantDenseList } from './variants'
import './design.css'

/**
 * デザイン選定用ギャラリー（`#design` でのみ表示）。
 * 「複数カードを同時に見せる」レイアウト4案を1ページに並べ、番号で選んでもらう。
 * 本体アプリ（1枚ずつの学習ループ）はそのまま残っている。
 */
export function DesignGallery() {
  return (
    <div className="gallery">
      <div className="gallery-top">
        <h1>レイアウト比較 — 複数カードをまとめて表示</h1>
        <p>「日本語 0→3,000」コースのモックデータで表示。番号で選んでください（色調は後で別途調整できます）。</p>
      </div>
      <Section n={1} title="Study Grid — タイル格子（一部めくって意味表示）">
        <VariantGrid cards={mockCards} />
      </Section>
      <Section n={2} title="Queue + Focus — 左に一覧・右に今の1枚">
        <VariantQueueFocus cards={mockCards} />
      </Section>
      <Section n={3} title="Deck Stack — 今の1枚を大きく＋次の数枚を横に">
        <VariantDeckStack cards={mockCards} />
      </Section>
      <Section n={4} title="Dense List — 一覧俯瞰（Anki ブラウザ風）">
        <VariantDenseList cards={mockCards} />
      </Section>
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="gsection">
      <div className="glabel">
        <span className="gnum">{n}</span>
        <span className="gtitle">{title}</span>
      </div>
      <div className="gframe">{children}</div>
    </section>
  )
}
