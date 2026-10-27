import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import {
  ALLOWED_OPS,
  PROPOSALS_DIR,
  PROPOSAL_ENTITIES,
  PROPOSAL_OPS,
  PROPOSAL_STATUSES,
  newProposalId,
  proposalPath,
  validateChange,
  validateProposal
} from './proposal'
import type { ProposalEntity, ProposalOp } from './proposal'

// 固定合法 UUID（与 schema.test.ts 同风格），供各测试复用
const CHAPTER_ID = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'
const TARGET_ID = 'b7d9e2f4-1a3c-4b5d-9e6f-0a1b2c3d4e5f'

function validSource(): Record<string, unknown> {
  return { chapterId: CHAPTER_ID, quote: '她望向远山，低声念出一个名字。' }
}

function validChange(): Record<string, unknown> {
  return {
    op: 'update',
    entity: 'character',
    targetId: TARGET_ID,
    before: { personality: '沉默' },
    after: { personality: '反抗' },
    source: validSource(),
    overwritesHuman: true
  }
}

function validFile(): Record<string, unknown> {
  return {
    id: 'prop-3f2b6c1a-m0z8k1x',
    chapterId: CHAPTER_ID,
    createdAt: '2026-10-28T12:00:00.000Z',
    aiModel: 'claude-sonnet-4-5',
    status: 'pending',
    changes: [validChange()]
  }
}

/** 按 op 的必备字段构造最小合法条目（组合表遍历用）。 */
function changeFor(op: ProposalOp, entity: ProposalEntity): Record<string, unknown> {
  const c: Record<string, unknown> = { op, entity, source: validSource() }
  if (op !== 'create') c.targetId = TARGET_ID
  if (op !== 'delete') c.after = { title: '新值' }
  return c
}

// ---------------------------------------------------------------------------
// 组合表（单一权威：T3 门控 / T5 渲染徽章都读它）
// ---------------------------------------------------------------------------

