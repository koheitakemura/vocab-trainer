import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { coverageAt } from '../data/coverage'
import { useStrings, type UiLanguage } from '../text/i18n'

/**
 * 1,000語・2,000語・全語到達の大節目だけに出す全画面ワンショット演出（約3秒・タップで即解除）。
 * 被覆率メッセージで「語数」を「聞こえる世界の割合」に翻訳し、直後に次の里程標を提示して
 * 達成後の失速（post-reward reset）を橋渡しする。演出は CSS のみ・常駐アニメなし。
 */
export function MilestoneOverlay({
  milestone,
  total,
  onClose,
  uiLanguage,
}: {
  milestone: number
  total: number
  onClose: () => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  useEffect(() => {
    const timer = setTimeout(onClose, 3200)
    return () => clearTimeout(timer)
  }, [onClose])
  const next = milestone >= total ? null : Math.min(milestone + 500, total)
  return createPortal(
    <div className="milestone-overlay" onClick={onClose} role="presentation">
      <div className="milestone-card">
        <div className="milestone-big">{t.milestoneBig(milestone)}</div>
        <div className="milestone-sub">{t.milestoneSub(coverageAt(milestone))}</div>
        {next && <div className="milestone-next">{t.milestoneNext(next)}</div>}
      </div>
    </div>,
    document.body,
  )
}
