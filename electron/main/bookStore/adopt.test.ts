// 采纳引擎测试（M4b T3 + M4c-1 键域迁移，tmp 书目录 + 真 repository，零仓库 mock）：
// - R1 origin 机制：aiTouched 语义（人写 = 非空 && 不在 aiTouched）；覆盖人写 → REFUSED: 覆盖人写内容 <field>；
//   overwritesHuman:true 未经 UI 确认 → REFUSED: 未确认覆盖；确认后落盘 + aiTouched 追加 + updatedAt 刷新；
//   create×character/world 播种 aiTouched = 所写非空字段名清单（裁定 A：AI 产字段不得伪装人写——
//   不播种则作者后续编辑这些字段永远无从比对）；
// - R2 __proto__ 加固：after 携 own '__proto__' 键 → 允许字段照常应用、Object.prototype 零污染、存量干净；
// - R3 逐实体深校验：create×character/world/plotline/choice/foreshadow 全形状校验（注入新 id+时间戳）、
//   update×foreshadow 仅 status/plannedPayoffNote/note、summary/index 落 .ai/ 的形狀与合并语义、
//   delete 仅限 plotline/choice/foreshadow 且 targetId 必须存在（delete×character 由 validateChange 双保险拒）；
// - 批次纪律：逐条 try/catch（一条坏不拖累整批）、applied/refused 对账、markSettled 键域双写记账、
//   重复采纳拒绝、非法/未知键拒绝、rejectChanges 按键摘除（空 → 整份删除）+ 双账同步收缩；
// - M4c-1 稳定键：通道参数 = changeKey 键集（cid ?? 位置回退键，单源 src/common/proposal.ts）。
//   判别性测试 = 跨窗口 reject 重排后按 cid 采纳「不误拒、不错放」（旧位置世界两案都会错位，
//   RED 证据见 task-1-report）；legacy 文件（无 cid 仅 appliedIndexes）三操作全链路位置语义兼容。
// - M4c-2 create 幂等（aiSource 令牌）：create×五实体落盘前按 aiSource={proposalId,条目键} 扫描
//   目标域——命中 = 已应用（计入 applied、不新建、绝不双胞胎）；未命中 → 创建并盖章令牌。
//   判别性测试 = markSettled 失败（账目回滚）后重试同批「计数不变 + applied 报键」（旧世界双胞胎，
//   M4b 终审 + M4c-1 钉死的最后残留窗口在此关闭）；update/delete 不注入不查询（既有幂等语义不动）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'
import { mkTmpBook } from '../../../tests/tmp'
import { FIELD_ALLOWLIST, adoptChanges, rejectChanges } from './adopt'
import { getProposal, loadProposalRaw, writeProposal } from './proposals'
import { createChapter, listChapters } from './chapters'
import { createCharacter, getCharacter, listCharacters, updateCharacter } from './characters'
import { createWorldEntry, getWorldEntry, listWorldEntries, updateWorldEntry } from './world'
import {
  createChoice,
  createPlotline,
  listChoices,
  listPlotlines,
  readLedger,
  resolveForeshadow,
  upsertForeshadow
} from './narrative'
import { characterIds, worldIds } from './refs'
import { aiIndexFile, chapterSummaryFile, foreshadowFile } from './paths'
import { changeKey, newProposalId, proposalPath } from '../../../src/common/proposal'
import type { ProposalChange, ProposalFile } from '../../../src/common/proposal'
import type { Chapter } from '../../../src/common/ipc'
import type { ForeshadowEntry } from '../../../src/common/schema'
import { validateForeshadowEntry } from '../../../src/common/schema'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

let idSeq = 0
function nextProposalId(): string {
  idSeq += 1
  return newProposalId('3f2b6c1a', 1700000000000 + idSeq)
}

function mkChange(chapterId: string, over?: Partial<ProposalChange>): ProposalChange {
  return {
    op: 'create',
    entity: 'character',
    after: {},
    source: { chapterId, quote: '她望向远山，低声念出一个名字。' },
    ...over
  }
}

function mkProposal(chapterId: string, changes: unknown[], over?: Partial<ProposalFile>): ProposalFile {
  return {
    id: nextProposalId(),
    chapterId,
    createdAt: new Date().toISOString(),
    aiModel: 'test-model',
    status: 'pending',
    changes: changes as ProposalChange[],
    ...over
  }
}

/** 合法提案走仓库正门（writeProposal 前置校验）。 */
function plant(p: string, chapterId: string, changes: unknown[]): ProposalFile {
  const f = mkProposal(chapterId, changes)
  writeProposal(p, f)
  return f
}

/** 非法提案绕过校验直落盘（对抗输入 / validateChange 双保险测试专用）。 */
function plantBypass(p: string, file: unknown): void {
  const f = file as ProposalFile
  mkdirSync(join(p, '.ai', 'proposals'), { recursive: true })
  writeFileSync(proposalPath(p, f.id), yaml.dump(file, { noRefs: true, lineWidth: 120 }), 'utf8')
}

/** 键域（M4c-1）：file 第 i 条的记账键（cid ?? 位置回退键——changeKey 单源）。 */
function keyOf(f: ProposalFile, i: number): string {
  return changeKey(f.changes[i], i)
}
function keysOf(f: ProposalFile, idx: number[]): string[] {
  return idx.map((i) => keyOf(f, i))
}

function fullCharacterAfter(over?: Record<string, unknown>): Record<string, unknown> {
  return {
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
    links: [],
    ...over
  }
}

function setup(): { p: string; ch: Chapter } {
  const p = mkTmpBook()
  const ch = createChapter(p, '第一章')
  return { p, ch }
}

/** 人写字段种子：repo 直写（aiTouched 保持缺失 → 全字段人写语义）。 */
function seedHumanCharacter(p: string, over?: Record<string, unknown>): string {
  const doc = createCharacter(p, { name: '旧名', gender: 'male', role: 'supporting' })
  updateCharacter(p, { ...doc, personality: '人写性格', ...over } as typeof doc)
  return doc.id
}

