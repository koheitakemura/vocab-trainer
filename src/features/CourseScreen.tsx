import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, VocabCard } from '../types'
import type { ReviewGrade } from '../srs/scheduler'
import { db, emptyByGrade } from '../store/db'
import { ensureSummary, estimatedVocab, exportProgress, importProgress, localDate } from '../store/progress'
import { safeGet, safeSet } from '../store/safeStorage'
import { coverageAt } from '../data/coverage'
import { fmtNum } from '../text/format'
import { StudyGrid } from './study/StudyGrid'
import { AllWords } from './browse/AllWords'
import { StatsPanel } from './stats/StatsPanel'
import { ThemeToggle } from '../theme/ThemeToggle'
import { Credits } from './Credits'
import { SparkleOverlay, type BurstSpec } from './SparkleOverlay'
import { MeterBreakdown } from './MeterBreakdown'
import { MilestoneChip } from './MilestoneChip'
import { MilestoneOverlay } from './MilestoneOverlay'

type Tab = 'study' | 'all' | 'stats'

const EMPTY_BY_GRADE: Record<ReviewGrade, number> = emptyByGrade()

export function CourseScreen({ course, cards }: { course: Course; cards: VocabCard[] }) {
  const [tab, setTab] = useState<Tab>('study')
  const fileRef = useRef<HTMLInputElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const [bursts, setBursts] = useState<BurstSpec[]>([])
  const [popNonce, setPopNonce] = useState(0)
  const nextBurstId = useRef(0)
  const [overlayMilestone, setOverlayMilestone] = useState<number | null>(null)

  // メーターはコース別サマリ1行だけを読む（recordReview が増分更新）。
  // 旧実装は採点のたびに courseId の全 progress 行をスキャンしており、3万語スケールで破綻する構造だった。
  // サマリ行はストア層の不変条件として常に存在する（移行/復元/リセットが必ず書く）。
  // 無い場合はゼロ表示のまま ensureSummary（下の effect）が自己修復し、put で liveQuery が再発火する。
  // 既定値を渡さない＝undefined はロード中の意味（マイルストーン判定が偽の0を初期値と誤認しないため）。
  const started = useLiveQuery(async () => {
    const s = await db.summary.get(course.id)
    return s
      ? { introduced: s.introduced, byGrade: s.byGrade, burned: s.burned ?? 0 }
      : { introduced: 0, byGrade: emptyByGrade(), burned: 0 }
  }, [course.id])
  useEffect(() => {
    void ensureSummary(course.id)
  }, [course.id])

  const introduced = started?.introduced ?? 0
  const byGrade = started?.byGrade ?? EMPTY_BY_GRADE
  const burned = started?.burned ?? 0
  const total = cards.length
  // 目標が感じられるよう 500 語ごとに目盛りを打つ（総数ちょうどの位置は末尾と被るので除外）。
  const milestones: number[] = []
  for (let m = 500; m < total; m += 500) milestones.push(m)

  // ── A: 推定語彙数（retrievability 合計）。マウント時に1回スキャンし、以後は採点の deltaR で O(1) 追従。
  //    復元・リセット後は estNonce を進めてベースラインを取り直す。
  const [estBase, setEstBase] = useState<number | null>(null)
  const [estDelta, setEstDelta] = useState(0)
  const [estNonce, setEstNonce] = useState(0)
  useEffect(() => {
    let active = true
    setEstBase(null)
    setEstDelta(0)
    void estimatedVocab(course.id).then((v) => {
      if (active) setEstBase(v)
    })
    return () => {
      active = false
    }
  }, [course.id, estNonce])
  const estKnown = estBase === null ? null : Math.max(0, Math.round(estBase + estDelta))
  const handleReviewed = useCallback((deltaR: number) => setEstDelta((x) => x + deltaR), [])

  // ── B: 500語目盛りの跨ぎ検出（初回ロード・復元/リセット直後は無音で同期し、演出の連発を防ぐ）。
  const introducedRef = useRef<number | null>(null)
  const suppressMilestoneRef = useRef(false)
  useEffect(() => {
    if (started === undefined) return
    const cur = started.introduced
    const prev = introducedRef.current
    introducedRef.current = cur
    const crossed = Math.floor(cur / 500)
    const key = `vt:lastMilestone:${course.id}`
    const stored = Number(safeGet(key) ?? 'NaN')
    if (prev === null || suppressMilestoneRef.current || Number.isNaN(stored)) {
      suppressMilestoneRef.current = false
      safeSet(key, String(crossed))
      return
    }
    if (crossed > stored && cur > prev) {
      safeSet(key, String(crossed))
      const m = crossed * 500
      fireTickBurst(m)
      if (m % 1000 === 0) setOverlayMilestone(m)
    } else if (crossed < stored) {
      safeSet(key, String(crossed))
    }
    // 全語開始（コース完了）は 500 刻みと別に一度だけ祝う
    if (prev !== null && prev < total && cur >= total && total > 0) setOverlayMilestone(total)
  }, [started, course.id, total])

  /** 跨いだ目盛りへ金色スパークルを撃つ（目盛りが無い節目はヘッダーの数字へ） */
  const fireTickBurst = (m: number) => {
    const tick = document.querySelector(`.progress-tick[data-m="${m}"]`)
    const rect = (tick ?? meterRef.current)?.getBoundingClientRect()
    if (!rect) return
    nextBurstId.current += 1
    setBursts((bs) => [...bs, { id: nextBurstId.current, sourceRect: rect, targetRect: rect, gold: true }])
  }

  // カード（StudyGrid のさらに奥、別 DOM subtree）からヘッダーの数字へ飛ぶ演出。
  // ヘッダーの座標を知っているのはここだけなので、portal もここが管理する。
  const handleWordStarted = useCallback((sourceRect: DOMRect, gold?: boolean) => {
    const targetRect = meterRef.current?.getBoundingClientRect()
    if (!targetRect) return
    nextBurstId.current += 1
    setBursts((bs) => [...bs, { id: nextBurstId.current, sourceRect, targetRect, gold }])
  }, [])
  const handleBurstArrive = useCallback(() => setPopNonce((n) => n + 1), [])
  const handleBurstDone = useCallback((id: number) => setBursts((bs) => bs.filter((b) => b.id !== id)), [])

  // ── E: バックアップの番人。最終バックアップ以降のレビュー数を dailyStats から導出（数百行の小テーブル）。
  const backupInfo = useLiveQuery(async () => {
    const [metaRow, stats] = await Promise.all([
      db.meta.get('lastBackupAt'),
      db.dailyStats.where('courseId').equals(course.id).toArray(),
    ])
    const last = typeof metaRow?.value === 'string' ? metaRow.value : null
    // 同日のバックアップ後レビューを漏らさない側（過大寄り＝安全側）に倒す
    const lastDay = last ? localDate(new Date(last)) : null
    let unsaved = 0
    for (const s of stats) if (!lastDay || s.date >= lastDay) unsaved += s.reviews
    const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity
    return { unsaved, neverBacked: !last, days }
  }, [course.id])
  const showBackupBadge =
    !!backupInfo &&
    backupInfo.unsaved > 0 &&
    (backupInfo.neverBacked ? backupInfo.unsaved >= 30 : backupInfo.unsaved >= 100 || backupInfo.days >= 14)

  const onExport = async () => {
    const json = await exportProgress()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vocab-progress-${course.id}-${localDate(new Date()).replace(/-/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
    await db.meta.put({ key: 'lastBackupAt', value: new Date().toISOString() })
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    suppressMilestoneRef.current = true // 復元で introduced が跳んでも演出を連発しない
    const n = await importProgress(await file.text())
    e.target.value = ''
    setEstNonce((x) => x + 1) // 推定語彙数のベースラインを取り直す
    // 復元は全置換。学習済み行だけを数える（v1 バックアップの未着手行はカウントしない）
    window.alert(`Restore complete — ${n} studied card(s).`)
  }

  const handleProgressReset = useCallback(() => {
    suppressMilestoneRef.current = true
    setEstNonce((x) => x + 1)
  }, [])

  const segs = [
    { key: 'mastered', n: burned },
    { key: 'known', n: byGrade.good + byGrade.easy },
    { key: 'fuzzy', n: byGrade.hard },
    { key: 'learning', n: byGrade.again },
  ]

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
          <MeterBreakdown counts={byGrade} burned={burned} />
          {estKnown !== null && introduced > 0 && (
            <div className="meter-est" title="Estimated recall right now, from the FSRS memory model (sum of per-word retrievability). Conversation coverage is an approximate, corpus-based figure.">
              ≈{fmtNum(estKnown)} in memory · ~{coverageAt(estKnown)}% of everyday conversation
            </div>
          )}
        </div>
      </header>

      <div className="progress" aria-hidden="true">
        <div className="progress-track">
          <div className="progress-stack">
            {segs.map(
              (s) =>
                s.n > 0 && (
                  <span
                    key={s.key}
                    className={`progress-seg progress-seg--${s.key}`}
                    style={{ width: `${(s.n / total) * 100}%` }}
                  />
                ),
            )}
          </div>
          {milestones.map((m) => (
            <span
              key={m}
              data-m={m}
              className={`progress-tick${m <= introduced ? ' passed' : ''}`}
              style={{ left: `${(m / total) * 100}%` }}
            />
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
      {/* チップは情報テキストなので aria-hidden の飾りバーの外に置く（スクリーンリーダーにも読ませる） */}
      <MilestoneChip introduced={introduced} total={total} />

      <nav className="tabs">
        <button className={`tab${tab === 'study' ? ' on' : ''}`} onClick={() => setTab('study')}>
          Study
        </button>
        <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
          All words <span className="tab-count">{total}</span>
        </button>
        <button className={`tab${tab === 'stats' ? ' on' : ''}`} onClick={() => setTab('stats')}>
          Stats
        </button>
      </nav>

      <main className="course-main">
        {tab === 'study' ? (
          <StudyGrid
            cards={cards}
            onWordStarted={handleWordStarted}
            onReviewed={handleReviewed}
            onProgressReset={handleProgressReset}
            onBackup={onExport}
          />
        ) : tab === 'all' ? (
          <AllWords cards={cards} />
        ) : (
          <StatsPanel course={course} cards={cards} />
        )}
      </main>

      {createPortal(
        <SparkleOverlay bursts={bursts} onArrive={handleBurstArrive} onDone={handleBurstDone} />,
        document.body,
      )}
      {overlayMilestone !== null && (
        <MilestoneOverlay milestone={overlayMilestone} total={total} onClose={() => setOverlayMilestone(null)} />
      )}

      <footer className="statusbar">
        <div className="session-info">
          <ThemeToggle />
          <Credits />
        </div>
        <div className="actions">
          <button className="link" onClick={onExport} title="Download your progress as a JSON file">
            ⭳ Backup
            {showBackupBadge && backupInfo && <span className="backup-badge">{backupInfo.unsaved} unsaved</span>}
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
