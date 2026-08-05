import { useState } from 'react'
import type { Course, CourseId, VocabCard } from '../../types'
import type { CourseListing } from '../../data/courseRegistry'
import { CoursePicker } from '../CoursePicker'
import { headwordFitClass } from '../study/headwordFit'
import { useStrings } from '../../text/i18n'
import { CourseRequestRejected, requestCourseAccess } from '../../store/courseRequests'
import './preview.css'

/**
 * 未割当コースのプレビュー画面。読み取り専用——採点ボタンも Dexie への書き込みも一切無い。
 * 先頭カードのサンプル（App.tsx が repository.getCardsPreview で既に絞り込み済み）を見せて、
 * 気に入ったら「利用をリクエストする」を送るだけの UI。
 * ヘッダーは CourseScreen.tsx と同じ CoursePicker を共有し、見た目の一貫性を保つ。
 */
export function CoursePreviewScreen({
  course,
  cards,
  allCourses,
  allowedIds,
  onSelectCourse,
}: {
  course: Course
  cards: VocabCard[]
  allCourses: CourseListing[]
  allowedIds: Set<CourseId>
  onSelectCourse: (id: CourseId) => void
}) {
  const t = useStrings(course.uiLanguage)
  const [status, setStatus] = useState<'idle' | 'busy' | 'sent' | 'already-requested' | 'already-granted' | 'error'>(
    'idle',
  )
  const [message, setMessage] = useState('')

  const request = async () => {
    setStatus('busy')
    try {
      const result = await requestCourseAccess(course.id)
      setStatus(result)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof CourseRequestRejected ? err.message : String(err))
    }
  }

  const resolved = status === 'sent' || status === 'already-requested' || status === 'already-granted'

  return (
    <div className="course-screen preview-screen">
      <header className="topbar">
        <div className="course">
          <CoursePicker course={course} allCourses={allCourses} allowedIds={allowedIds} onSelectCourse={onSelectCourse} />
        </div>
      </header>
      <div className="preview-body">
        <p className="preview-intro">{t.previewIntro}</p>
        <p className="preview-count">{t.previewCardCount(cards.length)}</p>
        <div className="board">
          {cards.map((c) => (
            <PreviewTile key={c.id} card={c} isPhrase={course.type === 'phrase'} />
          ))}
        </div>
        <div className="preview-cta">
          {resolved ? (
            <p className="preview-result">
              {status === 'sent' && t.previewRequestSent}
              {status === 'already-requested' && t.previewAlreadyRequested}
              {status === 'already-granted' && t.previewAlreadyGranted}
            </p>
          ) : (
            <>
              <button type="button" className="btn primary" disabled={status === 'busy'} onClick={() => void request()}>
                {status === 'busy' ? t.previewRequesting : t.previewRequestButton}
              </button>
              {status === 'error' && <p className="preview-result error">{t.previewRequestFailed(message)}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * クリックで裏面（訳・例文）を表示するだけの読み取り専用タイル。
 * StudyGrid.tsx の Tile と違い、採点ボタン・TileMark・Dexie 書き込みは一切持たない
 * ——CSS クラス（.tile 系）だけ共有して見た目を揃える。
 */
function PreviewTile({ card, isPhrase }: { card: VocabCard; isPhrase: boolean }) {
  const [flipped, setFlipped] = useState(false)
  const example = card.examples[0]

  return (
    <div className={`tile${flipped ? ' revealed' : ''}${isPhrase ? ' phrase' : ''}`}>
      <div
        className="tile-content"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label={card.headword}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setFlipped((f) => !f)
        }}
      >
        {flipped ? (
          <>
            <div className={`tile-hw sm${headwordFitClass(card.headword)}`}>{card.headword}</div>
            {card.reading && (
              <span className="tile-reading">
                {card.reading}
                {card.ipa && <span className="tile-ipa"> {card.ipa}</span>}
              </span>
            )}
            <div className="tile-back">
              <div className="tile-gloss">{card.gloss}</div>
              {example && (
                <div className="tile-example">
                  <div className="tile-example-src">{example.text}</div>
                  <div className="tile-example-tr">{example.translation}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={`tile-hw${headwordFitClass(card.headword)}`}>{card.headword}</div>
        )}
      </div>
    </div>
  )
}