function mkForeshadow(over?: Partial<ForeshadowEntry>): ForeshadowEntry {
  return {
    id: randomUUID(),
    title: '旧钟',
    plantedChapterId: randomUUID(),
    plannedPayoffNote: '待回收',
    resolvedChapterId: null,
    status: 'open',
    ...over
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ---------------------------------------------------------------------------
// FIELD_ALLOWLIST（R2 单一权威：schema.ts 声明字段，保留键绝不入表）
// ---------------------------------------------------------------------------

describe('FIELD_ALLOWLIST', () => {
  it('钉死各实体可写字段（与 schema.ts 形状对齐，改动需过评审）', () => {
    expect(FIELD_ALLOWLIST.character).toEqual([
      'name', 'gender', 'age', 'role', 'avatar', 'appearance', 'personality',
      'background', 'goals', 'flaws', 'relationships', 'arc', 'tags', 'notes', 'links'
    ])
    expect(FIELD_ALLOWLIST.world).toEqual(['title', 'category', 'content', 'parentId', 'order', 'tags', 'links'])
    expect(FIELD_ALLOWLIST.plotline).toEqual(['title', 'summary', 'status', 'stages'])
    expect(FIELD_ALLOWLIST.choice).toEqual(['title', 'chapterId', 'options'])
    expect(FIELD_ALLOWLIST.foreshadow).toEqual([
      'title', 'plantedChapterId', 'plannedPayoffNote', 'resolvedChapterId', 'status', 'note'
    ])
    expect(FIELD_ALLOWLIST.summary).toEqual(['text'])
    expect(FIELD_ALLOWLIST.index).toEqual(['adds'])
  })

  it('任何实体表都不含 __proto__ 与保留键', () => {
    for (const list of Object.values(FIELD_ALLOWLIST)) {
      // aiSource（M4c-2）：引擎专属出处令牌——绝不可经提案载荷写入（create 由引擎盖章、update 保留键丢弃）
      for (const banned of ['__proto__', 'id', 'createdAt', 'updatedAt', 'aiTouched', 'aiSource']) {
        expect(list).not.toContain(banned)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// create×character（R3 深校验 + 落盘形状）
// ---------------------------------------------------------------------------

describe('create×character', () => {
  it('全形状 after → listCharacters 出现；aiTouched 播种所写非空字段（裁定 A）；提案 settled + 双账', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r).toEqual({ applied: keysOf(f, [0]), refused: [] })
    const list = listCharacters(p)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('阿明')
    expect(list[0].personality).toBe('沉稳')
    // 裁定 A：非空写入字段入册即记名（allowlist 序）；空数组字段（relationships/arc/tags/links）不入账
    expect(list[0].aiTouched).toEqual(['name', 'gender', 'age', 'role', 'appearance', 'personality', 'background'])
    expect(list[0].createdAt).toMatch(ISO_RE)
    const stored = getProposal(p, f.id)
    expect(stored?.status).toBe('settled')
    expect(stored?.appliedIndexes).toEqual([0])
    // M4c-1 双写：首次采纳起 appliedCids 落盘（键域从此为该文件权威）
    expect(stored?.appliedCids).toEqual([keyOf(f, 0)])
  })

  it('裁定 A 连锁：后续整理改 AI 自建卡的记名字段，无需 overwritesHuman 直接应用', () => {
    const { p, ch } = setup()
    const f1 = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    adoptChanges(p, f1.id, keysOf(f1, [0]), [])
    const created = listCharacters(p)[0]
    const f2 = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: created.id, after: { personality: '二稿性格' } })
    ])
    const r = adoptChanges(p, f2.id, keysOf(f2, [0]), []) // 无旗标、无确认
    expect(r).toEqual({ applied: keysOf(f2, [0]), refused: [] })
    const stored = getCharacter(p, created.id)!
    expect(stored.personality).toBe('二稿性格')
    expect(stored.aiTouched).toEqual(['name', 'gender', 'age', 'role', 'appearance', 'personality', 'background']) // 去重不加位
  })

  it('裁定 A 空值不入账：create 携空 personality → 不记名，人写后照常受保护', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ personality: '' }) })])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const created = listCharacters(p)[0]
    expect(created.aiTouched).not.toContain('personality')
    // 人手填写后（repo 直写模拟）该字段 = 人写：AI 再改需旗标+确认
    updateCharacter(p, { ...created, personality: '人写性格' })
    const f2 = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: created.id, after: { personality: 'AI 覆盖' } })
    ])
    expect(adoptChanges(p, f2.id, keysOf(f2, [0]), []).refused[0].reason).toBe('REFUSED: 覆盖人写内容 personality')
  })

  it('after 缺必备字段 → 整条拒（错误串带字段路径）且零落盘，提案保持 pending', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: { name: '残缺' } })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual([])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0].key).toBe(keyOf(f, 0))
    expect(r.refused[0].reason).toContain('REFUSED: 角色形状非法')
    expect(r.refused[0].reason).toContain('character.personality')
    expect(listCharacters(p)).toEqual([])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('pending')
  })

  it('after 携幻影关系边 → repository REF_BROKEN 拒（引用检查复用）', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ relationships: [{ targetId: ghost, kind: '宿敌' }] }) })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.refused[0].reason).toContain(`REF_BROKEN: ${ghost}`)
    expect(listCharacters(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// R1 origin 保护（update×character）
// ---------------------------------------------------------------------------

describe('update×character origin 保护（R1）', () => {
  function updateChange(chId: string, targetId: string, after: Record<string, unknown>, over?: Partial<ProposalChange>): ProposalChange {
    return mkChange(chId, { op: 'update', entity: 'character', targetId, after, ...over })
  }

  it('人写 personality 无 overwritesHuman → REFUSED: 覆盖人写内容 personality（点名事实字段）', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 覆盖' })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toBe('REFUSED: 覆盖人写内容 personality')
    expect(getCharacter(p, cid)?.personality).toBe('人写性格')
  })

  it('overwritesHuman:true 但未进 confirmedOverwrite → REFUSED: 未确认覆盖', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 覆盖' }, { overwritesHuman: true })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.refused[0].reason).toBe('REFUSED: 未确认覆盖')
    expect(getCharacter(p, cid)?.personality).toBe('人写性格')
  })

  it('overwritesHuman:true + confirmed（键域）→ 落盘、aiTouched 追加、updatedAt 刷新、createdAt 不动', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const before = getCharacter(p, cid)!
    const f = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 覆盖' }, { overwritesHuman: true })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), keysOf(f, [0]))
    expect(r).toEqual({ applied: keysOf(f, [0]), refused: [] })
    const after = getCharacter(p, cid)!
    expect(after.personality).toBe('AI 覆盖')
    expect(after.aiTouched).toEqual(['personality'])
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.name).toBe('旧名') // 未涉及字段不动
  })

  it('确认集错位（confirmedOverwrite 带别的键）→ 仍拒未确认覆盖（键域逐字对齐，不代答）', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      updateChange(ch.id, cid, { personality: 'AI 覆盖' }, { overwritesHuman: true }),
      mkChange(ch.id, { after: fullCharacterAfter() })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), keysOf(f, [1])) // 确认了别的条目
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toBe('REFUSED: 未确认覆盖')
    expect(getCharacter(p, cid)?.personality).toBe('人写性格')
  })

  it('AI 写过的字段（在 aiTouched）再更新无需 overwritesHuman；aiTouched 去重不重复', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f1 = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 一稿' }, { overwritesHuman: true })])
    adoptChanges(p, f1.id, keysOf(f1, [0]), keysOf(f1, [0]))
    const f2 = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 二稿', appearance: '新外貌' })])
    const r = adoptChanges(p, f2.id, keysOf(f2, [0]), [])
    expect(r.applied).toEqual(keysOf(f2, [0]))
    const doc = getCharacter(p, cid)!
    expect(doc.personality).toBe('AI 二稿')
    expect(doc.appearance).toBe('新外貌')
    expect(doc.aiTouched).toEqual(['personality', 'appearance'])
  })

  it('空字段（空串 / 空数组）不算人写：无旗标即可补全', () => {
    const { p, ch } = setup()
    const doc = createCharacter(p, { name: '白纸', gender: 'female', role: 'minor' })
    expect(doc.personality).toBe('')
    const f = plant(p, ch.id, [updateChange(ch.id, doc.id, { personality: 'AI 补充', links: [] })])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual(keysOf(f, [0]))
    expect(getCharacter(p, doc.id)?.personality).toBe('AI 补充')
    expect(getCharacter(p, doc.id)?.aiTouched).toEqual(['personality', 'links'])
  })

  it('number 字段：默认 0 视为空可写；人写非零值受保护', () => {
    const { p, ch } = setup()
    const doc = createCharacter(p, { name: '无龄', gender: 'other', role: 'minor' })
    const f1 = plant(p, ch.id, [updateChange(ch.id, doc.id, { age: 24 })])
    expect(adoptChanges(p, f1.id, keysOf(f1, [0]), []).applied).toEqual(keysOf(f1, [0])) // 0 → 24 放行（0 = 仓库默认空值）
    const human = createCharacter(p, { name: '有龄', gender: 'male', role: 'minor' }, { age: 40 })
    const f2 = plant(p, ch.id, [updateChange(ch.id, human.id, { age: 41 })])
    const r = adoptChanges(p, f2.id, keysOf(f2, [0]), [])
    expect(r.refused[0].reason).toBe('REFUSED: 覆盖人写内容 age')
    expect(getCharacter(p, human.id)?.age).toBe(40)
  })

  it('保留键回显（id/createdAt/updatedAt/aiTouched/status）→ 静默丢弃，其余字段照常应用', () => {
    const { p, ch } = setup()
    const doc = createCharacter(p, { name: '守备', gender: 'male', role: 'minor' })
    const f = plant(p, ch.id, [
      updateChange(ch.id, doc.id, {
        id: randomUUID(),
        createdAt: '垃圾',
        updatedAt: '垃圾',
        aiTouched: ['伪造'],
        status: 'done',
        personality: 'AI 值'
      })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual(keysOf(f, [0]))
    const stored = getCharacter(p, doc.id)!
    expect(stored.id).toBe(doc.id)
    expect(stored.createdAt).toBe(doc.createdAt)
    expect(stored.aiTouched).toEqual(['personality']) // '伪造' 没混进账本
    expect((stored as unknown as Record<string, unknown>).status).toBeUndefined()
  })

  it('评审 I2：未知字段（非 allowlist 非保留回显）→ 整条拒 REFUSED: 未知字段 <key>，零写盘', () => {
    const { p, ch } = setup()
    const doc = createCharacter(p, { name: '守备', gender: 'male', role: 'minor' })
    const f = plant(p, ch.id, [
      updateChange(ch.id, doc.id, { personality: 'AI 值', origin: 'human' }) // 合法+未知混合
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toBe('REFUSED: 未知字段 origin')
    const stored = getCharacter(p, doc.id)!
    expect(stored.personality).toBe('') // 合法字段也没落盘（applied 记账绝不说谎）
    expect(stored.aiTouched).toBeUndefined()
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('pending')
  })

  it('after 无可应用字段（空对象/全保留键）→ REFUSED: 无可应用字段；after 非对象同拒', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      updateChange(ch.id, cid, {}),
      updateChange(ch.id, cid, { id: 'x' }),
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: cid, after: '不是对象' })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1, 2]), [])
    expect(r.applied).toEqual([])
    expect(r.refused.map((x) => x.reason)).toEqual([
      'REFUSED: 无可应用字段',
      'REFUSED: 无可应用字段',
      'REFUSED: after 必须是对象'
    ])
  })

  it('targetId 缺失角色 / 非 UUID → 拒（CHARACTER_MISSING / BAD_CHARACTER_ID 透传）', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const f = plant(p, ch.id, [
      updateChange(ch.id, ghost, { personality: 'x' }),
      updateChange(ch.id, '../../evil', { personality: 'x' })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1]), [])
    expect(r.refused[0].reason).toContain(`CHARACTER_MISSING: ${ghost}`)
    expect(r.refused[1].reason).toContain('BAD_CHARACTER_ID')
  })
})

