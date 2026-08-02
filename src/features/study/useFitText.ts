import { useLayoutEffect, useRef, useState } from 'react'

/** 大きい順。収まらなければ次のサイズへ段階的に縮める。 */
const DEFAULT_STEPS = [13, 12, 11, 10, 9, 8.5]

/**
 * 指定した「枠」要素（高さが固定/上限つき・overflow:hidden）にテキストが収まるまで、
 * 中の文字のフォントサイズを段階的に縮める。カードの高さを固定したまま、訳語が長い
 * カードでもレイアウトが崩れないようにする（純粋な CSS だけでは「収まるまで縮める」を
 * 表現できないため JS で計測する）。
 *
 * 返す boxRef は「高さが制限された枠」の要素に付けること。scrollHeight（実際に必要な
 * 高さ）と clientHeight（見えている高さ＝枠の上限）を比較して、はみ出しを判定する。
 *
 * overflowing は「最小段階まで縮めてもまだ溢れている」＝一部が見えていないことを表す。
 * 呼び出し側はここで初めて「切れている」表現（下端フェード等）に切り替える。切り口が
 * 文の途中でスパッと切れると壊れて見えるため、フェードは常時ではなくこのときだけ出す。
 */
export function useFitText(text: string, steps: number[] = DEFAULT_STEPS) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  // text が変わったら（＝別のタイルがめくられた等）最大サイズからやり直す
  useLayoutEffect(() => {
    setStep(0)
    setOverflowing(false)
  }, [text])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const over = el.scrollHeight > el.clientHeight + 1
    if (over && step < steps.length - 1) setStep((s) => s + 1)
    else if (over !== overflowing) setOverflowing(over)
  }, [step, text, steps, overflowing])

  return { boxRef, fontSize: steps[Math.min(step, steps.length - 1)], overflowing }
}
