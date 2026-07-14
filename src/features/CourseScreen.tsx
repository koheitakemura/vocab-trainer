import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, VocabCard } from '../types'
import type { ReviewGrade } from '../srs/scheduler'
import { db, emptyByGrade } from '../store/db'
import { ensureSummary, exportProgress, importProgress } from '../store/progress'
import { StudyGrid } from './study/StudyGrid'
import { AllWords } from './browse/AllWords'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Credits } from './Credits'
import { SparkleOverlay, type BurstSpec } from './SparkleOverlay'
import { MeterBreakdown } from './MeterBreakdown'

type Tab = 'study' | 'all'

const EMPTY_BY_GRADE: Record<ReviewGrade, number> = emptyByGrade()

export function CourseScreen({ course, cards }: { course: Course; cards: VocabCard[] }) {
  const [tab, setTab] = useState<Tab>('study')
  const fileRef = useRef<HTMLInputElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const [bursts, setBursts] = useState<BurstSpec[]>([])
  const [popNonce, setPopNonce] = useState(0)
  const nextBurstId = useRef(0)

  // メーターはコース別サマリ1行だけを読む（recordReview が増分更新）。
  // 旧実装は採点のたびに courseId の全 progress 行をスキャンしており、3万語スケールで破綻する構造だった。
  // サマリ行はストア層の不変条件として常に存在する（移行/復元/リセットが必ず書く）。
  // 無い場合はゼロ表示のまま ensureSummary（下の effect）が自己修復し、put で liveQuery が再発火する
  // ——liveQuery 内で progress 全行を読むフォールバックは置かない（全テーブル購読が残り続けるため）。
  const started = useLiveQuery(
    async () => {
      const s = await db.summary.get(course.id)
      return s ? { introduced: s.introduced, byGrade: s.byGrade } : { introduced: 0, byGrade: emptyByGrade() }
    },
    [course.id],
    { introduced: 0, byGrade: EMPTY_BY_GRADE },
  )
  useEffect(() => {
    void ensureSummary(course.id)
  }, [course.id])
  const introduced = started.introduced
  const total = cards.length
  const pct = total > 0 ? Math.round((introduced / total) * 100) : 0
  // 目標が感じられるよう 500 語ごとに目盛りを打つ（総数ちょうどの位置は末尾と被るので除外）。
  const milestones: number[] = []
  for (let m = 500; m < total; m += 500) milestones.push(m)

  // カード（StudyGrid のさらに奥、別 DOM subtree）からヘッダーの数字へ飛ぶ演出。
  // ヘッダーの座標を知っているのはここだけなので、portal もここが管理する。
  const handleWordStarted = useCallback((sourceRect: DOMRect) => {
    const targetRect = meterRef.current?.getBoundingClientRect()
    if (!targetRect) return
    nextBurstId.current += 1
    setBursts((bs) => [...bs, { id: nextBurstId.current, sourceRect, targetRect }])
  }, [])
  const handleBurstArrive = useCallback(() => setPopNonce((n) => n + 1), [])
  const handleBurstDone = useCallback((id: number) => setBursts((bs) => bs.filter((b) => b.id !== id)), [])

  const onExport = async () => {
    const json = await exportProgress()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vocab-progress-${course.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const n = await importProgress(await file.text())
    e.target.value = ''
    // 復元は全置換。学習済み行だけを数える（v1 バックアップの未着手行はカウントしない）
    window.alert(`Restore complete — ${n} studied card(s).`)
  }

  return (
    <div className="course-screen">
      <header className="topbar">
        <div className="course">
          <span className="badge">{course.type === 'rail' ? 'RAIL' : course.type.toUpperCase()}</span>
          <h1 className="course-title">{course.title}</h1>
        </div>
        <div className="meter" aria-label="progress" ref={meterRef}>
          <div className="meter-head">
            <span key={popNonce} className={`meter-num${popNonce ? ' pop' : ''}`}>
              {introduced}
            </span>
            <span className="meter-den">/ {total}</span>
          </div>
          <div className="meter-label">words started</div>
          <MeterBreakdown counts={started.byGrade} />
        </div>
      </header>

      <div className="progress" aria-hidden="true">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
          {milestones.map((m) => (
            <span key={m} className="progress-tick" style={{ left: `${(m / total) * 100}%` }} />
          ))}
        </div>
        <div className="progress-scale">
          {milestones.map((m) => (
            <span key={m} className="progress-scale-mark" style={{ left: `${(m / total) * 100}%` }}>
              {m < 1000 ? m : `${m / 1000}k`}
            </span>
          ))}
        </div>
      </div>

      <nav className="tabs">
        <button className={`tab${tab === 'study' ? ' on' : ''}`} onClick={() => setTab('study')}>
          Study
        </button>
        <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
          All words <span className="tab-count">{total}</span>
        </button>
      </nav>

      <main className="course-main">
        {tab === 'study' ? <StudyGrid cards={cards} onWordStarted={handleWordStarted} /> : <AllWords cards={cards} />}
      </main>

      {createPortal(
        <SparkleOverlay bursts={bursts} onArrive={handleBurstArrive} onDone={handleBurstDone} />,
        document.body,
      )}

      <footer className="statusbar">
        <div className="session-info">
          <ThemeToggle />
          <Credits />
        </div>
        <div className="actions">
          <button className="link" onClick={onExport} title="Download your progress as a JSON file">
            ⭳ Backup
          </button>
          <button className="link" onClick={() => fileRef.current?.click()} title="Restore progress from a JSON file">
            ⭱ Restore
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
      </footer>
    </div>
  )
}
