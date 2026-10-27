import { describe, it, expect } from 'vitest'
import { ALLOWED_OPS, QUOTE_MAX_LENGTH } from './proposal'
import { budgetToMaxTokens, buildOrganizeContract, buildOrganizePrompt } from './organizePrompt'
import type { AssembledContext } from './ai-context'
import type { ForeshadowEntry } from './schema'

// 固定 UUID（与 proposal.test.ts 同风格）
const CHAPTER_ID = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'
const FS_ID_1 = '11111111-1111-4111-8111-111111111111'
const FS_ID_2 = '22222222-2222-4222-8222-222222222222'
const PLANTED_CH = '33333333-3333-4333-8333-333333333333'

function makeAssembled(): AssembledContext {
  return {
    messages: [
      { role: 'system', content: 'SYSTEM-SKELETON-MARKER' },
      { role: 'user', content: 'USER-BODY-MARKER 本章正文原样，不得增删一个字节。' }
    ],
    droppedFor: ['outline'],
    estTokens: 42
  }
}

function foreshadow(id: string, title: string, plantedChapterId: string): ForeshadowEntry {
  return {
    id,
    title,
    plantedChapterId,
    plannedPayoffNote: '按计划回收',
    resolvedChapterId: null,
    status: 'open'
  }
}

const PENDING: ForeshadowEntry[] = [
  foreshadow(FS_ID_1, '老剑的秘密', PLANTED_CH),
  foreshadow(FS_ID_2, '血月之约', CHAPTER_ID)
]

/** 取组合表中某 op 的实体行（格式钉死：`- <op>：<entities>`）。 */
function lineForOp(contract: string, op: string): string {
  const line = contract.split('\n').find((l) => l.startsWith(`- ${op}：`))
  expect(line, `组合表应含 op 行：${op}`).toBeTypeOf('string')
  return line as string
}

/** ALLOWED_OPS 值集合并（首现序），测试侧独立推导，与实现同源不同抄。 */
function opsInTable(): string[] {
  return Array.from(new Set(Object.values(ALLOWED_OPS).flat()))
}

// ---------------------------------------------------------------------------
// buildOrganizeContract —— 输出规约段
// ---------------------------------------------------------------------------

describe('buildOrganizeContract 组合表（渲染自 ALLOWED_OPS，勿手抄）', () => {
  it('每个 op 行的实体清单与 ALLOWED_OPS 逐字一致（改表即改 prompt，永不漂移）', () => {
    const contract = buildOrganizeContract()
    for (const op of opsInTable()) {
      const expected = Object.entries(ALLOWED_OPS)
        .filter(([, allowed]) => allowed.includes(op as never))
        .map(([entity]) => entity)
        .join(', ')
      expect(lineForOp(contract, op)).toBe(`- ${op}：${expected}`)
    }
  })

  it('delete 行恰为 plotline/choice/foreshadow，绝不含 character/world（分工铁律）', () => {
    const del = lineForOp(buildOrganizeContract(), 'delete')
    expect(del).toBe('- delete：plotline, choice, foreshadow')
    expect(del).not.toContain('character')
    expect(del).not.toContain('world')
  })

  it('update 行覆盖全部七类（含仅 update 的 index）', () => {
    expect(lineForOp(buildOrganizeContract(), 'update')).toContain('index')
  })
})

describe('buildOrganizeContract 规约条款', () => {
  const contract = buildOrganizeContract()

  it('引文规则：QUOTE_MAX_LENGTH 数值出现 + 逐字/原样找到', () => {
    expect(contract).toContain(String(QUOTE_MAX_LENGTH))
    expect(contract).toContain('逐字')
    expect(contract).toContain('原样找到')
  })

  it('JSON 契约形状：只输出一个 JSON 对象、changes 数组、source 仅 quote', () => {
    expect(contract).toContain('只输出一个 JSON 对象')
    expect(contract).toContain('"changes"')
    expect(contract).toContain('"source":{"quote"')
    expect(contract).toContain('overwritesHuman')
    expect(contract).toContain('targetId')
    expect(contract).toContain('after')
  })

  it('信封字段归系统：id/createdAt/aiModel/status 由系统补全', () => {
    expect(contract).toContain('createdAt')
    expect(contract).toContain('aiModel')
    expect(contract).toContain('由系统补全')
  })

  it('origin 铁律：人写字段必须 overwritesHuman:true；不得提议删除 character/world', () => {
    expect(contract).toContain('origin 铁律')
    expect(contract).toContain('overwritesHuman:true')
    expect(contract).toContain('不得提议删除 character 或 world')
  })

  it('输出纪律含无围栏；数量纪律宁缺毋滥；伏笔核销指令在列', () => {
    expect(contract).toContain('代码围栏')
    expect(contract).toContain('宁缺毋滥')
    expect(contract).toContain('待核销伏笔')
    expect(contract).toContain('update foreshadow')
  })

  it('确定性纯函数：两次调用逐字相等', () => {
    expect(buildOrganizeContract()).toBe(buildOrganizeContract())
  })
})

