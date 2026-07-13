import { useEffect, useState } from 'react'
import { getAutoplayPref, setAutoplayPref } from './audioPrefs'

/** 新規カードの自動発音を on/off する（オフィスで音を出したくない場合など）。 */
export function AutoplayToggle() {
  const [on, setOn] = useState(getAutoplayPref)

  useEffect(() => {
    setAutoplayPref(on)
  }, [on])

  return (
    <button className="link" onClick={() => setOn((v) => !v)} title="Toggle audio autoplay for new cards">
      {on ? '🔊 Auto' : '🔇 Auto'}
    </button>
  )
}
