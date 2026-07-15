import { useState } from 'react'
import type { CourseSource } from '../types'
import { useStrings, type UiLanguage } from '../text/i18n'

/**
 * データ出典クレジット。EDRDG（JMdict）・Tatoeba（CC BY 2.0 FR）等、コースが使う
 * データソースのライセンス条項は出典の明記とライセンスページへのリンクを要求する
 * ものが多い。表示内容はコースの meta.json（course.sources）から渡される
 * （PLAN.md §5.4／固定の出典ハードコードはコース非依存にならないため廃止）。
 * 出典名・note・ライセンス表記そのもの（s.name/s.note/s.license）は翻訳しない
 * （表示義務のある原文をそのまま出す）。ボタン等のチロムだけ uiLanguage で切り替える。
 */
export function Credits({ sources, uiLanguage }: { sources?: CourseSource[]; uiLanguage: UiLanguage }) {
  const t = useStrings(uiLanguage)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>
        {t.creditsButton}
      </button>
      {open && (
        <div className="credits-overlay" onClick={() => setOpen(false)}>
          <div className="credits-box" onClick={(e) => e.stopPropagation()}>
            <h2>{t.dataCredits}</h2>
            {sources && sources.length > 0 ? (
              sources.map((s) => (
                <p key={s.name}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                  {s.note ? ` — ${s.note}` : ''} {t.sourceLicenseLabel}{' '}
                  {s.licenseUrl ? (
                    <a href={s.licenseUrl} target="_blank" rel="noreferrer">
                      {s.license}
                    </a>
                  ) : (
                    s.license
                  )}
                  .
                </p>
              ))
            ) : (
              <p>{t.noSourcesYet}</p>
            )}
            <button className="btn ghost" onClick={() => setOpen(false)}>
              {t.close}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
