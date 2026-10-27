// 提案仓库测试（M4b T3）：`.ai/proposals/<id>.yaml` = ProposalFile（docStore 原子写）。
// 纪律镜像五实体仓库：listProposals 坏档 warn（绝对路径）+ 跳过、点读抛穿（PROPOSAL_INVALID）、
// 缺失点读 → null；文件名 stem 即 id 权威；deleteProposal 幂等 false 不抛；
// 路径安全门 BAD_PROPOSAL_ID（提案 id 非 UUID——`prop-…` 形状，join 前必须拦 `../` 重定向）；
// markSettled 是 appliedIndexes/status 的唯一写入口（裁定：applied 追踪存文件内，重写维护）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { mkTmpBook } from '../../../tests/tmp'
import {
  computeProposalStatus,
  deleteProposal,
  getProposal,
  listProposals,
  loadProposalRaw,
  markSettled,
  sanitizeAppliedIndexes,
  writeProposal
} from './proposals'
import { newProposalId, proposalPath } from '../../../src/common/proposal'
import type { ProposalChange, ProposalFile } from '../../../src/common/proposal'

const CH1 = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'

function mkChange(over?: Partial<ProposalChange>): ProposalChange {
  return {
    op: 'create',
    entity: 'character',
    after: { name: '阿明' },
    source: { chapterId: CH1, quote: '她望向远山。' },
    ...over
  }
}

let seq = 0
function mkFile(over?: Partial<ProposalFile>): ProposalFile {
  seq += 1
  return {
    id: newProposalId(CH1, 1700000000000 + seq),
    chapterId: CH1,
    createdAt: new Date(Date.UTC(2026, 9, 28, 12, 0, seq)).toISOString(),
    aiModel: 'test-model',
    status: 'pending',
    changes: [mkChange()],
    ...over
  }
}

/** 绕过 writeProposal 校验直落盘（对抗输入/双保险测试用）。 */
function plantRaw(p: string, file: unknown): string {
  const id = (file as ProposalFile).id
  const abs = proposalPath(p, id)
  mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
  writeFileSync(abs, yaml.dump(file, { noRefs: true, lineWidth: 120 }), 'utf8')
  return abs
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// writeProposal + getProposal
// ---------------------------------------------------------------------------

describe('writeProposal / getProposal', () => {
  it('write 落盘 .ai/proposals/<id>.yaml，get 读回深度相等；文件内容过 validateProposal', () => {
    const p = mkTmpBook()
    const f = mkFile()
    expect(writeProposal(p, f)).toBe(f)
    const abs = proposalPath(p, f.id)
    expect(existsSync(abs)).toBe(true)
    expect(getProposal(p, f.id)).toEqual(f)
    expect(yaml.load(readFileSync(abs, 'utf8'))).toEqual(JSON.parse(JSON.stringify(f)))
  })

  it('stem 权威：文件内 id 字段被篡改后 getProposal 仍以文件名为准', () => {
    const p = mkTmpBook()
    const f = mkFile()
    // 文件名 = f.id，内容 id 字段 = 别的值（模拟手改/第三方写入）
    const abs = proposalPath(p, f.id)
    mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
    writeFileSync(abs, yaml.dump({ ...f, id: '被篡改的id' }, { noRefs: true }), 'utf8')
    expect(getProposal(p, f.id)?.id).toBe(f.id)
  })

  it('write 前校验：changes 空数组 → PROPOSAL_INVALID 抛且零落盘', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [] })
    expect(() => writeProposal(p, f)).toThrow(/PROPOSAL_INVALID/)
    expect(existsSync(proposalPath(p, f.id))).toBe(false)
  })

  it('id 路径安全门：`../../evil`、含分隔符、`.`、`..`、空串 → BAD_PROPOSAL_ID 且零落盘', () => {
    const p = mkTmpBook()
    for (const bad of ['../../evil', 'a/b', 'a\\b', '.', '..', '']) {
      const f = mkFile({ id: bad })
      expect(() => writeProposal(p, f), JSON.stringify(bad)).toThrow(/BAD_PROPOSAL_ID/)
      expect(() => getProposal(p, bad)).toThrow(/BAD_PROPOSAL_ID/)
    }
    // 重定向目标（书根上层 / .ai 根）都没有 evil.yaml 落下
    expect(existsSync(join(p, '.ai', 'evil.yaml'))).toBe(false)
    expect(existsSync(join(p, 'evil.yaml'))).toBe(false)
  })

  it('get 缺失 → null；坏字节 → PROPOSAL_INVALID 抛穿（含绝对路径）；可解析但非法同样抛穿', () => {
    const p = mkTmpBook()
    expect(getProposal(p, 'prop-nope-1')).toBeNull()
    const abs = proposalPath(p, 'prop-bad-1') // 正斜杠拼接（proposalPath 权威形状）
    mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
    writeFileSync(abs, '{{{ 不是 YAML', 'utf8')
    expect(() => getProposal(p, 'prop-bad-1')).toThrow(/PROPOSAL_INVALID/)
    try {
      getProposal(p, 'prop-bad-1')
    } catch (err) {
      expect((err as Error).message).toContain(abs) // warn/错误串带绝对路径
    }
    const f = mkFile({ status: 'archived' as ProposalFile['status'] })
    plantRaw(p, f)
    expect(() => getProposal(p, f.id)).toThrow(/status/)
  })

  it('appliedIndexes 宽容往返：缺失时读回不携键；存在时原样返回', () => {
    const p = mkTmpBook()
    const a = mkFile()
    writeProposal(p, a)
    expect('appliedIndexes' in (getProposal(p, a.id) as object)).toBe(false)
    const b = mkFile({ appliedIndexes: [0] })
    writeProposal(p, b)
    expect(getProposal(p, b.id)?.appliedIndexes).toEqual([0])
  })
})

