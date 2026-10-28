// M3 图谱视图的纯数据核心：把 CharacterV2[] / WorldEntryV2[]（M4c-2 起另加
// PlotlineV2[] / ChoiceNodeV2[] / CharacterV2 单体）转换为
// React Flow 可渲染的 { nodes, edges }，不含任何 React / DOM 依赖，可单测。
// 颜色一律取 src/renderer/styles/global.css 中已定义的设计变量（双主题均存在）。

import type { Node, Edge } from '@xyflow/react'
import type { CharacterV2, ChoiceNodeV2, PlotlineV2, WorldEntryV2 } from '@/common/schema'
import type { CharacterRole, SettingCategory } from '@/common/ipc'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type GraphKind = 'character' | 'world' | 'plotline' | 'choice' | 'arc'

/** 剧情线状态。schema.ts 刻意不导出命名类型（Task 1 共管），此处按结构派生。 */
export type PlotlineStatus = PlotlineV2['status']

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

export const STATUS_COLORS: Record<PlotlineStatus, string> = {
  active: 'var(--color-primary)',
  done: 'var(--color-success)',
  dormant: 'var(--color-text-tertiary)'
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

const STATUS_LABELS: Record<PlotlineStatus, string> = {
  active: '进行中',
  done: '已完结',
  dormant: '休眠'
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
    // type 必须显式给出：GraphView 的 nodeTypes 按 type 分发自定义节点，缺省会退化成
    // React Flow 内置 default 矩形（Task 3 真机实测抓出的接线断点，测试钉死防回归）
    if (i === 0) return { id: c.id, type: 'character', position: { x: 0, y: 0 }, data }
    const angle = ((i - 1) / ringCount) * Math.PI * 2
    return {
      id: c.id,
      type: 'character',
      position: { x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
      data
    }
  })

  return { nodes, edges }
}

/**
 * summary 截断：超过 max 字符取前 max 个加省略号（弧光 stage 卡片行高有限，
 * 全文留给实体卡）。恰 max 不截、不加省略号。
 */
const truncate = (s: string, max = 40): string => (s.length > max ? `${s.slice(0, max)}…` : s)

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
        type: 'world', // 同角色图：type 是 nodeTypes 分发键，缺失即退化 default 节点
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

// ---------------------------------------------------------------------------
// 剧情走向图：每剧情线一列、stages 纵向顺序链（M4c-2 Task 3）
// ---------------------------------------------------------------------------

/**
 * 语义钉死：
 * - 节点 = stage（不设剧情线根节点——根会与首 stage 重复表达标题）。
 *   每剧情线独占一列：列序 = createdAt 升序、同刻按 id 升序（总序 → 乱序输入同图）；
 *   0-stage 剧情线仍占其列（空列，列号与排序后下标一致，规则最简）。
 *   x = colIndex*260，y = stage 数组原序下标*120。
 * - 节点：label=stage.title，sub=`剧情线标题（状态中文）`，色=STATUS_COLORS[status]
 *   （运行时脏 status 兜底 FALLBACK_COLOR + 原样回显，同世界观图姿态）；
 *   id = `ps-<plotlineId>-<row>`，entityId 回指剧情线（点击=打开剧情线卡/跳章）。
 * - 边：stage_i→stage_{i+1}，id = `pc-<plotlineId>-<目标下标>`；无 label——
 *   顺序链自明（M3 关系边的 kind 标签语义在此不存在）。n stages → n-1 边。
 */
