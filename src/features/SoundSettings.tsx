import { useState } from 'react'
import {
  getTapSoundChoice,
  playTapSound,
  setTapSoundChoice,
  SOUND_CHOICES,
  type SoundChoice,
} from '../audio/tapSound'
import { useStrings, type UiLanguage } from '../text/i18n'
import { SpeakerIcon } from '../ui/icons'

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
