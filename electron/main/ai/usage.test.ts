// AI 用量账本测试（M4a Task 4）。
// 钉死四条：① 追加落盘 <book>/.ai/usage.jsonl（mkdir -p、单行 JSON+\n、不读旧文件）；
// ② 聚合形状 byFeature(三键恒在)/total/byModel；③ 坏行/形状漂移行静默跳过（数值漂移按 0 计入）；
// ④ 缺文件 → 全零摘要（不是 null、不抛）。写失败 warn 且只带 errno（不回显内容）。
import { describe, expect, it, vi } from 'vitest'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiUsageRecord } from '../../../src/common/ai-types'
import { appendUsage, emptyUsageSummary, readUsageSummary } from './usage'
import { mkTmpBook } from '../../../tests/tmp'

const rec = (over: Partial<AiUsageRecord> = {}): AiUsageRecord => ({
  ts: '2026-10-28T08:00:00.000Z',
  feature: 'organize',
  model: 'gpt-test',
  promptTokens: 100,
  completionTokens: 20,
  ...over
})

describe('appendUsage', () => {
  it('首写建 .ai 目录；内容为单行 JSON + \\n；再写追加第二行（顺序保持）', () => {
    const book = mkTmpBook()
    appendUsage(book, rec())
    appendUsage(book, rec({ feature: 'completion', promptTokens: 50, completionTokens: 5 }))
    const file = join(book, '.ai', 'usage.jsonl')
    expect(existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf-8')
    expect(text.endsWith('\n')).toBe(true)
    const lines = text.split('\n').filter((l) => l !== '')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual(rec())
    expect((JSON.parse(lines[1]) as AiUsageRecord).feature).toBe('completion')
    // 单行性：JSON 字符串不带裸 CR/LF
    expect(lines[0].includes('\r')).toBe(false)
  })

  it('写失败（.ai 被普通文件占位）→ warn 一次且只带 errno，绝不抛、不回显内容', () => {
    const book = mkTmpBook()
    const blocker = join(book, '.ai') // 先占一个同名普通文件 → mkdir -p 必炸
    writeFileSync(blocker, 'x')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => appendUsage(blocker, rec())).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = String(warn.mock.calls[0][0])
    expect(logged).toContain('errno=')
    expect(logged).not.toContain('gpt-test')
    warn.mockRestore()
  })
})

describe('readUsageSummary', () => {
  it('缺文件 → 全零（三 feature 键恒在）', () => {
    const book = mkTmpBook()
    expect(readUsageSummary(book)).toEqual(emptyUsageSummary())
  })

  it('聚合：多 feature 多 model 正确累加，cached 缺省按 0', () => {
    const book = mkTmpBook()
    appendUsage(book, rec({ feature: 'organize', model: 'A', promptTokens: 100, completionTokens: 20, cachedTokens: 30 }))
    appendUsage(book, rec({ feature: 'organize', model: 'A', promptTokens: 1, completionTokens: 2 }))
    appendUsage(book, rec({ feature: 'review', model: 'B', promptTokens: 7, completionTokens: 8 }))
    const s = readUsageSummary(book)
    expect(s.byFeature.organize).toEqual({ calls: 2, prompt: 101, completion: 22, cached: 30 })
    expect(s.byFeature.completion).toEqual({ calls: 0, prompt: 0, completion: 0, cached: 0 })
    expect(s.byFeature.review).toEqual({ calls: 1, prompt: 7, completion: 8, cached: 0 })
    expect(s.total).toEqual({ calls: 3, prompt: 108, completion: 30, cached: 30 })
    expect(s.byModel).toEqual({
      A: { prompt: 101, completion: 22 },
      B: { prompt: 7, completion: 8 }
    })
  })

  it('坏行静默跳过：非 JSON、数组、未知 feature、空 model 不计；数值漂移（负/非数）按 0 计入', () => {
    const book = mkTmpBook()
    appendUsage(book, rec({ model: 'A', promptTokens: 100, completionTokens: 20 }))
    const junk = [
      'not-json{{',
      '["array","row"]',
      JSON.stringify({ ts: 'x', feature: 'teleport', model: 'A', promptTokens: 9, completionTokens: 9 }),
      JSON.stringify({ ts: 'x', feature: 'organize', model: '', promptTokens: 9, completionTokens: 9 }),
      JSON.stringify({ ts: 'x', feature: 'organize', model: 'C', promptTokens: -5, completionTokens: 'many' }),
      '   ',
      // 合法但缺 ts：ts 不参与聚合，照常计入
      JSON.stringify({ feature: 'organize', model: 'D', promptTokens: 3, completionTokens: 4 })
    ].join('\n') + '\n'
    appendFileSync(join(book, '.ai', 'usage.jsonl'), junk, 'utf-8')
    const s = readUsageSummary(book)
    expect(s.total).toEqual({ calls: 3, prompt: 103, completion: 24, cached: 0 })
    expect(s.byFeature.organize.calls).toBe(3)
    expect(s.byModel.A).toEqual({ prompt: 100, completion: 20 })
    expect(s.byModel.C).toEqual({ prompt: 0, completion: 0 }) // 漂移值按 0 计，行本身合法
    expect(s.byModel.D).toEqual({ prompt: 3, completion: 4 })
  })

  it('路径不存在 → 全零，不抛', () => {
    expect(readUsageSummary(join(mkTmpBook(), 'nope'))).toEqual(emptyUsageSummary())
  })
})
