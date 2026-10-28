// readAiData 测试（M4b Task 4 裁定 4：`.ai/` 只读快照三态——缺/正常/坏）。
// 纯读零校验纪律：缺文件/缺目录 → 空对象（organize 上下文层自然缺席）；坏文件 →
// console.warn（绝对路径）+ 跳过该条，绝不让单份坏摘要瘫痪整次读取。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { mkTmpBook } from '../../../tests/tmp'
import { readAiData } from './aiData'
import { chapterSummariesDir, volumeSummariesDir, aiIndexFile } from './paths'

const CH1 = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'
const CH2 = '7a1c2b3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d'
const VOL1 = '9e8d7c6b-5a4f-4321-8765-4321fedcba98'

let book = ''

function writeChapterSummary(chapterId: string, doc: unknown): void {
  mkdirSync(chapterSummariesDir(book), { recursive: true })
  writeFileSync(join(chapterSummariesDir(book), `${chapterId}.yaml`), yaml.dump(doc), 'utf8')
}

beforeEach(() => {
  book = mkTmpBook()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readAiData：缺态', () => {
  it('.ai/ 整体不存在 → 三个空对象（绝不抛）', () => {
    expect(readAiData(book)).toEqual({
      chapterSummaries: {},
      volumeSummaries: {},
      entityIndex: {}
    })
  })

  it('index.json 缺失 → entityIndex {}，摘要照常读', () => {
    writeChapterSummary(CH1, { chapterId: CH1, text: '阿明出发。', updatedAt: 'x', aiModel: 'm' })
    const snap = readAiData(book)
    expect(snap.entityIndex).toEqual({})
    expect(snap.chapterSummaries[CH1]).toBe('阿明出发。')
  })
})

describe('readAiData：正常态', () => {
  it('三域齐读：章摘要按文件内 chapterId 键、卷摘要按 volumeId 键、index 原样', () => {
    writeChapterSummary(CH1, { chapterId: CH1, text: '第一章摘要', updatedAt: 'x', aiModel: 'm' })
    writeChapterSummary(CH2, { chapterId: CH2, text: '第二章摘要', updatedAt: 'x', aiModel: 'm' })
    mkdirSync(volumeSummariesDir(book), { recursive: true })
    writeFileSync(
      join(volumeSummariesDir(book), `${VOL1}.yaml`),
      yaml.dump({ volumeId: VOL1, text: '第一卷梗概', updatedAt: 'x', aiModel: 'm' }),
      'utf8'
    )
    writeFileSync(
      aiIndexFile(book),
      JSON.stringify({ 'entity-1': [CH1, CH2], 'entity-2': [] }),
      'utf8'
    )
    expect(readAiData(book)).toEqual({
      chapterSummaries: { [CH1]: '第一章摘要', [CH2]: '第二章摘要' },
      volumeSummaries: { [VOL1]: '第一卷梗概' },
      entityIndex: { 'entity-1': [CH1, CH2], 'entity-2': [] }
    })
  })

  it('文件名 stem 兜底键：文件内 id 字段缺失/非字符串时用 stem（读侧宽容，不猜内容）', () => {
    writeChapterSummary(CH1, { text: '无 id 字段的摘要' })
    const snap = readAiData(book)
    expect(snap.chapterSummaries[CH1]).toBe('无 id 字段的摘要')
  })
})

describe('readAiData：坏态（warn + skip，绝不整体抛）', () => {
  it('坏 YAML 摘要 → 跳过该条并 warn（绝对路径），好条目照常返回', () => {
    writeChapterSummary(CH1, { chapterId: CH1, text: '好摘要' })
    mkdirSync(chapterSummariesDir(book), { recursive: true })
    // tabs 缩进 + 错误键的坏字节：js-yaml 抛 YAMLException
    writeFileSync(join(chapterSummariesDir(book), `${CH2}.yaml`), '\t: [未闭合\n', 'utf8')
    const snap = readAiData(book)
    expect(snap.chapterSummaries).toEqual({ [CH1]: '好摘要' })
    expect(console.warn).toHaveBeenCalledTimes(1)
    const warned = String(vi.mocked(console.warn).mock.calls[0][0])
    expect(warned).toContain(join(chapterSummariesDir(book), `${CH2}.yaml`))
  })

  it('text 缺失/非字符串的摘要 → warn + skip（值域只允许 string）', () => {
    writeChapterSummary(CH1, { chapterId: CH1, updatedAt: 'x' })
    const snap = readAiData(book)
    expect(snap.chapterSummaries).toEqual({})
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('index.json 非 JSON → warn + entityIndex {}；单键值非 string[] → 该键跳过（其余保留）', () => {
    mkdirSync(join(book, '.ai'), { recursive: true })
    writeFileSync(aiIndexFile(book), '{ 坏掉的 json', 'utf8')
    expect(readAiData(book).entityIndex).toEqual({})

    writeFileSync(aiIndexFile(book), JSON.stringify({ ok: [CH1], bad: [CH1, 42], top: 'x' }), 'utf8')
    const snap = readAiData(book)
    expect(snap.entityIndex).toEqual({ ok: [CH1] })
    expect(console.warn).toHaveBeenCalled()
  })

  it('顶层非对象（数组/标量）index.json → warn + {}', () => {
    mkdirSync(join(book, '.ai'), { recursive: true })
    writeFileSync(aiIndexFile(book), '[1,2,3]', 'utf8')
    expect(readAiData(book).entityIndex).toEqual({})
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})
