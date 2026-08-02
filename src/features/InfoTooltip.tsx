import { useEffect, useRef, useState, type ReactNode } from 'react'
import { InfoIcon } from '../ui/icons'

/**
 * 「？」アイコン＋説明パネル。マウスは :hover で即座に、タッチ端末はタップで開閉する
 * （タッチでは :hover が「一度触ると張り付く／全く効かない」のどちらかになりがちなので、
 * CSS の :hover とクリックトグルの両方を用意し、どちらでも開けるようにする）。
 *
 * 外側タップで閉じる：開いている間だけ document にリスナーを足す（常時監視しない）。
 */
export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <span className="info-tip" ref={rootRef}>
      <button
        type="button"
        className="info-tip-trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <InfoIcon />
      </button>
      <div className={`info-tip-panel${open ? ' open' : ''}`} role="tooltip">
        {children}
      </div>
    </span>
  )
}
