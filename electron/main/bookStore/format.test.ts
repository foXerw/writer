import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkTmpBook } from '../../../tests/tmp'
import { detectFormat } from './format'
import { bookJsonPath } from './paths'

describe('detectFormat', () => {
  it('空目录 = invalid', () => {
    expect(detectFormat(mkTmpBook())).toBe('invalid')
  })

  it('目录根本不存在 = invalid', () => {
    expect(detectFormat(join(mkTmpBook(), 'ghost'))).toBe('invalid')
  })

  it('.novelwriter.json 存在 = v1', () => {
    const dir = mkTmpBook()
    writeFileSync(join(dir, '.novelwriter.json'), '{"name":"旧书"}')

    expect(detectFormat(dir)).toBe('v1')
  })

  it('book.json(formatVersion=2) = v2', () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), '{"formatVersion":2,"name":"新书"}')

    expect(detectFormat(dir)).toBe('v2')
  })

  it('v2 与旧标记并存 = v2（先判 book.json，幂等防重迁）', () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), '{"formatVersion":2}')
    writeFileSync(join(dir, '.novelwriter.json'), '{}')

    expect(detectFormat(dir)).toBe('v2')
  })

  it('半迁移救援：book.json 缺失、仅剩 .novelwriter.json.migrated = v1', () => {
    const dir = mkTmpBook()
    writeFileSync(join(dir, '.novelwriter.json.migrated'), '{}')

    expect(detectFormat(dir)).toBe('v1')
  })

  it('book.json 存在但解析失败 = 抛 CORRUPT_BOOK: <path>（坏 v2 绝不降级当 v1 重迁）', () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), 'not: [valid yaml,,,')
    writeFileSync(join(dir, '.novelwriter.json'), '{}') // 有旧标记也不许吞掉损坏

    expect(() => detectFormat(dir)).toThrow(`CORRUPT_BOOK: ${bookJsonPath(dir)}`)
  })

  it('book.json 可解析但 formatVersion !== 2 = 抛 CORRUPT_BOOK: <path>', () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), '{"formatVersion":1,"name":"未知版本"}')

    expect(() => detectFormat(dir)).toThrow(`CORRUPT_BOOK: ${bookJsonPath(dir)}`)
  })

  it('book.json 可解析但非对象（如纯量） = 抛 CORRUPT_BOOK: <path>', () => {
    const dir = mkTmpBook()
    writeFileSync(bookJsonPath(dir), '42')

    expect(() => detectFormat(dir)).toThrow(`CORRUPT_BOOK: ${bookJsonPath(dir)}`)
  })
})
