// REVIEW_* 通道错误中文映射表单测（M6 Task 6 carry-in 2；纯逻辑）。姿态与三张先列表同源
// （proposalErrors / narrativeErrors / aiErrorText）：
// - 前缀 → 中文 label，detail（冒号后原文）非空拼「label：detail」，未知前缀回落
//   「操作失败：<解包原文>」——绝不吞掉真实原因；
// - 真实 IPC 错误恒裹 `Error invoking remote method '…': Error: …` + 尾部 stack：必须先经
//   parseKindTaggedError 解包再对文本做【锚定】前缀匹配（bookErrors.ts 交过的学费：裸 anchored
//   匹配在真实 IPC 边界必然失配；正文里恰好出现 REVIEW_* 字样的普通错误不得被误路由）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewErrorText, reviewInvalidText } from './reviewErrors'

describe('reviewErrorText × 词表（六个通道前缀各归一中）', () => {
  it('每个前缀独立归一、互不撞文案；detail 保留在冒号后', () => {
    const probes: Array<[string, string]> = [
      ['REVIEW_INVALID: 3f2b6c1a: anchor.quote must be a non-empty string', '3f2b6c1a: anchor.quote must be a non-empty string'],
      ['REVIEW_MISSING: 3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d', '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'],
      ['REVIEW_NOT_OPEN: 3f2b6c1a', '3f2b6c1a'],
      ['REVIEW_CHAPTER_MISSING: 3f2b6c1a', '3f2b6c1a'],
      ['REVIEW_TOO_MANY: 201 > 200', '201 > 200'],
      ['BAD_REVIEW_CHAPTER_ID: ../../evil', '../../evil']
    ]
    const labels = probes.map(([raw]) => reviewErrorText(raw).split('：')[0])
    expect(new Set(labels).size).toBe(6)
    for (const [raw, detail] of probes) {
      const t = reviewErrorText(raw)
      expect(t, raw).not.toBe('操作失败')
      expect(t, raw).not.toBe(`操作失败：${raw}`)
      expect(t, raw).toContain(detail)
    }
  })

  it('label：detail 拼接可诊断；裸前缀（无 detail）只出标签；全空白 detail 同裸前缀', () => {
    expect(reviewErrorText('REVIEW_MISSING: op-1')).toBe('该审阅意见已不存在（可能已被驳回、转化或删除）：op-1')
    expect(reviewErrorText('REVIEW_NOT_OPEN')).toBe('该意见已不是待处理状态（驳回/转化/置旧后不可重复操作）')
    expect(reviewErrorText('REVIEW_MISSING:   ')).toBe('该审阅意见已不存在（可能已被驳回、转化或删除）')
  })
})

describe('reviewErrorText × IPC 包装与误路由防线', () => {
  it('真实通道 reject 形状：剥包装 + 裁 stack 后锚定匹配', () => {
    const raw =
      "Error invoking remote method 'review:dismiss': Error: REVIEW_NOT_OPEN: 3f2b6c1a\n    at Object.<anonymous> (electron/main/ipc/modules/reviews.ts:52:15)"
    const t = reviewErrorText(raw)
    expect(t).toBe('该意见已不是待处理状态（驳回/转化/置旧后不可重复操作）：3f2b6c1a')
    expect(t).not.toContain('at Object') // 展示面不背帧栈
  })

  it('正文误路由防线：错误文本【不以】前缀开头时 REVIEW_* 字样照常回落原文', () => {
    const raw = '写入审阅账本失败：你在正文里引用了 REVIEW_MISSING 字样的示例'
    expect(reviewErrorText(raw)).toBe(`操作失败：${raw}`)
  })

  it('[busy] tag 归一（镜像 proposalErrors/narrativeErrors：本域通道不产此 tag，防御性收入）', () => {
    expect(reviewErrorText('[busy] 请求 op-1 正在处理中')).toBe('已有请求在途：请求 op-1 正在处理中')
  })

  it('空 / 纯空白原文 → 裸「操作失败」（无悬空冒号）', () => {
    expect(reviewErrorText('')).toBe('操作失败')
    expect(reviewErrorText('   ')).toBe('操作失败')
  })
})

describe('reviewErrorText × 词表全覆盖（防主进程新增 throw 前缀漏翻译）', () => {
  it('审阅域两源文件里每个「冒号跟随」的真实 throw 前缀都在词表内', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const sources = [
      'electron/main/bookStore/reviews.ts',
      'electron/main/ipc/modules/reviews.ts'
    ]
    const thrown = new Set<string>()
    for (const rel of sources) {
      const text = readFileSync(join(root, rel), 'utf8')
      // 只收 `前缀:` 形态的审阅通道词（REVIEW_* / BAD_REVIEW_CHAPTER_ID）
      for (const m of text.matchAll(/((?:REVIEW_[A-Z0-9_]+|BAD_REVIEW_CHAPTER_ID))(?=:)/g)) thrown.add(m[1])
    }
    // 词表 6 键全在场（漏键 = 该错误会裸回落「操作失败：」，用户看不到归因）
    expect([...thrown].sort()).toEqual([
      'BAD_REVIEW_CHAPTER_ID',
      'REVIEW_CHAPTER_MISSING',
      'REVIEW_INVALID',
      'REVIEW_MISSING',
      'REVIEW_NOT_OPEN',
      'REVIEW_TOO_MANY'
    ])
    for (const prefix of thrown) {
      // 命中词表 → label 分支（返回值绝不是「操作失败：」回落形态）；漏翻译的会原样回落——两边可区分
      expect(
        reviewErrorText(`${prefix}: x`) !== `操作失败：${prefix}: x` &&
          reviewErrorText(`${prefix}: x`) !== '操作失败',
        `词表漏键: ${prefix}`
      ).toBe(true)
    }
  })
})

describe('reviewInvalidText × convert 拒绝原因（终审 sweep：不泄内部 not-open 码）', () => {
  it('软类与三种 not-open 状态各归一中，互不撞文案', () => {
    const probes: Array<[string, string]> = [
      ['soft-not-convertible', '软性感受'],
      ['not-open:dismissed', '已驳回'],
      ['not-open:converted', '已转化'],
      ['not-open:open+stale', '上次未重现']
    ]
    const texts = probes.map(([reason]) => reviewInvalidText(reason))
    expect(new Set(texts).size).toBe(4)
    for (const i of probes.keys()) {
      // 绝不含原始 not-open/soft-not-convertible 内部码（中文归一，不泄码）
      expect(texts[i]).not.toMatch(/not-open|soft-not-convertible/)
      expect(texts[i]).toContain(probes[i][1])
    }
  })

  it('soft-not-convertible 带尾缀仍命中软类分支（startsWith 前缀匹配）', () => {
    expect(reviewInvalidText('soft-not-convertible:extra')).toContain('软性感受')
  })

  it('未知 not-open 状态回落可诊断中文（保留状态、不 throw）', () => {
    expect(reviewInvalidText('not-open:weird')).toContain('该意见当前状态不可转化')
    expect(reviewInvalidText('not-open:weird')).toContain('weird')
  })

  it('完全未知原因保留平文可诊断（绝不吞真因）', () => {
    expect(reviewInvalidText('unknown-category:xyz')).toBe('该意见不可转化：unknown-category:xyz')
  })
})
