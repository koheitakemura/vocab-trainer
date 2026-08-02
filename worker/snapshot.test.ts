import { describe, expect, it } from 'vitest'
import {
  SnapshotError,
  allPrefix,
  historyKey,
  historyPrefix,
  latestKey,
  needsOverwriteConfirmation,
  pruneHistoryKeys,
  readBinary,
} from './snapshot'

const GZIP_HEADER = new Uint8Array([0x1f, 0x8b, 0x08, 0x00])

function requestWith(body: BodyInit | null, contentType = 'application/gzip'): Request {
  return new Request('https://example.com/api/snapshot', {
    method: 'PUT',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  })
}

describe('latestKey / historyKey / prefixes', () => {
  it('email をパスに埋め込む', () => {
    expect(latestKey('a@b.com')).toBe('snapshots/a@b.com/latest.json.gz')
    expect(historyPrefix('a@b.com')).toBe('snapshots/a@b.com/history/')
    expect(allPrefix('a@b.com')).toBe('snapshots/a@b.com/')
  })

  it('historyKey のタイムスタンプ部分は : と . を含まない（拡張子と紛らわしくしないため）', () => {
    const key = historyKey('a@b.com', new Date('2026-08-02T03:04:05.678Z'))
    expect(key).toBe('snapshots/a@b.com/history/2026-08-02T03-04-05-678Z.json.gz')
    const timestampSegment = key.split('/').at(-1)!.replace(/\.json\.gz$/, '')
    expect(timestampSegment).not.toMatch(/[:.]/)
  })

  it('タイムスタンプの辞書順が時系列順と一致する（R2 の list ソートに依存するため）', () => {
    const earlier = historyKey('a@b.com', new Date('2026-08-01T00:00:00Z'))
    const later = historyKey('a@b.com', new Date('2026-08-02T00:00:00Z'))
    expect(earlier < later).toBe(true)
  })
})

describe('needsOverwriteConfirmation', () => {
  it('既存が実質空（2KB未満）なら常に許可する', () => {
    expect(needsOverwriteConfirmation(0, 0)).toBe(false)
    expect(needsOverwriteConfirmation(1024, 0)).toBe(false)
  })

  it('新しい方が既存の10%未満なら確認を要求する', () => {
    expect(needsOverwriteConfirmation(100_000, 5_000)).toBe(true)
  })

  it('新しい方が既存の10%以上なら許可する（正常な減少はブロックしない）', () => {
    expect(needsOverwriteConfirmation(100_000, 15_000)).toBe(false)
  })

  it('通常の増加は常に許可する', () => {
    expect(needsOverwriteConfirmation(100_000, 120_000)).toBe(false)
  })
})

describe('pruneHistoryKeys', () => {
  const keys = Array.from({ length: 15 }, (_, i) => `k${14 - i}`) // 新しい順 (k14, k13, ..., k0)

  it('新しい方から既定10件だけ残す', () => {
    const { keep, drop } = pruneHistoryKeys(keys)
    expect(keep).toHaveLength(10)
    expect(keep[0]).toBe('k14')
    expect(keep.at(-1)).toBe('k5')
    expect(drop).toHaveLength(5)
    expect(drop).toEqual(['k4', 'k3', 'k2', 'k1', 'k0'])
  })

  it('件数が上限以下なら何も削らない', () => {
    const { keep, drop } = pruneHistoryKeys(keys.slice(0, 3))
    expect(keep).toHaveLength(3)
    expect(drop).toHaveLength(0)
  })

  it('keep 件数を指定できる', () => {
    const { keep, drop } = pruneHistoryKeys(keys, 3)
    expect(keep).toEqual(['k14', 'k13', 'k12'])
    expect(drop).toHaveLength(12)
  })
})

describe('readBinary', () => {
  it('gzip マジックバイト付きの本文を受け付ける', async () => {
    const body = new Uint8Array([...GZIP_HEADER, 1, 2, 3])
    const result = await readBinary(requestWith(body))
    expect(new Uint8Array(result)).toEqual(body)
  })

  it('Content-Type が application/gzip でなければ拒否する（中身が gzip でも）', async () => {
    const body = new Uint8Array([...GZIP_HEADER, 1, 2, 3])
    await expect(readBinary(requestWith(body, 'application/json'))).rejects.toThrow(SnapshotError)
  })

  it('gzip マジックバイトが無ければ拒否する（Content-Type を詐称しても中身は見る）', async () => {
    const notGzip = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    await expect(readBinary(requestWith(notGzip))).rejects.toThrow(SnapshotError)
  })

  it('空の本文を拒否する', async () => {
    await expect(readBinary(requestWith(new Uint8Array(0)))).rejects.toThrow(SnapshotError)
  })

  it('上限（5MB）を超える本文を拒否する', async () => {
    const huge = new Uint8Array(5 * 1024 * 1024 + 1)
    huge.set(GZIP_HEADER)
    await expect(readBinary(requestWith(huge))).rejects.toThrow(SnapshotError)
  })

  it('上限ちょうどの本文は受け付ける', async () => {
    const exact = new Uint8Array(5 * 1024 * 1024)
    exact.set(GZIP_HEADER)
    const result = await readBinary(requestWith(exact))
    expect(result.byteLength).toBe(5 * 1024 * 1024)
  })
})
