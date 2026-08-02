import { useState } from 'react'
import { BOARD_SIZES, getBoardSize, setBoardSize, type BoardSize } from './boardSize'
import { useStrings, type UiLanguage } from '../../text/i18n'
import { CardsIcon } from '../../ui/icons'

/**
 * 1回に画面へ並べるカードの枚数を選ぶプルダウン。
 * SoundSettings と同じ流儀で localStorage に自己完結で永続化し、
 * 変更すると useStudyBoard が盤面を組み直す（再読み込み不要）。
 *
 * 枚数を変えると**採点していないカードは入れ替わる**（新しい枚数で組み直すため）。
 * 採点済みの進捗は当然そのまま残る。
 */
export function BoardSizeSettings({ uiLanguage }: { uiLanguage: UiLanguage }) {
  const t = useStrings(uiLanguage)
  const [size, setSize] = useState<BoardSize>(getBoardSize)

  const handleChange = (next: BoardSize) => {
    setSize(next)
    setBoardSize(next)
  }

  return (
    <label className="link sound-settings" title={t.cardsPerSessionLabel}>
      <CardsIcon />
      <select
        className="sound-settings-select"
        aria-label={t.cardsPerSessionLabel}
        value={size}
        onChange={(e) => handleChange(Number(e.target.value) as BoardSize)}
      >
        {BOARD_SIZES.map((n) => (
          <option key={n} value={n}>
            {t.cardsPerSessionOption(n)}
          </option>
        ))}
      </select>
    </label>
  )
}