// ---------------------------------------------------------------------------
// R2 __proto__ 加固
// ---------------------------------------------------------------------------

describe('__proto__ 加固（R2）', () => {
  it('after 携 own __proto__ 键：允许字段照常应用，Object.prototype 与存量零污染', () => {
    const { p, ch } = setup()
    // 存量：name 为 AI 已有字段（aiTouched 含 name）→ 无需覆盖旗标即可改名
    const doc = createCharacter(p, { name: '旧名', gender: 'male', role: 'minor' })
    updateCharacter(p, { ...doc, aiTouched: ['name'] })
    // own '__proto__' 键只能经 JSON.parse 构造（对象字面量会触发 setter）
    const after = JSON.parse('{"__proto__": {"polluted": true}, "name": "新名"}')
    expect(Object.prototype.hasOwnProperty.call(after, '__proto__')).toBe(true)
    const f = mkProposal(ch.id, [mkChange(ch.id, { op: 'update', entity: 'character', targetId: doc.id, after })])
    writeProposal(p, f) // dump 保留 own __proto__ 键（实验证实）
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r).toEqual({ applied: keysOf(f, [0]), refused: [] })
    // name 应用成功
    const stored = getCharacter(p, doc.id)!
    expect(stored.name).toBe('新名')
    // 全局原型零污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    // 存量对象干净：无 own __proto__、原型仍是 Object.prototype、后续无关读取干净
    expect(Object.prototype.hasOwnProperty.call(stored as object, '__proto__')).toBe(false)
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
    const fresh: Record<string, unknown> = {}
    expect(fresh.polluted).toBeUndefined()
    expect(listCharacters(p)[0].name).toBe('新名')
  })

  it('create 路径同样免疫：after 携 own __proto__ → 形状校验拒或忽略，绝无污染', () => {
    const { p, ch } = setup()
    const after = JSON.parse(
      '{"__proto__": {"polluted": true}, "name": "阿明", "gender": "male", "age": 24, "role": "protagonist", "appearance": "", "personality": "", "background": "", "relationships": [], "arc": [], "tags": [], "links": []}'
    )
    const f = mkProposal(ch.id, [mkChange(ch.id, { after })])
    writeProposal(p, f)
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual(keysOf(f, [0])) // allowlist 拷贝天然不含 __proto__ → 正常建卡
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const stored = listCharacters(p)[0]
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
    expect(stored.name).toBe('阿明')
  })
})

// ---------------------------------------------------------------------------
// world（create + update origin 保护）
// ---------------------------------------------------------------------------

describe('world create/update', () => {
  it('create×world 全形状 → listWorldEntries 出现；aiTouched 播种非空写入字段（裁定 A）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, {
        entity: 'world',
        after: { title: '青云山', category: 'location', content: '云雾缭绕', parentId: null, order: 1, tags: ['地理'], links: [] }
      })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const list = listWorldEntries(p)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('青云山')
    // 非空写入 = title/category/content/order(1≠0)/tags(非空数组)；parentId null 与 links [] 不入账
    expect(list[0].aiTouched).toEqual(['title', 'category', 'content', 'order', 'tags'])
  })

  it('update×world 人写 content：无旗标拒 / 确认覆盖后 aiTouched 记账', () => {
    const { p, ch } = setup()
    const entry = createWorldEntry(p, { title: '旧条目', category: 'history' })
    updateWorldEntry(p, { ...entry, content: '人写正文' })
    const deny = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'world', targetId: entry.id, after: { content: 'AI 正文' } })
    ])
    const r1 = adoptChanges(p, deny.id, keysOf(deny, [0]), [])
    expect(r1.refused[0].reason).toBe('REFUSED: 覆盖人写内容 content')
    expect(getWorldEntry(p, entry.id)?.content).toBe('人写正文')
    const ok = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'world', targetId: entry.id, after: { content: 'AI 正文' }, overwritesHuman: true })
    ])
    const r2 = adoptChanges(p, ok.id, keysOf(ok, [0]), keysOf(ok, [0]))
    expect(r2.applied).toEqual(keysOf(ok, [0]))
    const stored = getWorldEntry(p, entry.id)!
    expect(stored.content).toBe('AI 正文')
    expect(stored.aiTouched).toEqual(['content'])
  })
})

// ---------------------------------------------------------------------------
// plotline / choice
// ---------------------------------------------------------------------------

