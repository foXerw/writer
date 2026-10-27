// 采纳引擎测试（M4b T3，tmp 书目录 + 真 repository，零仓库 mock）：
// - R1 origin 机制：aiTouched 语义（人写 = 非空 && 不在 aiTouched）；覆盖人写 → REFUSED: 覆盖人写内容 <field>；
//   overwritesHuman:true 未经 UI 确认 → REFUSED: 未确认覆盖；确认后落盘 + aiTouched 追加 + updatedAt 刷新；
//   create 不设 aiTouched（裁定：新建全字段 AI 产但暂无人写内容，采纳入册后归作者监护——从严）；
// - R2 __proto__ 加固：after 携 own '__proto__' 键 → 允许字段照常应用、Object.prototype 零污染、存量干净；
// - R3 逐实体深校验：create×character/world/plotline/choice/foreshadow 全形状校验（注入新 id+时间戳）、
//   update×foreshadow 仅 status/plannedPayoffNote/note、summary/index 落 .ai/ 的形狀与合并语义、
//   delete 仅限 plotline/choice/foreshadow 且 targetId 必须存在（delete×character 由 validateChange 双保险拒）；
// - 批次纪律：逐条 try/catch（一条坏不拖累整批）、applied/refused 对账、markSettled 记账、
//   重复采纳拒绝、越界/非法索引拒绝、rejectChanges 删条目（空 → 整份删除）+ appliedIndexes 重排。
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
import { newProposalId, proposalPath } from '../../../src/common/proposal'
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
      for (const banned of ['__proto__', 'id', 'createdAt', 'updatedAt', 'aiTouched']) {
        expect(list).not.toContain(banned)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// create×character（R3 深校验 + 落盘形状）
// ---------------------------------------------------------------------------

describe('create×character', () => {
  it('全形状 after → listCharacters 出现；aiTouched 播种所写非空字段（裁定 A）；提案 settled', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const r = adoptChanges(p, f.id, [0], [])
    expect(r).toEqual({ applied: [0], refused: [] })
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
  })

  it('裁定 A 连锁：后续整理改 AI 自建卡的记名字段，无需 overwritesHuman 直接应用', () => {
    const { p, ch } = setup()
    const f1 = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    adoptChanges(p, f1.id, [0], [])
    const created = listCharacters(p)[0]
    const f2 = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: created.id, after: { personality: '二稿性格' } })
    ])
    const r = adoptChanges(p, f2.id, [0], []) // 无旗标、无确认
    expect(r).toEqual({ applied: [0], refused: [] })
    const stored = getCharacter(p, created.id)!
    expect(stored.personality).toBe('二稿性格')
    expect(stored.aiTouched).toEqual(['name', 'gender', 'age', 'role', 'appearance', 'personality', 'background']) // 去重不加位
  })

  it('裁定 A 空值不入账：create 携空 personality → 不记名，人写后照常受保护', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter({ personality: '' }) })])
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
    const created = listCharacters(p)[0]
    expect(created.aiTouched).not.toContain('personality')
    // 人手填写后（repo 直写模拟）该字段 = 人写：AI 再改需旗标+确认
    updateCharacter(p, { ...created, personality: '人写性格' })
    const f2 = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: created.id, after: { personality: 'AI 覆盖' } })
    ])
    expect(adoptChanges(p, f2.id, [0], []).refused[0].reason).toBe('REFUSED: 覆盖人写内容 personality')
  })

  it('after 缺必备字段 → 整条拒（错误串带字段路径）且零落盘，提案保持 pending', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: { name: '残缺' } })])
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0].index).toBe(0)
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
    const r = adoptChanges(p, f.id, [0], [])
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toBe('REFUSED: 覆盖人写内容 personality')
    expect(getCharacter(p, cid)?.personality).toBe('人写性格')
  })

  it('overwritesHuman:true 但未进 confirmedOverwrite → REFUSED: 未确认覆盖', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 覆盖' }, { overwritesHuman: true })])
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.refused[0].reason).toBe('REFUSED: 未确认覆盖')
    expect(getCharacter(p, cid)?.personality).toBe('人写性格')
  })

  it('overwritesHuman:true + confirmed → 落盘、aiTouched 追加、updatedAt 刷新、createdAt 不动', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const before = getCharacter(p, cid)!
    const f = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 覆盖' }, { overwritesHuman: true })])
    const r = adoptChanges(p, f.id, [0], [0])
    expect(r).toEqual({ applied: [0], refused: [] })
    const after = getCharacter(p, cid)!
    expect(after.personality).toBe('AI 覆盖')
    expect(after.aiTouched).toEqual(['personality'])
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.name).toBe('旧名') // 未涉及字段不动
  })

  it('AI 写过的字段（在 aiTouched）再更新无需 overwritesHuman；aiTouched 去重不重复', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const f1 = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 一稿' }, { overwritesHuman: true })])
    adoptChanges(p, f1.id, [0], [0])
    const f2 = plant(p, ch.id, [updateChange(ch.id, cid, { personality: 'AI 二稿', appearance: '新外貌' })])
    const r = adoptChanges(p, f2.id, [0], [])
    expect(r.applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([0])
    expect(getCharacter(p, doc.id)?.personality).toBe('AI 补充')
    expect(getCharacter(p, doc.id)?.aiTouched).toEqual(['personality', 'links'])
  })

  it('number 字段：默认 0 视为空可写；人写非零值受保护', () => {
    const { p, ch } = setup()
    const doc = createCharacter(p, { name: '无龄', gender: 'other', role: 'minor' })
    const f1 = plant(p, ch.id, [updateChange(ch.id, doc.id, { age: 24 })])
    expect(adoptChanges(p, f1.id, [0], []).applied).toEqual([0]) // 0 → 24 放行（0 = 仓库默认空值）
    const human = createCharacter(p, { name: '有龄', gender: 'male', role: 'minor' }, { age: 40 })
    const f2 = plant(p, ch.id, [updateChange(ch.id, human.id, { age: 41 })])
    const r = adoptChanges(p, f2.id, [0], [])
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([])
    expect(r.refused[0].reason).toBe('REFUSED: 未知字段 origin')
    const stored = getCharacter(p, doc.id)!
    expect(stored.personality).toBe('') // 合法字段也没落盘（appliedIndexes 绝不说谎）
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
    const r = adoptChanges(p, f.id, [0, 1, 2], [])
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
    const r = adoptChanges(p, f.id, [0, 1], [])
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r).toEqual({ applied: [0], refused: [] })
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
    const r = adoptChanges(p, f.id, [0], [])
    expect(r.applied).toEqual([0]) // allowlist 拷贝天然不含 __proto__ → 正常建卡
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r1 = adoptChanges(p, deny.id, [0], [])
    expect(r1.refused[0].reason).toBe('REFUSED: 覆盖人写内容 content')
    expect(getWorldEntry(p, entry.id)?.content).toBe('人写正文')
    const ok = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'world', targetId: entry.id, after: { content: 'AI 正文' }, overwritesHuman: true })
    ])
    const r2 = adoptChanges(p, ok.id, [0], [0])
    expect(r2.applied).toEqual([0])
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
    expect(adoptChanges(p, good.id, [0], []).applied).toEqual([0])
    expect(listPlotlines(p).map((x) => x.title)).toEqual(['主线'])
    const bad = plant(p, ch.id, [mkChange(ch.id, { entity: 'plotline', after: { title: '残线' } })])
    const r = adoptChanges(p, bad.id, [0], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
    const stored = listPlotlines(p).find((x) => x.id === pl.id)!
    expect(stored.summary).toBe('新纲')
    expect(stored.status).toBe('active') // status 保留：AI 不得改剧情线生命周期
    const only = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'plotline', targetId: pl.id, after: { status: 'done' } })
    ])
    const r = adoptChanges(p, only.id, [0], [])
    expect(r.refused[0].reason).toBe('REFUSED: 无可应用字段')
    // 评审 I2 同纪律覆盖 mergePlain 路径：未知字段整条拒，合法字段也不落盘
    const unknown = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'plotline', targetId: pl.id, after: { summary: '再改', color: '红' } })
    ])
    const r2 = adoptChanges(p, unknown.id, [0], [])
    expect(r2.refused[0].reason).toBe('REFUSED: 未知字段 color')
    expect(listPlotlines(p).find((x) => x.id === pl.id)!.summary).toBe('新纲')
  })

  it('create×choice 挂真章 → listChoices；幻影章 → REF_BROKEN 拒', () => {
    const { p, ch } = setup()
    const good = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'choice', after: { title: '岔路', chapterId: ch.id, options: [{ label: '左', consequence: '遇伏' }] } })
    ])
    expect(adoptChanges(p, good.id, [0], []).applied).toEqual([0])
    expect(listChoices(p)).toHaveLength(1)
    const ghost = randomUUID()
    const bad = plant(p, ch.id, [
      mkChange(ch.id, { entity: 'choice', after: { title: '幻影', chapterId: ghost, options: [] } })
    ])
    const r = adoptChanges(p, bad.id, [0], [])
    expect(r.refused[0].reason).toContain(`REF_BROKEN: ${ghost}`)
    expect(listChoices(p)).toHaveLength(1)
  })

  it('update×choice options 显式覆盖 → 落盘', () => {
    const { p, ch } = setup()
    const c = createChoice(p, { title: '旧选项', chapterId: ch.id })
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'choice', targetId: c.id, after: { options: [{ label: '战', consequence: '胜' }] } })
    ])
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0, 1, 2], [])
    expect(r.applied).toEqual([0, 1])
    expect(listPlotlines(p)).toEqual([])
    expect(listChoices(p)).toEqual([])
    expect(r.refused[0].index).toBe(2)
    expect(r.refused[0].reason).toContain('PLOTLINE_MISSING')
  })

  it('delete×character 双保险：绕过 writeProposal 的坏提案 → validateChange 在采纳现场再拒', () => {
    const { p, ch } = setup()
    const cid = seedHumanCharacter(p)
    const evil = mkProposal(ch.id, [mkChange(ch.id, { op: 'delete', entity: 'character', targetId: cid })])
    plantBypass(p, evil) // 文件级校验会被拒——刻意绕过，模拟手改文件
    const r = adoptChanges(p, evil.id, [0], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, bad.id, [0], [])
    expect(r.refused[0].reason).toContain('FORESHADOW_TRANSITION')
    const noop = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { status: 'resolved' } })
    ])
    expect(adoptChanges(p, noop.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
    const stored = readLedger(p).entries.find((x) => x.id === e.id)!
    expect(stored.plannedPayoffNote).toBe('新计划')
    expect(stored.note).toBe('补注')
    expect(stored.title).toBe('旧钟') // title 不在 update 白名单 → 忽略
    expect(stored.status).toBe('open')
    const none = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: e.id, after: { title: '只改表外' } })
    ])
    expect(adoptChanges(p, none.id, [0], []).refused[0].reason).toContain('无可应用字段')
  })

  it('update/delete×foreshadow 幻影 targetId → FORESHADOW_MISSING 拒', () => {
    const { p, ch } = setup()
    const ghost = randomUUID()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'foreshadow', targetId: ghost, after: { status: 'resolved' } }),
      mkChange(ch.id, { op: 'delete', entity: 'foreshadow', targetId: ghost })
    ])
    const r = adoptChanges(p, f.id, [0, 1], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0, 1, 2], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    const r = adoptChanges(p, f.id, [0, 1, 2, 3], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
    const text = readFileSync(aiIndexFile(p), 'utf8')
    expect(text).not.toContain('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(characterIds(p)).toContain(car.id)
    expect(worldIds(p)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 批次语义
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
    const r = adoptChanges(p, f.id, [0, 1, 2], [])
    expect(r.applied).toEqual([0, 2])
    expect(r.refused).toEqual([{ index: 1, reason: 'REFUSED: 覆盖人写内容 personality' }])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('partial')
    expect(loadProposalRaw(p, f.id).proposal.appliedIndexes).toEqual([0, 2])
    // 重采纳：1 照拒（人写保护是状态性的），0 拒「已采纳」（防双写）
    const r2 = adoptChanges(p, f.id, [0, 1], [])
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
    expect(adoptChanges(p, f.id, [0], []).applied).toEqual([0])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('partial')
    expect(adoptChanges(p, f.id, [1], [1]).applied).toEqual([1])
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
  })

  it('越界/非法索引/重复索引：越界与非法按条拒，重复只处理一次', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const r = adoptChanges(p, f.id, [5, -1, 1.5, 0, 0], [])
    expect(r.applied).toEqual([0])
    expect(r.refused.map((x) => [x.index, x.reason])).toEqual([
      [5, 'REFUSED: 条目索引越界'],
      [-1, 'REFUSED: 条目索引越界'],
      [1.5, 'REFUSED: 条目索引非法: 1.5']
    ])
    expect(listCharacters(p)).toHaveLength(1)
  })

  it('提案缺失 → PROPOSAL_MISSING 抛穿（通道级错误，不是逐条拒）', () => {
    const { p } = setup()
    expect(() => adoptChanges(p, 'prop-nope-1', [0], [])).toThrow(/PROPOSAL_MISSING/)
  })

  it('全拒批次零写盘：status/appliedIndexes 不变（不做无意义重写）', () => {
    const { p, ch } = setup()
    const human = seedHumanCharacter(p)
    const f = plant(p, ch.id, [
      mkChange(ch.id, { op: 'update', entity: 'character', targetId: human, after: { personality: 'AI' } })
    ])
    const before = readFileSync(proposalPath(p, f.id), 'utf8')
    adoptChanges(p, f.id, [0], [])
    expect(readFileSync(proposalPath(p, f.id), 'utf8')).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// rejectChanges
// ---------------------------------------------------------------------------

describe('rejectChanges', () => {
  it('删中间条目：其余保序、appliedIndexes 重排、status 重算', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '丙' }) })
    ])
    expect(adoptChanges(p, f.id, [1], []).applied).toEqual([1]) // 采纳「乙」
    rejectChanges(p, f.id, [0]) // 驳回「甲」→ 乙 前移到索引 0
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.changes).toHaveLength(2)
    expect((raw.proposal.changes[0] as ProposalChange).after).toEqual(fullCharacterAfter({ name: '乙' }))
    expect(raw.proposal.appliedIndexes).toEqual([0]) // 旧 1 → 新 0
    expect(raw.proposal.status).toBe('partial')
    // 重排后索引 0 已采纳 → 再采纳被拒（防双写），索引 1（丙）可正常采纳
    const r = adoptChanges(p, f.id, [0, 1], [])
    expect(r.applied).toEqual([1])
    expect(r.refused[0].reason).toBe('REFUSED: 条目已采纳')
    expect(loadProposalRaw(p, f.id).proposal.status).toBe('settled')
    expect(listCharacters(p).map((c) => c.name).sort()).toEqual(['乙', '丙'].sort())
  })

  it('驳回已采纳条目：applied 出账，status 回落', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    adoptChanges(p, f.id, [0], [])
    rejectChanges(p, f.id, [0])
    const raw = loadProposalRaw(p, f.id)
    expect(raw.proposal.appliedIndexes).toEqual([])
    expect(raw.proposal.status).toBe('pending')
    const onDisk = yaml.load(readFileSync(proposalPath(p, f.id), 'utf8')) as Record<string, unknown>
    expect('appliedIndexes' in onDisk).toBe(false) // 空账不携键（与存量文件同形）
  })

  it('驳回全部剩余条目 → 整份提案删除（文件消失）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    rejectChanges(p, f.id, [0, 1])
    expect(existsSync(proposalPath(p, f.id))).toBe(false)
    expect(getProposal(p, f.id)).toBeNull()
    expect(listCharacters(p)).toEqual([])
  })

  it('幂等：空数组/越界索引 → 零写盘不抛；缺失提案 → PROPOSAL_MISSING', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [mkChange(ch.id, { after: fullCharacterAfter() })])
    const before = readFileSync(proposalPath(p, f.id), 'utf8')
    rejectChanges(p, f.id, [])
    rejectChanges(p, f.id, [9])
    expect(readFileSync(proposalPath(p, f.id), 'utf8')).toBe(before)
    expect(() => rejectChanges(p, 'prop-nope-1', [0])).toThrow(/PROPOSAL_MISSING/)
  })

  it('重写后的文件仍过文件级校验（getProposal 可读，面板不裂）', () => {
    const { p, ch } = setup()
    const f = plant(p, ch.id, [
      mkChange(ch.id, { after: fullCharacterAfter({ name: '甲' }) }),
      mkChange(ch.id, { after: fullCharacterAfter({ name: '乙' }) })
    ])
    adoptChanges(p, f.id, [0], [])
    rejectChanges(p, f.id, [1])
    const doc = getProposal(p, f.id)
    expect(doc?.status).toBe('settled')
    expect(doc?.changes).toHaveLength(1)
    expect(doc?.appliedIndexes).toEqual([0])
  })
})
