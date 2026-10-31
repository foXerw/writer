// M6 T4——意见→提案 change 转化纯函数测试（opinionToChange）。
// 钉死：三类别映射形状（foreshadow CREATE / world UPDATE / character UPDATE）、
// after 构造不丢既有字段（整卡拷贝 + 目标字段追加段）、target 校验两路（命中→ok；
// 缺失/错域→need-target + 对应域候选按 name 序）、软意见 invalid('soft-not-convertible')、
// 产物过 validateChange（与提案存储层同一把门）——转化即落盘前的形状预审。
// 纯逻辑零 I/O：不碰 fs/ipc，写盘归 T5 编排（proposal:save/appendChanges）。
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { CharacterV2, WorldEntryV2 } from './schema'
import { validateForeshadowEntry } from './schema'
import type { ProposalChange } from './proposal'
import { validateChange } from './proposal'
import type { ReviewCategory, ReviewOpinion } from './reviewTypes'
import { SOFT_CATEGORIES } from './reviewTypes'
import { opinionToChange } from './reviewConvert'

const CHAPTER = '11111111-2222-4333-8444-555555555555'

function mkOpinion(over: Partial<ReviewOpinion> = {}): ReviewOpinion {
  return {
    id: randomUUID(),
    chapterId: CHAPTER,
    category: 'foreshadow-unresolved',
    severity: 'hard',
    anchor: { quote: '她望向远山，低声念出一个名字。', paraIndex: 3 },
    text: '此伏笔至本章仍未回收，需要尽快安排回声。',
    suggestion: '可在结尾让名字应有回声。',
    status: 'open',
    stale: false,
    createdAt: new Date().toISOString(),
    model: 'test-model',
    ...over
  }
}

function mkWorld(over: Partial<WorldEntryV2> = {}): WorldEntryV2 {
  return {
    id: randomUUID(),
    title: '南城结界',
    category: 'magic',
    content: '南城以青铜门为界，入夜后灵脉封闭。',
    parentId: null,
    order: 1,
    tags: ['结界'],
    links: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over
  }
}

function mkCharacter(over: Partial<CharacterV2> = {}): CharacterV2 {
  return {
    id: randomUUID(),
    name: '林惊秋',
    gender: 'female',
    age: 19,
    role: 'protagonist',
    appearance: '青衣长发',
    personality: '外冷内热',
    background: '出身药商之家',
    goals: '查清父亲失踪真相',
    flaws: '多疑',
    relationships: [],
    arc: [],
    tags: [],
    links: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over
  }
}

/** change.after 取回记录形状（测试专用窄化；产物由 ok 分支保证是对象）。 */
function afterOf(change: ProposalChange): Record<string, unknown> {
  expect(change.after).toBeInstanceOf(Object)
  return change.after as Record<string, unknown>
}

