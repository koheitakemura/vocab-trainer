import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, CourseId, VocabCard } from '../types'
import type { CourseListing } from '../data/courseRegistry'
import type { ReviewGrade } from '../srs/scheduler'
import { db, emptyByGrade } from '../store/db'
import {
  acknowledgeEpoch,
  checkProgressIntegrity,
  ensureSummary,
  exportProgress,
  importProgress,
  localDate,
  resetCourseProgress,
  vocabSnapshot,
  type ProgressIntegrity,
} from '../store/progress'
import { getCoachSentences, type CoachSentence } from '../data/coachSentences'
import {
  checkForServerRestore,
  confirmOfferedRestore,
  reconcileAfterManualImport,
  undoLastRestore,
  uploadSnapshot,
  type RestoreCheckResult,
} from '../store/snapshot'
import { relativeTimeLabel } from '../text/format'
import type { GradeOutcome } from './study/useStudyBoard'
import { safeGet, safeSet } from '../store/safeStorage'
import { courseProgress } from '../data/coverage'
import { StudyGrid } from './study/StudyGrid'
import { AllWords } from './browse/AllWords'
import { StatsPanel } from './stats/StatsPanel'
import { GrowthPanel } from './growth/GrowthPanel'
import { ThemeToggle } from '../theme/ThemeToggle'
import { SoundSettings } from './SoundSettings'
import { BoardSizeSettings } from './study/BoardSizeSettings'
import { Credits } from './Credits'
import { SparkleOverlay, type BurstSpec } from './SparkleOverlay'
import { MeterBreakdown } from './MeterBreakdown'
import { MilestoneChip } from './MilestoneChip'
import { MilestoneOverlay } from './MilestoneOverlay'
import { CategorySelector } from './CategorySelector'
import { AdminEntry } from './admin/AdminEntry'
import { pickCoachMessage } from './coach'
import { useStrings } from '../text/i18n'

type Tab = 'study' | 'all' | 'stats' | 'growth'

const EMPTY_BY_GRADE: Record<ReviewGrade, number> = emptyByGrade()