describe('ALLOWED_OPS 组合表', () => {
  it('钉死 spec 分工：create 六类、update 七类、delete 仅 plotline/choice/foreshadow', () => {
    expect(ALLOWED_OPS).toEqual({
      character: ['create', 'update'],
      world: ['create', 'update'],
      plotline: ['create', 'update', 'delete'],
      choice: ['create', 'update', 'delete'],
      foreshadow: ['create', 'update', 'delete'],
      summary: ['create', 'update'],
      index: ['update']
    })
  })

  it('常量枚举集合与组合表键一致', () => {
    expect([...PROPOSAL_OPS]).toEqual(['create', 'update', 'delete'])
    expect([...PROPOSAL_ENTITIES].sort()).toEqual(Object.keys(ALLOWED_OPS).sort())
    expect([...PROPOSAL_STATUSES].sort()).toEqual(['partial', 'pending', 'settled'])
  })

  it('遍历组合表：所有合法 (op, entity) 均通过 validateChange', () => {
    for (const entity of PROPOSAL_ENTITIES) {
      for (const op of ALLOWED_OPS[entity]) {
        expect(validateChange(changeFor(op, entity))).toEqual([])
      }
    }
  })

  it('遍历组合表：所有非法 (op, entity) 均被拒绝且错误串带 op 与 entity', () => {
    for (const entity of PROPOSAL_ENTITIES) {
      for (const op of PROPOSAL_OPS) {
        if (ALLOWED_OPS[entity].includes(op)) continue
        const errors = validateChange(changeFor(op, entity))
        expect(errors.length, `${op} × ${entity} 应被拒绝`).toBeGreaterThan(0)
        expect(errors.some((e) => e.includes(op) && e.includes(entity))).toBe(true)
      }
    }
  })

  it('delete × character（人写法实体）被拒绝——AI 无权删人写法', () => {
    const c = changeFor('delete', 'character')
    expect(validateChange(c).some((e) => e.includes('character'))).toBe(true)
  })

  it('delete × world / delete × index / create × index 同样被拒绝', () => {
    expect(validateChange(changeFor('delete', 'world')).length).toBeGreaterThan(0)
    expect(validateChange(changeFor('delete', 'index')).length).toBeGreaterThan(0)
    expect(validateChange(changeFor('create', 'index')).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// validateChange 条目级规则
// ---------------------------------------------------------------------------

describe('validateChange', () => {
  it('最小合法对象返回 []', () => {
    expect(validateChange(validChange())).toEqual([])
  })

  it('非对象输入直接拒绝', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(validateChange(bad).length).toBeGreaterThan(0)
    }
  })

  it('未知 op 字符串（如 "rename"）被拒绝且错误含 op', () => {
    const c = validChange()
    c.op = 'rename'
    expect(validateChange(c).some((e) => e.includes('op'))).toBe(true)
  })

  it('未知 entity 字符串（如 "outline"）被拒绝且错误含 entity', () => {
    const c = validChange()
    c.entity = 'outline'
    expect(validateChange(c).some((e) => e.includes('entity'))).toBe(true)
  })

  it('create 必有 after；缺失时报错含 after', () => {
    const c = changeFor('create', 'character')
    expect(validateChange(c)).toEqual([])
    delete c.after
    expect(validateChange(c).some((e) => e.includes('after'))).toBe(true)
  })

  it('update 必有 targetId + after，各自缺失分别报错', () => {
    const noTarget = validChange()
    delete noTarget.targetId
    expect(validateChange(noTarget).some((e) => e.includes('targetId'))).toBe(true)

    const noAfter = validChange()
    delete noAfter.after
    expect(validateChange(noAfter).some((e) => e.includes('after'))).toBe(true)
  })

  it('delete 必有 targetId；不要求 after', () => {
    const c = changeFor('delete', 'foreshadow')
    expect(validateChange(c)).toEqual([])
    delete c.targetId
    expect(validateChange(c).some((e) => e.includes('targetId'))).toBe(true)
  })

  it('targetId 存在但为空白串视为缺失', () => {
    const c = validChange()
    c.targetId = '   '
    expect(validateChange(c).some((e) => e.includes('targetId'))).toBe(true)
  })

  it('before 是自由 unknown：缺省或任意结构都不报错（深校验在采纳期）', () => {
    const c = validChange()
    delete c.before
    expect(validateChange(c)).toEqual([])
    c.before = { whatever: [1, 2, { deep: true }] }
    expect(validateChange(c)).toEqual([])
  })

  it('after 接受任意 unknown（对象/数组/字符串均可）', () => {
    const c = changeFor('update', 'index')
    c.after = '整本书的目录文本'
    expect(validateChange(c)).toEqual([])
    c.after = [1, 2, 3]
    expect(validateChange(c)).toEqual([])
  })

  it('source 缺失或非对象报错含 source', () => {
    const c = validChange()
    delete c.source
    expect(validateChange(c).some((e) => e.includes('source'))).toBe(true)
    c.source = 'text'
    expect(validateChange(c).some((e) => e.includes('source'))).toBe(true)
  })

  it('source.chapterId 非 UUID 报错含 chapterId', () => {
    const c = validChange()
    ;(c.source as Record<string, unknown>).chapterId = 'ch-3'
    expect(validateChange(c).some((e) => e.includes('chapterId'))).toBe(true)
  })

  it('quote 空串/纯空白报错含 quote', () => {
    for (const q of ['', '   ', '\u3000\t']) {
      const c = validChange()
      ;(c.source as Record<string, unknown>).quote = q
      expect(validateChange(c).some((e) => e.includes('quote'))).toBe(true)
    }
  })

  it('quote 长 300 容忍、301 拒绝（prompt 约定 120，硬上限 300 只拦病理输出）', () => {
    const ok = validChange()
    ;(ok.source as Record<string, unknown>).quote = '谜'.repeat(300)
    expect(validateChange(ok)).toEqual([])

    const tooLong = validChange()
    ;(tooLong.source as Record<string, unknown>).quote = 'a'.repeat(301)
    expect(validateChange(tooLong).some((e) => e.includes('quote'))).toBe(true)
  })

  it('quote 非字符串报错', () => {
    const c = validChange()
    ;(c.source as Record<string, unknown>).quote = 123
    expect(validateChange(c).some((e) => e.includes('quote'))).toBe(true)
  })

  it('overwritesHuman 仅在 update 时要求 boolean；create/delete 上出现被容忍（忽略不报错）', () => {
    const c = validChange()
    c.overwritesHuman = 'yes'
    expect(validateChange(c).some((e) => e.includes('overwritesHuman'))).toBe(true)

    const create = changeFor('create', 'world')
    create.overwritesHuman = true
    expect(validateChange(create)).toEqual([])

    const del = changeFor('delete', 'choice')
    del.overwritesHuman = false
    expect(validateChange(del)).toEqual([])
  })

  it('未知多余字段容忍（向前兼容，与 schema.ts 同口径）', () => {
    const c = validChange()
    c.futureField = { anything: 1 }
    expect(validateChange(c)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// validateProposal 文件级规则
// ---------------------------------------------------------------------------

describe('validateProposal', () => {
  it('最小合法文件返回 []', () => {
    expect(validateProposal(validFile())).toEqual([])
  })

  it('非对象输入直接拒绝', () => {
    for (const bad of [null, undefined, 'x', 7, []]) {
      expect(validateProposal(bad).length).toBeGreaterThan(0)
    }
  })

  it('三种 status 全部接受（状态迁移由 T3 管理，此处只查枚举归属）', () => {
    for (const status of ['pending', 'partial', 'settled']) {
      const f = validFile()
      f.status = status
      expect(validateProposal(f)).toEqual([])
    }
  })

  it('status 枚举外值（如 "archived"）报错含 status', () => {
    const f = validFile()
    f.status = 'archived'
    expect(validateProposal(f).some((e) => e.includes('status'))).toBe(true)
  })

  it('changes 为空数组被拒绝（提案必须携带至少一条改动）', () => {
    const f = validFile()
    f.changes = []
    expect(validateProposal(f).some((e) => e.includes('changes'))).toBe(true)
  })

  it('changes 缺失 / 非数组被拒绝', () => {
    const f = validFile()
    delete f.changes
    expect(validateProposal(f).some((e) => e.includes('changes'))).toBe(true)
    f.changes = 'oops'
    expect(validateProposal(f).some((e) => e.includes('changes'))).toBe(true)
  })

  it('逐条下钻：非法条目错误带 changes[索引] 路径', () => {
    const f = validFile()
    f.changes = [validChange(), changeFor('delete', 'character')]
    const errors = validateProposal(f)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((e) => e.startsWith('proposal.changes[0]') || e.startsWith('proposal.changes[1]'))).toBe(
      true
    )
    expect(errors.some((e) => e.includes('changes[1]') && e.includes('character'))).toBe(true)
  })

  it('文件级必填字段缺失各自报错', () => {
    for (const field of ['id', 'chapterId', 'createdAt', 'aiModel', 'status', 'changes']) {
      const f = validFile()
      delete f[field]
      expect(validateProposal(f).some((e) => e.includes(field)), `缺 ${field}`).toBe(true)
    }
  })

  it('id 空白串报错；chapterId 非 UUID 报错', () => {
    const f = validFile()
    f.id = ' '
    expect(validateProposal(f).some((e) => e.includes('id'))).toBe(true)

    const g = validFile()
    g.chapterId = 'chapter-12'
    expect(validateProposal(g).some((e) => e.includes('chapterId'))).toBe(true)
  })

  it('不校验引用完整性：file.chapterId 与 change.source.chapterId 不一致不报错（repository 层职责）', () => {
    const f = validFile()
    f.chapterId = TARGET_ID
    expect(validateProposal(f)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 路径与 ID 纯函数
// ---------------------------------------------------------------------------

describe('proposalPath / PROPOSALS_DIR', () => {
  it('PROPOSALS_DIR 常量钉死为 .ai/proposals', () => {
    expect(PROPOSALS_DIR).toBe('.ai/proposals')
  })

  it('拼接为 <bookDir>/.ai/proposals/<id>.yaml，尾部分隔符归一', () => {
    expect(proposalPath('/books/dusk', 'prop-3f2b6c1a-m0z8k1x')).toBe(
      '/books/dusk/.ai/proposals/prop-3f2b6c1a-m0z8k1x.yaml'
    )
    expect(proposalPath('C:\\books\\dusk', 'x')).toBe('C:\\books\\dusk/.ai/proposals/x.yaml')
    for (const dir of ['/books/dusk/', '/books/dusk\\', '/books/dusk//']) {
      expect(proposalPath(dir, 'x')).toBe('/books/dusk/.ai/proposals/x.yaml')
      expect(proposalPath(dir, 'x')).toBe(proposalPath('/books/dusk', 'x'))
    }
  })

  it('bookDir 为空串时返回相对路径', () => {
    expect(proposalPath('', 'x')).toBe('.ai/proposals/x.yaml')
  })
})

describe('newProposalId', () => {
  it('格式 = prop-<chapterId 前 8 位>-<ts 的 36 进制>，注入 ts 可确定性测试', () => {
    const ts = 1730000000000
    expect(newProposalId(CHAPTER_ID, ts)).toBe(`prop-3f2b6c1a-${ts.toString(36)}`)
  })

  it('同输入同输出；不同 ts 产出不同 id', () => {
    expect(newProposalId(CHAPTER_ID, 1)).toBe(newProposalId(CHAPTER_ID, 1))
    expect(newProposalId(CHAPTER_ID, 1)).not.toBe(newProposalId(CHAPTER_ID, 2))
  })
})

// ---------------------------------------------------------------------------
// YAML 往返（模拟 T3 经 docStore 的 dump/load 序列化口径）
// ---------------------------------------------------------------------------

describe('js-yaml 往返', () => {
  it('dump → load → validateProposal 返回 []，ISO 字符串不被解析成 Date', () => {
    const original = validFile()
    const text = yaml.dump(original, { noRefs: true, lineWidth: 120 })
    const loaded = yaml.load(text)
    expect(validateProposal(loaded)).toEqual([])
    expect((loaded as Record<string, unknown>).createdAt).toBe('2026-10-28T12:00:00.000Z')
  })

  it('往返后与结构克隆深度相等（含嵌套 source 与 unknown after）', () => {
    const original = validFile()
    const loaded = yaml.load(yaml.dump(original, { noRefs: true, lineWidth: 120 }))
    expect(loaded).toEqual(JSON.parse(JSON.stringify(original)))
  })

  it('往返保留中文 quote 原样且仍通过校验', () => {
    const f = validFile()
    ;(f.changes as Record<string, unknown>[])[0].source = {
      chapterId: CHAPTER_ID,
      quote: '「山那边的火，是信号还是灾？」她不敢确定。'.repeat(4)
    }
    const loaded = yaml.load(yaml.dump(f, { noRefs: true, lineWidth: 120 }))
    expect(validateProposal(loaded)).toEqual([])
  })
})
