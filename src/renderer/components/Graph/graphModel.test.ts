import { describe, it, expect } from 'vitest'
import type { CharacterV2, WorldEntryV2 } from '@/common/schema'
import type { CharacterRole, SettingCategory } from '@/common/ipc'
import {
  buildCharacterGraph,
  buildWorldGraph,
  ROLE_COLORS,
  CATEGORY_COLORS
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
  relationships: { targetId: string; kind: string }[] = []
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
    arc: [],
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
