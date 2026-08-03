import { describe, expect, it } from 'vitest'
import {
  parseCorrectionInput,
  parseCourseIdParam,
  parseReportId,
  parseReportInput,
  parseReportStatus,
  REPORT_REASONS,
} from './reports'
import { ValidationError } from './validate'

const validReportBody = {
  courseId: 'en-10-30k',
  cardId: 'en-10-30k-0042',
  idEpoch: 1,
  headword: 'ordeal',
  reading: '',
  gloss: '試練',
  pos: '名詞',
  examples: [{ text: 'This was an ordeal.', translation: 'これは試練だった。' }],
  reason: 'gloss',
  note: '訳が違う気がします',
}

describe('parseReportInput', () => {
  it('妥当な入力をそのまま受ける', () => {
    const result = parseReportInput(validReportBody)
    expect(result.courseId).toBe('en-10-30k')
    expect(result.cardId).toBe('en-10-30k-0042')
    expect(result.reason).toBe('gloss')
    expect(result.examples).toEqual(validReportBody.examples)
  })

  it('AI生成カード（-x8桁16進）のcardIdも受ける', () => {
    const result = parseReportInput({ ...validReportBody, cardId: 'en-10-30k-x1a2b3c4' })
    expect(result.cardId).toBe('en-10-30k-x1a2b3c4')
  })

  it('courseId/cardId の形式が不正なら ValidationError', () => {
    expect(() => parseReportInput({ ...validReportBody, courseId: '../etc' })).toThrow(ValidationError)
    expect(() => parseReportInput({ ...validReportBody, cardId: '' })).toThrow(ValidationError)
    expect(() => parseReportInput({ ...validReportBody, cardId: 'has spaces' })).toThrow(ValidationError)
  })

  it('reason が REPORT_REASONS 以外なら ValidationError', () => {
    expect(() => parseReportInput({ ...validReportBody, reason: 'made-up-reason' })).toThrow(ValidationError)
    expect(() => parseReportInput({ ...validReportBody, reason: undefined })).toThrow(ValidationError)
  })

  it('headword が空なら ValidationError（他の語彙欄は空でも許容）', () => {
    expect(() => parseReportInput({ ...validReportBody, headword: '' })).toThrow(ValidationError)
    expect(parseReportInput({ ...validReportBody, gloss: '', pos: '', reading: '' }).gloss).toBe('')
  })

  it('note・各文字列欄は長さで切る（制御文字は空白化）', () => {
    const result = parseReportInput({ ...validReportBody, note: 'x'.repeat(300) })
    expect(result.note.length).toBe(200)
  })

  it('examples が5件を超えたら ValidationError', () => {
    const many = Array.from({ length: 6 }, () => validReportBody.examples[0])
    expect(() => parseReportInput({ ...validReportBody, examples: many })).toThrow(ValidationError)
  })

  it('idEpoch を省略すると 1 になる。異常値は 0-100 に丸める', () => {
    expect(parseReportInput({ ...validReportBody, idEpoch: undefined }).idEpoch).toBe(1)
    expect(parseReportInput({ ...validReportBody, idEpoch: -5 }).idEpoch).toBe(0)
    expect(parseReportInput({ ...validReportBody, idEpoch: 9999 }).idEpoch).toBe(100)
  })

  it('リクエスト本体がオブジェクトでなければ ValidationError', () => {
    expect(() => parseReportInput(null)).toThrow(ValidationError)
    expect(() => parseReportInput('string')).toThrow(ValidationError)
  })
})

describe('REPORT_REASONS', () => {
  it('想定する6種を持つ', () => {
    expect(REPORT_REASONS).toEqual(['gloss', 'reading', 'pos', 'example', 'inappropriate', 'other'])
  })
})

const validCorrectionBody = {
  courseId: 'en-10-30k',
  cardId: 'en-10-30k-0042',
  headword: 'ordeal',
  reading: '',
  gloss: '試練・苦難',
  pos: '名詞',
  examples: [{ text: 'It was an ordeal.', translation: 'それは試練だった。' }],
}

describe('parseCorrectionInput', () => {
  it('妥当な入力をそのまま受ける', () => {
    const result = parseCorrectionInput(validCorrectionBody)
    expect(result).toEqual(validCorrectionBody)
  })

  it('headword/gloss が空なら ValidationError（表示に必須の欄）', () => {
    expect(() => parseCorrectionInput({ ...validCorrectionBody, headword: '' })).toThrow(ValidationError)
    expect(() => parseCorrectionInput({ ...validCorrectionBody, gloss: '' })).toThrow(ValidationError)
  })

  it('reading/pos/examples は省略可（それぞれ既定値になる）', () => {
    const { reading: _r, pos: _p, examples: _e, ...rest } = validCorrectionBody
    const result = parseCorrectionInput(rest)
    expect(result.reading).toBe('')
    expect(result.pos).toBe('')
    expect(result.examples).toEqual([])
  })

  it('courseId/cardId の形式が不正なら ValidationError', () => {
    expect(() => parseCorrectionInput({ ...validCorrectionBody, cardId: 'bad id' })).toThrow(ValidationError)
  })
})

describe('parseReportId', () => {
  it('正の整数を受ける', () => {
    expect(parseReportId(42)).toBe(42)
    expect(parseReportId('42')).toBe(42)
  })

  it('0以下・非整数・NaN は ValidationError', () => {
    expect(() => parseReportId(0)).toThrow(ValidationError)
    expect(() => parseReportId(-1)).toThrow(ValidationError)
    expect(() => parseReportId(1.5)).toThrow(ValidationError)
    expect(() => parseReportId('abc')).toThrow(ValidationError)
    expect(() => parseReportId(undefined)).toThrow(ValidationError)
  })
})

describe('parseReportStatus', () => {
  it('open/planned/fixed/rejected を受ける', () => {
    expect(parseReportStatus('open')).toBe('open')
    expect(parseReportStatus('planned')).toBe('planned')
    expect(parseReportStatus('fixed')).toBe('fixed')
    expect(parseReportStatus('rejected')).toBe('rejected')
  })

  it('それ以外は ValidationError', () => {
    expect(() => parseReportStatus('done')).toThrow(ValidationError)
    expect(() => parseReportStatus(undefined)).toThrow(ValidationError)
  })
})

describe('parseCourseIdParam', () => {
  it('妥当なコースIDを受ける', () => {
    expect(parseCourseIdParam('en-10-30k')).toBe('en-10-30k')
  })

  it('null・不正な形式は ValidationError', () => {
    expect(() => parseCourseIdParam(null)).toThrow(ValidationError)
    expect(() => parseCourseIdParam('../etc/passwd')).toThrow(ValidationError)
  })
})
