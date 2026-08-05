/**
 * フレーズコース（tl-phrases-daily）専用の音声読み上げ。
 * ブラウザ内蔵の Web Speech API (SpeechSynthesis) を使う——追加インフラ・APIキー・
 * 音声ファイルの事前生成が不要。タガログ語（tl- または fil- 系）の音声は端末によって
 * 無いことが多いため、実際に見つかった場合だけ呼び出し側が再生ボタンを出す設計にする
 * （見つからない端末で「押しても鳴らないボタン」を出さない。useTagalogVoice フックを参照）。
 */

let cachedVoices: SpeechSynthesisVoice[] | null = null
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve([])
  if (cachedVoices) return Promise.resolve(cachedVoices)
  if (voicesPromise) return voicesPromise

  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis
    const existing = synth.getVoices()
    if (existing.length > 0) {
      cachedVoices = existing
      resolve(existing)
      return
    }
    // 多くのブラウザは音声リストの読み込みが非同期（初回は空配列を返す）。
    const onVoicesChanged = () => {
      const voices = synth.getVoices()
      cachedVoices = voices
      synth.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(voices)
    }
    synth.addEventListener('voiceschanged', onVoicesChanged)
    // voiceschanged を発火しない実装への保険（1秒待って一度だけ再確認）。
    setTimeout(() => {
      if (cachedVoices) return
      const voices = synth.getVoices()
      cachedVoices = voices
      synth.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(voices)
    }, 1000)
  })
  return voicesPromise
}

// BCP47コードの完全な言語部分だけを見る（末尾がハイフンか文字列終端であることを要求）。
// 前方一致だけだと tlh（クリンゴン語）が tl の誤マッチになる。
const TAGALOG_LANG_RE = /^(tl|fil)(-|$)/i

/** タガログ語（tl）・フィリピン語（fil）のいずれかにマッチする音声を1つ探す。 */
export async function getTagalogVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices()
  return voices.find((v) => TAGALOG_LANG_RE.test(v.lang)) ?? null
}

/**
 * 指定した音声でテキストを読み上げる。呼び出し前に getTagalogVoice() で
 * 音声が見つかっていることを確認しておくこと（無音声時に呼んでも何も起きない）。
 */
export function speakTagalog(text: string, voice: SpeechSynthesisVoice): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel() // 前の発話が再生中なら止めてから読み直す
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  utterance.rate = 0.9 // 学習用途のため既定よりやや遅め
  window.speechSynthesis.speak(utterance)
}
