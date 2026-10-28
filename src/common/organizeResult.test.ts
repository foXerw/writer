// buildProposalFromAi 测试（M4b Task 4：AI 全文 → ProposalFile 的纯函数收口）。
// 钉死三条控制器结转裁定：
// - 裁定 1（盖章序）：chapterId 先盖进每条 change.source，再跑 validateProposal——
//   顺序反了则每条都栽在 UUID 形状检查上（organizePrompt 契约：AI 只输出 source.quote）；
// - 裁定 2（空 changes 语义）：changes 空/缺失 → empty（不落盘、不算错）；
// - 解析失败（extractJsonLoose 抛）→ parse-failed，不带任何原文回显。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProposalFromAi } from './organizeResult'
import { validateProposal } from './proposal'
import type { ProposalFile } from './proposal'
import { UUID_PATTERN } from './schema'

const CHAPTER_ID = '2f8a9c1e-7b3d-4e6f-9a1c-5d8e2f0b7a63'
const OTHER_CHAPTER = '11111111-2222-4333-8444-555555555555'

/** 一条形状完备的 create×character（source 刻意不带 chapterId——AI 契约如此）。 */
const goodChange = () => ({
  op: 'create',
  entity: 'character',
  after: { name: '林晚' },
  source: { quote: '林晚把伞靠在门边。' }
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T08:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('buildProposalFromAi：ok 路径（裁定 1 盖章序）', () => {
  it('合法 changes → 盖信封 + source.chapterId 注入每条 + validateProposal 通过', () => {
    const raw = JSON.stringify({ changes: [goodChange()] })
    const out = buildProposalFromAi(raw, CHAPTER_ID, 'claude-sonnet-4-5')
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    const file: ProposalFile = out.file
    expect(validateProposal(file)).toEqual([]) // 盖章先于校验——顺序错了这里必炸
    expect(file.changes[0].source.chapterId).toBe(CHAPTER_ID)
    expect(file.changes[0].source.quote).toBe('林晚把伞靠在门边。')
  })

  it('信封字段逐钉：id/createdAt/aiModel/status/chapterId（fake timers 定钟）', () => {
    const out = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), CHAPTER_ID, 'gpt-4o-mini')
    if (out.kind !== 'ok') return expect.unreachable()
    expect(out.file.id).toBe(`prop-${CHAPTER_ID.slice(0, 8)}-${Date.now().toString(36)}`)
    expect(out.file.createdAt).toBe('2026-10-28T08:00:00.000Z')
    expect(out.file.aiModel).toBe('gpt-4o-mini')
    expect(out.file.status).toBe('pending')
    expect(out.file.chapterId).toBe(CHAPTER_ID)
  })

  it('AI 擅自输出 source.chapterId（幻影章）→ 被整理章覆写，绝不采信', () => {
    const c = goodChange() as Record<string, unknown>
    c.source = { quote: '林晚把伞靠在门边。', chapterId: OTHER_CHAPTER }
    const out = buildProposalFromAi(JSON.stringify({ changes: [c] }), CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    expect(out.file.changes[0].source.chapterId).toBe(CHAPTER_ID)
  })

  it('多余外层字段（AI 违约输出 id/status）被忽略：信封以本地构造为准', () => {
    const raw = JSON.stringify({ id: 'hijacked', status: 'settled', changes: [goodChange()] })
    const out = buildProposalFromAi(raw, CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    expect(out.file.status).toBe('pending')
    expect(out.file.id).toBe(`prop-${CHAPTER_ID.slice(0, 8)}-${Date.now().toString(36)}`)
  })

  it('多条目盖章（T5 结转，Task 6 P3）：带 source.chapterId 与不带 source 的两条混合 → 逐条盖章、整份通过校验', () => {
    const withSource: Record<string, unknown> = {
      ...goodChange(),
      source: { quote: '林晚把伞靠在门边。', chapterId: OTHER_CHAPTER } // AI 违约复述 id
    }
    const bare: Record<string, unknown> = {
      op: 'create',
      entity: 'character',
      after: { name: '老周' },
      source: { quote: '老周敲了敲门。' } // 契约形状：source 无 chapterId
    }
    const out = buildProposalFromAi(JSON.stringify({ changes: [withSource, bare] }), CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    expect(out.file.changes).toHaveLength(2)
    // 两条都被盖整章 id（违约值被覆写、缺失值被兜底注入）
    expect(out.file.changes.map((c) => c.source.chapterId)).toEqual([CHAPTER_ID, CHAPTER_ID])
    expect(out.file.changes.map((c) => c.source.quote)).toEqual(['林晚把伞靠在门边。', '老周敲了敲门。'])
    expect(validateProposal(out.file)).toEqual([]) // 盖章后整份可过——不是单条特例
  })

  it('围栏包裹的合法输出同样通过（宽容解析在函数内生效）', () => {
    const out = buildProposalFromAi('整理如下：\n```json\n' + JSON.stringify({ changes: [goodChange()] }) + '\n```\n', CHAPTER_ID, 'm')
    expect(out.kind).toBe('ok')
  })
})

describe('buildProposalFromAi：empty 语义（裁定 2）', () => {
  it('changes:[] → empty', () => {
    expect(buildProposalFromAi('{"changes":[]}', CHAPTER_ID, 'm')).toEqual({ kind: 'empty' })
  })

  it('changes 缺失 → empty', () => {
    expect(buildProposalFromAi('{}', CHAPTER_ID, 'm')).toEqual({ kind: 'empty' })
  })

  it('changes 非数组（形状漂移）→ empty（不落盘也不判错——空语义从严从简）', () => {
    expect(buildProposalFromAi('{"changes":"无"}', CHAPTER_ID, 'm')).toEqual({ kind: 'empty' })
  })

  it('顶层非对象（JSON 数组/原始值）→ empty（.changes 读取按缺失处理，绝不抛）', () => {
    expect(buildProposalFromAi('[]', CHAPTER_ID, 'm')).toEqual({ kind: 'empty' })
    expect(buildProposalFromAi('null', CHAPTER_ID, 'm')).toEqual({ kind: 'empty' })
  })
})

describe('buildProposalFromAi：parse-failed 与 invalid 分路', () => {
  it('全文不是 JSON（extractJsonLoose 抛）→ parse-failed，不带原文', () => {
    const out = buildProposalFromAi('抱歉，我无法整理。', CHAPTER_ID, 'm')
    expect(out).toEqual({ kind: 'parse-failed' })
  })

  it('非法 op×entity → invalid + validateProposal 错误串（已盖章，错误不含 chapterId 形状问题）', () => {
    const out = buildProposalFromAi(
      JSON.stringify({ changes: [{ op: 'delete', entity: 'character', source: { quote: '删掉他' } }] }),
      CHAPTER_ID,
      'm'
    )
    expect(out.kind).toBe('invalid')
    if (out.kind !== 'invalid') return
    expect(out.errors.join('\n')).toContain('not allowed for entity')
    expect(out.errors.join('\n')).not.toContain('source.chapterId') // 盖章先行的直接证据
  })

  it('缺 source.quote → invalid；source 整体缺失也被盖章救形、由 quote 检查拦截', () => {
    const noQuote = buildProposalFromAi(
      JSON.stringify({ changes: [{ op: 'create', entity: 'character', after: {}, source: {} }] }),
      CHAPTER_ID,
      'm'
    )
    expect(noQuote.kind).toBe('invalid')

    const noSource = buildProposalFromAi(
      JSON.stringify({ changes: [{ op: 'create', entity: 'character', after: {} }] }),
      CHAPTER_ID,
      'm'
    )
    expect(noSource.kind).toBe('invalid')
    if (noSource.kind !== 'invalid') return
    expect(noSource.errors.join('\n')).toContain('source.quote')
  })

  it('aiModel 为空串 → invalid（validateProposal 非空字符串门，落盘前拒掉而非静默造假名）', () => {
    const out = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), CHAPTER_ID, '')
    expect(out.kind).toBe('invalid')
  })

  it('chapterId 非 UUID → invalid（信封与 source 双双被 UUID 门拦下）', () => {
    const out = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), 'not-a-uuid', 'm')
    expect(out.kind).toBe('invalid')
    if (out.kind !== 'invalid') return
    expect(out.errors.join('\n')).toContain('UUID')
  })
})