describe('plotline / choice', () => {
  it('create×plotline 全形状 → listPlotlines；缺 summary/stages → 深校验拒', () => {
    const { p, ch } = setup()
    const good = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'plotline', after: { title: '主线', summary: '复仇', status: 'active', stages: [] } })
    ])
    expect(adoptChanges(p, good.id, keysOf(good, [0]), []).applied).toEqual(keysOf(good, [0]))
    expect(listPlotlines(p).map((x) => x.title)).toEqual(['主线'])
    const bad = plant(p, ch.id, [mkChange(ch.id, { entity: 'plotline', after: { title: '残线' } })])
    const r = adoptChanges(p, bad.id, keysOf(bad, [0]), [])
    expect(r.refused[0].reason).toContain('剧情线形状非法')
    expect(r.refused[0].reason).toContain('plotline.summary')
    expect(listPlotlines(p)).toHaveLength(1)
  })

  it('update×plotline：title/summary/stages 可写；status 是保留键 → 仅 status 时拒「无可应用字段」', () => {
    const { p, ch } = setup()
    const pl = createPlotline(p, { title: '旧线', summary: '旧纲' })
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'plotline', targetId: pl.id, after: { summary: '新纲', status: 'done' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const stored = listPlotlines(p).find((x) => x.id === pl.id)!
    expect(stored.summary).toBe('新纲')
    expect(stored.status).toBe('active') // status 保留：AI 不得改剧情线生命周期
    const only = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'plotline', targetId: pl.id, after: { status: 'done' } })
    ])
    const r = adoptChanges(p, only.id, keysOf(only, [0]), [])
    expect(r.refused[0].reason).toBe('REFUSED: 无可应用字段')
    // 评审 I2 同纪律覆盖 mergePlain 路径：未知字段整条拒，合法字段也不落盘
    const unknown = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'plotline', targetId: pl.id, after: { summary: '再改', color: '红' } })
    ])
    const r2 = adoptChanges(p, unknown.id, keysOf(unknown, [0]), [])
    expect(r2.refused[0].reason).toBe('REFUSED: 未知字段 color')
    expect(listPlotlines(p).find((x) => x.id === pl.id)!.summary).toBe('新纲')
  })

  it('create×choice 挂真章 → listChoices；幻影章 → REF_BROKEN 拒', () => {
    const { p, ch } = setup()
    const good = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'choice', after: { title: '岔路', chapterId: ch.id, options: [{ label: '左', consequence: '遇伏' }] } })
    ])
    expect(adoptChanges(p, good.id, keysOf(good, [0]), []).applied).toEqual(keysOf(good, [0]))
    expect(listChoices(p)).toHaveLength(1)
    const ghost = randomUUID()
    const bad = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'choice', after: { title: '幻影', chapterId: ghost, options: [] } })
    ])
    const r = adoptChanges(p, bad.id, keysOf(bad, [0]), [])
    expect(r.refused[0].reason).toContain(`REF_BROKEN: ${ghost}`)
    expect(listChoices(p)).toHaveLength(1)
  })

  it('update×choice options 显式覆盖 → 落盘', () => {
    const { p, ch } = setup()
    const c = createChoice(p, { title: '旧选项', chapterId: ch.id })
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'choice', targetId: c.id, after: { options: [{ label: '战', consequence: '胜' }] } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(listChoices(p).find((x) => x.id === c.id)?.options).toEqual([{ label: '战', consequence: '胜' }])
  })

  it('delete×plotline / delete×choice：存在 → 删；缺失 → 拒（存在性要求，裁定 R3）', () => {
    const { p, ch } = setup()
    const pl = createPlotline(p, { title: '待删线' })
    const c = createChoice(p, { title: '待删选项', chapterId: ch.id })
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'delete', entity: 'plotline', targetId: pl.id }),
      mkChange(ch.id, { op: 'delete', entity: 'choice', targetId: c.id }),
      mkChange(ch.id, { op: 'delete', entity: 'plotline', targetId: randomUUID() })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1, 2]), [])
    expect(r.applied).toEqual(keysOf(f, [0, 1]))
    expect(listPlotlines(p)).toEqual([])
    expect(listChoices(p)).toEqual([])
    expect(r.refused[0].key).toBe(keyOf(f, 2))
    expect(r.refused[0].reason).toContain('PLOTLINE_MISSING')
  })

  it('delete×character 双保险：绕过 writeProposal 的坏提案 → validateChange 在采纳现场再拒', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const evil = mkProposal(ch.id, [mkChange(ch.id, { op: 'delete', entity: 'character', targetId: cid })])
    plantBypass(p, evil) // 文件级校验会被拒——刻意绕过，模拟手改文件
    const r = adoptChanges(p, evil.id, keysOf(evil, [0]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toContain('is not allowed for entity "character"')
    expect(getCharacter(p, cid)).not.toBeNull() // 角色完好
  })
})

// ---------------------------------------------------------------------------
// foreshadow（create/update 状态机路由/delete）
// ---------------------------------------------------------------------------

describe('foreshadow', () => {
  it('create×foreshadow：after 即 ForeshadowEntry → 台账追加；id 一律注入新 UUID（防碰撞覆盖）', () => {
    const { p, ch } = setup()
    const forgedId = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, {
        entity: 'foreshadow',
        after: { id: forgedId, title: '断剑', plantedChapterId: ch.id, plannedPayoffNote: '后文回收', resolvedChapterId: null, status: 'open' }
      })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const entries = readLedger(p).entries
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('断剑')
    expect(entries[0].id).not.toBe(forgedId) // 新鲜 UUID，after.id 被忽略
    expect(validateForeshadowEntry(entries[0])).toEqual([])
  })

  it('create×foreshadow 缺 status/resolvedChapterId → 深校验拒', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'foreshadow', after: { title: '残缺', plantedChapterId: ch.id, plannedPayoffNote: '' } })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.refused[0].reason).toContain('伏笔形状非法')
    expect(readLedger(p).entries).toEqual([])
  })

  it('update×foreshadow status:resolved → 走状态机，回收章 = 整理章（proposal.chapterId）', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'resolved' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const stored = readLedger(p).entries.find((x) => x.id === e.id)!
    expect(stored.status).toBe('resolved')
    expect(stored.resolvedChapterId).toBe(ch.id)
  })

  it('update×foreshadow 非法转移（resolved→abandoned）→ FORESHADOW_TRANSITION 拒；同状态 → 无操作通过', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    resolveForeshadow(p, e.id, ch.id)
    const bad = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'abandoned' } })
    ])
    const r = adoptChanges(p, bad.id, keysOf(bad, [0]), [])
    expect(r.refused[0].reason).toContain('FORESHADOW_TRANSITION')
    const noop = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'resolved' } })
    ])
    expect(adoptChanges(p, noop.id, keysOf(noop, [0]), []).applied).toEqual(keysOf(noop, [0]))
    expect(readLedger(p).entries.find((x) => x.id === e.id)?.status).toBe('resolved')
  })

  it('update×foreshadow status:open（撤回）→ reopen 语义：resolvedChapterId 复位 null', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    resolveForeshadow(p, e.id, ch.id)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'open' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const stored = readLedger(p).entries.find((x) => x.id === e.id)!
    expect(stored.status).toBe('open')
    expect(stored.resolvedChapterId).toBeNull()
  })

  it('评审 I1：转移+坏类型说明字段混合 → 整条拒且台账字节不动（禁止半应用）', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    const before = readFileSync(foreshadowFile(p), 'utf8')
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'resolved', plannedPayoffNote: 123 } })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toContain('伏笔形状非法')
    expect(r.refused[0].reason).toContain('foreshadowEntry.plannedPayoffNote')
    // 关键判别：状态转移没有先行落账——磁盘字节逐一不动
    expect(readFileSync(foreshadowFile(p), 'utf8')).toBe(before)
    expect(readLedger(p).entries.find((x) => x.id === e.id)?.status).toBe('open')
  })

  it('评审 I1 对照：转移+说明字段混合合法 → 双落（status resolved + 回收章 + 新说明）', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'resolved', plannedPayoffNote: '新计划' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const stored = readLedger(p).entries.find((x) => x.id === e.id)!
    expect(stored.status).toBe('resolved')
    expect(stored.resolvedChapterId).toBe(ch.id)
    expect(stored.plannedPayoffNote).toBe('新计划')
  })

  it('update×foreshadow 仅 note 类字段：plannedPayoffNote/note 落盘、机对状态不动；表外字段拒', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { plannedPayoffNote: '新计划', note: '补注', title: '改名' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const stored = readLedger(p).entries.find((x) => x.id === e.id)!
    expect(stored.plannedPayoffNote).toBe('新计划')
    expect(stored.note).toBe('补注')
    expect(stored.title).toBe('旧钟') // title 不在 update 白名单 → 忽略
    expect(stored.status).toBe('open')
    const none = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { title: '只改表外' } })
    ])
    expect(adoptChanges(p, none.id, keysOf(none, [0]), []).refused[0].reason).toContain('无可应用字段')
  })

  it('update/delete×foreshadow 幻影 targetId → FORESHADOW_MISSING 拒', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: ghost, after: { status: 'resolved' } }),
      mkChange(ch.id, { op: 'delete', entity: 'foreshadow', targetId: ghost })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1]), [])
    expect(r.applied).toEqual([])
    expect(r.refused.every((x) => x.reason.includes('FORESHADOW_MISSING'))).toBe(true)
  })

  it('delete×foreshadow：条目从台账移除，其余保留', () => {
    const { p, ch } = setup()
    const a = mkForeshadow({ title: '甲' })
    const b = mkForeshadow({ title: '乙' })
    upsertForeshadow(p, a)
    upsertForeshadow(p, b)
    const f = plant(p, ch.id, [mkChange(ch.id, { op: 'delete', entity: 'foreshadow', targetId: a.id })])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(readLedger(p).entries.map((x) => x.title)).toEqual(['乙'])
  })
})

// ---------------------------------------------------------------------------
// summary（.ai/summaries/chapters/<chapterId>.yaml）
// ---------------------------------------------------------------------------

