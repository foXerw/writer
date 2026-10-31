// PROPOSAL_* 通道错误中文映射表单测（M4c-2 T6 结转；纯逻辑）。姿态与两张先列表同源：
// - 前缀 → 中文 label，detail（冒号后原文）非空拼「label：detail」，未知前缀回落
//   「操作失败：<解包原文>」——绝不吞掉真实原因（aiErrorText / narrativeErrors 同款纪律）；
// - 真实 IPC 错误恒裹 `Error invoking remote method '…': Error: …` + 尾部 stack：必须先经
//   parseKindTaggedError 解包再对文本做【锚定】前缀匹配（bookErrors.ts 交过的学费：裸 anchored
//   匹配在真实 IPC 边界必然失配；正文里恰好出现 PROPOSAL_* 字样的普通错误不得被误路由）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { proposalErrorText } from './proposalErrors'

describe('proposalErrorText × 词表（八个通道前缀各归一中）', () => {
  it('每个前缀独立归一、互不撞文案；detail 保留在冒号后', () => {
    const probes: Array<[string, string]> = [
      ['PROPOSAL_INVALID: /b/.ai/proposals/x.yaml: proposal.changes: expected array', '/b/.ai/proposals/x.yaml: proposal.changes: expected array'],
      ['PROPOSAL_TOO_LARGE: 201 > 200', '201 > 200'],
      ['PROPOSAL_DUPLICATE: 3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d', '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'],
      ['PROPOSAL_CHAPTER_MISSING: 3f2b6c1a', '3f2b6c1a'],
      ['PROPOSAL_MISSING: prop-3f2b6c1a-m0z8k1x', 'prop-3f2b6c1a-m0z8k1x'],
      ['PROPOSAL_APPEND_TARGET: prop-3f2b6c1a-m0z8k1x', 'prop-3f2b6c1a-m0z8k1x'],
      ['PROPOSAL_BAD_PARAMS: changeKeys 必须是数组', 'changeKeys 必须是数组'],
      ['BAD_PROPOSAL_ID: ../../evil', '../../evil']
    ]
    const labels = probes.map(([raw]) => proposalErrorText(raw).split('：')[0])
    expect(new Set(labels).size).toBe(8)
    for (const [raw, detail] of probes) {
      const t = proposalErrorText(raw)
      expect(t, raw).not.toBe('操作失败')
      expect(t, raw).not.toBe(`操作失败：${raw}`)
      expect(t, raw).toContain(detail)
    }
  })

  it('label：detail 拼接可诊断；裸前缀（无 detail）只出标签；全空白 detail 同裸前缀', () => {
    expect(proposalErrorText('PROPOSAL_MISSING: prop-x')).toBe('提案不存在（可能已被他端消化或删除）：prop-x')
    expect(proposalErrorText('PROPOSAL_CHAPTER_MISSING')).toBe('提案的出处章节已不存在')
    expect(proposalErrorText('PROPOSAL_MISSING:   ')).toBe('提案不存在（可能已被他端消化或删除）')
  })
})

describe('proposalErrorText × IPC 包装与误路由防线', () => {
  it('真实通道 reject 形状：剥包装 + 裁 stack 后锚定匹配', () => {
    const raw =
      "Error invoking remote method 'proposal:adopt': Error: PROPOSAL_DUPLICATE: 3f2b6c1a\n    at Object.<anonymous> (electron/main/ipc/modules/proposal.ts:63:15)"
    const t = proposalErrorText(raw)
    expect(t).toBe('该章已有待处理的提案（请先在审阅面板消化后再次整理）：3f2b6c1a')
    expect(t).not.toContain('at Object') // 展示面不背帧栈
  })

  it('正文误路由防线：错误文本【不以】前缀开头时 PROPOSAL_* 字样照常回落原文', () => {
    const raw = '写入提案失败：你在正文里引用了 PROPOSAL_DUPLICATE 字样的示例'
    expect(proposalErrorText(raw)).toBe(`操作失败：${raw}`)
  })

  it('[busy] tag 归一（镜像 narrativeErrors：本域通道不产此 tag，门面错误经 AI 管线冒出来也该可读）', () => {
    expect(proposalErrorText('[busy] 请求 prop-x 正在处理中')).toBe('已有请求在途：请求 prop-x 正在处理中')
  })

  it('空 / 纯空白原文 → 裸「操作失败」（无悬空冒号）', () => {
    expect(proposalErrorText('')).toBe('操作失败')
    expect(proposalErrorText('   ')).toBe('操作失败')
  })
})

describe('proposalErrorText × 词表全覆盖（防主进程新增 throw 前缀漏翻译）', () => {
  it('提案域三源文件里每个「冒号跟随」的真实 throw 前缀都在词表内', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const sources = [
      'electron/main/bookStore/proposals.ts',
      'electron/main/bookStore/adopt.ts',
      'electron/main/ipc/modules/proposal.ts'
    ]
    const thrown = new Set<string>()
    for (const rel of sources) {
      const text = readFileSync(join(root, rel), 'utf8')
      // 只收 `前缀:` 形态的 proposal 通道词（BAD_CHARACTER_ID 等实体域错误属逐条 REFUSED，不在本表）
      for (const m of text.matchAll(/((?:PROPOSAL_[A-Z0-9_]+|BAD_PROPOSAL_ID))(?=:)/g)) thrown.add(m[1])
    }
    // 词表 8 键全在场（漏键 = 该错误会裸回落「操作失败：」，用户看不到归因；
    // PROPOSAL_APPEND_TARGET = M6 T3 appendChanges 目标缺失/已 settled）
    expect([...thrown].sort()).toEqual([
      'BAD_PROPOSAL_ID',
      'PROPOSAL_APPEND_TARGET',
      'PROPOSAL_BAD_PARAMS',
      'PROPOSAL_CHAPTER_MISSING',
      'PROPOSAL_DUPLICATE',
      'PROPOSAL_INVALID',
      'PROPOSAL_MISSING',
      'PROPOSAL_TOO_LARGE'
    ])
    for (const prefix of thrown) {
      // 命中词表 → label 分支（返回值绝不是「操作失败：」回落形态）；漏翻译的会原样回落——两边可区分
      expect(
        proposalErrorText(`${prefix}: x`) !== `操作失败：${prefix}: x` &&
          proposalErrorText(`${prefix}: x`) !== '操作失败',
        `词表漏键: ${prefix}`
      ).toBe(true)
    }
  })
})
