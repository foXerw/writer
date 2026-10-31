// proposal:* handler 级测试（M4b T3）：vi.mock('electron') 捕获注册后直接调用，
// 钉死 5 通道的薄委托 + 参数形状（全部 {projectPath, …} 对象参数，控制器裁定）。
// 双保险姿态：proposal:save 在主进程再跑一次 validateProposal（渲染层 T4 已验过一次）+
// chapterId 盖章（不是现存章 → PROPOSAL_CHAPTER_MISSING 拒落）；引擎语义本身在
// bookStore/adopt.test.ts 全量钉死，这里只测委托与通道级错误。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkTmpBook } from '../../../../tests/tmp'
import { changeKey, newProposalId, proposalPath } from '../../../../src/common/proposal'
import type {
  ProposalAdoptResult,
  ProposalChange,
  ProposalFile
} from '../../../../src/common/proposal'
import { UUID_PATTERN } from '../../../../src/common/schema'
import { createChapter } from '../../bookStore/chapters'
import { listCharacters } from '../../bookStore/characters'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>
    ): void => {
      handlers.set(channel, listener)
    }
  }
}))

import { registerProposalHandlers } from './proposal'

beforeAll(() => {
  registerProposalHandlers()
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

let seq = 0
function mkFile(chapterId: string): ProposalFile {
  seq += 1
  return {
    id: newProposalId(chapterId, 1700000000000 + seq),
    chapterId,
    createdAt: new Date().toISOString(),
    aiModel: 'test-model',
    status: 'pending',
    changes: [
      {
        op: 'create',
        entity: 'character',
        after: {
          name: '阿明',
          gender: 'male',
          age: 24,
          role: 'protagonist',
          appearance: '黑发青衫',
          personality: '沉稳',
          background: '海边长大',
          relationships: [],
          arc: [],
          tags: [],
          links: []
        },
        source: { chapterId, quote: '她望向远山，低声念出一个名字。' }
      }
    ]
  }
}

/** 合法的待追加条目（无 cid——appendChanges 负责盖 randomUUID；审阅转化形状的代表）。 */
function mkAppendChange(chapterId: string): ProposalChange {
  return {
    op: 'update',
    entity: 'summary',
    targetId: chapterId,
    after: { text: '审阅转化：摘要补充。' },
    source: { chapterId, quote: '审阅意见引文：节奏拖沓。' }
  }
}

describe('proposal:save 双保险 + 盖章', () => {
  it('合法文件 + 现存章 → 落盘并可 getAll/get 读回', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    const saved = (await getHandler('proposal:save')(null, { projectPath: p, file })) as ProposalFile
    expect(saved.id).toBe(file.id)
    expect(existsSync(proposalPath(p, file.id))).toBe(true)
    const all = (await getHandler('proposal:getAll')(null, { projectPath: p })) as ProposalFile[]
    expect(all.map((f) => f.id)).toEqual([file.id])
    const one = (await getHandler('proposal:get')(null, { projectPath: p, id: file.id })) as ProposalFile | null
    expect(one?.chapterId).toBe(ch.id)
  })

  it('主进程再校验：changes 空数组 → PROPOSAL_INVALID 拒落（即使渲染层漏检）', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    file.changes = []
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file }))
    ).rejects.toThrow(/PROPOSAL_INVALID/)
    expect(existsSync(proposalPath(p, file.id))).toBe(false)
  })

  it('条目数上限：201 条 → PROPOSAL_TOO_LARGE 拒落；200 条边界放行', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    file.changes = new Array(201).fill(file.changes[0])
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file }))
    ).rejects.toThrow(/PROPOSAL_TOO_LARGE: 201 > 200/)
    expect(existsSync(proposalPath(p, file.id))).toBe(false)
    const edge: ProposalFile = { ...file, changes: new Array(200).fill(file.changes[0]) }
    const saved = (await getHandler('proposal:save')(null, { projectPath: p, file: edge })) as ProposalFile
    expect(saved.changes).toHaveLength(200)
  })

  it('同章去重闸门（Task 6 P2）：已有 pending 提案 → 第二份拒 PROPOSAL_DUPLICATE；全部采纳（settled）后放行', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const first = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file: first })
    // 模拟另一窗口/第二次整理产出的同章提案（id 不同、chapterId 相同）
    const second = mkFile(ch.id)
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file: second }))
    ).rejects.toThrow(`PROPOSAL_DUPLICATE: ${ch.id}`)
    expect(existsSync(proposalPath(p, second.id))).toBe(false)
    // 消化第一份 → settled：同章可再收新提案（闸门只拦未消化的）
    await getHandler('proposal:adopt')(null, {
      projectPath: p,
      proposalId: first.id,
      changeKeys: [changeKey(first.changes[0], 0)],
      confirmedOverwrite: []
    })
    const third = mkFile(ch.id)
    const saved = (await getHandler('proposal:save')(null, {
      projectPath: p,
      file: third
    })) as ProposalFile
    expect(existsSync(proposalPath(p, saved.id))).toBe(true)
  })

  it('盖章：chapterId 不是现存章 → PROPOSAL_CHAPTER_MISSING 拒落', async () => {
    const p = mkTmpBook()
    createChapter(p, '第一章')
    const ghost = randomUUID() // UUID 形状合法但书中无此章（幻觉/过期章 id）
    const file = mkFile(ghost)
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file }))
    ).rejects.toThrow(`PROPOSAL_CHAPTER_MISSING: ${ghost}`)
    expect(existsSync(proposalPath(p, file.id))).toBe(false)
  })
})

describe('proposal:getAll / get', () => {
  it('get 缺失 → null；getAll 空目录 → []', async () => {
    const p = mkTmpBook()
    expect(await getHandler('proposal:get')(null, { projectPath: p, id: 'prop-nope-1' })).toBeNull()
    expect(await getHandler('proposal:getAll')(null, { projectPath: p })).toEqual([])
  })
})