describe('summary', () => {
  it('update×summary → 落盘 {chapterId,text,updatedAt,aiModel}；T4 readAiData 可按章 id 定位', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'summary', targetId: ch.id, after: { text: '本章摘要：少年离乡。' } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const abs = chapterSummaryFile(p, ch.id)
    expect(existsSync(abs)).toBe(true)
    const doc = yaml.load(readFileSync(abs, 'utf8')) as Record<string, unknown>
    expect(doc.chapterId).toBe(ch.id)
    expect(doc.text).toBe('本章摘要：少年离乡。')
    expect(doc.aiModel).toBe('test-model')
    expect(doc.updatedAt as string).toMatch(ISO_RE)
  })

  it('create×summary 无 targetId → 缺省 = 整理章（proposal.chapterId）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { entity: 'summary', after: { text: '新摘要' } })])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(existsSync(chapterSummaryFile(p, ch.id))).toBe(true)
  })

  it('幻影 targetId / 空 text / after 缺 text → 拒且零落盘', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'summary', targetId: ghost, after: { text: 'x' } }),
      mkChange(ch.id, { op: 'update', entity: 'summary', targetId: ch.id, after: { text: '   ' } }),
      mkChange(ch.id, { op: 'update', entity: 'summary', targetId: ch.id, after: {} })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1, 2]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toContain(`CHAPTER_MISSING: ${ghost}`)
    expect(r.refused[1].reason).toContain('after.text 必须是非空字符串')
    expect(r.refused[2].reason).toContain('after.text 必须是非空字符串')
    expect(existsSync(chapterSummaryFile(p, ch.id))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// index（.ai/index.json 合并：去重 + 章序）
// ---------------------------------------------------------------------------

describe('index', () => {
  it('adds 合并：去重 + 按 listChapters 章序存储；既有键保留', () => {
    const p = mkTmpBook()
    const ch1 = createChapter(p, '第一章')
    const ch2 = createChapter(p, '第二章')
    const ch3 = createChapter(p, '第三章')
    const car = createCharacter(p, { name: '甲', gender: 'male', role: 'minor' })
    const we = createWorldEntry(p, { title: '乙地', category: 'location' })
    // 既有索引：甲↔第三章（乱序在前）
    mkdirSync(join(p, '.ai'), { recursive: true })
    writeFileSync(aiIndexFile(p), JSON.stringify({ [car.id]: [ch3.id] }), 'utf8')
    const f = plant(p, ch1.id, [
      mkChange(ch1.id, {
        op: 'update',
        entity: 'index',
        targetId: ch1.id, // update 必携 targetId（校验器）；index 上语义未用（T3 裁定：占位=整理章）
        after: {
          adds: [
            { entityId: car.id, chapterId: ch2.id },
            { entityId: car.id, chapterId: ch1.id },
            { entityId: car.id, chapterId: ch2.id }, // 重复 → 去重
            { entityId: we.id, chapterId: ch1.id }
          ]
        }
      })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const idx = JSON.parse(readFileSync(aiIndexFile(p), 'utf8')) as Record<string, string[]>
    expect(idx[car.id]).toEqual([ch1.id, ch2.id, ch3.id]) // 章序 1,2,3
    expect(idx[we.id]).toEqual([ch1.id])
    expect(listChapters(p).map((c) => c.id)).toEqual([ch1.id, ch2.id, ch3.id]) // 顺序前提自检
  })

  it('entityId 必须存在于 角色∪词条∪伏笔；幻影/非 UUID/幻影章 → 拒（整条不落）', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const car = createCharacter(p, { name: '甲', gender: 'male', role: 'minor' })
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: ghost, chapterId: ch.id }] } }),
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: 'not-a-uuid', chapterId: ch.id }] } }),
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: car.id, chapterId: ghost }] } }),
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [] } })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1, 2, 3]), [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toContain(`REF_BROKEN: ${ghost}`)
    expect(r.refused[1].reason).toContain('形状非法')
    expect(r.refused[2].reason).toContain(`REF_BROKEN: ${ghost}`)
    expect(r.refused[3].reason).toContain('after.adds 必须是非空数组')
    expect(existsSync(aiIndexFile(p))).toBe(false)
  })

  it('伏笔 id 也是合法 entityId（三源并集）', () => {
    const { p, ch } = setup()
    const e = mkForeshadow()
    upsertForeshadow(p, e)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: e.id, chapterId: ch.id }] } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const idx = JSON.parse(readFileSync(aiIndexFile(p), 'utf8')) as Record<string, string[]>
    expect(idx[e.id]).toEqual([ch.id])
  })

  it('既有 index.json 损坏 → warn + 按空索引重建（派生数据可再生，不拒）', () => {
    const { p, ch } = setup()
    const car = createCharacter(p, { name: '甲', gender: 'male', role: 'minor' })
    mkdirSync(join(p, '.ai'), { recursive: true })
    writeFileSync(aiIndexFile(p), '{{{ 坏 JSON', 'utf8')
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: car.id, chapterId: ch.id }] } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(console.warn).toHaveBeenCalled()
    const idx = JSON.parse(readFileSync(aiIndexFile(p), 'utf8')) as Record<string, string[]>
    expect(idx).toEqual({ [car.id]: [ch.id] })
  })

  it('index.json 里混入 __proto__ 键 → 读取跳过，重写后消失，原型零污染', () => {
    const { p, ch } = setup()
    const car = createCharacter(p, { name: '甲', gender: 'male', role: 'minor' })
    mkdirSync(join(p, '.ai'), { recursive: true })
    // JSON.parse 对 __proto__ 产生 own property（安全），模拟被第三方污染过的索引文件
    const dirty = JSON.parse(`{"__proto__": {"polluted": true}, "${car.id}": ["${ch.id}"]}`)
    writeFileSync(aiIndexFile(p), JSON.stringify(dirty), 'utf8')
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'index', targetId: ch.id, after: { adds: [{ entityId: car.id, chapterId: ch.id }] } })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    const text = readFileSync(aiIndexFile(p), 'utf8')
    expect(text).not.toContain('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(characterIds(p)).toContain(car.id)
    expect(worldIds(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 批次语义（M4c-1 起按 changeKey 键集上报）
// ---------------------------------------------------------------------------

describe('批次语义', () => {
  it('2 好 1 坏 → applied 2 + refused 1，status partial；重采纳：坏条目照拒、好条目拒「已采纳」', () => {
    const { p, ch } = setup()
    const human = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '新建甲' }) }),
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: human, after: { personality: 'AI 覆盖' } }),
      mkChange(ch.id, {
        entity: 'world',
        after: { title: '新地点', category: 'location', content: '', parentId: null, order: 0, tags: [], links: [] }
      })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0, 1, 2]), [])
    expect(r.applied).toEqual(keysOf(f, [0, 2]))
    expect(r.refused).toEqual([{ key: keyOf(f, 1), reason: 'REFUSED: 覆盖人写内容 personality' }])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0, 2])
    // 重采纳：1 照拒（人写保护是状态性的），0 拒「已采纳」（防双写）
    const r2 = adoptChanges(p, f.id, keysOf(f, [0, 1]), [])
    expect(r2.applied).toEqual([])
    expect(r2.refused.map((x) => x.reason)).toEqual(['REFUSED: 条目已采纳', 'REFUSED: 覆盖人写内容 personality'])
    expect(listCharacters(p)).toHaveLength(2) // 新建甲没有二次落盘
  })

  it('补齐被拒条目（带旗标+确认）后 status → settled', () => {
    const { p, ch } = setup()
    const human = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: human, after: { personality: 'AI 覆盖' }, overwritesHuman: true })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('partial')
    expect(adoptChanges(p, f.id, keysOf(f, [1]), keysOf(f, [1])).applied).toEqual(keysOf(f, [1]))
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
  })

  it('非法/未知/重复键：非法与未知按条拒，重复键只处理一次', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const k0 = keyOf(f, 0)
    const r = adoptChanges(p, f.id, [5, 'no-such-key', k0, k0, 1.5] as unknown as string[], [])
    expect(r.applied).toEqual([k0])
    expect(r.refused.map((x) => [x.key, x.reason])).toEqual([
      ['5', 'REFUSED: 条目键非法: 5'],
      ['no-such-key', 'REFUSED: 条目键未知: no-such-key'],
      ['1.5', 'REFUSED: 条目键非法: 1.5']
    ])
    expect(listCharacters(p)).toHaveLength(1)
  })

  it('changeKeys 非数组 → PROPOSAL_BAD_PARAMS 抛穿；提案缺失 → PROPOSAL_MISSING 抛穿（通道级错误，不是逐条拒）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    expect(() => adoptChanges(p, f.id, 'oops' as unknown as string[], [])).toThrow(/PROPOSAL_BAD_PARAMS/)
    expect(() => adoptChanges(p, 'prop-nope-1', ['x'], [])).toThrow(/PROPOSAL_MISSING/)
  })

  it('全拒批次零写盘：status/双账不变（不做无意义重写）', () => {
    const { p, ch } = setup()
    const human = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: human, after: { personality: 'AI' } })
    ])
    const before = readFileSync(proposalPath(p, f.id), 'utf8')
    adoptChanges(p, f.id, keysOf(f, [0]), [])
    expect(readFileSync(proposalPath(p, f.id), 'utf8')).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// rejectChanges