// ---------------------------------------------------------------------------
// M4c-1：cid 盖章——记账主键自出生即稳定（adopt/markSettled/reject 键域的源头）
// ---------------------------------------------------------------------------

describe('buildProposalFromAi × cid 盖章（M4c-1）', () => {
  it('每条 change 注入唯一 cid（UUID 形状），整份过校验', () => {
    const raw = JSON.stringify({
      changes: [
        goodChange(),
        { ...goodChange(), after: { name: '老周' }, source: { quote: '老周敲了敲门。' } }
      ]
    })
    const out = buildProposalFromAi(raw, CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    const cids = out.file.changes.map((c) => c.cid)
    expect(cids).toHaveLength(2)
    expect(cids.every((x) => typeof x === 'string' && UUID_PATTERN.test(x as string))).toBe(true)
    expect(new Set(cids).size).toBe(2) // 同批互异
    expect(validateProposal(out.file)).toEqual([])
  })

  it('AI 违约自带 cid → 一律新鲜盖章覆写，绝不采信（与 chapterId 盖章同立场）', () => {
    const c = { ...goodChange(), cid: 'hijacked-cid' } as Record<string, unknown>
    const out = buildProposalFromAi(JSON.stringify({ changes: [c] }), CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    const cid = out.file.changes[0].cid
    expect(cid).not.toBe('hijacked-cid')
    expect(UUID_PATTERN.test(cid as string)).toBe(true)
  })

  it('两次 build 的 cid 互不相同（每条新鲜随机，跨提案也不复用）', () => {
    const a = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), CHAPTER_ID, 'm')
    const b = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), CHAPTER_ID, 'm')
    if (a.kind !== 'ok' || b.kind !== 'ok') return expect.unreachable()
    expect(a.file.changes[0].cid).not.toBe(b.file.changes[0].cid)
  })

  it('cid 排在条目首位（盖章字段前置，YAML 落盘可读性；source 盖章纪律不受影响）', () => {
    const out = buildProposalFromAi(JSON.stringify({ changes: [goodChange()] }), CHAPTER_ID, 'm')
    if (out.kind !== 'ok') return expect.unreachable()
    expect(Object.keys(out.file.changes[0])[0]).toBe('cid')
    expect(out.file.changes[0].source.chapterId).toBe(CHAPTER_ID)
  })
})
