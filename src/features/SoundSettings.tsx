import { useState } from 'react'
import {
  getTapSoundChoice,
  playTapSound,
  setTapSoundChoice,
  SOUND_CHOICES,
  type SoundChoice,
} from '../audio/tapSound'
import { useStrings, type UiLanguage } from '../text/i18n'

/**
 * スピーカーのアイコン。絵文字（🔊/🔇）は OS ごとに色も形も変わり、周りの単色の
 * フッター文字から浮くので、currentColor で描く SVG にしている。
 * muted のときは波の代わりに × を出す（音が「消えている」ことが形で分かる）。
 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      className="sound-settings-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6.4h2.3L8.7 3.5v9L5.3 9.6H3z" fill="currentColor" />
      {muted ? (
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
          <path d="M10.9 6.3l3 3.4M13.9 6.3l-3 3.4" />
        </g>
      ) : (
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
          <path d="M10.7 6.2a2.9 2.9 0 0 1 0 3.6" />
          <path d="M12.7 4.6a5.4 5.4 0 0 1 0 6.8" />
        </g>
      )}
    </svg>
  )
}

/**
 * 採点ボタンの確認音を選ぶプルダウン（無音も選択肢に含む）。選ぶと即プレビュー再生する
 * ので、聴き比べてそのまま決められる（'off' はプレビューも無音＝選んだ結果が体感できる）。
 * ThemeToggle と同じく localStorage に自己完結で永続化し、StudyGrid/FocusSheet 側は
 * playTapSound() を引数無しで呼ぶだけで最新の選択を読みに行く。
 */
export function SoundSettings({ uiLanguage }: { uiLanguage: UiLanguage }) {
  const t = useStrings(uiLanguage)
  const [choice, setChoice] = useState<SoundChoice>(getTapSoundChoice)

  const soundLabel: Record<SoundChoice, string> = {
    chime: t.soundChime,
    pop: t.soundPop,
    marimba: t.soundMarimba,
    bell: t.soundBell,
    none: t.soundOff,
  }

  const handleChange = (next: SoundChoice) => {
    setChoice(next)
    setTapSoundChoice(next)
    playTapSound(next)
  }

  return (
    <label className="link sound-settings" title={t.tapSoundLabel}>
      <SpeakerIcon muted={choice === 'none'} />
      <select
        className="sound-settings-select"
        aria-label={t.tapSoundLabel}
        value={choice}
        onChange={(e) => handleChange(e.target.value as SoundChoice)}
      >
        {SOUND_CHOICES.map((c) => (
          <option key={c} value={c}>
            {soundLabel[c]}
          </option>
        ))}
      </select>
    </label>
  )
}