// ---------------------------------------------------------------------------

describe('rejectChanges', () => {
  it('删中间条目：其余保序、双账同步收缩（回退键按新位置重算）、status 重算', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '丙' }) })
    ])
    expect(adoptChanges(p, f.id, keysOf(f, [1]), []).applied).toEqual(keysOf(f, [1])) // 采纳「乙」
    rejectChanges(p, f.id, keysOf(f, [0])) // 驳回「甲」→ 乙 前移到索引 0
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.changes).toHaveLength(2)
    expect((raw.proposal.changes[0] as ProposalChange).after).toEqual(fullCharacterAfter({ name: '乙' }))
    expect(raw.proposal.appliedIndexes).toEqual([0]) // 旧 1 → 新 0
    // M4c-1：adopt 已双写过 appliedCids → reject 必须同步重算（legacy 回退键按新位置，防陈旧键错位）
    expect(raw.proposal.appliedCids).toEqual([changeKey(raw.proposal.changes[0], 0)])
    expect(raw.proposal.status).toBe('partial')
    // 重排后位置 0 已采纳 → 再采纳被拒（防双写第一道闸）；位置 1（丙）进入 create——
    // M4c-2 legacy 取舍（本测试无 cid，键 = 位置回退键）：乙 的 aiSource 令牌盖的是重排前的
    // 位置键 idx:1，reject 重排后 idx:1 改指 丙 → create 前的幂等扫描误命中 乙 → 丙 按「已应用」
    // 处理（计入 applied、不双胞胎、不落盘）。位置键身份随 reject 漂移正是 M4c-1 引入 cid 的动机；
    // 应用盖章的提案（M4c-1 起）恒有 cid → 令牌 = 真 UUID，不存在本窗口。第三方手写提案请带 cid
    // （BOOK_FORMAT §8）。账目机制本身（本测试的正题）不受影响：
    const r = adoptChanges(p, f.id, [changeKey(raw.proposal.changes[0], 0), changeKey(raw.proposal.changes[1], 1)], [])
    expect(r.applied).toEqual([changeKey(raw.proposal.changes[1], 1)])
    expect(r.refused[0].reason).toBe('REFUSED: 条目已采纳')
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
    expect(listCharacters(p).map((c) => c.name)).toEqual(['乙']) // 丙 被陈旧位置令牌挡住（legacy 取舍，见上注）
  })

  it('驳回已采纳条目：applied 出账（双账皆空不携键），status 回落', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    adoptChanges(p, f.id, keysOf(f, [0]), [])
    rejectChanges(p, f.id, keysOf(f, [0]))
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedIndexes).toEqual([])
    // 空账不携键 → 文件回落纯 legacy 形态（两账皆空时键域/位置语义全等，权威链判别无歧义）
    expect(raw.proposal.appliedCids).toBeUndefined()
    expect(raw.proposal.status).toBe('pending')
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect('appliedIndexes' in onDisk).toBe(false) // 空账不携键（与存量文件同形）
    expect('appliedCids' in onDisk).toBe(false)
  })

  it('驳回全部剩余条目 → 整份提案删除（文件消失）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    rejectChanges(p, f.id, keysOf(f, [0, 1]))
    expect(existsSync(proposalPath(p, f.id))).toBe(false)
    expect(getProposal(p, f.id)).toBeNull()
    expect(listCharacters(p)).toEqual([])
  })

  it('幂等：空数组/未知键 → 零写盘不抛；缺失提案 → PROPOSAL_MISSING', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const before = readFileSync(proposalPath(p, f.id), 'utf8')
    rejectChanges(p, f.id, [])
    rejectChanges(p, f.id, ['no-such-key'])
    expect(readFileSync(proposalPath(p, f.id), 'utf8')).toBe(before)
    expect(() => rejectChanges(p, 'prop-nope-1', ['x'])).toThrow(/PROPOSAL_MISSING/)
    expect(() => rejectChanges(p, f.id, 'oops' as unknown as string[])).toThrow(/PROPOSAL_BAD_PARAMS/)
  })

  it('重写后的文件仍过文件级校验（getProposal 可读，面板不裂）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    adoptChanges(p, f.id, keysOf(f, [0]), [])
    rejectChanges(p, f.id, keysOf(f, [1]))
    const doc = getProposal(p, f.id)
    expect(doc?.status).toBe('settled')
    expect(doc?.changes).toHaveLength(1)
    expect(doc?.appliedIndexes).toEqual([0])
    expect(doc?.appliedCids).toEqual([changeKey(doc?.changes[0], 0)])
  })
})

// ---------------------------------------------------------------------------
// M4c-1：cid 稳定键（判别性测试——旧位置世界的跨窗口错位在这里全部收敛）
// ---------------------------------------------------------------------------

