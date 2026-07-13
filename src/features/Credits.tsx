import { useState } from 'react'

/**
 * データ出典クレジット。EDRDG（JMdict）・Tatoeba（CC BY 2.0 FR）は利用規約上、
 * 出典の明記とライセンスページへのリンクが必須（PLAN.md §5.4）。
 */
export function Credits() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>
        Credits
      </button>
      {open && (
        <div className="credits-overlay" onClick={() => setOpen(false)}>
          <div className="credits-box" onClick={(e) => e.stopPropagation()}>
            <h2>Data credits</h2>
            <p>
              This site/software uses the JMdict/EDICT dictionary files. These files are the property of the
              Electronic Dictionary Research and Development Group, and are used in conformance with the
              Group&apos;s licence.{' '}
              <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">
                EDRDG licence
              </a>
            </p>
            <p>
              Example sentences from{' '}
              <a href="https://tatoeba.org" target="_blank" rel="noreferrer">
                Tatoeba.org
              </a>
              , licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noreferrer">
                CC BY 2.0 FR
              </a>
              .
            </p>
            <p>
              JLPT vocabulary list derived from{' '}
              <a href="https://www.tanos.co.uk/jlpt/" target="_blank" rel="noreferrer">
                tanos.co.uk
              </a>{' '}
              (Jonathan Waller, CC BY), via{' '}
              <a href="https://github.com/Bluskyo/JLPT_Vocabulary" target="_blank" rel="noreferrer">
                Bluskyo/JLPT_Vocabulary
              </a>
              .
            </p>
            <p>
              Word frequency ordering from{' '}
              <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">
                wordfreq
              </a>{' '}
              (MIT).
            </p>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
