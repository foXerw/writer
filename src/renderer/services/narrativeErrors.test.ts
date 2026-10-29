// 叙事通道（plotline:*/choice:*/foreshadow:*）错误中文映射表单测（合并后加固批新建，
// 词表本体属 M4c-2 Task 5）。姿态与 proposalErrors.test.ts 同源：锚定前缀 → 中文 label，
// detail（冒号后原文）非空拼「label：detail」，未知回落「操作失败：<解包原文>」绝不吞真实原因。
// 加固点（item 4）：对锚定匹配【前】先 trim 解包文本——PREFIX_RE 与 proposalErrors 逐字节同式，
// 此前带前导空白的消息错过 ^[A-Z] 锚定、掉进泛化回落，两表不对称；本文件钉死对称面。
import { describe, expect, it } from 'vitest'
import { narrativeErrorText } from './narrativeErrors'

describe('narrativeErrorText × 词表锚定（Task 5 既有姿态回归）', () => {
  it('前缀归一 + detail 拼接可诊断；裸前缀（无 detail）只出标签', () => {
    expect(narrativeErrorText('REF_BROKEN: 3f2b6c1a')).toBe('引用了已不存在的章节或实体：3f2b6c1a')
    expect(narrativeErrorText('PLOTLINE_TITLE_INVALID')).toBe('剧情线标题不能为空白或含换行')
    expect(narrativeErrorText('FORESHADOW_INVALID:   ')).toBe('伏笔台账数据已损坏，应用未做任何修改')
  })

  it('真实通道 reject 形状：剥包装 + 裁 stack 后锚定匹配，展示面不背帧栈', () => {
    const raw =
      "Error invoking remote method 'choice:update': Error: CHOICE_MISSING: ch-1\n    at Object.<anonymous> (electron/main/ipc/modules/narrative.ts:88:15)"
    const t = narrativeErrorText(raw)
    expect(t).toBe('关键选项不存在（可能刚被删除）：ch-1')
    expect(t).not.toContain('at Object')
  })

  it('正文误路由防线：解包文本【不以】前缀开头时 REF_BROKEN 字样照常回落原文', () => {
    const raw = '保存失败：你在正文里引用了 REF_BROKEN 字样的示例'
    expect(narrativeErrorText(raw)).toBe(`操作失败：${raw}`)
  })

  it('[busy] tag 归一（在途门的场景防御）', () => {
    expect(narrativeErrorText('[busy] 整理仍在途')).toBe('已有请求在途：整理仍在途')
  })
})

describe('narrativeErrorText × trim 对称性（加固批 item 4，镜像 proposalErrors 姿态）', () => {
  it('前导空白的已知前缀 → 仍命中词表，不再掉进「操作失败：」泛化回落', () => {
    expect(
      narrativeErrorText('  FORESHADOW_INVALID: /book/foreshadow.yaml: ledger.entries: expected array')
    ).toBe('伏笔台账数据已损坏，应用未做任何修改：/book/foreshadow.yaml: ledger.entries: expected array')
    expect(narrativeErrorText('\n PLOTLINE_MISSING  ')).toBe('剧情线不存在（可能刚被删除）')
  })

  it('[busy] 尾随空白同样被 trim 归一（proposalErrors 的 unwrapped 同点）', () => {
    expect(narrativeErrorText('[busy] 整理仍在途  ')).toBe('已有请求在途：整理仍在途')
  })

  it('空 / 纯空白原文 → 裸「操作失败」（无悬空冒号，与 proposalErrors 同形）', () => {
    expect(narrativeErrorText('')).toBe('操作失败')
    expect(narrativeErrorText('   ')).toBe('操作失败')
  })
})
