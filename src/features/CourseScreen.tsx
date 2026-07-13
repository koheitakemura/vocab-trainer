import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, VocabCard } from '../types'
import { db } from '../store/db'
import { exportProgress, importProgress } from '../store/progress'
import { StudyGrid } from './study/StudyGrid'
import { AllWords } from './browse/AllWords'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Credits } from './Credits'
import { AutoplayToggle } from '../audio/AutoplayToggle'

type Tab = 'study' | 'all'

export function CourseScreen({ course, cards }: { course: Course; cards: VocabCard[] }) {
  const [tab, setTab] = useState<Tab>('study')
  const fileRef = useRef<HTMLInputElement>(null)

  const introduced = useLiveQuery(
    () => db.progress.where('courseId').equals(course.id).and((p) => p.status !== 'new').count(),
    [course.id],
    0,
  )
  const total = cards.length
  const pct = total > 0 ? Math.round(((introduced ?? 0) / total) * 100) : 0

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
    window.alert(`Restored ${n} card(s).`)
  }

  return (
    <div className="course-screen">
      <header className="topbar">
        <div className="course">
          <span className="badge">{course.type === 'rail' ? 'RAIL' : course.type.toUpperCase()}</span>
          <h1 className="course-title">{course.title}</h1>
        </div>
        <div className="meter" aria-label="progress">
          <div className="meter-head">
            <span className="meter-num">{introduced ?? 0}</span>
            <span className="meter-den">/ {total}</span>
          </div>
          <div className="meter-label">words started</div>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab${tab === 'study' ? ' on' : ''}`} onClick={() => setTab('study')}>
          Study
        </button>
        <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
          All words <span className="tab-count">{total}</span>
        </button>
      </nav>

      <main className="course-main">{tab === 'study' ? <StudyGrid cards={cards} /> : <AllWords cards={cards} />}</main>

      <footer className="statusbar">
        <div className="session-info">
          <ThemeToggle />
          <AutoplayToggle />
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
