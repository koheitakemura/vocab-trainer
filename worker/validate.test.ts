import { describe, expect, it } from 'vitest'
import { ValidationError, parseCardId } from './validate'

describe('parseCardId — 管理画面（昇格・削除）が指定する card_id の検証', () => {
  it('makeCardId() が作る形式（<courseId>-x<8桁16進>）を通す', () => {
    expect(parseCardId('en-10-30k-xbd6a3f8d')).toBe('en-10-30k-xbd6a3f8d')
    expect(parseCardId('ja-0-3k-x00000000')).toBe('ja-0-3k-x00000000')
  })

  it('前後の空白は trim してから検証する', () => {
    expect(parseCardId('  en-10-30k-xbd6a3f8d  ')).toBe('en-10-30k-xbd6a3f8d')
  })

  it('通常の数値サフィックスcardId（-x を含まない）は拒否する', () => {
    expect(() => parseCardId('en-10-30k-0001')).toThrow(ValidationError)
  })

  it('16進以外の文字・桁数違い・大文字は拒否する', () => {
    expect(() => parseCardId('en-10-30k-xZZZZZZZZ')).toThrow(ValidationError)
    expect(() => parseCardId('en-10-30k-xbd6a3f')).toThrow(ValidationError)
    expect(() => parseCardId('en-10-30k-xBD6A3F8D')).toThrow(ValidationError)
  })

  it('SQLインジェクション・制御文字混じりの入力は拒否する', () => {
    expect(() => parseCardId("en-10-30k-xbd6a3f8d'; DROP TABLE extra_cards;--")).toThrow(ValidationError)
  })

  it('文字列以外・空文字は拒否する', () => {
    expect(() => parseCardId(undefined)).toThrow(ValidationError)
    expect(() => parseCardId(123)).toThrow(ValidationError)
    expect(() => parseCardId('')).toThrow(ValidationError)
  })
})
