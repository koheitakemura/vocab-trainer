import { safeGet, safeSet } from '../store/safeStorage'

/**
 * 採点ボタン押下時の確認音（合成音・アセット無し）。
 * AudioContext はユーザー操作（クリック）内で初回生成するためオートプレイ制限に掛からない。
 */
type AudioContextCtor = new () => AudioContext

export type SoundChoice = 'chime' | 'pop' | 'marimba' | 'bell' | 'none'

/** 設定 UI がこの順で選択肢を並べる（'none' ＝無音を末尾に）。 */
export const SOUND_CHOICES: SoundChoice[] = ['chime', 'pop', 'marimba', 'bell', 'none']

const DEFAULT_CHOICE: SoundChoice = 'chime'
const STORAGE_KEY = 'vocab-tap-sound'

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as
      | AudioContextCtor
      | undefined
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(
  audioCtx: AudioContext,
  start: number,
  {
    type = 'sine' as OscillatorType,
    freq,
    freqTo,
    peak,
    duration,
    filterFreq,
  }: {
    type?: OscillatorType
    freq: number
    freqTo?: number
    peak: number
    duration: number
    filterFreq?: number
  },
) {
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo, start + duration * 0.6)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, duration * 0.2))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  let node: AudioNode = gain
  if (filterFreq) {
    const filter = audioCtx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFreq
    gain.connect(filter)
    node = filter
  }
  osc.connect(gain)
  node.connect(audioCtx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

const SOUND_BUILDERS: Record<Exclude<SoundChoice, 'none'>, (audioCtx: AudioContext, now: number) => void> = {
  // 短い上昇トーン（既定）。
  chime: (audioCtx, now) => tone(audioCtx, now, { freq: 660, freqTo: 880, peak: 0.18, duration: 0.18 }),
  // 柔らかく短い「ポン」。
  pop: (audioCtx, now) => tone(audioCtx, now, { type: 'triangle', freq: 500, freqTo: 360, peak: 0.22, duration: 0.09 }),
  // 木琴風（フィルターで丸めた低めの音・減衰長め）。
  marimba: (audioCtx, now) => {
    tone(audioCtx, now, { type: 'sine', freq: 523.25, peak: 0.2, duration: 0.26, filterFreq: 1800 })
    tone(audioCtx, now, { type: 'sine', freq: 523.25 * 2.4, peak: 0.05, duration: 0.16, filterFreq: 2200 })
  },
  // 明るいベル（2音のきらめき）。
  bell: (audioCtx, now) => {
    tone(audioCtx, now, { type: 'triangle', freq: 784, peak: 0.14, duration: 0.16 })
    tone(audioCtx, now + 0.05, { type: 'triangle', freq: 987.77, peak: 0.14, duration: 0.2 })
  },
}

export function getTapSoundChoice(): SoundChoice {
  const saved = safeGet(STORAGE_KEY)
  if (saved && (SOUND_CHOICES as string[]).includes(saved)) return saved as SoundChoice
  return DEFAULT_CHOICE
}

export function setTapSoundChoice(choice: SoundChoice) {
  safeSet(STORAGE_KEY, choice)
}

/** choice を渡さなければ localStorage に保存済みの選択（既定は 'chime'）を鳴らす。設定 UI のプレビュー用に choice を渡せる。 */
export function playTapSound(choice: SoundChoice = getTapSoundChoice()) {
  if (choice === 'none') return
  const audioCtx = getContext()
  if (!audioCtx) return
  SOUND_BUILDERS[choice](audioCtx, audioCtx.currentTime)
}
