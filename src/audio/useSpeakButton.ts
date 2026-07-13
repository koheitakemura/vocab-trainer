import { useCallback, useEffect, useState } from 'react'
import { isJapaneseAudioAvailable, speakJapanese } from './speak'

/** 1つの再生ボタンぶんの状態（利用可否・再生中フラグ）を管理する */
export function useSpeakButton(text: string, audioUrl?: string) {
  const [available, setAvailable] = useState(!!audioUrl)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    if (audioUrl) {
      setAvailable(true)
      return
    }
    let active = true
    void isJapaneseAudioAvailable().then((ok) => {
      if (active) setAvailable(ok)
    })
    return () => {
      active = false
    }
  }, [audioUrl])

  const play = useCallback(() => {
    setSpeaking(true)
    speakJapanese(text, { audioUrl, onEnd: () => setSpeaking(false) })
  }, [text, audioUrl])

  return { available, speaking, play }
}
