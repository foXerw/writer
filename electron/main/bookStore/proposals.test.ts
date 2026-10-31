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
  appendProposalChanges,
  computeProposalStatus,
  deleteProposal,
  getProposal,
  listProposals,
  loadProposalRaw,
  markSettled,
  sanitizeAppliedCids,
  sanitizeAppliedIndexes,
  writeProposal
} from './proposals'
import { changeKey, newProposalId, proposalPath } from '../../../src/common/proposal'
import type { ProposalChange, ProposalFile } from '../../../src/common/proposal'
import { UUID_PATTERN } from '../../../src/common/schema'

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

/** 键域（M4c-1 起 markSettled 收 changeKey 键集）：file 第 i 条的记账键。 */
function keyOf(f: ProposalFile, i: number): string {
  return changeKey(f.changes[i], i)
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

  it('appliedCids 往返（M4c-1）：缺失不携键；存在原样返回；形状漂移 write 前拒', () => {
    const p = mkTmpBook()
    const a = mkFile()
    writeProposal(p, a)
    expect('appliedCids' in (getProposal(p, a.id) as object)).toBe(false)
    const b = mkFile({ appliedCids: ['cid-a'] })
    writeProposal(p, b)
    expect(getProposal(p, b.id)?.appliedCids).toEqual(['cid-a'])
    const bad = mkFile({ appliedCids: 'oops' as unknown as string[] })
    expect(() => writeProposal(p, bad)).toThrow(/PROPOSAL_INVALID/)
    expect(existsSync(proposalPath(p, bad.id))).toBe(false)
  })

  it('cid 往返（M4c-1）：changes 内 cid 原样保留；同文件重复 cid → write 拒（文件级唯一性）', () => {
    const p = mkTmpBook()
    const ok = mkFile({ changes: [mkChange({ cid: 'cid-x' }), mkChange({ cid: 'cid-y' })] })
    writeProposal(p, ok)
    expect(getProposal(p, ok.id)?.changes.map((c) => c.cid)).toEqual(['cid-x', 'cid-y'])
    const dup = mkFile({ changes: [mkChange({ cid: 'same' }), mkChange({ cid: 'same' })] })
    expect(() => writeProposal(p, dup)).toThrow(/PROPOSAL_INVALID/)
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

describe('sanitizeAppliedCids（纯函数，M4c-1）', () => {
  it('非数组 → undefined（纯 legacy 文件不携键，权威链不静默切换）', () => {
    expect(sanitizeAppliedCids(undefined)).toBeUndefined()
    expect(sanitizeAppliedCids('x')).toBeUndefined()
    expect(sanitizeAppliedCids({ 0: 'a' })).toBeUndefined()
  })

  it('只留非空字符串、去重保序；空数组 → 空数组（键域权威、零采纳）', () => {
    expect(sanitizeAppliedCids(['a', 42, 'a', '', null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizeAppliedCids([])).toEqual([])
  })
})

describe('markSettled（M4c-1 键域 + 双写）', () => {
  function threeChanges(p: string, withCids = false): ProposalFile {
    const f = mkFile({
      changes: [0, 1, 2].map((i) => mkChange(withCids ? { cid: `cid-${i}-stable` } : undefined))
    })
    writeProposal(p, f)
    return f
  }

  it('采纳 2/3 → partial 且双账落进文件（appliedCids 并集 + appliedIndexes 位置投影）；补最后一条 → settled', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    const [k0, k1, k2] = [0, 1, 2].map((i) => keyOf(f, i))
    expect(markSettled(p, f.id, [k1, k0])).toBe('partial')
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedIndexes).toEqual([0, 1]) // 投影升序
    expect(raw.proposal.appliedCids).toEqual([k1, k0]) // 并集序：既有在前、批次在后
    expect(raw.proposal.status).toBe('partial')
    expect(markSettled(p, f.id, [k2])).toBe('settled')
    const raw2 = loadProposalRaw(p, f.id)
    expect(raw2.proposal.appliedIndexes).toEqual([0, 1, 2])
    expect(raw2.proposal.appliedCids).toEqual([k1, k0, k2])
  })

  it('双写等价（非 Negotiable #3）：appliedIndexes ≡ appliedCids 对当前 changes 的位置投影（cid 文件，同一原子写）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p, true)
    markSettled(p, f.id, ['cid-1-stable'])
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect(onDisk.appliedCids).toEqual(['cid-1-stable'])
    expect(onDisk.appliedIndexes).toEqual([1])
    markSettled(p, f.id, ['cid-0-stable'])
    const disk2 = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect(disk2.appliedCids).toEqual(['cid-1-stable', 'cid-0-stable'])
    expect(disk2.appliedIndexes).toEqual([0, 1]) // 投影与键域语义恒等（旧读者兼容面）
  })

  it('重复上报同一键幂等（并集去重）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    const k0 = keyOf(f, 0)
    markSettled(p, f.id, [k0])
    expect(markSettled(p, f.id, [k0])).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0])
    expect(loadProposalRaw(p, f.id).proposal.appliedCids).toEqual([k0])
  })

  it('空上报 → pending 且双账键都不携（与存量文件同形）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    expect(markSettled(p, f.id, [])).toBe('pending')
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect('appliedIndexes' in onDisk).toBe(false)
    expect('appliedCids' in onDisk).toBe(false)
  })

  it('未知/非法键被清洗（不在当前 changes 键域 → 不入账；旧「越界索引清洗」的键域等价物）', () => {
    const p = mkTmpBook()
    const f = threeChanges(p)
    const k0 = keyOf(f, 0)
    expect(markSettled(p, f.id, [k0, 'ghost-key', ''])).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0])
    expect(loadProposalRaw(p, f.id).proposal.appliedCids).toEqual([k0])
  })

  it('既有 appliedCids 里的漂移键（不在当前 changes）在重写时出账——账目恒指向活条目', () => {
    const p = mkTmpBook()
    const f = mkFile({
      changes: [mkChange({ cid: 'cid-0-stable' }), mkChange({ cid: 'cid-1-stable' })],
      appliedCids: ['cid-1-stable', 'cid-of-a-change-long-gone'] // 第三方改写留下的幽灵账
    })
    writeProposal(p, f)
    expect(markSettled(p, f.id, ['cid-0-stable'])).toBe('settled')
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedCids).toEqual(['cid-1-stable', 'cid-0-stable']) // 幽灵键被清洗
    expect(raw.proposal.appliedIndexes).toEqual([0, 1])
  })

  it('缺失文件 → PROPOSAL_MISSING 抛', () => {
    expect(() => markSettled(mkTmpBook(), 'prop-nope-1', ['x'])).toThrow(/PROPOSAL_MISSING/)
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

  it('appliedCids 宽容装载（M4c-1）：垃圾元素清洗去重；缺失 → undefined（纯 legacy 保持位置语义）', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [mkChange(), mkChange()] })
    plantRaw(p, { ...f, appliedCids: ['a', 42, 'a', '', null] })
    expect(loadProposalRaw(p, f.id).proposal.appliedCids).toEqual(['a'])
    const g = mkFile()
    plantRaw(p, g)
    expect(loadProposalRaw(p, g.id).proposal.appliedCids).toBeUndefined()
    // 空数组 = 键域权威、零采纳（第三方写过 appliedCids: [] 的文件不回落位置语义）
    const h = mkFile({ changes: [mkChange()] })
    plantRaw(p, { ...h, appliedCids: [], appliedIndexes: [0] })
    expect(loadProposalRaw(p, h.id).proposal.appliedCids).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// appendProposalChanges（M6 T3 additive 引擎口：审阅转化意见并入本章未消化提案，
// 尾部追加——既有 cid/位置回退键/applied 双账不动，DUPLICATE 闸门语义不受影响）
// ---------------------------------------------------------------------------

const CID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('appendProposalChanges（M6 T3 尾部追加）', () => {
  it('unsettled 目标：cid 缺省盖 UUID + 给定 cid 原样 + 尾部追加既有键稳定 + 返回更新后全文（与盘上读回一致）', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [mkChange(), mkChange({ cid: CID_A })] })
    writeProposal(p, f)
    const keysBefore = f.changes.map((c, i) => changeKey(c, i)) // 首条 = 位置回退键（changeKey 派生，grep 门禁内联字面量）
    const out = appendProposalChanges(p, f.id, [
      mkChange({ op: 'update', entity: 'world', targetId: 'w-1', after: { name: '新设定' } }), // 无 cid → 盖章
      mkChange({ cid: CID_B }) // 给定 cid → 原样
    ])
    expect(out.changes).toHaveLength(4)
    // 尾部追加：前两条逐字原样、既有键域不动（回退键与 cid 键前后恒等——index 稳定）
    expect(out.changes.slice(0, 2)).toEqual(f.changes)
    expect(out.changes.slice(0, 2).map((c, i) => changeKey(c, i))).toEqual(keysBefore)
    // cid 缺省盖 randomUUID（UUID 形状，非 idx: 前缀）；给定 cid 原样保留
    expect(out.changes[2]?.cid).toMatch(UUID_PATTERN)
    expect(changeKey(out.changes[2], 2)).toBe(out.changes[2]?.cid)
    expect(out.changes[3]?.cid).toBe(CID_B)
    // 信封不变：id/chapterId/createdAt/aiModel/status 原样，返回全文 == 盘上读回
    expect(out.id).toBe(f.id)
    expect(out.chapterId).toBe(f.chapterId)
    expect(out.createdAt).toBe(f.createdAt)
    expect(out.aiModel).toBe(f.aiModel)
    expect(out.status).toBe('pending')
    expect(getProposal(p, f.id)).toEqual(out)
  })

  it('partial 目标：applied 双账原样、追加条目未采纳、status 仍 partial（追加不改记账）', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [mkChange({ cid: CID_A }), mkChange({ cid: CID_B })] })
    writeProposal(p, f)
    expect(markSettled(p, f.id, [CID_A])).toBe('partial')
    const out = appendProposalChanges(p, f.id, [mkChange({ cid: CID_C })])
    expect(out.status).toBe('partial')
    expect(out.appliedCids).toEqual([CID_A])
    expect(out.appliedIndexes).toEqual([0])
    expect(out.changes).toHaveLength(3)
    expect(out.changes[2]?.cid).toBe(CID_C)
  })

  it('settled / 缺失目标 → PROPOSAL_APPEND_TARGET: <id>（settled 盘字节不变；缺失不造文件）', () => {
    const p = mkTmpBook()
    const settled = mkFile({ status: 'settled' })
    writeProposal(p, settled)
    const abs = proposalPath(p, settled.id)
    const before = readFileSync(abs, 'utf8')
    expect(() => appendProposalChanges(p, settled.id, [mkChange()])).toThrow(
      `PROPOSAL_APPEND_TARGET: ${settled.id}`
    )
    expect(readFileSync(abs, 'utf8')).toBe(before)
    expect(() => appendProposalChanges(p, 'prop-nope-3', [mkChange()])).toThrow(
      'PROPOSAL_APPEND_TARGET: prop-nope-3'
    )
    expect(existsSync(proposalPath(p, 'prop-nope-3'))).toBe(false)
  })

  it('任一坏形状条目 → 整拒零写（PROPOSAL_INVALID 带 append.changes[i] 路径；盘字节恒等）', () => {
    const p = mkTmpBook()
    const f = mkFile()
    writeProposal(p, f)
    const abs = proposalPath(p, f.id)
    const before = readFileSync(abs, 'utf8')
    expect(() =>
      appendProposalChanges(p, f.id, [
        mkChange({ cid: CID_A }), // 好条目也被整拒——不留半套
        mkChange({ op: 'delete', entity: 'character', targetId: CH1, after: undefined }) // 组合表禁 delete×character
      ])
    ).toThrow(/PROPOSAL_INVALID: .*append\.changes\[1\]/)
    expect(readFileSync(abs, 'utf8')).toBe(before)
  })

  it('追加条目 cid 与既有条目重复 → 整拒（merged 复跑 validateProposal 的文件级判重）', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [mkChange({ cid: CID_A })] })
    writeProposal(p, f)
    const abs = proposalPath(p, f.id)
    const before = readFileSync(abs, 'utf8')
    expect(() => appendProposalChanges(p, f.id, [mkChange({ cid: CID_A })])).toThrow(
      /PROPOSAL_INVALID: .*duplicate cid/
    )
    expect(readFileSync(abs, 'utf8')).toBe(before)
  })

  it('空追加 = 恒等重写（无条目可拒、既有内容与键不变）；坏 id 走 BAD_PROPOSAL_ID 路径门', () => {
    const p = mkTmpBook()
    const f = mkFile({ changes: [mkChange({ cid: CID_A })] })
    writeProposal(p, f)
    const out = appendProposalChanges(p, f.id, [])
    expect(out.changes).toEqual(f.changes)
    expect(() => appendProposalChanges(p, '../evil', [mkChange()])).toThrow(/BAD_PROPOSAL_ID/)
  })

  it('changes 非数组 → PROPOSAL_BAD_PARAMS 在任何处理前抛穿（adoptChanges changeKeys 守卫同款；盘字节恒等）', () => {
    const p = mkTmpBook()
    const f = mkFile()
    writeProposal(p, f)
    const abs = proposalPath(p, f.id)
    const before = readFileSync(abs, 'utf8')
    // 字符串带 length——若无前置守卫会溜进 forEach 在逐条校验处炸出错误码不稳定的消息
    expect(() =>
      appendProposalChanges(p, f.id, 'oops' as unknown as ProposalChange[])
    ).toThrow(/PROPOSAL_BAD_PARAMS/)
    expect(() =>
      appendProposalChanges(p, 'prop-nope-4', undefined as unknown as ProposalChange[])
    ).toThrow(/PROPOSAL_BAD_PARAMS/)
    expect(readFileSync(abs, 'utf8')).toBe(before)
    expect(existsSync(proposalPath(p, 'prop-nope-4'))).toBe(false)
  })
})
