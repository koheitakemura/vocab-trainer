import { describe, expect, it } from 'vitest'
import { wordMatchScore } from './wordMatch'

describe('wordMatchScore', () => {
  it('完全一致が最上位（0）', () => {
    expect(wordMatchScore('ordeal', '/ɔɹdˈil/', 'gloss', 'ordeal')).toBe(0)
  })

  it('前方一致は完全一致より下位だが部分一致より上位', () => {
    const prefix = wordMatchScore('ordeal', undefined, undefined, 'orde')
    const substring = wordMatchScore('coordeal-ish', undefined, undefined, 'orde')
    expect(prefix).not.toBeNull()
    expect(substring).not.toBeNull()
    expect(prefix!).toBeLessThan(substring!)
  })

  it('読み（reading）一致は見出し語一致より下位、意味一致より上位', () => {
    const headwordMatch = wordMatchScore('ordeal', '/ɔɹdˈil/', 'きびしい試練', 'ordeal')
    const readingMatch = wordMatchScore('ordeal', '/ɔɹdˈil/', 'きびしい試練', 'ɔɹdˈil')
    const glossMatch = wordMatchScore('ordeal', '/ɔɹdˈil/', 'きびしい試練', '試練')
    expect(headwordMatch!).toBeLessThan(readingMatch!)
    expect(readingMatch!).toBeLessThan(glossMatch!)
  })

  it('gloss が無くても（静的プールのインデックス想定）見出し語・読みの一致は成立する', () => {
    expect(wordMatchScore('aachen', '/ˈɑkən/', undefined, 'aach')).not.toBeNull()
    expect(wordMatchScore('aachen', '/ˈɑkən/', undefined, 'nomatch')).toBeNull()
  })

  it('大文字小文字・前後空白は無視する', () => {
    expect(wordMatchScore('Ordeal', undefined, undefined, '  ORDEAL  ')).toBe(0)
  })

  it('一致しなければ null', () => {
    expect(wordMatchScore('ordeal', '/ɔɹdˈil/', 'きびしい試練', 'zzzznotaword')).toBeNull()
  })

  it('空クエリは null', () => {
    expect(wordMatchScore('ordeal', undefined, undefined, '')).toBeNull()
  })
})
