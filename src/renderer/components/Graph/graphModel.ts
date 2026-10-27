// M3 图谱视图的纯数据核心：把 CharacterV2[] / WorldEntryV2[] 转换为
// React Flow 可渲染的 { nodes, edges }，不含任何 React / DOM 依赖，可单测。
// 颜色一律取 src/renderer/styles/global.css 中已定义的设计变量（双主题均存在）。

import type { Node, Edge } from '@xyflow/react'
import type { CharacterV2, WorldEntryV2 } from '@/common/schema'
import type { CharacterRole, SettingCategory } from '@/common/ipc'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type GraphKind = 'character' | 'world'

// 注意：必须用 type 别名而非 interface —— @xyflow/react v12 的 Node<T> 约束
// T extends Record<string, unknown>，type 别名享有隐式索引签名而 interface 没有。
export type GraphNodeData = {
  label: string
  sub?: string
  color: string
  kind: GraphKind
  entityId: string
}

export interface Graph {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

// ---------------------------------------------------------------------------
// 配色与中文标签（仅使用 global.css 已定义的 CSS 变量）
// ---------------------------------------------------------------------------

export const ROLE_COLORS: Record<CharacterRole, string> = {
  protagonist: 'var(--color-primary)',
  antagonist: 'var(--color-danger)',
  supporting: 'var(--color-warning)',
  minor: 'var(--color-text-secondary)'
}

export const CATEGORY_COLORS: Record<SettingCategory, string> = {
  location: 'var(--color-success)',
  history: 'var(--color-warning)',
  magic: 'var(--color-primary)',
  culture: 'var(--color-danger)',
  other: 'var(--color-text-secondary)'
}

const ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  minor: '次要'
}

const CATEGORY_LABELS: Record<SettingCategory, string> = {
  location: '地点',
  history: '历史',
  magic: '魔法',
  culture: '文化',
  other: '其他'
}

/** 未知 category（运行时脏数据）的兜底色，同样来自 global.css。 */
const FALLBACK_COLOR = 'var(--color-text-tertiary)'

// ---------------------------------------------------------------------------
// 角色关系图：径向布局
// ---------------------------------------------------------------------------

/**
 * 语义钉死：
 * - 节点 = 每个角色；自环与悬挂边静默丢弃（不抛，悬挂项 console.warn）。
 * - A→B 与 B→A 各成一条有向边，边 id 带链路下标保证唯一。
 * - 布局：度数（入+出）降序、同度按 id 升序排序；最高者置圆心 (0,0)（钉死此值，
 *   测试与 Task 2 视口自适应均以此为锚），其余均匀分布在半径 R = 120 + 40*n 的
 *   圆周（n = 外围节点数，不含圆心）。弦长下限 ≈ 2·40·π ≈ 251 > 1，永不重叠。
 */
