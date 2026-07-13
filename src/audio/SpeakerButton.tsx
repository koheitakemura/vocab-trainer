import { useSpeakButton } from './useSpeakButton'

/** 発音再生ボタン。この端末で日本語音声が使えない場合は何も描画しない。 */
export function SpeakerButton({
  text,
  audioUrl,
  className,
  label = 'Play pronunciation',
}: {
  text: string
  audioUrl?: string
  className?: string
  label?: string
}) {
  const { available, speaking, play } = useSpeakButton(text, audioUrl)
  if (!available) return null

  return (
    <button
      type="button"
      className={`speaker-btn${speaking ? ' speaking' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        play()
      }}
      aria-label={label}
      title={label}
    >
      {speaking ? '🔊' : '🔈'}
    </button>
  )
}
