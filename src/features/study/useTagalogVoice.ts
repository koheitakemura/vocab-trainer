import { useEffect, useState } from 'react'
import { getTagalogVoice } from '../../audio/tts'

/** この端末でタガログ語の音声合成が使えるか。無ければ null（呼び出し側は再生ボタンを出さない）。 */
export function useTagalogVoice(): SpeechSynthesisVoice | null {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    let active = true
    void getTagalogVoice().then((v) => {
      if (active) setVoice(v)
    })
    return () => {
      active = false
    }
  }, [])

  return voice
}
