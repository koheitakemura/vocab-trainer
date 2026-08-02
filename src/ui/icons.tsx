import type { ReactNode } from 'react'

/**
 * UI で使う単色アイコン。
 *
 * 絵文字（🌙 🔥 🔊 …）は **OS ごとに色も形も変わる**うえ、単色の文字の中で 1 つだけ
 * カラーで浮く。かといって ⭳ ⚙ ▦ のような文字記号は **フォントに無い端末では豆腐（□）**
 * になる。どちらの事故も起きないよう、必要なものは自分で SVG として持つ。
 *
 * すべて currentColor で描くので、置いた場所の文字色・ホバー・テーマ切替に自動で追従する。
 * viewBox は 16×16 で統一。既定サイズ 14px（フッターの 13px 文字に合う）。
 */

type IconProps = { size?: number; className?: string }

function Icon({
  size = 14,
  className,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** 音あり／消音。消音は波の代わりに × を出す（形でも状態が分かる） */
export function SpeakerIcon({ muted, ...p }: IconProps & { muted: boolean }) {
  return (
    <Icon {...p}>
      <path d="M3 6.4h2.3L8.7 3.5v9L5.3 9.6H3z" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
        {muted ? (
          <path d="M10.9 6.3l3 3.4M13.9 6.3l-3 3.4" />
        ) : (
          <>
            <path d="M10.7 6.2a2.9 2.9 0 0 1 0 3.6" />
            <path d="M12.7 4.6a5.4 5.4 0 0 1 0 6.8" />
          </>
        )}
      </g>
    </Icon>
  )
}

/** ライトテーマへ切り替える側 */
export function SunIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M8 1.3v1.5M8 13.2v1.5M1.3 8h1.5M13.2 8h1.5" />
        <path d="M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
      </g>
    </Icon>
  )
}

/** ダークテーマへ切り替える側 */
export function MoonIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M13.4 9.8A5.7 5.7 0 0 1 6.2 2.6a5.7 5.7 0 1 0 7.2 7.2z" fill="currentColor" />
    </Icon>
  )
}

/** 1セッションのカード枚数。学習ボードのカードそのものを表す（ロゴの格子と紛れないよう重ねた札で描く） */
export function CardsIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect
        x="5"
        y="2.2"
        width="8.8"
        height="6.6"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect x="2.2" y="6" width="8.8" height="7.8" rx="1.5" fill="currentColor" />
    </Icon>
  )
}

/** 進捗を端末に書き出す（Backup） */
export function DownloadIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M8 2.3v7.2" />
        <path d="M5.2 6.8L8 9.6l2.8-2.8" />
        <path d="M2.9 11.4v2.3h10.2v-2.3" />
      </g>
    </Icon>
  )
}

/** 書き出したファイルから戻す（Restore） */
export function UploadIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M8 9.6V2.4" />
        <path d="M5.2 5.2L8 2.4l2.8 2.8" />
        <path d="M2.9 11.4v2.3h10.2v-2.3" />
      </g>
    </Icon>
  )
}

/** 管理者画面。歯車にすると同じ行の太陽アイコンと形が紛れるので、つまみ（設定）で描く */
export function SlidersIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M2.6 5.2h10.8M2.6 10.8h10.8" />
      </g>
      <g fill="currentColor">
        <circle cx="6" cy="5.2" r="1.9" />
        <circle cx="10.4" cy="10.8" r="1.9" />
      </g>
    </Icon>
  )
}

/** 説明ツールチップの起点（「？」）。丸+疑問符は言語を問わず「詳細情報」として通じる */
export function InfoIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <g fill="currentColor">
        <circle cx="8" cy="11.3" r="0.9" />
        <path
          d="M8 9.6c0-.9.5-1.3 1.1-1.8.6-.5 1.1-1 1.1-1.9 0-1.2-.9-2-2.2-2-1.1 0-1.9.6-2.2 1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
    </Icon>
  )
}

/** 単語検索（タブ行の検索ボックス） */
export function SearchIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <circle cx="7" cy="7" r="4.2" />
        <path d="M10.2 10.2L14 14" />
      </g>
    </Icon>
  )
}

/** AI生成（検索で見つからない語をAIに作らせるボタン） */
export function SparkleIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path
        d="M8 1.6l1.1 3.3L12.4 6l-3.3 1.1L8 10.4 6.9 7.1 3.6 6l3.3-1.1z"
        fill="currentColor"
      />
      <path d="M12.6 9.6l.55 1.65 1.65.55-1.65.55-.55 1.65-.55-1.65-1.65-.55 1.65-.55z" fill="currentColor" />
    </Icon>
  )
}

/** 連続学習日数 */
export function FlameIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path
        d="M8.9 1.2c.4 2.1-.8 3.2-1.9 4.2C5.8 6.5 4.6 7.7 4.6 9.6a4.4 4.4 0 0 0 8.8 0c0-1.6-.7-2.7-1.6-3.6-.3.7-.8 1.1-1.4 1.3.6-2.3-.6-4.6-1.5-6.1z"
        fill="currentColor"
      />
    </Icon>
  )
}