export function buildPlotlineGraph(plotlines: PlotlineV2[]): Graph {
  if (plotlines.length === 0) return { nodes: [], edges: [] }

  const ordered = [...plotlines].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const nodes: Node<GraphNodeData>[] = []
  const edges: Edge[] = []
  ordered.forEach((p, col) => {
    p.stages.forEach((stage, row) => {
      const id = `ps-${p.id}-${row}`
      nodes.push({
        id,
        type: 'plotline', // nodeTypes 分发键，同 character/world 钉法
        position: { x: col * COL_X, y: row * ROW_Y },
        data: {
          label: stage.title,
          sub: `${p.title}（${STATUS_LABELS[p.status] ?? p.status}）`,
          color: STATUS_COLORS[p.status] ?? FALLBACK_COLOR,
          kind: 'plotline',
          entityId: p.id
        }
      })
      if (row > 0) {
        edges.push({ id: `pc-${p.id}-${row}`, source: `ps-${p.id}-${row - 1}`, target: id })
      }
    })
  })

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// 关键选项图：按章分列的无边散点集合（M4c-2 Task 3）
// ---------------------------------------------------------------------------

/**
 * 语义钉死：
 * - 边恒为 []。裁定（计划 §Task 3）：choice→choice 链接仅当 consequence 指向另一
 *   choice id 时成立，而 M2 schema 的 ChoiceOption.consequence 是自由文本、无此字段，
 *   故 M4c 选择图 = 按章分列的节点集合，不造边。
 * - 列 = 有 ≥1 选项节点的章；x 按该章在 orderedChapterIds 中的**全局章序**定位
 *   （x = indexOf*260），中间没有选项的章留空列——章的远近由章序决定，不做压缩。
 * - 悬挂 chapterId（章已删/不在序表）：节点不丢，按 chapterId 升序补排在已知列之后
 *   （列号 = orderedChapterIds.length + 组内秩），确定性且不崩。
 * - 列内行序：createdAt 升序、同刻按 id 升序（总序 → 乱序输入同图）；y = rowIndex*120。
 * - 节点：label=title，sub=`N 个选项`（0 选项仍是节点），色=var(--color-warning)；
 *   id = choice.id，type='choice'。
 */
export function buildChoiceGraph(choices: ChoiceNodeV2[], orderedChapterIds: string[]): Graph {
  if (choices.length === 0) return { nodes: [], edges: [] }

  const columnByChapter = new Map(orderedChapterIds.map((id, i) => [id, i]))
  const byChapter = new Map<string, ChoiceNodeV2[]>()
  for (const c of choices) {
    byChapter.set(c.chapterId, [...(byChapter.get(c.chapterId) ?? []), c])
  }

  const known = [...byChapter.keys()]
    .filter((ch) => columnByChapter.has(ch))
    .sort((a, b) => columnByChapter.get(a)! - columnByChapter.get(b)!)
    .map((ch) => ({ col: columnByChapter.get(ch)!, list: byChapter.get(ch)! }))
  const dangling = [...byChapter.keys()]
    .filter((ch) => !columnByChapter.has(ch))
    .sort()
    .map((ch, i) => ({ col: orderedChapterIds.length + i, list: byChapter.get(ch)! }))

  const cmp = (a: ChoiceNodeV2, b: ChoiceNodeV2): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const nodes: Node<GraphNodeData>[] = []
  for (const { col, list } of [...known, ...dangling]) {
    list.sort(cmp).forEach((c, row) => {
      nodes.push({
        id: c.id,
        type: 'choice', // nodeTypes 分发键，同 character/world 钉法
        position: { x: col * COL_X, y: row * ROW_Y },
        data: {
          label: c.title,
          sub: `${c.options.length} 个选项`,
          color: 'var(--color-warning)',
          kind: 'choice',
          entityId: c.id
        }
      })
    })
  }

  return { nodes, edges: [] }
}

// ---------------------------------------------------------------------------
// 角色成长图：根 + 单列 arc stages 链（M4c-2 Task 3）
// ---------------------------------------------------------------------------

/**
 * 语义钉死：
 * - 输入为**单个**角色（arc 视图配角色选择器，Task 4）；null/undefined → 空图。
 * - 根节点：character.id，position {0,0}，label=name、sub=role 中文、color=ROLE_COLORS[role]
 *   —— data 形状与角色图逐字段一致，故 type/kind 均复用 'character'（Task 4 可直接
 *   挂 CharacterNode，点击回退 M3「打开角色卡」）。
 * - stage 节点：arc 数组原序（不做二次排序——成长顺序即录入顺序），单列 x=260、
 *   y=rowIndex*120；label=title，sub=summary 截断 40，色=ROLE_COLORS[role]（弧光随人）；
 *   id = `as-<charId>-<row>`，type='arc'，entityId 回指角色。
 * - 边：根→stage0、stage_i→stage_{i+1}，id = `ac-<charId>-<目标下标>`；无 label。
 *   m stages → m 边；空 arc → 仅根、0 边。
 */
export function buildArcGraph(character: CharacterV2 | null | undefined): Graph {
  if (!character) return { nodes: [], edges: [] }

  const color = ROLE_COLORS[character.role] ?? FALLBACK_COLOR
  const nodes: Node<GraphNodeData>[] = [
    {
      id: character.id,
      type: 'character', // 复用角色节点渲染：根与角色图节点 data 同形
      position: { x: 0, y: 0 },
      data: {
        label: character.name,
        sub: ROLE_LABELS[character.role] ?? character.role,
        color,
        kind: 'character',
        entityId: character.id
      }
    }
  ]
  const edges: Edge[] = []

  character.arc.forEach((stage, row) => {
    const id = `as-${character.id}-${row}`
    nodes.push({
      id,
      type: 'arc', // nodeTypes 分发键，同 character/world 钉法
      position: { x: COL_X, y: row * ROW_Y },
      data: {
        label: stage.title,
        sub: truncate(stage.summary),
        color,
        kind: 'arc',
        entityId: character.id
      }
    })
    const source = row === 0 ? character.id : `as-${character.id}-${row - 1}`
    edges.push({ id: `ac-${character.id}-${row}`, source, target: id })
  })

  return { nodes, edges }
}