// ---------------------------------------------------------------------------
// listProposals
// ---------------------------------------------------------------------------

describe('listProposals', () => {
  it('目录缺失 → []（从未整理过是常态）', () => {
    expect(listProposals(mkTmpBook())).toEqual([])
  })

  it('好档全收 + 坏档 warn（绝对路径）跳过 + 非 yaml 忽略；按 createdAt 升序（同刻按 id）', () => {
    const p = mkTmpBook()
    const later = mkFile() // seq 大 → createdAt 晚
    const earlier = mkFile()
    const earlyCopy: ProposalFile = { ...earlier, createdAt: '2026-10-01T00:00:00.000Z' }
    writeProposal(p, later)
    writeProposal(p, earlyCopy)
    // 坏档：可解析但结构非法
    plantRaw(p, mkFile({ changes: [] }))
    // 非 yaml 文件：忽略
    mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
    writeFileSync(join(p, '.ai', 'proposals', 'notes.txt'), 'x', 'utf8')

    const list = listProposals(p)
    expect(list.map((f) => f.id)).toEqual([earlyCopy.id, later.id])
    expect(console.warn).toHaveBeenCalledTimes(1)
    const warnMsg = vi.mocked(console.warn).mock.calls[0][0] as string
    expect(warnMsg).toContain(join(p, '.ai', 'proposals'))
    expect(warnMsg).toContain('跳过损坏提案文件')
  })

  it('坏档不进列表也不抛（一本坏提案不让面板瘫痪）', () => {
    const p = mkTmpBook()
    const abs = join(p, '.ai', 'proposals', 'prop-broken-1.yaml')
    mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
    writeFileSync(abs, '\t坏: [', 'utf8')
    expect(listProposals(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deleteProposal
// ---------------------------------------------------------------------------

describe('deleteProposal', () => {
  it('存在 → true 且文件消失；再删 → false；缺失 → false；坏 id → false（幂等契约不抛）', () => {
    const p = mkTmpBook()
    const f = mkFile()
    writeProposal(p, f)
    expect(deleteProposal(p, f.id)).toBe(true)
    expect(existsSync(proposalPath(p, f.id))).toBe(false)
    expect(deleteProposal(p, f.id)).toBe(false)
    expect(deleteProposal(p, 'prop-never-1')).toBe(false)
    expect(deleteProposal(p, '../../evil')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// markSettled / computeProposalStatus / sanitizeAppliedIndexes
// ---------------------------------------------------------------------------

describe('computeProposalStatus（纯函数）', () => {
  it('无采纳 → pending；部分 → partial；全清 → settled；0 条目视为全清', () => {
    expect(computeProposalStatus(3, 0)).toBe('pending')
    expect(computeProposalStatus(3, 1)).toBe('partial')
    expect(computeProposalStatus(3, 2)).toBe('partial')
    expect(computeProposalStatus(3, 3)).toBe('settled')
    expect(computeProposalStatus(0, 0)).toBe('settled')
  })
})

describe('sanitizeAppliedIndexes（纯函数）', () => {
  it('非数组 → []；越界/负数/非整数/NaN 过滤；去重升序', () => {
    expect(sanitizeAppliedIndexes('x', 3)).toEqual([])
    expect(sanitizeAppliedIndexes(undefined, 3)).toEqual([])
    expect(sanitizeAppliedIndexes([2, 0, 0, 5, -1, 1.5, NaN], 3)).toEqual([0, 2])
  })
})

describe('markSettled', () => {
  function threeChanges(p: string): ProposalFile {
    const f = mkFile({ changes: [mkChange(), mkChange(), mkChange()] })
    writeProposal(p, f)
    return f
  }

  it('采纳 2/3 → partial 且 appliedIndexes 落进文件；补最后一条 → settled', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    expect(markSettled(p, f.id, [1, 0])).toBe('partial')
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedIndexes).toEqual([0, 1]) // 去重升序
    expect(raw.proposal.status).toBe('partial')
    expect(markSettled(p, f.id, [2])).toBe('settled')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0, 1, 2])
  })

  it('重复上报同一索引幂等（并集去重）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    markSettled(p, f.id, [0])
    expect(markSettled(p, f.id, [0])).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0])
  })

  it('无采纳重写不携 appliedIndexes 键、status 回到 pending 计算（空上报 → pending）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    expect(markSettled(p, f.id, [])).toBe('pending')
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect('appliedIndexes' in onDisk).toBe(false)
  })

  it('越界索引被清洗（不进 appliedIndexes）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    expect(markSettled(p, f.id, [0, 7, -2])).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0])
  })

  it('缺失文件 → PROPOSAL_MISSING 抛', () => {
    expect(() => markSettled(mkTmpBook(), 'prop-nope-1', [0])).toThrow(/PROPOSAL_MISSING/)
  })
})

// ---------------------------------------------------------------------------
// loadProposalRaw（adopt/reject 的宽容装载口：结构门 + 逐条深校验留给引擎）
// ---------------------------------------------------------------------------

describe('loadProposalRaw', () => {
  it('文件级非法但结构可读 → 照常装载（双保险输入：delete×character 条目留给 adopt 逐条拒）', () => {
    const p = mkTmpBook()
    const f = mkFile({
      status: 'archived' as ProposalFile['status'],
      changes: [mkChange({ op: 'delete', entity: 'character', targetId: CH1, after: undefined })]
    })
    plantRaw(p, f)
    const { proposal, abs } = loadProposalRaw(p, f.id)
    expect(abs).toBe(proposalPath(p, f.id))
    expect(proposal.status).toBe('pending') // 非法枚举强制回 pending
    expect(proposal.changes).toHaveLength(1)
    expect(proposal.chapterId).toBe(CH1)
  })

  it('changes 非数组 / 坏字节 / 缺失 → PROPOSAL_INVALID 或 PROPOSAL_MISSING 抛', () => {
    const p = mkTmpBook()
    const f = mkFile()
    plantRaw(p, { ...f, changes: 'oops' })
    expect(() => loadProposalRaw(p, f.id)).toThrow(/PROPOSAL_INVALID/)
    const abs = plantRaw(p, mkFile({ id: 'prop-bad-2' }))
    writeFileSync(abs, '\t坏: [', 'utf8')
    expect(() => loadProposalRaw(p, 'prop-bad-2')).toThrow(/PROPOSAL_INVALID/)
    expect(() => loadProposalRaw(p, 'prop-nope-9')).toThrow(/PROPOSAL_MISSING/)
    expect(() => loadProposalRaw(p, '../evil')).toThrow(/BAD_PROPOSAL_ID/)
  })
})
