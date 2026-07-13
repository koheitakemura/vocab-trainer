/**
 * 音声再生の一元入口。
 * - VocabCard.audioUrl / Example.audioUrl（ビルド時TTS事前生成の静的ファイル）があれば最優先で再生
 * - 無ければブラウザ内蔵の Web Speech API で代替再生（無料・課金判断不要。品質は劣るが listening-first
 *   設計を今すぐ動かせる。PLAN §3.4 の「かな読みから合成」原則と同じ理由で、漢字ではなく読み（かな）を
 *   渡す — 漢字直読みは誤読のリスクがあるため）
 * 本物の TTS 音声ファイルが用意され次第、呼び出し側は変更不要でファイル優先に切り替わる。
 */

let cachedJaVoice: SpeechSynthesisVoice | null = null
let listenerAttached = false

function pickBest(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ja = voices.filter((v) => v.lang.toLowerCase().startsWith('ja'))
  if (ja.length === 0) return null
  // ローカル音声を優先。リモート音声（例: Chrome の「Google 日本語」）はサーバー到達性に
  // 依存し、環境によっては無音のまま失敗することがあるため、確実に動くローカル優先。
  return ja.find((v) => v.localService) ?? ja[0]
}

// ブラウザの音声リストは非同期に段階的に埋まることがある（初回 getVoices() が
// 一部のリモート音声だけを返し、ローカル音声が後から voiceschanged で追加される等）。
// 一度確定して終わりにせず、リストが更新されるたびに best を取り直す。
function ensureVoiceschangedListener(): void {
  if (listenerAttached || typeof window === 'undefined' || !window.speechSynthesis) return
  listenerAttached = true
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    const better = pickBest(window.speechSynthesis.getVoices())
    if (better) cachedJaVoice = better
  })
}

function resolveJaVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve(null)
  ensureVoiceschangedListener()

  const current = pickBest(window.speechSynthesis.getVoices())
  if (current) {
    cachedJaVoice = current
    return Promise.resolve(current)
  }
  if (cachedJaVoice) return Promise.resolve(cachedJaVoice)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 1500)
    const handler = () => {
      clearTimeout(timeout)
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      cachedJaVoice = pickBest(window.speechSynthesis.getVoices())
      resolve(cachedJaVoice)
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)
  })
}

/** この端末で日本語音声（ファイル再生 or Web Speech）が使えるか、UI 表示判定用に非同期確認 */
export async function isJapaneseAudioAvailable(): Promise<boolean> {
  return (await resolveJaVoice()) !== null
}

/**
 * 日本語テキストを再生する。audioUrl があればそれを、無ければ Web Speech で読み上げる。
 * onEnd は再生完了（またはエラー・利用不可）時に必ず呼ばれる。
 */
export function speakJapanese(text: string, opts: { audioUrl?: string; onEnd?: () => void } = {}): void {
  const { audioUrl, onEnd } = opts
  window.speechSynthesis?.cancel()

  if (audioUrl) {
    const audio = new Audio(audioUrl)
    audio.addEventListener('ended', () => onEnd?.(), { once: true })
    audio.addEventListener('error', () => onEnd?.(), { once: true })
    void audio.play().catch(() => onEnd?.())
    return
  }

  void resolveJaVoice().then((voice) => {
    if (!voice || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    const utter = new SpeechSynthesisUtterance(text)
    utter.voice = voice
    utter.lang = voice.lang
    utter.rate = 0.95
    utter.onend = () => onEnd?.()
    utter.onerror = () => onEnd?.()
    window.speechSynthesis.speak(utter)
  })
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel()
}
