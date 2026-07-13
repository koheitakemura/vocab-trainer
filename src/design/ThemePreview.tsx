/**
 * カラートーン比較用の静的プレビュー（Study 画面の代表的な断片）。
 * 既存クラス（.tile / .meter / .btn 等）をそのまま使い、テーマは親の CSS 変数で切り替える。
 */
export function ThemePreview() {
  return (
    <div className="tp">
      <div className="topbar">
        <div className="course">
          <span className="badge">RAIL</span>
          <h1 className="course-title">Japanese 0 → 3,000</h1>
        </div>
        <div className="meter">
          <div className="meter-head">
            <span className="meter-num">8</span>
            <span className="meter-den">/ 50</span>
          </div>
          <div className="meter-label">words started</div>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: '16%' }} />
          </div>
        </div>
      </div>

      <div className="tabs">
        <button className="tab on">Study</button>
        <button className="tab">
          All words <span className="tab-count">50</span>
        </button>
      </div>

      <div className="board tp-board">
        <div className="tile s-done">
          <span className="tile-dot" />
          <div className="tile-hw">水</div>
          <div className="tile-gloss done">water</div>
        </div>
        <div className="tile s-done">
          <span className="tile-dot" />
          <div className="tile-hw">火</div>
          <div className="tile-gloss done">fire</div>
        </div>
        <div className="tile s-again">
          <span className="tile-dot" />
          <div className="tile-hw">山</div>
        </div>
        <div className="tile active revealed">
          <span className="tile-dot" />
          <div className="tile-hw sm">川</div>
          <div className="tile-reading">かわ</div>
          <div className="tile-gloss">river</div>
          <div className="tile-grade">
            <button className="btn again">Again</button>
            <button className="btn good">Good</button>
          </div>
        </div>
        <div className="tile">
          <span className="tile-dot" />
          <div className="tile-hw">空</div>
        </div>
        <div className="tile">
          <span className="tile-dot" />
          <div className="tile-hw">海</div>
        </div>
        <div className="tile">
          <span className="tile-dot" />
          <div className="tile-hw">人</div>
        </div>
        <div className="tile">
          <span className="tile-dot" />
          <div className="tile-hw">本</div>
        </div>
      </div>
    </div>
  )
}
