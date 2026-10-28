import { describe, it, expect } from 'vitest'
import type {
  CharacterArcStage,
  CharacterV2,
  ChoiceNodeV2,
  PlotlineV2,
  WorldEntryV2
} from '@/common/schema'
import type { CharacterRole, SettingCategory } from '@/common/ipc'
import {
  buildCharacterGraph,
  buildWorldGraph,
  buildPlotlineGraph,
  buildChoiceGraph,
  buildArcGraph,
  ROLE_COLORS,
  CATEGORY_COLORS,
  STATUS_COLORS,
  type PlotlineStatus
} from './graphModel'

// ---------------------------------------------------------------------------
// 测试夹具：只填图构建关心的字段，其余给最小合法值
// ---------------------------------------------------------------------------

const ID_A = '3f2b6c1a-9d4e-4a7b-8c5d-1e6f7a8b9c0d'
const ID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ID_C = '11111111-2222-3333-4444-555555555555'
const ID_D = '66666666-7777-8888-9999-000000000000'

function char(
  id: string,
  name: string,
  role: CharacterRole,
  relationships: { targetId: string; kind: string }[] = [],
  arc: CharacterArcStage[] = []
): CharacterV2 {
  return {
    id,
    name,
    gender: 'other',
    age: 1,
    role,
    appearance: '',
    personality: '',
    background: '',
    relationships,
    arc,
    tags: [],
    links: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function entry(
  id: string,
  title: string,
  category: SettingCategory,
  parentId: string | null = null,
  order = 0
): WorldEntryV2 {
  return {
    id,
    title,
    category,
    content: '',
    parentId,
    order,
    tags: [],
    links: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function arcStage(title: string, summary: string): CharacterArcStage {
  return { title, summary, chapterIds: [] }
}

function plotline(
  id: string,
  title: string,
  status: PlotlineStatus,
  stageTitles: string[],
  createdAt = '2026-01-01T00:00:00.000Z'
): PlotlineV2 {
  return {
    id,
    title,
    summary: '',
    status,
    stages: stageTitles.map((t) => ({ title: t, summary: `概要-${t}`, chapterIds: [], entityIds: [] })),
    createdAt,
    updatedAt: createdAt
  }
}

function choice(
  id: string,
  chapterId: string,
  title: string,
  optionCount: number,
  createdAt = '2026-01-01T00:00:00.000Z'
): ChoiceNodeV2 {
  return {
    id,
    chapterId,
    title,
    options: Array.from({ length: optionCount }, (_, i) => ({
      label: `选项${i + 1}`,
      consequence: ''
    })),
    createdAt,
    updatedAt: createdAt
  }
}

function expectFinitePositions(nodes: { position: { x: number; y: number } }[]): void {
  for (const n of nodes) {
    expect(Number.isFinite(n.position.x)).toBe(true)
    expect(Number.isFinite(n.position.y)).toBe(true)
  }
}

function expectNoOverlap(nodes: { position: { x: number; y: number } }[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].position.x - nodes[j].position.x
      const dy = nodes[i].position.y - nodes[j].position.y
      expect(Math.hypot(dx, dy)).toBeGreaterThan(1)
    }
  }
}

// ---------------------------------------------------------------------------
// buildCharacterGraph
// ---------------------------------------------------------------------------

describe('buildCharacterGraph', () => {
  it('空输入 → nodes/edges 均为空数组，不抛', () => {
    const g = buildCharacterGraph([])
    expect(g).toEqual({ nodes: [], edges: [] })
  })

  it('3 角色环 A→B→C→A：3 节点 3 边，边端点均为合法角色 id', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [{ targetId: ID_B, kind: '朋友' }]),
      char(ID_B, '乙', 'antagonist', [{ targetId: ID_C, kind: '师徒' }]),
      char(ID_C, '丙', 'supporting', [{ targetId: ID_A, kind: '亲人' }])
    ]
    const g = buildCharacterGraph(chars)
    expect(g.nodes).toHaveLength(3)
    expect(g.edges).toHaveLength(3)
    const ids = new Set(chars.map((c) => c.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
      expect(e.source).not.toBe(e.target)
    }
    // 节点 data 形状
    const a = g.nodes.find((n) => n.id === ID_A)
    expect(a).toBeDefined()
    expect(a?.data).toEqual({
      label: '甲',
      sub: '主角',
      color: ROLE_COLORS.protagonist,
      kind: 'character',
      entityId: ID_A
    })
  })

  it("每个节点带 type:'character'（GraphView nodeTypes 分发键，缺失即退化 default 矩形）", () => {
    // Task 3 真机实测抓出的接线断点：无 type 时 nodeTypes 永不命中自定义节点，
    // 图谱虽「渲染成功」但全是内置灰框、graph.css 作用域全落空——纯渲染层才暴露，单测钉死
    const chars = [
      char(ID_A, '甲', 'protagonist', [{ targetId: ID_B, kind: '朋友' }]),
      char(ID_B, '乙', 'antagonist')
    ]
    const g = buildCharacterGraph(chars)
    expect(g.nodes).toHaveLength(2)
    for (const n of g.nodes) expect(n.type).toBe('character')
  })

  it('自环（targetId === 自身 id）被静默丢弃', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [
        { targetId: ID_A, kind: '自我' },
        { targetId: ID_B, kind: '朋友' }
      ]),
      char(ID_B, '乙', 'minor')
    ]
    const g = buildCharacterGraph(chars)
    expect(g.edges).toHaveLength(1)
    expect(g.edges.every((e) => e.source !== e.target)).toBe(true)
  })

  it('悬挂边（targetId 不在角色集合）静默丢弃、不抛', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [
        { targetId: 'ghost', kind: '神秘' },
        { targetId: ID_B, kind: '朋友' }
      ]),
      char(ID_B, '乙', 'supporting')
    ]
    const g = buildCharacterGraph(chars)
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].target).toBe(ID_B)
  })

  it('A↔B 互设 → 两条有向边，id 互不相同', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [{ targetId: ID_B, kind: '宿敌' }]),
      char(ID_B, '乙', 'antagonist', [{ targetId: ID_A, kind: '宿敌' }])
    ]
    const g = buildCharacterGraph(chars)
    expect(g.edges).toHaveLength(2)
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(2)
    expect(g.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(
      [`${ID_A}->${ID_B}`, `${ID_B}->${ID_A}`].sort()
    )
  })

  it('单角色 → 唯一节点为圆心 {0,0}，无边', () => {
    const g = buildCharacterGraph([char(ID_A, '独', 'minor')])
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('布局不变量：坐标有限且两两不重合（含中心与环、环与环）', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [
        { targetId: ID_B, kind: '友' },
        { targetId: ID_C, kind: '友' },
        { targetId: ID_D, kind: '友' }
      ]),
      char(ID_B, '乙', 'antagonist', [{ targetId: ID_C, kind: '友' }]),
      char(ID_C, '丙', 'supporting'),
      char(ID_D, '丁', 'minor')
    ]
    const g = buildCharacterGraph(chars)
    expectFinitePositions(g.nodes)
    expectNoOverlap(g.nodes)
    // 度数最高者（甲：3 出边）居圆心
    const center = g.nodes.find((n) => n.position.x === 0 && n.position.y === 0)
    expect(center?.id).toBe(ID_A)
  })

  it('确定性：同输入两次构建 → 位置逐一相同', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [{ targetId: ID_B, kind: '友' }]),
      char(ID_B, '乙', 'antagonist', [{ targetId: ID_C, kind: '友' }]),
      char(ID_C, '丙', 'supporting', [{ targetId: ID_A, kind: '友' }]),
      char(ID_D, '丁', 'minor', [{ targetId: ID_A, kind: '仰慕' }])
    ]
    const g1 = buildCharacterGraph(chars)
    const g2 = buildCharacterGraph(chars)
    const pos1 = Object.fromEntries(g1.nodes.map((n) => [n.id, n.position]))
    const pos2 = Object.fromEntries(g2.nodes.map((n) => [n.id, n.position]))
    expect(pos1).toEqual(pos2)
  })

  it('边 id 唯一（含 source 与链路下标）', () => {
    const chars = [
      char(ID_A, '甲', 'protagonist', [
        { targetId: ID_B, kind: '友' },
        { targetId: ID_B, kind: '敌' }
      ]),
      char(ID_B, '乙', 'minor')
    ]
    const g = buildCharacterGraph(chars)
    expect(g.edges).toHaveLength(2)
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(2)
  })

  it('ROLE_COLORS 四色齐备且互不相同', () => {
    expect(Object.keys(ROLE_COLORS).sort()).toEqual([
      'antagonist',
      'minor',
      'protagonist',
      'supporting'
    ])
    expect(new Set(Object.values(ROLE_COLORS)).size).toBe(4)
  })

  it('CATEGORY_COLORS 五色齐备且互不相同', () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([
      'culture',
      'history',
      'location',
      'magic',
      'other'
    ])
    expect(new Set(Object.values(CATEGORY_COLORS)).size).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// buildWorldGraph
// ---------------------------------------------------------------------------

describe('buildWorldGraph', () => {
  it('空输入 → nodes/edges 均为空数组，不抛', () => {
    const g = buildWorldGraph([])
    expect(g).toEqual({ nodes: [], edges: [] })
  })

  it("每个节点带 type:'world'（同角色图：nodeTypes 分发键钉死）", () => {
    const g = buildWorldGraph([entry(ID_A, '山', 'location'), entry(ID_B, '河', 'history')])
    expect(g.nodes).toHaveLength(2)
    for (const n of g.nodes) expect(n.type).toBe('world')
  })

  it('单节点（parentId=null）→ 1 节点 0 边', () => {
    const g = buildWorldGraph([entry(ID_A, '山门', 'location')])
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes[0].data).toEqual({
      label: '山门',
      sub: '地点',
      color: CATEGORY_COLORS.location,
      kind: 'world',
      entityId: ID_A
    })
  })

  it('两层父链 根→子→孙：2 条父→子边，层级 y 递增', () => {
    const entries = [
      entry(ID_A, '大陆', 'location', null, 0),
      entry(ID_B, '王国', 'location', ID_A, 0),
      entry(ID_C, '都城', 'location', ID_B, 0)
    ]
    const g = buildWorldGraph(entries)
    expect(g.nodes).toHaveLength(3)
    expect(g.edges).toHaveLength(2)
    for (const e of g.edges) {
      expect(e.id).toBe(`h-${e.target}-${e.source}`)
    }
    const y = Object.fromEntries(g.nodes.map((n) => [n.id, n.position.y]))
    expect(y[ID_A]).toBeLessThan(y[ID_B])
    expect(y[ID_B]).toBeLessThan(y[ID_C])
    // 同列同 x
    const xs = g.nodes.map((n) => n.position.x)
    expect(new Set(xs).size).toBe(1)
  })

  it('跨 category 分列：不同类目 x 不同，列序按固定顺序', () => {
    const entries = [
      entry(ID_A, 'location项', 'location'),
      entry(ID_B, 'history项', 'history'),
      entry(ID_C, 'magic项', 'magic'),
      entry(ID_D, 'culture项', 'culture')
    ]
    const g = buildWorldGraph(entries)
    const xOf = (id: string): number => g.nodes.find((n) => n.id === id)!.position.x
    // 固定列序 location=0, history=1, magic=2, culture=3 → x = col*260
    expect(xOf(ID_A)).toBe(0)
    expect(xOf(ID_B)).toBe(260)
    expect(xOf(ID_C)).toBe(520)
    expect(xOf(ID_D)).toBe(780)
    expect(g.edges).toHaveLength(0)
  })

  it('列内行序：根按 order 升序，子紧随其父；y = row*120', () => {
    const entries = [
      entry(ID_C, '丙', 'other', null, 5),
      entry(ID_A, '甲', 'other', null, 1),
      entry(ID_B, '乙', 'other', ID_A, 0)
    ]
    const g = buildWorldGraph(entries)
    const yOf = (id: string): number => g.nodes.find((n) => n.id === id)!.position.y
    expect(yOf(ID_A)).toBe(0)
    expect(yOf(ID_B)).toBe(120)
    expect(yOf(ID_C)).toBe(240)
  })

  it('悬挂 parentId → 视为根，静默不抛、无边', () => {
    const g = buildWorldGraph([entry(ID_A, '孤儿', 'magic', 'ghost')])
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expectFinitePositions(g.nodes)
  })

  it('布局不变量：坐标有限、两两不重合', () => {
    const entries = [
      entry(ID_A, 'a', 'location'),
      entry(ID_B, 'b', 'location', ID_A),
      entry(ID_C, 'c', 'history'),
      entry(ID_D, 'd', 'history'),
      entry('e1', 'e', 'magic'),
      entry('e2', 'f', 'magic', ID_C)
    ]
    const g = buildWorldGraph(entries)
    expectFinitePositions(g.nodes)
    expectNoOverlap(g.nodes)
  })

  it('确定性：同输入两次构建 → 位置逐一相同', () => {
    const entries = [
      entry(ID_A, 'a', 'location', null, 2),
      entry(ID_B, 'b', 'location', null, 1),
      entry(ID_C, 'c', 'history', ID_A),
      entry(ID_D, 'd', 'magic')
    ]
    const g1 = buildWorldGraph(entries)
    const g2 = buildWorldGraph(entries)
    const pos1 = Object.fromEntries(g1.nodes.map((n) => [n.id, n.position]))
    const pos2 = Object.fromEntries(g2.nodes.map((n) => [n.id, n.position]))
    expect(pos1).toEqual(pos2)
  })

  it('运行时脏 category（不在五类中）不抛，归最后一列且坐标有限', () => {
    const dirty = entry(ID_A, 'x', 'location')
    const weird: WorldEntryV2 = { ...dirty, category: 'weird' as SettingCategory }
    const g = buildWorldGraph([entry(ID_D, '正常', 'other'), weird])
    expectFinitePositions(g.nodes)
    const xOf = (id: string): number => g.nodes.find((n) => n.id === id)!.position.x
    expect(xOf(ID_A)).toBeGreaterThan(xOf(ID_D))
  })

  it('parentId 环（A↔B 互指）不死循环，全部节点仍被定位', () => {
    const entries = [
      entry(ID_A, 'a', 'location', ID_B),
      entry(ID_B, 'b', 'location', ID_A),
      entry(ID_C, 'c', 'location', ID_A)
    ]
    const g = buildWorldGraph(entries)
    expect(g.nodes).toHaveLength(3)
    expectFinitePositions(g.nodes)
    expectNoOverlap(g.nodes)
    expect(g.edges.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// buildPlotlineGraph
// ---------------------------------------------------------------------------

describe('buildPlotlineGraph', () => {
  it('空输入 → nodes/edges 均为空数组，不抛', () => {
    const g = buildPlotlineGraph([])
    expect(g).toEqual({ nodes: [], edges: [] })
  })

  it('剧情线 0 stages（退化）→ 无节点无边，不抛', () => {
    const g = buildPlotlineGraph([plotline(ID_A, '空线', 'active', [])])
    expect(g).toEqual({ nodes: [], edges: [] })
  })

  it('单剧情线 3 stages → 3 节点纵向一列（x=0，y=0/120/240），2 条顺序链边', () => {
    const g = buildPlotlineGraph([plotline(ID_A, '主线', 'active', ['起', '承', '合'])])
    expect(g.nodes).toHaveLength(3)
    expect(g.edges).toHaveLength(2)
    expect(g.nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 120 },
      { x: 0, y: 240 }
    ])
    // 节点 data 形状：label=stage.title，sub=剧情线标题+status 中文
    expect(g.nodes[1].data).toEqual({
      label: '承',
      sub: '主线（进行中）',
      color: STATUS_COLORS.active,
      kind: 'plotline',
      entityId: ID_A
    })
  })

  it('两剧情线 → 每线一列（x=colIndex*260），边仅在各自线内 stage_i→stage_{i+1}', () => {
    const g = buildPlotlineGraph([
      plotline(ID_A, '甲线', 'active', ['a1', 'a2', 'a3']),
      plotline(ID_B, '乙线', 'done', ['b1', 'b2'])
    ])
    expect(g.nodes).toHaveLength(5)
    expect(g.edges).toHaveLength(3) // (3-1) + (2-1)
    const xOf = (label: string): number =>
      g.nodes.find((n) => n.data.label === label)!.position.x
    expect(xOf('a1')).toBe(0)
    expect(xOf('a3')).toBe(0)
    expect(xOf('b1')).toBe(260)
    // 边不跨列：每条边的两端 id 前缀同线
    for (const e of g.edges) {
      const src = g.nodes.find((n) => n.id === e.source)!
      const tgt = g.nodes.find((n) => n.id === e.target)!
      expect(src.position.x).toBe(tgt.position.x)
      expect(tgt.position.y).toBeGreaterThan(src.position.y)
    }
  })

  it('边无 label（链条自明，M3 关系边的 kind 标签不适用于 stage 顺序链）', () => {
    const g = buildPlotlineGraph([plotline(ID_A, '甲', 'active', ['s1', 's2', 's3'])])
    expect(g.edges).toHaveLength(2)
    for (const e of g.edges) expect(e.label).toBeUndefined()
  })

  it("每个节点带 type:'plotline'（GraphView nodeTypes 分发键，同 character/world 钉法）", () => {
    const g = buildPlotlineGraph([plotline(ID_A, '甲', 'dormant', ['s1', 's2'])])
    for (const n of g.nodes) {
      expect(n.type).toBe('plotline')
      expect(n.data.kind).toBe('plotline')
    }
  })

  it('status 三色映射：active→primary、done→success、dormant→text-tertiary（含中文标签）', () => {
    const g = buildPlotlineGraph([
      plotline(ID_A, 'A', 'active', ['a']),
      plotline(ID_B, 'B', 'done', ['b']),
      plotline(ID_C, 'C', 'dormant', ['c'])
    ])
    const nodeOf = (label: string) => g.nodes.find((n) => n.data.label === label)!
    expect(nodeOf('a').data.color).toBe('var(--color-primary)')
    expect(nodeOf('b').data.color).toBe('var(--color-success)')
    expect(nodeOf('c').data.color).toBe('var(--color-text-tertiary)')
    expect(nodeOf('a').data.sub).toBe('A（进行中）')
    expect(nodeOf('b').data.sub).toBe('B（已完结）')
    expect(nodeOf('c').data.sub).toBe('C（休眠）')
  })

  it('运行时脏 status → 兜底色 + 原样回显，不抛', () => {
    const dirty = plotline(ID_A, '甲', 'active', ['s'])
    const g = buildPlotlineGraph([{ ...dirty, status: 'weird' as PlotlineStatus }])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].data.color).toBe('var(--color-text-tertiary)')
    expect(g.nodes[0].data.sub).toBe('甲（weird）')
  })

  it('确定性：按 createdAt→id 排序，输入乱序两次构建结果逐一相同', () => {
    const base = [
      plotline(ID_A, '甲', 'active', ['a1', 'a2'], '2026-01-03T00:00:00.000Z'),
      plotline(ID_B, '乙', 'done', ['b1'], '2026-01-01T00:00:00.000Z'),
      plotline(ID_D, '丙', 'dormant', ['c1', 'c2', 'c3'], '2026-01-03T00:00:00.000Z')
    ]
    const shuffled = [base[2], base[0], base[1]]
    const g1 = buildPlotlineGraph(base)
    const g2 = buildPlotlineGraph(shuffled)
    expect(g2).toEqual(g1)
    // 列序：createdAt 升序（乙）→ 同日按 id 升序（'3f2b…' < '6666…' 见夹具常量）
    const xOf = (label: string): number =>
      g1.nodes.find((n) => n.data.label === label)!.position.x
    expect(xOf('b1')).toBe(0)
    expect(xOf('a1')).toBe(260)
    expect(xOf('c1')).toBe(520)
  })

  it('布局不变量：坐标有限且两两不重合', () => {
    const g = buildPlotlineGraph([
      plotline(ID_A, '甲', 'active', ['a1', 'a2', 'a3']),
      plotline(ID_B, '乙', 'done', ['b1']),
      plotline(ID_C, '丙', 'dormant', ['c1', 'c2'])
    ])
    expectFinitePositions(g.nodes)
    expectNoOverlap(g.nodes)
  })
})

// ---------------------------------------------------------------------------
// buildChoiceGraph
// ---------------------------------------------------------------------------

describe('buildChoiceGraph', () => {
  it('空输入 → nodes/edges 均为空数组，不抛', () => {
    const g = buildChoiceGraph([], [ID_A])
    expect(g).toEqual({ nodes: [], edges: [] })
  })

  it('单选项 → 1 节点 0 边，sub=「N 个选项」，色=warning', () => {
    const g = buildChoiceGraph([choice(ID_A, ID_C, '抉择', 2)], [ID_C])
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toEqual([])
    expect(g.nodes[0].data).toEqual({
      label: '抉择',
      sub: '2 个选项',
      color: 'var(--color-warning)',
      kind: 'choice',
      entityId: ID_A
    })
    expect(g.nodes[0].type).toBe('choice')
    expect(g.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('0 选项（退化）仍是节点，sub=「0 个选项」', () => {
    const g = buildChoiceGraph([choice(ID_A, ID_C, '空抉择', 0)], [ID_C])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].data.sub).toBe('0 个选项')
  })

  it('无边散点图（裁定 R：M2 schema 无 choice→choice 链接字段）→ edges 恒为空', () => {
    const chapters = [ID_A, ID_B]
    const choices = [
      choice(ID_C, ID_A, '甲选', 2),
      choice(ID_D, ID_B, '乙选', 1),
      choice('e1', ID_A, '丙选', 3)
    ]
    const g = buildChoiceGraph(choices, chapters)
    expect(g.nodes).toHaveLength(3)
    expect(g.edges).toEqual([])
  })

  it('列位置跟随 orderedChapterIds 全局章序：ch3 的选项落在 ch3 列（ch1/ch2 空亦然）', () => {
    const chapters = ['ch1', 'ch2', 'ch3']
    const g = buildChoiceGraph([choice(ID_A, 'ch3', '抉择', 1)], chapters)
    expect(g.nodes[0].position.x).toBe(520) // index 2 * 260
    expect(g.nodes[0].position.y).toBe(0)
  })

  it('同章多选项纵向堆叠 y=rowIndex*120；列内按 createdAt→id 排序，乱序输入结果不变', () => {
    const base = [
      choice(ID_A, ID_C, '先', 1, '2026-01-02T00:00:00.000Z'),
      choice(ID_B, ID_C, '后', 2, '2026-01-01T00:00:00.000Z'),
      choice(ID_D, ID_C, '同日按id', 3, '2026-01-02T00:00:00.000Z')
    ]
    const shuffled = [base[2], base[1], base[0]]
    const g1 = buildChoiceGraph(base, [ID_C])
    const g2 = buildChoiceGraph(shuffled, [ID_C])
    expect(g2).toEqual(g1)
    expect(g1.nodes.map((n) => [n.data.label, n.position.y])).toEqual([
      ['后', 0],
      ['先', 120],
      ['同日按id', 240]
    ])
  })

  it('悬挂 chapterId（不在 orderedChapterIds）不丢节点：排在已知列之后、按章 id 升序，确定性', () => {
    const chapters = ['ch1']
    const choices = [choice(ID_A, 'zz', '乙', 1), choice(ID_B, 'aa', '甲', 1)]
    const g = buildChoiceGraph([...choices, choice('c1', 'ch1', '正常', 1)], chapters)
    expect(g.nodes).toHaveLength(3)
    const xOf = (label: string): number =>
      g.nodes.find((n) => n.data.label === label)!.position.x
    expect(xOf('正常')).toBe(0)
    // 未知章按 chapterId 升序补列：aa=列1、zz=列2
    expect(xOf('甲')).toBe(260)
    expect(xOf('乙')).toBe(520)
  })

  it('布局不变量：坐标有限且两两不重合；两次构建逐一相同', () => {
    const chapters = ['ch1', 'ch2', 'ch3']
    const choices = [
      choice(ID_A, 'ch1', 'a', 1),
      choice(ID_B, 'ch1', 'b', 2, '2026-01-02T00:00:00.000Z'),
      choice(ID_C, 'ch3', 'c', 1),
      choice(ID_D, 'ghost', 'd', 1)
    ]
    const g1 = buildChoiceGraph(choices, chapters)
    const g2 = buildChoiceGraph(choices, chapters)
    expect(g2).toEqual(g1)
    expectFinitePositions(g1.nodes)
    expectNoOverlap(g1.nodes)
  })
})

// ---------------------------------------------------------------------------
// buildArcGraph
// ---------------------------------------------------------------------------

describe('buildArcGraph', () => {
  it('null / undefined（未选角色）→ 空图，不抛', () => {
    expect(buildArcGraph(null)).toEqual({ nodes: [], edges: [] })
    expect(buildArcGraph(undefined)).toEqual({ nodes: [], edges: [] })
  })

  it('arc 为空（退化）→ 仅角色根节点 {0,0}，无边', () => {
    const g = buildArcGraph(char(ID_A, '甲', 'protagonist'))
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(g.nodes[0].data).toEqual({
      label: '甲',
      sub: '主角',
      color: ROLE_COLORS.protagonist,
      kind: 'character',
      entityId: ID_A
    })
    // 根节点复用 CharacterNode 渲染（type 与角色图同键，data 形状逐字段一致）
    expect(g.nodes[0].type).toBe('character')
  })

  it('单 stage → 2 节点 1 边（根→stage0），stage 列 x=260 y=0', () => {
    const c = char(ID_A, '甲', 'supporting', [], [arcStage('觉醒', '初获力量')])
    const g = buildArcGraph(c)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.nodes[1].position).toEqual({ x: 260, y: 0 })
    expect(g.nodes[1].data).toEqual({
      label: '觉醒',
      sub: '初获力量',
      color: ROLE_COLORS.supporting,
      kind: 'arc',
      entityId: ID_A
    })
    expect(g.nodes[1].type).toBe('arc')
    expect(g.edges[0].source).toBe(ID_A)
    expect(g.edges[0].target).toBe(g.nodes[1].id)
    expect(g.edges[0].label).toBeUndefined()
  })

  it('3 stages → 4 节点 3 边（根→0、0→1、1→2），stage 纵向 y=0/120/240、x 恒 260', () => {
    const c = char(ID_A, '甲', 'antagonist', [], [
      arcStage('起', 's1'),
      arcStage('承', 's2'),
      arcStage('转', 's3')
    ])
    const g = buildArcGraph(c)
    expect(g.nodes).toHaveLength(4)
    expect(g.edges).toHaveLength(3)
    expect(g.nodes.slice(1).map((n) => n.position)).toEqual([
      { x: 260, y: 0 },
      { x: 260, y: 120 },
      { x: 260, y: 240 }
    ])
    for (const e of g.edges) {
      expect(g.nodes.some((n) => n.id === e.source)).toBe(true)
      expect(g.nodes.some((n) => n.id === e.target)).toBe(true)
    }
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(3)
  })

  it('summary 截断 40：超长取前 40 字符加省略号，恰 40 不加', () => {
    const long = '相'.repeat(45)
    const exact = '凝'.repeat(40)
    const c = char(ID_A, '甲', 'minor', [], [arcStage('长', long), arcStage('准', exact)])
    const g = buildArcGraph(c)
    expect(g.nodes[1].data.sub).toBe('相'.repeat(40) + '…')
    expect(g.nodes[2].data.sub).toBe(exact)
  })

  it('stage 顺序 = 数组原序（不做二次排序），两次构建逐一相同', () => {
    const c = char(ID_A, '甲', 'protagonist', [], [
      arcStage('三', 'c'),
      arcStage('一', 'a'),
      arcStage('二', 'b')
    ])
    const g1 = buildArcGraph(c)
    const g2 = buildArcGraph(c)
    expect(g2).toEqual(g1)
    expect(g1.nodes.slice(1).map((n) => n.data.label)).toEqual(['三', '一', '二'])
  })

  it('布局不变量：坐标有限且两两不重合（根与列、列内行间）', () => {
    const c = char(ID_A, '甲', 'protagonist', [], [
      arcStage('s1', ''),
      arcStage('s2', ''),
      arcStage('s3', '')
    ])
    const g = buildArcGraph(c)
    expectFinitePositions(g.nodes)
    expectNoOverlap(g.nodes)
  })
})

// ---------------------------------------------------------------------------
// STATUS_COLORS：CSS 变量存在性钉死（双主题 global.css 均有定义，控制器已核实）
// ---------------------------------------------------------------------------

describe('STATUS_COLORS', () => {
  it('三色齐备、互不相同，且取钉死的四个 var token 之列', () => {
    // 四个 var 名按字面钉死于测试（控制器已核实双主题 global.css 均有定义）：
    // --color-primary / --color-success / --color-warning / --color-text-tertiary
    const PINNED_VARS = [
      'var(--color-primary)',
      'var(--color-success)',
      'var(--color-warning)',
      'var(--color-text-tertiary)'
    ]
    expect(Object.keys(STATUS_COLORS).sort()).toEqual(['active', 'done', 'dormant'])
    expect(new Set(Object.values(STATUS_COLORS)).size).toBe(3)
    expect(STATUS_COLORS).toEqual({
      active: 'var(--color-primary)',
      done: 'var(--color-success)',
      dormant: 'var(--color-text-tertiary)'
    })
    for (const v of Object.values(STATUS_COLORS)) expect(PINNED_VARS).toContain(v)
  })
})