describe('proposal:adopt / reject 委托（M4c-1 键域参数）', () => {
  it('adopt {projectPath, proposalId, changeKeys, confirmedOverwrite} → 引擎结果对象（键域对账）', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file })
    const k0 = changeKey(file.changes[0], 0)
    const r = (await getHandler('proposal:adopt')(null, {
      projectPath: p,
      proposalId: file.id,
      changeKeys: [k0],
      confirmedOverwrite: []
    })) as ProposalAdoptResult
    expect(r).toEqual({ applied: [k0], refused: [] })
    expect(listCharacters(p).map((c) => c.name)).toEqual(['阿明'])
    const stored = (await getHandler('proposal:get')(null, { projectPath: p, id: file.id })) as ProposalFile | null
    expect(stored?.status).toBe('settled')
    expect(stored?.appliedCids).toEqual([k0]) // 双写：键域权威 + 位置投影
    expect(stored?.appliedIndexes).toEqual([0])
  })

  it('reject 全部条目 → 整份提案删除（文件消失，getAll 归零）', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file })
    await getHandler('proposal:reject')(null, {
      projectPath: p,
      proposalId: file.id,
      changeKeys: [changeKey(file.changes[0], 0)]
    })
    expect(existsSync(proposalPath(p, file.id))).toBe(false)
    expect(await getHandler('proposal:getAll')(null, { projectPath: p })).toEqual([])
  })
})

// M6 T3 additive：审阅转化意见并入本章既有未消化提案（尾部追加、cid 盖章、闸门不动）。
describe('proposal:appendChanges（M6 T3 additive 合并）', () => {
  it('append 到 unsettled → 返回更新后全文：尾部追加（首条逐字、位置键稳定）+ 追加条 cid 盖章 UUID', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file })
    const updated = (await getHandler('proposal:appendChanges')(null, {
      projectPath: p,
      proposalId: file.id,
      changes: [mkAppendChange(ch.id)]
    })) as ProposalFile
    expect(updated.changes).toHaveLength(2)
    expect(updated.changes[0]).toEqual(file.changes[0]) // 头部的既有位置回退键 idx:0 不动
    expect(updated.changes[1]?.cid).toMatch(UUID_PATTERN) // 缺 cid → 引擎盖 randomUUID
    expect(updated.status).toBe('pending')
    const stored = (await getHandler('proposal:get')(null, {
      projectPath: p,
      id: file.id
    })) as ProposalFile | null
    expect(stored).toEqual(updated) // 返回值 = 盘上全文
  })

  it('目标 settled（全量采纳后）→ 拒 PROPOSAL_APPEND_TARGET: <id>，盘字节不变', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file })
    await getHandler('proposal:adopt')(null, {
      projectPath: p,
      proposalId: file.id,
      changeKeys: [changeKey(file.changes[0], 0)],
      confirmedOverwrite: []
    })
    const abs = proposalPath(p, file.id)
    const before = readFileSync(abs, 'utf8')
    await expect(
      Promise.resolve().then(() =>
        getHandler('proposal:appendChanges')(null, {
          projectPath: p,
          proposalId: file.id,
          changes: [mkAppendChange(ch.id)]
        })
      )
    ).rejects.toThrow(`PROPOSAL_APPEND_TARGET: ${file.id}`)
    expect(readFileSync(abs, 'utf8')).toBe(before)
  })

  it('目标缺文件 → 拒 PROPOSAL_APPEND_TARGET: <id> 且不造文件', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    await expect(
      Promise.resolve().then(() =>
        getHandler('proposal:appendChanges')(null, {
          projectPath: p,
          proposalId: 'prop-nope-7',
          changes: [mkAppendChange(ch.id)]
        })
      )
    ).rejects.toThrow('PROPOSAL_APPEND_TARGET: prop-nope-7')
    expect(existsSync(proposalPath(p, 'prop-nope-7'))).toBe(false)
  })

  it('坏形状条目混在好条目里 → 整拒零写（PROPOSAL_INVALID 带 append.changes[1] 路径，原文件字节恒等）', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const file = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file })
    const abs = proposalPath(p, file.id)
    const before = readFileSync(abs, 'utf8')
    const bad: ProposalChange = {
      op: 'delete',
      entity: 'character', // 组合表禁 delete×character（AI 无权删人写法）
      targetId: 'x-1',
      source: { chapterId: ch.id, quote: '坏条目。' }
    }
    await expect(
      Promise.resolve().then(() =>
        getHandler('proposal:appendChanges')(null, {
          projectPath: p,
          proposalId: file.id,
          changes: [mkAppendChange(ch.id), bad]
        })
      )
    ).rejects.toThrow(/PROPOSAL_INVALID: .*append\.changes\[1\]/)
    expect(readFileSync(abs, 'utf8')).toBe(before)
  })

  it('闸门回归：appendChanges 存在不放宽 proposal:save 的 DUPLICATE 闸门（append 后同章第二份仍拒）', async () => {
    const p = mkTmpBook()
    const ch = createChapter(p, '第一章')
    const first = mkFile(ch.id)
    await getHandler('proposal:save')(null, { projectPath: p, file: first })
    await getHandler('proposal:appendChanges')(null, {
      projectPath: p,
      proposalId: first.id,
      changes: [mkAppendChange(ch.id)]
    })
    const second = mkFile(ch.id)
    await expect(
      Promise.resolve().then(() => getHandler('proposal:save')(null, { projectPath: p, file: second }))
    ).rejects.toThrow(`PROPOSAL_DUPLICATE: ${ch.id}`)
    expect(existsSync(proposalPath(p, second.id))).toBe(false)
  })
})