function okChange(o: ReviewOpinion, ctx: Parameters<typeof opinionToChange>[1]): ProposalChange {
  const r = opinionToChange(o, ctx)
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.kind}`)
  return r.change
}

describe('opinionToChange：foreshadow-unresolved → create foreshadow', () => {
  const ctx = { characters: [], world: [] }
  it('映射形状钉死：op=create、entity=foreshadow、无 targetId、source 携带章 id + 锚引文', () => {
    const c = okChange(mkOpinion(), ctx)
    expect(c.op).toBe('create')
    expect(c.entity).toBe('foreshadow')
    expect(c.targetId).toBeUndefined()
    expect(c.overwritesHuman).toBeUndefined()
    expect(c.source).toEqual({ chapterId: CHAPTER, quote: '她望向远山，低声念出一个名字。' })
  })
  it('after 播种镜像 ForeshadowEntry 必备字段（adopt 深度关可直接过）', () => {
    const o = mkOpinion({ text: '此伏笔至本章仍未回收，需要尽快安排回声。' })
    const after = afterOf(okChange(o, ctx))
    // title = 意见文本截 30 字；plantedChapterId = 意见章；status 播种 open；
    // plannedPayoffNote 取 suggestion（缺省回落 text）；resolvedChapterId 显式 null——
    // validateForeshadowEntry 要求 string|null 在场（undefined 会被拒）。
    expect(after.status).toBe('open')
    expect(after.plantedChapterId).toBe(CHAPTER)
    expect(after.resolvedChapterId).toBeNull()
    expect(after.plannedPayoffNote).toBe('可在结尾让名字应有回声。')
    expect(after.title).toBe('此伏笔至本章仍未回收，需要尽快安排回声。'.slice(0, 30))
  })
  it('title 截断在 30 字（超长意见只留前 30 码点）', () => {
    const long = '一'.repeat(50)
    const after = afterOf(okChange(mkOpinion({ text: long }), ctx))
    expect(after.title).toBe('一'.repeat(30))
  })
  it('无 suggestion 时 plannedPayoffNote 回落意见文本', () => {
    const after = afterOf(okChange(mkOpinion({ suggestion: undefined }), ctx))
    expect(after.plannedPayoffNote).toBe('此伏笔至本章仍未回收，需要尽快安排回声。')
  })
  it('产物过 validateChange 零错误；after 补 id 后过 validateForeshadowEntry（采纳可用预审）', () => {
    const c = okChange(mkOpinion(), ctx)
    expect(validateChange(c)).toEqual([])
    expect(validateForeshadowEntry({ ...afterOf(c), id: randomUUID() })).toEqual([])
  })
})

describe('opinionToChange：setting-conflict → update world', () => {
  it('target 命中 world → ok；after = 整卡拷贝 + content 追加 suggestion 段（既有字段不丢）', () => {
    const w = mkWorld()
    const o = mkOpinion({ category: 'setting-conflict', targetEntityId: w.id })
    const c = okChange(o, { characters: [], world: [w] })
    expect(c.op).toBe('update')
    expect(c.entity).toBe('world')
    expect(c.targetId).toBe(w.id)
    expect(c.overwritesHuman).toBe(true) // 改写人写 content——R1 通道旗标
    const after = afterOf(c)
    expect(after.content).toBe(`${w.content}\n\n${o.suggestion}`)
    // 不丢既有字段（除 content 外逐字段恒等）
    for (const key of Object.keys(w)) {
      if (key === 'content') continue
      expect(after[key]).toEqual((w as unknown as Record<string, unknown>)[key])
    }
    expect(validateChange(c)).toEqual([])
  })
  it('content 为空时 suggestion 独占正文；无 suggestion 回落意见文本', () => {
    const w = mkWorld({ content: '' })
    const o = mkOpinion({ category: 'setting-conflict', targetEntityId: w.id, suggestion: undefined })
    const after = afterOf(okChange(o, { characters: [], world: [w] }))
    expect(after.content).toBe('此伏笔至本章仍未回收，需要尽快安排回声。')
  })
  it('targetEntityId 缺失 → need-target，candidates = world 全列表 {id,name=title} 按 name 序', () => {
    const w1 = mkWorld({ title: '青铜门', category: 'location' })
    const w2 = mkWorld({ title: '灵脉志' })
    const w3 = mkWorld({ title: '北境军制', category: 'history' })
    const o = mkOpinion({ category: 'setting-conflict' })
    const r = opinionToChange(o, { characters: [mkCharacter()], world: [w3, w1, w2] })
    expect(r.kind).toBe('need-target')
    if (r.kind !== 'need-target') return
    // name 序 = UTF-16 码元字典序（跨机确定，见实现注）：北(5317) < 灵(7075) < 青(9752)
    expect(r.candidates.map((x) => x.name)).toEqual(['北境军制', '灵脉志', '青铜门'])
    const expected = [w3, w2, w1].map((w) => ({ id: w.id, name: w.title }))
    expect(r.candidates).toEqual(expected)
    // 域预滤：character 不进 candidates
    expect(r.candidates.every((x) => [w1.id, w2.id, w3.id].includes(x.id))).toBe(true)
  })
  it('targetEntityId 指向 character（错域）→ need-target；空串视同缺失', () => {
    const ch = mkCharacter()
    const ctx = { characters: [ch], world: [mkWorld()] }
    const r1 = opinionToChange(mkOpinion({ category: 'setting-conflict', targetEntityId: ch.id }), ctx)
    expect(r1.kind).toBe('need-target')
    const r2 = opinionToChange(mkOpinion({ category: 'setting-conflict', targetEntityId: '' }), ctx)
    expect(r2.kind).toBe('need-target')
  })
})

describe('opinionToChange：motivation-break → update character', () => {
  it('target 命中 character → ok；after = 整卡拷贝 + goals 追加段（文本无「动机/性格」）', () => {
    const ch = mkCharacter()
    const o = mkOpinion({ category: 'motivation-break', targetEntityId: ch.id, text: '主角放弃了追查线索。', suggestion: '补一段内心摇摆。' })
    const c = okChange(o, { characters: [ch], world: [] })
    expect(c.op).toBe('update')
    expect(c.entity).toBe('character')
    expect(c.targetId).toBe(ch.id)
    expect(c.overwritesHuman).toBe(true)
    const after = afterOf(c)
    expect(after.goals).toBe(`${ch.goals}\n\n补一段内心摇摆。`)
    expect(after.flaws).toBe(ch.flaws) // 路由规则：未命中关键词不动 flaws
    for (const key of Object.keys(ch)) {
      if (key === 'goals') continue
      expect(after[key]).toEqual((ch as unknown as Record<string, unknown>)[key])
    }
    expect(validateChange(c)).toEqual([])
  })
  it('路由规则：text 或 suggestion 提及「动机」/「性格」→ 追加 flaws，goals 不动', () => {
    const ch = mkCharacter()
    const byText = afterOf(okChange(
      mkOpinion({ category: 'motivation-break', targetEntityId: ch.id, text: '此处动机断裂明显。' }),
      { characters: [ch], world: [] }
    ))
    expect(byText.flaws).toBe(`${ch.flaws}\n\n可在结尾让名字应有回声。`)
    expect(byText.goals).toBe(ch.goals)
    const ch2 = mkCharacter()
    const bySuggestion = afterOf(okChange(
      mkOpinion({ category: 'motivation-break', targetEntityId: ch2.id, text: '行为无来由。', suggestion: '强化性格铺垫。' }),
      { characters: [ch2], world: [] }
    ))
    expect(bySuggestion.flaws).toBe(`${ch2.flaws}\n\n强化性格铺垫。`)
  })
  it('goals/flaws 缺席时播种单段；空串字段等价缺席', () => {
    const ch = mkCharacter({ goals: undefined, flaws: undefined })
    const after = afterOf(okChange(
      mkOpinion({ category: 'motivation-break', targetEntityId: ch.id, text: '性格不合逻辑。', suggestion: '加一句自白。' }),
      { characters: [ch], world: [] }
    ))
    expect(after.flaws).toBe('加一句自白。') // 命中「性格」→ flaws；原值缺席 → 单段无前置换行
    expect(after.goals).toBeUndefined()
    const ch2 = mkCharacter({ goals: '', flaws: '' })
    const after2 = afterOf(okChange(
      mkOpinion({ category: 'motivation-break', targetEntityId: ch2.id, text: '行为无来由。', suggestion: '加一句自白。' }),
      { characters: [ch2], world: [] }
    ))
    expect(after2.goals).toBe('加一句自白。')
  })
  it('target 缺失/错域（指向 world）→ need-target，candidates = character 全列表按 name 序', () => {
    const c1 = mkCharacter({ name: '张三' })
    const c2 = mkCharacter({ name: 'Alice' })
    const w = mkWorld()
    const ctx = { characters: [c1, c2], world: [w] }
    const r1 = opinionToChange(mkOpinion({ category: 'motivation-break' }), ctx)
    expect(r1.kind).toBe('need-target')
    if (r1.kind !== 'need-target') return
    expect(r1.candidates.map((x) => x.id)).toEqual([c2.id, c1.id]) // Alice(0x41…) < 张三(0x5F20…)，码元序
    const r2 = opinionToChange(mkOpinion({ category: 'motivation-break', targetEntityId: w.id }), ctx)
    expect(r2.kind).toBe('need-target')
    if (r2.kind !== 'need-target') return
    expect(r2.candidates.every((x) => x.id !== w.id)).toBe(true) // world 不进 character 候选
  })
})

describe('opinionToChange：软类别与兜底', () => {
  it('三类软意见一律 invalid(soft-not-convertible)——散文是作者地盘（spec 非目标）', () => {
    for (const category of SOFT_CATEGORIES) {
      const r = opinionToChange(mkOpinion({ category: category as ReviewCategory }), {
        characters: [mkCharacter()],
        world: [mkWorld()]
      })
      expect(r).toEqual({ kind: 'invalid', reason: 'soft-not-convertible' })
    }
  })
  it('need-target 候选为空列表时仍是 need-target（作者域为空 → 选择器空态，非 invalid）', () => {
    const r = opinionToChange(mkOpinion({ category: 'setting-conflict' }), { characters: [], world: [] })
    expect(r).toEqual({ kind: 'need-target', candidates: [] })
  })
})