export function CourseScreen({
  course,
  cards,
  courses,
  onSelectCourse,
}: {
  course: Course
  cards: VocabCard[]
  /** 選択可能なコース一覧（1件だけなら切替UIは出さない） */
  courses: CourseListing[]
  onSelectCourse: (id: CourseId) => void
}) {
  const t = useStrings(course.uiLanguage)
  const [tab, setTab] = useState<Tab>('study')
  // カテゴリー別学習：選択中カテゴリー（null=全体）。盤面に渡す cards をこのレンズで絞る。
  const [category, setCategory] = useState<string | null>(null)
  const studyCards = useMemo(
    () => (category ? cards.filter((c) => c.category === category) : cards),
    [cards, category],
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const [bursts, setBursts] = useState<BurstSpec[]>([])
  const [popNonce, setPopNonce] = useState(0)
  const nextBurstId = useRef(0)
  const [overlayMilestone, setOverlayMilestone] = useState<number | null>(null)
  // 端末内の表示名（アカウント登録ではない。同じURLを別々の端末で使う人を区別するための
  // ローカル専用ラベル。db.meta の汎用キー・バリュー行に載せるだけでスキーマ変更不要）。
  // 登録・変更は管理者画面（別セッションで構築中）からのみ行う——ここは表示専用（読み取りのみ）。
  const displayNameRow = useLiveQuery(() => db.meta.get('displayName'), [])
  const displayName = typeof displayNameRow?.value === 'string' ? displayNameRow.value : null
  // StudyGrid（＝useStudyBoard）内の restart をタブ行のボタンから呼べるように受け取る。
  // StudyGrid がマウント中だけ埋まり、アンマウント（別タブ）で null に戻る。
  const studyRestartRef = useRef<(() => void) | null>(null)
  const exposeStudyRestart = useCallback((fn: (() => void) | null) => {
    studyRestartRef.current = fn
  }, [])

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
  // コースの帯域開始位置（例: ja-10-30k/en-10-30k は 10,000）。目盛り・節目の「表示上の数字」
  // だけをこの分だけ足して見せる（進捗計算・クロス判定・localStorageキー等の内部ロジックは
  // 常にコース内0起点のまま——表示とロジックの基準をずらすとバグの温床になるため）。
  const displayOffset = course.band.from
  // 目標が感じられるよう 1000 語ごとに目盛りを打つ（総数ちょうどの位置は末尾と被るので除外）。
  // 500刻みだと帯つきコース（2万語超）で目盛りラベルが密集し読みにくいため1000に変更
  // （2026-07-30 Kohei指摘）。跨ぎ検出・節目演出（500刻み）は据え置き——ここは表示専用の
  // 目盛り粒度で、data-mが一致しない500刻みの節目はheaderへのフォールバック演出になるだけ。
  const milestones: number[] = []
  for (let m = 1000; m < total; m += 1000) milestones.push(m)

  // ── A: 推定語彙数（retrievability 合計）＋既習語集合。マウント時に1回スキャンし、
  //    以後は採点結果で O(1) 追従。復元・リセット後は estNonce を進めて取り直す。
  const [estBase, setEstBase] = useState<number | null>(null)
  const [estDelta, setEstDelta] = useState(0)
  const [estNonce, setEstNonce] = useState(0)
  const [knownIds, setKnownIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let active = true
    setEstBase(null)
    setEstDelta(0)
    void vocabSnapshot(course.id).then((v) => {
      if (!active) return
      setEstBase(v.estKnown)
      setKnownIds(v.knownIds)
    })
    return () => {
      active = false
    }
  }, [course.id, estNonce])
  const estKnown = estBase === null ? null : Math.max(0, Math.round(estBase + estDelta))
  // コース種別に応じた進捗の意味づけ（1.5.4）。rail(0-3k) は従来どおり会話被覆率%、
  // cloze(3k-10k) は書き言葉被覆率%、calibrate-mine(10k-30k) は語数＋深度の2軸。
  const progress = estKnown === null ? null : courseProgress(course, estKnown)
  const handleReviewed = useCallback((res: GradeOutcome) => {
    setEstDelta((x) => x + res.deltaR)
    // コーチ文の解禁判定用に既習語集合も追従（known になったら追加、外れたら除去）
    setKnownIds((prev) => {
      if (res.known === prev.has(res.cardId)) return prev
      const next = new Set(prev)
      if (res.known) next.add(res.cardId)
      else next.delete(res.cardId)
      return next
    })
  }, [])

  // ── 進捗の健全性（コースを開いたときに1回だけ調べる）。
  // cardId が付け替わった世代の記録は「覚えた」判定が別の単語に付いているので、
  // 黙って使わせず本人に一度だけ選んでもらう（勝手に消さない・気づけない状態にもしない）。
  const [integrity, setIntegrity] = useState<ProgressIntegrity | null>(null)
  useEffect(() => {
    let active = true
    setIntegrity(null)
    const ids = new Set(cards.map((c) => c.id))
    void checkProgressIntegrity(course.id, course.idEpoch ?? 1, ids).then((r) => {
      if (active) setIntegrity(r)
    })
    return () => {
      active = false
    }
  }, [course.id, course.idEpoch, cards])

  const dismissStaleEpoch = useCallback(
    async (reset: boolean) => {
      if (reset) await resetCourseProgress(course.id)
      await acknowledgeEpoch(course.id, course.idEpoch ?? 1)
      setIntegrity((prev) => (prev ? { ...prev, staleEpoch: false, orphans: reset ? 0 : prev.orphans } : prev))
      if (reset) {
        // ヘッダーの推定語彙数・メーターを作り直す（リセット直後の演出は抑止済みの経路に乗せる）
        suppressMilestoneRef.current = true
        setEstNonce((n) => n + 1)
      }
    },
    [course.id, course.idEpoch],
  )

  // ── コーチの日本語文バンク（静的 JSON・1回だけ読み込み）
  const [sentences, setSentences] = useState<CoachSentence[]>([])
  useEffect(() => {
    let active = true
    void getCoachSentences(course.id).then((s) => {
      if (active) setSentences(s)
    })
    return () => {
      active = false
    }
  }, [course.id])

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
    // 全語開始（コース完了）は 500 刻みと別に一度だけ祝う。
    // かなコース(ja-kana)は総数が500語未満で「次の節目=コース完了」に潰れ、
    // coverageAt(=0-3k会話ドメイン専用)由来の被覆率%文言が意味を成さないため対象外にする。
    if (course.type !== 'kana' && prev !== null && prev < total && cur >= total && total > 0)
      setOverlayMilestone(total)
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

  // ── サーバー同期の状態表示。db.meta は snapshot.ts が書くので liveQuery で追従するだけ
  //   （ここではタイマーもfetchも持たない。あくまで「今の状態」を映すだけの受け手）。
  const snapshotStatus = useLiveQuery(async () => {
    const [uploaded, blocked] = await Promise.all([
      db.meta.get('lastSnapshotUploadAt'),
      db.meta.get('snapshotGuardBlockedAt'),
    ])
    return {
      uploadedAt: typeof uploaded?.value === 'string' ? uploaded.value : null,
      blocked: Boolean(blocked?.value),
    }
  })
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false)
  const handleSyncStatusClick = useCallback(async () => {
    if (!snapshotStatus?.blocked || confirmingOverwrite) return
    if (!window.confirm(t.serverSyncBlockedConfirm)) return
    setConfirmingOverwrite(true)
    try {
      await uploadSnapshot(true)
    } finally {
      setConfirmingOverwrite(false)
    }
  }, [snapshotStatus?.blocked, confirmingOverwrite, t])

  // ── 復元（サーバー→この端末）。アプリ起動時に1回だけ判定する（snapshot.ts 側の
  //   モジュール変数がガードしているので、course 切り替えでの再実行やコンポーネント
  //   の再マウントでも二重には走らない）。ローカルに何かある場合は絶対に自動実行しない。
  const [restoreCheck, setRestoreCheck] = useState<RestoreCheckResult | null>(null)
  const [restoring, setRestoring] = useState(false)
  useEffect(() => {
    let active = true
    void checkForServerRestore().then((r) => {
      if (active) setRestoreCheck(r)
    })
    return () => {
      active = false
    }
  }, [])

  const refreshAfterFullReplace = useCallback(() => {
    // importProgress は全置換なので、ヘッダーの推定語彙数・演出抑止も復元直後に作り直す
    // （handleProgressReset と同じ経路——コースを開き直すのに近い状態を1回だけ起こす）
    suppressMilestoneRef.current = true
    setEstNonce((n) => n + 1)
  }, [])

  const handleRestoreOfferConfirm = useCallback(async () => {
    if (restoring) return
    if (!window.confirm(t.restoreConfirmDialog)) return
    setRestoring(true)
    try {
      const n = await confirmOfferedRestore()
      setRestoreCheck(n === null ? null : { kind: 'auto-restored', rows: n })
      if (n !== null) refreshAfterFullReplace()
    } finally {
      setRestoring(false)
    }
  }, [restoring, t, refreshAfterFullReplace])

  const dismissRestoreOffer = useCallback(() => setRestoreCheck(null), [])

  // 自動復元のトーストは非モーダル＝操作をブロックしない。数秒で自動的に消える
  useEffect(() => {
    if (restoreCheck?.kind !== 'auto-restored') return
    const id = window.setTimeout(() => setRestoreCheck(null), 8000)
    return () => window.clearTimeout(id)
  }, [restoreCheck])

  // 「元に戻す」の可否は db.meta.preRestoreStash の有無そのもの（サーバー復元・元に戻す、
  //  どちらの直後でも liveQuery が自動で追従する。専用の state を別に持たない）。
  const undoAvailable = useLiveQuery(async () => Boolean(await db.meta.get('preRestoreStash')))
  const handleUndoRestore = useCallback(async () => {
    if (!window.confirm(t.restoreUndoConfirm)) return
    const n = await undoLastRestore()
    if (n !== null) {
      refreshAfterFullReplace()
      window.alert(t.restoreUndoDone(n))
    }
  }, [t, refreshAfterFullReplace])

  // ── E: バックアップの番人 ＋ コーチ用の活動サマリ。どちらも dailyStats（数百行の小テーブル）
  //    1回のスキャンから導出する（毎採点で再実行されるが行数∝日数なので軽い）。
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

    const now = new Date()
    const today = localDate(now)
    const dowMon = (now.getDay() + 6) % 7 // 0=月 .. 6=日
    const monday = new Date(now)
    monday.setDate(monday.getDate() - dowMon)
    const weekStart = localDate(monday)
    let todayReviews = 0
    let todayNew = 0
    let lastActive: string | null = null
    let activeDaysThisWeek = 0
    for (const s of stats) {
      if (s.reviews <= 0) continue
      if (s.date === today) {
        todayReviews = s.reviews
        todayNew = s.newStarted
      } else if (!lastActive || s.date > lastActive) {
        lastActive = s.date
      }
      if (s.date >= weekStart && s.date <= today) activeDaysThisWeek++
    }
    const gapDays = lastActive
      ? Math.round((new Date(today).getTime() - new Date(lastActive).getTime()) / 86400000)
      : null
    const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity
    return { unsaved, neverBacked: !last, days, todayReviews, todayNew, gapDays, activeDaysThisWeek }
  }, [course.id])

  // ── コーチ・メッセージ（端末内データのみ。状況が変わると入れ替わる）
  const coachMsg = useMemo(
    () =>
      pickCoachMessage({
        now: new Date(),
        introduced,
        total,
        estKnown,
        mastered: burned,
        todayReviews: backupInfo?.todayReviews ?? 0,
        todayNew: backupInfo?.todayNew ?? 0,
        gapDays: backupInfo?.gapDays ?? null,
        activeDaysThisWeek: backupInfo?.activeDaysThisWeek ?? 0,
        knownIds,
        sentences,
        course,
      }),
    [introduced, total, estKnown, burned, backupInfo, knownIds, sentences, course],
  )
  const showBackupBadge =
    !!backupInfo &&
    backupInfo.unsaved > 0 &&
    (backupInfo.neverBacked ? backupInfo.unsaved >= 30 : backupInfo.unsaved >= 100 || backupInfo.days >= 14)

  const onExport = async () => {
    const json = await exportProgress()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    // 表示名があればファイル名に添える（複数人分のバックアップを受け取ったときに区別するため）。
    // 中身側は exportProgress() が db.meta を丸ごと同梱するので displayName も自動で入る。
    const nameSlug = displayName?.trim().toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/gi, '-')
    const a = document.createElement('a')
    a.href = url
    a.download = `vocab-progress-${course.id}${nameSlug ? `-${nameSlug}` : ''}-${localDate(new Date()).replace(/-/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
    await db.meta.put({ key: 'lastBackupAt', value: new Date().toISOString() })
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    suppressMilestoneRef.current = true // 復元で introduced が跳んでも演出を連発しない
    const n = await importProgress(await file.text())
    // サーバー同期のフラグを正直な状態に戻す（snapshot.ts 参照。落とすと「同期済み」を騙るか、
    // 逆に本当は復元できているのに次回チェックがサーバー版を古いと誤判定し続ける）
    await reconcileAfterManualImport()
    e.target.value = ''
    setEstNonce((x) => x + 1) // 推定語彙数のベースラインを取り直す
    // 復元は全置換。学習済み行だけを数える（v1 バックアップの未着手行はカウントしない）
    window.alert(t.restoreComplete(n))
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
          {/* コースが1つしかない間はドロップダウンを出さず見出しのまま（選ぶ意味がないUIを避ける） */}
          {courses.length > 1 ? (
            <select
              className="course-select"
              aria-label={t.selectCourseAria}
              value={course.id}
              onChange={(e) => onSelectCourse(e.target.value as CourseId)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="course-name">{course.title}</h1>
          )}
          {/* 状況に応じて変わるコーチ・メッセージ（すべて端末内のデータから。外部送信なし）。
              日本語文（既習語だけで構成）のときは下に英訳を添える */}
          <div className="coach-block" key={coachMsg.text} aria-live="polite">
            <p className="coach">
              {displayName && t.nameGreetingPrefix(displayName)}
              {coachMsg.text}
            </p>
            {coachMsg.sub && <p className="coach-sub">{coachMsg.sub}</p>}
          </div>
        </div>
        <div className="meter" aria-label={t.meterAria} ref={meterRef}>
          <div className="meter-head">
            <span key={popNonce} className={`meter-num${popNonce ? ' pop' : ''}`}>
              {introduced}
            </span>
            <span className="meter-den">/ {total}</span>
          </div>
          <div className="meter-label">{t.wordsStarted}</div>
          <MeterBreakdown counts={byGrade} burned={burned} uiLanguage={course.uiLanguage} />
          {estKnown !== null && introduced > 0 && progress && (
            <div className="meter-est" title={t.meterEstTitle}>
              {t.meterEst(estKnown, progress)}
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
          {milestones.map((m) => {
            const d = m + displayOffset
            return (
              <span key={m} className="progress-scale-mark" style={{ left: `${(m / total) * 100}%` }}>
                {d < 1000 ? d : `${d / 1000}k`}
              </span>
            )
          })}
        </div>
      </div>
      {/* チップは情報テキストなので aria-hidden の飾りバーの外に置く（スクリーンリーダーにも読ませる） */}
      {/* かなコース(ja-kana)は coverageAt 由来の被覆率%文言が意味を成さないため非表示 */}
      {course.type !== 'kana' && (
        <MilestoneChip introduced={introduced} total={total} displayOffset={displayOffset} uiLanguage={course.uiLanguage} />
      )}

      <nav className="tabs">
        <button className={`tab${tab === 'study' ? ' on' : ''}`} onClick={() => setTab('study')}>
          {t.tabStudy}
        </button>
        <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
          {t.tabAllWords} <span className="tab-count">{total}</span>
        </button>
        <button className={`tab${tab === 'stats' ? ' on' : ''}`} onClick={() => setTab('stats')}>
          {t.tabStats}
        </button>
        <button className={`tab${tab === 'growth' ? ' on' : ''}`} onClick={() => setTab('growth')}>
          {t.tabGrowth}
        </button>
        {tab === 'study' && (
          <div className="tab-tools">
            <CategorySelector cards={cards} selected={category} onSelect={setCategory} uiLanguage={course.uiLanguage} />
            <button
              type="button"
              className="tab-refresh"
              onClick={() => studyRestartRef.current?.()}
              aria-label={t.startAnotherSession}
              title={t.startAnotherSession}
            >
              ↻ <span className="tab-refresh-label">{t.startAnotherSession}</span>
            </button>
          </div>
        )}
      </nav>

      <main className="course-main">
        {/* サーバーに新しい記録がある（＝ローカルに何かある状態での復元提案）。
            自動復元は絶対にしない——上書きされる既存データが実在するため必ず確認を挟む。 */}
        {restoreCheck?.kind === 'offer' && (
          <div className="stale-epoch restore-offer" role="alert">
            <div className="stale-epoch-text">
              <strong>{t.restoreOfferTitle}</strong>
              <p>{t.restoreOfferBody(restoreCheck.totalRows)}</p>
              {restoreCheck.epochMismatch && <p className="hint">{t.restoreOfferEpochWarning}</p>}
            </div>
            <div className="stale-epoch-actions">
              <button type="button" className="btn primary" disabled={restoring} onClick={() => void handleRestoreOfferConfirm()}>
                {t.restoreOfferAction}
              </button>
              <button type="button" className="btn ghost" disabled={restoring} onClick={dismissRestoreOffer}>
                {t.restoreOfferDismiss}
              </button>
            </div>
          </div>
        )}
        {/* 記録が別の単語に付いている疑いがあるコースでだけ、一度だけ出す。
            モーダルにしないのは、誤タップで消える/勝手に進む事故を避けるため
            （選ぶまで残り、どちらを選んでも二度と出ない）。 */}
        {integrity?.staleEpoch && (
          <div className="stale-epoch" role="alert">
            <div className="stale-epoch-text">
              <strong>{t.staleEpochTitle}</strong>
              <p>{t.staleEpochBody(integrity.rows)}</p>
              {integrity.orphans > 0 && <p className="hint">{t.orphanNote(integrity.orphans)}</p>}
            </div>
            <div className="stale-epoch-actions">
              <button type="button" className="btn primary" onClick={() => void dismissStaleEpoch(true)}>
                {t.staleEpochReset}
              </button>
              <button type="button" className="btn ghost" onClick={() => void dismissStaleEpoch(false)}>
                {t.staleEpochKeep}
              </button>
            </div>
          </div>
        )}
        {tab === 'study' ? (
          <StudyGrid
            cards={studyCards}
            courseType={course.type}
            onWordStarted={handleWordStarted}
            onReviewed={handleReviewed}
            onProgressReset={handleProgressReset}
            onBackup={onExport}
            onExposeRestart={exposeStudyRestart}
            uiLanguage={course.uiLanguage}
          />
        ) : tab === 'all' ? (
          <AllWords cards={cards} uiLanguage={course.uiLanguage} />
        ) : tab === 'stats' ? (
          <StatsPanel course={course} cards={cards} />
        ) : (
          <GrowthPanel course={course} />
        )}
      </main>

      {createPortal(
        <SparkleOverlay bursts={bursts} onArrive={handleBurstArrive} onDone={handleBurstDone} />,
        document.body,
      )}
      {restoreCheck?.kind === 'auto-restored' &&
        createPortal(
          <div className="restore-toast" role="status">
            {t.restoreAutoToast(restoreCheck.rows)}
            <button type="button" className="restore-toast-close" onClick={dismissRestoreOffer} aria-label="close">
              ×
            </button>
          </div>,
          document.body,
        )}
      {overlayMilestone !== null && (
        <MilestoneOverlay
          milestone={overlayMilestone}
          total={total}
          displayOffset={displayOffset}
          onClose={() => setOverlayMilestone(null)}
          uiLanguage={course.uiLanguage}
        />
      )}

      <footer className="statusbar">
        <div className="session-info">
          <ThemeToggle />
          <SoundSettings uiLanguage={course.uiLanguage} />
          <BoardSizeSettings uiLanguage={course.uiLanguage} />
          <Credits sources={course.sources} uiLanguage={course.uiLanguage} />
          {snapshotStatus?.blocked ? (
            <button type="button" className="link sync-status sync-status--blocked" onClick={() => void handleSyncStatusClick()}>
              {t.serverSyncBlocked}
            </button>
          ) : (
            <span className="sync-status">
              {snapshotStatus?.uploadedAt ? t.serverSyncedAgo(relativeTimeLabel(snapshotStatus.uploadedAt)) : t.serverSyncNever}
            </span>
          )}
          {undoAvailable && (
            <button type="button" className="link sync-status" onClick={() => void handleUndoRestore()}>
              {t.restoreUndo}
            </button>
          )}
        </div>
        <div className="actions">
          <button className="link" onClick={onExport} title={t.backupTitle}>
            ⭳ {t.backup}
            {showBackupBadge && backupInfo && <span className="backup-badge">{t.unsaved(backupInfo.unsaved)}</span>}
          </button>
          <button className="link" onClick={() => fileRef.current?.click()} title={t.restoreTitle}>
            ⭱ {t.restore}
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
          <AdminEntry />
        </div>
      </footer>
    </div>
  )
}