// ---------------------------------------------------------------------------
// buildOrganizePrompt —— 消息组装
// ---------------------------------------------------------------------------

describe('buildOrganizePrompt', () => {
  function build(pending: ForeshadowEntry[] = PENDING) {
    const assembled = makeAssembled()
    return { assembled, messages: buildOrganizePrompt({ assembled, chapterTitle: '断剑', chapterId: CHAPTER_ID, pendingForeshadows: pending }) }
  }

  it('输出保持 system+user 各一，角色序列不变', () => {
    const { messages } = build()
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('红线守卫：user 内容逐字节原样透传（装配器输出即最终，SENTINEL 语义由 T1/T5 钉）', () => {
    const { assembled, messages } = build()
    expect(messages[1].content).toBe(assembled.messages[1].content)
    expect(messages[1].content).toBe('USER-BODY-MARKER 本章正文原样，不得增删一个字节。')
  })

  it('system = 原骨架 + 追加段（章节 header/规约/伏笔清单），骨架原文在前完好', () => {
    const { messages } = build()
    const sys = messages[0].content
    expect(sys.startsWith('SYSTEM-SKELETON-MARKER')).toBe(true)
    expect(sys).toContain('《断剑》')
    expect(sys).toContain(CHAPTER_ID)
    expect(sys).toContain('【输出规约】')
    expect(sys).toContain('- delete：plotline, choice, foreshadow')
  })

  it('不改动入参：messages/对象逐字段与 structuredClone 快照一致', () => {
    const assembled = makeAssembled()
    const snapshot = structuredClone(assembled)
    const out = buildOrganizePrompt({ assembled, chapterTitle: '断剑', chapterId: CHAPTER_ID, pendingForeshadows: PENDING })
    expect(assembled).toEqual(snapshot)
    // 返回的 message 对象是新对象，不与入参共享引用（防下游误改）
    expect(out[1]).not.toBe(assembled.messages[1])
  })

  it('伏笔清单逐条渲染：`- <id> <title>（埋于 <plantedChapterId>）`', () => {
    const { messages } = build()
    expect(messages[0].content).toContain(`- ${FS_ID_1} 老剑的秘密（埋于 ${PLANTED_CH}）`)
    expect(messages[0].content).toContain(`- ${FS_ID_2} 血月之约（埋于 ${CHAPTER_ID}）`)
  })

  it('空清单 → 当前无待核销伏笔', () => {
    const { messages } = build([])
    expect(messages[0].content).toContain('当前无待核销伏笔')
    expect(messages[0].content).not.toContain(FS_ID_1)
  })

  it('无 system 消息时兜底：前置一条规约 system', () => {
    const assembled: AssembledContext = {
      messages: [{ role: 'user', content: 'ONLY-USER' }],
      droppedFor: [],
      estTokens: 1
    }
    const out = buildOrganizePrompt({ assembled, chapterTitle: '断剑', chapterId: CHAPTER_ID, pendingForeshadows: [] })
    expect(out[0].role).toBe('system')
    expect(out[0].content).toContain('【输出规约】')
    expect(out[1].content).toBe('ONLY-USER')
  })
})

// ---------------------------------------------------------------------------
// budgetToMaxTokens
// ---------------------------------------------------------------------------

describe('budgetToMaxTokens', () => {
  it('夹取 [2048, 16384]：小预算抬到地板，大预算封顶，中间线性透传', () => {
    expect(budgetToMaxTokens(100)).toBe(2048)
    expect(budgetToMaxTokens(0)).toBe(2048)
    expect(budgetToMaxTokens(2048)).toBe(2048)
    expect(budgetToMaxTokens(5000)).toBe(5000)
    expect(budgetToMaxTokens(16384)).toBe(16384)
    expect(budgetToMaxTokens(99999)).toBe(16384)
  })
})