export function buildCharacterGraph(chars: CharacterV2[]): Graph {
  if (chars.length === 0) return { nodes: [], edges: [] }

  const idSet = new Set(chars.map((c) => c.id))
  const edges: Edge[] = []
  const degree = new Map<string, number>()
  for (const c of chars) degree.set(c.id, 0)

  for (const c of chars) {
    c.relationships.forEach((link, idx) => {
      if (link.targetId === c.id) return // 自环：静默丢弃
      if (!idSet.has(link.targetId)) {
        console.warn(`[graphModel] 丢弃悬挂关系边：${c.id} → ${link.targetId}（目标不存在）`)
        return
      }
      edges.push({
        id: `e-${c.id}-${link.targetId}-${idx}`,
        source: c.id,
        target: link.targetId,
        label: link.kind
      })
      degree.set(c.id, (degree.get(c.id) ?? 0) + 1)
      degree.set(link.targetId, (degree.get(link.targetId) ?? 0) + 1)
    })
  }

  // 度数降序，同度按 id 升序（稳定 tiebreak → 同输入必得同布局）
  const ordered = [...chars].sort((a, b) => {
    const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const ringCount = ordered.length - 1
  const radius = 120 + 40 * ringCount
  const nodes: Node<GraphNodeData>[] = ordered.map((c, i): Node<GraphNodeData> => {
    const data: GraphNodeData = {
      label: c.name,
      sub: ROLE_LABELS[c.role] ?? c.role,
      color: ROLE_COLORS[c.role] ?? FALLBACK_COLOR,
      kind: 'character',
      entityId: c.id
    }
    if (i === 0) return { id: c.id, position: { x: 0, y: 0 }, data }
    const angle = ((i - 1) / ringCount) * Math.PI * 2
    return {
      id: c.id,
      position: { x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
      data
    }
  })

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// 世界观设定图：类目分列 + 层级行序
// ---------------------------------------------------------------------------

const CATEGORY_COLUMN_ORDER: readonly SettingCategory[] = [
  'location',
  'history',
  'magic',
  'culture',
  'other'
]

const COL_X = 260
const ROW_Y = 120

/**
 * 语义钉死：
 * - 列：固定列序 location,history,magic,culture,other（colIndex 即列号，与是否
 *   出现无关）；运行时未知类目按字母序排在五列之后。x = colIndex * 260。
 * - 行：列内先根（parentId 为空或悬挂视同根，按 order 升序、同 order 按 id 升序），
 *   再深度优先把每个根的子孙紧随其后（children 同规则排序）。y = rowIndex * 120。
 * - parentId 环（脏数据）：无法从根到达的节点按 (order,id) 序补为伪根继续遍历，
 *   保证每个节点都被定位、坐标有限。
 * - 边：父→子，id = `h-${child}-${parent}`；悬挂 parentId 静默跳。
 */
export function buildWorldGraph(entries: WorldEntryV2[]): Graph {
  if (entries.length === 0) return { nodes: [], edges: [] }

  const idSet = new Set(entries.map((e) => e.id))
  const byId = new Map(entries.map((e) => [e.id, e]))

  // 有效父：非空且目标存在；悬挂 → 视为根
  const validParent = (e: WorldEntryV2): string | null =>
    e.parentId !== null && idSet.has(e.parentId) && e.parentId !== e.id ? e.parentId : null

  const children = new Map<string, WorldEntryV2[]>()
  const roots: WorldEntryV2[] = []
  for (const e of entries) {
    const p = validParent(e)
    if (p === null) roots.push(e)
    else children.set(p, [...(children.get(p) ?? []), e])
  }
  const cmp = (a: WorldEntryV2, b: WorldEntryV2): number =>
    a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  roots.sort(cmp)
  for (const list of children.values()) list.sort(cmp)

  const edges: Edge[] = []
  for (const [parentId, kids] of children) {
    for (const kid of kids) {
      edges.push({ id: `h-${kid.id}-${parentId}`, source: parentId, target: kid.id })
    }
  }

  // 列号：未知类目排在固定五列之后、按字母序
  const columnOf = (category: string): number => {
    const known = CATEGORY_COLUMN_ORDER.indexOf(category as SettingCategory)
    if (known >= 0) return known
    const unknownCats = [
      ...new Set(
        entries
          .map((e) => e.category as string)
          .filter((c) => !CATEGORY_COLUMN_ORDER.includes(c as SettingCategory))
      ),
    ].sort()
    return CATEGORY_COLUMN_ORDER.length + unknownCats.indexOf(category)
  }

  // 列内行序：DFS（根先、子随其后），脏数据环补为伪根
  const colRows = new Map<number, string[]>()
  const visited = new Set<string>()
  const place = (e: WorldEntryV2, col: number): void => {
    if (visited.has(e.id)) return
    visited.add(e.id)
    colRows.set(col, [...(colRows.get(col) ?? []), e.id])
    for (const kid of children.get(e.id) ?? []) {
      if (!visited.has(kid.id)) place(kid, col)
    }
  }
  for (const r of roots) place(r, columnOf(r.category as string))
  const remaining = [...entries].filter((e) => !visited.has(e.id)).sort(cmp)
  for (const r of remaining) place(r, columnOf(r.category as string))

  const nodes: Node<GraphNodeData>[] = []
  for (const [col, rowIds] of [...colRows.entries()].sort((a, b) => a[0] - b[0])) {
    rowIds.forEach((id, row) => {
      const e = byId.get(id)
      if (!e) return
      nodes.push({
        id,
        position: { x: col * COL_X, y: row * ROW_Y },
        data: {
          label: e.title,
          sub: CATEGORY_LABELS[e.category] ?? (e.category as string),
          color: CATEGORY_COLORS[e.category] ?? FALLBACK_COLOR,
          kind: 'world',
          entityId: id
        }
      })
    })
  }

  return { nodes, edges }
}
