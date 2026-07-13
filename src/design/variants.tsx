import type { VocabCard } from '../types'

/** モックアップ用の擬似ステータス（見た目の色分けを見せるため） */
type DemoStatus = 'new' | 'learning' | 'known'
const demoStatus = (i: number): DemoStatus => (i % 5 === 0 ? 'known' : i % 3 === 1 ? 'learning' : 'new')

/** 案① Study Grid — 同じ大きさのタイルを格子状に。一部は裏返して意味を表示。 */
export function VariantGrid({ cards }: { cards: VocabCard[] }) {
  const sample = cards.slice(0, 16)
  return (
    <div className="v-grid">
      {sample.map((c, i) => {
        const flipped = i % 4 === 2
        return (
          <div key={c.id} className={`vg-tile s-${demoStatus(i)}${flipped ? ' flipped' : ''}`}>
            <span className="vg-dot" />
            {flipped ? (
              <>
                <div className="vg-word small">{c.headword}</div>
                <div className="vg-gloss">{c.gloss}</div>
              </>
            ) : (
              <>
                <div className="vg-word">{c.headword}</div>
                <div className="vg-reading">{c.reading}</div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 案② Queue + Focus — 左に「これから出る語」の一覧、右に今の1枚。複数見えるが焦点は1つ。 */
export function VariantQueueFocus({ cards }: { cards: VocabCard[] }) {
  const focus = cards[0]
  const list = cards.slice(0, 12)
  return (
    <div className="v-qf">
      <aside className="qf-list">
        <div className="qf-list-head">Up next · {list.length}</div>
        {list.map((c, i) => (
          <div key={c.id} className={`qf-row${i === 0 ? ' active' : ''} s-${demoStatus(i)}`}>
            <span className="qf-num">{c.frequencyRank}</span>
            <span className="qf-word">{c.headword}</span>
            <span className="qf-reading">{c.reading}</span>
            <span className="qf-gloss">{c.gloss}</span>
          </div>
        ))}
      </aside>
      <div className="qf-focus">
        <div className="qf-card">
          <span className="qf-tag">N5 · #{focus.frequencyRank}</span>
          <div className="qf-hw">{focus.headword}</div>
          <div className="qf-r">{focus.reading}</div>
          <div className="qf-g">{focus.gloss}</div>
          <div className="mini-btns">
            <button className="btn again">Again</button>
            <button className="btn good">Good</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 案③ Deck Stack — 今の1枚を大きく、その下に「次に来る」数枚を横一列で見せる。 */
export function VariantDeckStack({ cards }: { cards: VocabCard[] }) {
  const hero = cards[0]
  const up = cards.slice(1, 6)
  return (
    <div className="v-stack">
      <div className="ds-hero">
        <span className="qf-tag">N5 · #{hero.frequencyRank}</span>
        <div className="ds-hw">{hero.headword}</div>
        <div className="ds-r">{hero.reading}</div>
        <div className="ds-g">{hero.gloss}</div>
        <div className="mini-btns">
          <button className="btn again">Again</button>
          <button className="btn good">Good</button>
        </div>
      </div>
      <div className="ds-uplabel">Up next</div>
      <div className="ds-row">
        {up.map((c) => (
          <div key={c.id} className="ds-mini">
            <div className="ds-mini-hw">{c.headword}</div>
            <div className="ds-mini-r">{c.reading}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 案④ Dense List — Anki ブラウザ風の高密度リスト。一目で十数語を俯瞰。 */
export function VariantDenseList({ cards }: { cards: VocabCard[] }) {
  const list = cards.slice(0, 13)
  return (
    <div className="v-dense">
      <div className="dl-head">
        <span>#</span>
        <span>Word</span>
        <span>Reading</span>
        <span>Meaning</span>
        <span>Status</span>
      </div>
      {list.map((c, i) => (
        <div key={c.id} className="dl-row">
          <span className="dl-num">{c.frequencyRank}</span>
          <span className="dl-word">{c.headword}</span>
          <span className="dl-reading">{c.reading}</span>
          <span className="dl-gloss">{c.gloss}</span>
          <span className={`dl-pill s-${demoStatus(i)}`}>{demoStatus(i)}</span>
        </div>
      ))}
    </div>
  )
}