describe('cid 稳定键（M4c-1：跨窗口重排判别 / 重放幂等 / 未知键拒）', () => {
  /** 带 cid 的三条 create（甲/乙/丙）：键域判别场景的标准盘面。 */
  function plantWithCids(p: string, chId: string): { f: ProposalFile; cidA: string; cidB: string; cidC: string } {
    const cidA = randomUUID()
    const cidB = randomUUID()
    const cidC = randomUUID()
    const f = plant(p, chId, [
      mkChange(chId, { cid: cidA, after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(chId, { cid: cidB, after: fullCharacterAfter({ name: '乙' }) }),
      mkChange(chId, { cid: cidC, after: fullCharacterAfter({ name: '丙' }) })
    ])
    return { f, cidA, cidB, cidC }
  }

  it('判别测试（plan 1(a) 场景）：采纳乙 → 外部 reject 甲重排 → 按 cid 采丙：不误拒、不错放、账目稳', () => {
    const { p, ch } = setup()
    const { f, cidA, cidB, cidC } = plantWithCids(p, ch.id)
    // 窗口1：采纳第 2 条（乙）
    expect(adoptChanges(p, f.id, [cidB], [])).toEqual({ applied: [cidB], refused: [] })
    // 窗口2（外部）：驳回第 1 条（甲）→ changes 收缩为 [乙,丙]（旧位置世界所有 index 左移）
    rejectChanges(p, f.id, [cidA])
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.changes).toHaveLength(2)
    expect(raw.proposal.appliedIndexes).toEqual([0]) // 位置投影同步收缩（legacy 读者兼容面）
    expect(raw.proposal.appliedCids).toEqual([cidB]) // 键域纹丝不动——appliedCids 即权威
    // 窗口1 的陈旧勾选「第 3 条丙」（旧 index 2 已越界 = 旧世界的误拒点）按 cid 到达
    const r = adoptChanges(p, f.id, [cidC], [])
    expect(r).toEqual({ applied: [cidC], refused: [] })
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
    // 不错放：落盘的正是被勾选的 乙+丙；甲 没有复活
    expect(listCharacters(p).map((c) => c.name).sort()).toEqual(['乙', '丙'].sort())
  })

  it('跨窗口错放判别：窗口1勾选乙、窗口2先驳回甲 → 按 cid 落盘的是乙（旧位置世界 index 1 会错写成丙）', () => {
    const { p, ch } = setup()
    const { f, cidA, cidB } = plantWithCids(p, ch.id)
    rejectChanges(p, f.id, [cidA]) // 窗口2 抢先：changes → [乙,丙]，旧 index 1 现在指向丙
    const r = adoptChanges(p, f.id, [cidB], []) // 窗口1 的陈旧勾选此后到达
    expect(r).toEqual({ applied: [cidB], refused: [] })
    expect(listCharacters(p).map((c) => c.name)).toEqual(['乙']) // 用户勾谁落谁——绝不错放
  })

  it('markSettled 成功后的重放：reject 收缩后按同 cid 重放 → REFUSED 条目已采纳（create 不双胞胎）', () => {
    const { p, ch } = setup()
    const { f, cidA, cidB } = plantWithCids(p, ch.id)
    expect(adoptChanges(p, f.id, [cidB], []).applied).toEqual([cidB])
    rejectChanges(p, f.id, [cidA]) // 重排 + 收缩（旧位置世界 appliedIndexes 靠 remap 幸存，键域天然稳定）
    const replay = adoptChanges(p, f.id, [cidB], [])
    expect(replay.applied).toEqual([])
    expect(replay.refused).toEqual([{ key: cidB, reason: 'REFUSED: 条目已采纳' }])
    expect(listCharacters(p)).toHaveLength(1) // 乙只有一份——重试双胞胎被键域账目挡住
  })

  it('未知键拒（面板越界夹取退役后的引擎侧兜底）：键不在当前 changes → REFUSED + 零写盘', () => {
    const { p, ch } = setup()
    const { f, cidA, cidB } = plantWithCids(p, ch.id)
    rejectChanges(p, f.id, [cidA])
    const before = readFileSync(proposalPath(p, f.id), 'utf8')
    const r = adoptChanges(p, f.id, [cidA, 'ghost-key'], []) // 跨窗口陈旧勾选：cidA 已被他端驳回
    expect(r.applied).toEqual([])
    expect(r.refused.map((x) => [x.key, x.reason])).toEqual([
      [cidA, `REFUSED: 条目键未知: ${cidA}`],
      ['ghost-key', 'REFUSED: 条目键未知: ghost-key']
    ])
    expect(readFileSync(proposalPath(p, f.id), 'utf8')).toBe(before) // 全拒 → 提案文件字节不动
    expect(listCharacters(p)).toEqual([])
    // 盘面一致性：乙 仍未采纳，后续按同键可正常采（未知键拒不误伤活条目）
    expect(adoptChanges(p, f.id, [cidB], []).applied).toEqual([cidB])
  })

  it('confirmedOverwrite 同走键域：跨窗口重排后确认键仍命中用户确认过的条目（旧位置世界会误拒「未确认覆盖」）', () => {
    const { p, ch } = setup()
    const human = seedHumanCharacter(p)
    const cidA = randomUUID()
    const cidB = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { cid: cidA, after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, {
        cid: cidB,
        op: 'update',
        entity: 'character',
        targetId: human,
        after: { personality: 'AI 覆盖' },
        overwritesHuman: true
      })
    ])
    // 窗口1：勾选 B 并确认覆盖 → 窗口2 抢先驳回 A（B 前移到 index 0，旧位置确认集 [1] 作废）
    rejectChanges(p, f.id, [cidA])
    const r = adoptChanges(p, f.id, [cidB], [cidB])
    expect(r).toEqual({ applied: [cidB], refused: [] })
    expect(getCharacter(p, human)?.personality).toBe('AI 覆盖')
  })

  it('混合权威翻译：带 cid 但只有 appliedIndexes（第三方按旧口径写账）→ 位置记账正确翻译进键域，重放照拒', () => {
    const { p, ch } = setup()
    const cidA = randomUUID()
    const cidB = randomUUID()
    const f = mkProposal(
      ch.id,
      [
        mkChange(ch.id, { cid: cidA, after: fullCharacterAfter({ name: '甲' }) }),
        mkChange(ch.id, { cid: cidB, after: fullCharacterAfter({ name: '乙' }) })
      ],
      { appliedIndexes: [0] } // 第三方旧口径：只有位置账
    )
    writeProposal(p, f)
    const r = adoptChanges(p, f.id, [cidA, cidB], [])
    expect(r.applied).toEqual([cidB])
    expect(r.refused).toEqual([{ key: cidA, reason: 'REFUSED: 条目已采纳' }])
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedCids).toEqual([cidA, cidB]) // 首次双写后 → 键域永久权威
    expect(raw.proposal.appliedIndexes).toEqual([0, 1])
    expect(raw.proposal.status).toBe('settled')
    expect(listCharacters(p).map((c) => c.name)).toEqual(['乙']) // 甲是记账条目：不复活、不双胞胎
  })

  it('legacy 文件全链路（无 cid、手写 appliedIndexes）：采纳/驳回/重放全按位置回退键照常', () => {
    const { p, ch } = setup()
    const f = mkProposal(ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '丙' }) })
    ], { appliedIndexes: [1] }) // 手写/存量形态：乙已记账（实体未真实落盘）
    writeProposal(p, f)
    const [k0, k1] = keysOf(f, [0, 1])
    const r = adoptChanges(p, f.id, [k1, k0], [])
    expect(r.applied).toEqual([k0])
    expect(r.refused).toEqual([{ key: k1, reason: 'REFUSED: 条目已采纳' }])
    // 首次采纳 → 双写：键域从此为该文件权威（纯 legacy 时代结束）
    let raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedCids).toEqual([k1, k0]) // 既有（位置投影翻译）在前、批次在后
    expect(raw.proposal.appliedIndexes).toEqual([0, 1])
    expect(raw.proposal.status).toBe('partial')
    // reject 摘甲（已采纳）→ 幸存者回退键按新位置重算，账目同步收缩
    rejectChanges(p, f.id, [k0])
    raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.changes).toHaveLength(2) // [乙, 丙]
    expect(raw.proposal.appliedIndexes).toEqual([0]) // 乙 前移
    expect(raw.proposal.appliedCids).toEqual([changeKey(raw.proposal.changes[0], 0)])
    // 丙按新位置回退键正常采纳 → settled（甲实体在采纳时已落盘——reject 不撤销实体，既有语义）
    const kBing = changeKey(raw.proposal.changes[1], 1)
    const r2 = adoptChanges(p, f.id, [kBing], [])
    expect(r2.applied).toEqual([kBing])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
    expect(listCharacters(p).map((c) => c.name).sort()).toEqual(['甲', '丙'].sort())
  })

  it('纯 legacy 文件（从未双写）reject 保持位置语义：不写 appliedCids，权威不静默切换', () => {
    const { p, ch } = setup()
    const f = mkProposal(ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '丙' }) })
    ], { appliedIndexes: [2] }) // 丙已记账
    writeProposal(p, f)
    rejectChanges(p, f.id, keysOf(f, [0])) // 驳回甲 → [乙,丙]
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect('appliedCids' in onDisk).toBe(false) // 从未双写 → 位置语义保持（BOOK_FORMAT 兼容承诺）
    expect(onDisk.appliedIndexes).toEqual([1]) // 丙 旧2 → 新1
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedCids).toBeUndefined()
    expect(raw.proposal.status).toBe('partial')
    // 首次采纳 → 双写落地，键域从此接管
    const kYi = changeKey(raw.proposal.changes[0], 0)
    expect(adoptChanges(p, f.id, [kYi], []).applied).toEqual([kYi])
    const raw2 = loadProposalRaw(p, f.id)
    expect(raw2.proposal.appliedCids).toEqual([
      changeKey(raw2.proposal.changes[1], 1), // 既有丙账（位置翻译）在前
      kYi // 批次乙在后
    ])
    expect(raw2.proposal.appliedIndexes).toEqual([0, 1])
    expect(raw2.proposal.status).toBe('settled')
  })

  it('markSettled 失败窗口已关闭（M4c-2 判别测试）：记账丢失 → 重试同批 → aiSource 命中跳过创建（无双胞胎）+ applied 仍报键', () => {
    const { p, ch } = setup()
    const { f, cidB } = plantWithCids(p, ch.id)
    adoptChanges(p, f.id, [cidB], [])
    expect(listCharacters(p)).toHaveLength(1)
    const first = listCharacters(p)[0]
    // 模拟 markSettled 写盘失败（T3 顾虑 5 失败窗口）：实体已落盘而盘上账目回滚成未记账形态
    // （原子写失败 = 文件保持旧字节——回滚重写与真实失败后的盘上状态逐字节等价）
    const { proposal: raw } = loadProposalRaw(p, f.id)
    writeProposal(p, {
      id: raw.id,
      chapterId: raw.chapterId,
      createdAt: raw.createdAt,
      aiModel: raw.aiModel,
      status: 'pending',
      changes: raw.changes as ProposalChange[]
    })
    // 重试同批（同 cid）→ 盘上账目已丢，但首采实体携 aiSource={proposalId,cid} 令牌 →
    // create 前扫描命中 = 已应用：不新建、不双胞胎，applied 照常报键并补账（M4c-1 钉死的残留窗口在此关闭）
    const retry = adoptChanges(p, f.id, [cidB], [])
    expect(retry).toEqual({ applied: [cidB], refused: [] })
    expect(listCharacters(p)).toHaveLength(1) // 判别点：旧世界此处 = 2（双胞胎）
    expect(listCharacters(p)[0].id).toBe(first.id) // 原卡仍在，没有新卡
    expect(loadProposalRaw(p, f.id).proposal.appliedCids).toEqual([cidB]) // 重试把账补上
  })
})

// ---------------------------------------------------------------------------
// M4c-2：create 幂等（aiSource 令牌——markSettled 失败重试的双胞胎窗口关闭）
// ---------------------------------------------------------------------------

describe('create 幂等（M4c-2 aiSource 令牌）', () => {
  it('命中跳过：域内已有 aiSource 同 {proposalId,条目键} 的实体 → 不新建、applied 报键、账目当场补上', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) })])
    const k0 = keyOf(f, 0)
    // 预置带令牌的实体（模拟「前次采纳已落盘、账目却丢了」的盘面上残留的孪生源）
    const twin = createCharacter(p, { name: '哨兵', gender: 'male', role: 'minor' }, {
      aiSource: { proposalId: f.id, cid: k0 }
    })
    const r = adoptChanges(p, f.id, [k0], [])
    expect(r).toEqual({ applied: [k0], refused: [] })
    expect(listCharacters(p)).toHaveLength(1) // 命中 → 跳过创建，绝不双胞胎
    expect(listCharacters(p)[0].id).toBe(twin.id)
    expect(loadProposalRaw(p, f.id).proposal.appliedCids).toEqual([k0])
  })

  it('近似不命中：proposalId 或 cid 任一不符 → 照常创建（扫描是双字段全等，不是模糊匹配）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) })])
    const k0 = keyOf(f, 0)
    createCharacter(p, { name: '别家', gender: 'male', role: 'minor' }, {
      aiSource: { proposalId: 'prop-other-1', cid: k0 } // 同键异提案
    })
    createCharacter(p, { name: '半截', gender: 'female', role: 'minor' }, {
      aiSource: { proposalId: f.id, cid: 'other-key' } // 同提案异键
    })
    expect(adoptChanges(p, f.id, [k0], []).applied).toEqual([k0])
    expect(listCharacters(p)).toHaveLength(3) // 两张近似卡都没误伤：正常创建第三张
  })

  it('伏笔域（台账扫描）同样命中跳过：create×foreshadow 重试不追加第二条', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, {
        entity: 'foreshadow',
        after: { title: '断剑', plantedChapterId: ch.id, plannedPayoffNote: '后文回收', resolvedChapterId: null, status: 'open' }
      })
    ])
    const k0 = keyOf(f, 0)
    upsertForeshadow(p, { ...mkForeshadow(), title: '断剑', aiSource: { proposalId: f.id, cid: k0 } })
    const r = adoptChanges(p, f.id, [k0], [])
    expect(r).toEqual({ applied: [k0], refused: [] })
    expect(readLedger(p).entries).toHaveLength(1)
  })

  it('create×五域一律注入 aiSource={proposalId, 条目键}（键 = changeKey 派生值）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, {
        entity: 'world',
        after: { title: '青云山', category: 'location', content: '云雾缭绕', parentId: null, order: 0, tags: [], links: [] }
      }),
      mkChange(ch.id, { entity: 'plotline', after: { title: '主线', summary: '复仇', status: 'active', stages: [] } }),
      mkChange(ch.id, { entity: 'choice', after: { title: '岔路', chapterId: ch.id, options: [] } }),
      mkChange(ch.id, {
        entity: 'foreshadow',
        after: { title: '断剑', plantedChapterId: ch.id, plannedPayoffNote: '后文回收', resolvedChapterId: null, status: 'open' }
      })
    ])
    const keys = keysOf(f, [0, 1, 2, 3, 4])
    expect(adoptChanges(p, f.id, keys, []).applied).toEqual(keys)
    expect(listCharacters(p)[0].aiSource).toEqual({ proposalId: f.id, cid: keys[0] })
    expect(listWorldEntries(p)[0].aiSource).toEqual({ proposalId: f.id, cid: keys[1] })
    expect(listPlotlines(p)[0].aiSource).toEqual({ proposalId: f.id, cid: keys[2] })
    expect(listChoices(p)[0].aiSource).toEqual({ proposalId: f.id, cid: keys[3] })
    expect(readLedger(p).entries[0].aiSource).toEqual({ proposalId: f.id, cid: keys[4] })
  })

  it('手写实体（无 aiSource）不受扫描影响：create 照常落盘，手写卡始终不带 aiSource 键', () => {
    const { p, ch } = setup()
    const humanId = seedHumanCharacter(p)
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ name: '新卡' }) })])
    expect(adoptChanges(p, f.id, keysOf(f, [0]), []).applied).toEqual(keysOf(f, [0]))
    expect(listCharacters(p)).toHaveLength(2) // 手写卡的存在没有让 create 误判「已应用」
    const human = getCharacter(p, humanId)!
    expect('aiSource' in human).toBe(false)
    expect(human.aiSource).toBeUndefined()
  })

  it('update 路径零注入：手写卡 update 后无 aiSource 键；after 回显/伪造 aiSource → 保留键静默丢弃', () => {
    const { p, ch } = setup()
    const humanId = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      mkChange(ch.id, {
        op: 'update',
        entity: 'character',
        targetId: humanId,
        after: { personality: 'AI 覆盖', aiSource: { proposalId: 'prop-fake', cid: 'fake-key' } },
        overwritesHuman: true
      })
    ])
    const r = adoptChanges(p, f.id, keysOf(f, [0]), keysOf(f, [0]))
    expect(r.applied).toEqual(keysOf(f, [0])) // 伪造键按保留回显丢弃，合法字段照常应用（不整条拒）
    const stored = getCharacter(p, humanId)!
    expect(stored.personality).toBe('AI 覆盖')
    expect('aiSource' in stored).toBe(false) // 伪造没落盘，update 也从不注入
  })

  it('update 保留既有令牌：AI 自建卡经后续整理 update，aiSource 纹丝不动（出处可追溯）', () => {
    const { p, ch } = setup()
    const f1 = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) })])
    expect(adoptChanges(p, f1.id, keysOf(f1, [0]), []).applied).toEqual(keysOf(f1, [0]))
    const created = listCharacters(p)[0]
    const f2 = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: created.id, after: { personality: '二稿性格' } })
    ])
    expect(adoptChanges(p, f2.id, keysOf(f2, [0]), []).applied).toEqual(keysOf(f2, [0]))
    expect(getCharacter(p, created.id)?.personality).toBe('二稿性格')
    expect(getCharacter(p, created.id)?.aiSource).toEqual({ proposalId: f1.id, cid: keyOf(f1, 0) })
  })

  it('legacy 无 cid 条目：aiSource.cid = 位置回退键（changeKey 单源派生），账目回滚后重试同样不双胞胎', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ]) // 无 cid → 键 = 位置回退键（keyOf 派生，绝不内联前缀字面量——grep 门）
    const k1 = keyOf(f, 1)
    expect(adoptChanges(p, f.id, [k1], []).applied).toEqual([k1])
    expect(listCharacters(p)[0].aiSource).toEqual({ proposalId: f.id, cid: k1 })
    // 账目回滚（markSettled 失败等价盘面）→ 重试 → 令牌命中跳过
    const { proposal: raw } = loadProposalRaw(p, f.id)
    writeProposal(p, {
      id: raw.id,
      chapterId: raw.chapterId,
      createdAt: raw.createdAt,
      aiModel: raw.aiModel,
      status: 'pending',
      changes: raw.changes as ProposalChange[]
    })
    const retry = adoptChanges(p, f.id, [k1], [])
    expect(retry).toEqual({ applied: [k1], refused: [] })
    expect(listCharacters(p)).toHaveLength(1) // 回退键令牌同样关窗
  })
})
