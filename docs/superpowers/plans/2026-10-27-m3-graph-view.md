# M3：图谱视图 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M2 的实体-关系数据渲染成可交互的图谱视图（人物关系图 + 世界观图），在主区与写作视图切换，点节点联动侧栏面板。

**Architecture:** 业务与渲染彻底解耦——`graphModel.ts` 纯函数把 M2 的 `CharacterV2[]`/`WorldEntryV2[]` 转成 React Flow 的 `{nodes, edges}`（含自算布局），可脱离 React 单测；`GraphView.tsx` 用 @xyflow/react 只做渲染/交互；经 M1 预留的 `renderMainView()` 接缝挂入 Workspace，顶部 `写作|图谱` 分段控件切换。数据经现有 `character:getAll`/`setting:getAll` 门面拉取，订阅 M2 的 `book:changed` 自动刷新。

**Tech Stack:** 既有栈 + **@xyflow/react v12**（React Flow，唯一新增运行时依赖，peer 支持 React 18）。

**Spec:** `docs/superpowers/specs/2026-10-27-m3-graph-view-design.md`（本计划实现其 §2 目标、§4 选择、§7 DoD；§3 非目标尤其"点击跳章节推迟 M4"必须遵守）

## Global Constraints

- 新增运行时依赖仅 `@xyflow/react`（`npm i @xyflow/react`，随 package-lock 一起提交）。
- 不改 M2 数据模型、不改 IPC 通道集合（只消费现有 `character:getAll`、`setting:getAll`）。
- 图配色一律走 CSS 变量（`var(--color-*)`），深/浅双主题无不可读文字、无闪。
- 纯逻辑（graphModel）必须 vitest 单测；React 组件层无 jsdom，靠 typecheck/lint/build + 人工冒烟。
- UI 文案中文；App 名"完美小说"。
- 门禁：`npm run typecheck` 0（入 build）、`npm run lint` 0 error（1 条既有 react-refresh warning 容忍）、`npm run test` 全绿、`npm run build` ok。
- 每任务一提交，conventional 前缀，末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 现状基线：main 已含 M1+M2，vitest 294 测试；`@xyflow/react` 未装。

## Review Focus

（规格没写、但最可能咬人的输入，每条钉到对应任务的测试/冒烟）

1. **退化数据不崩图**：空角色集、单角色、自环关系（targetId===自身）、悬挂关系（targetId 指向已删实体）、A↔B 互设的双向关系——`buildCharacterGraph` 必须全部产出合法 nodes/edges 且不抛（Task 1 单测）。
2. **布局不重叠不越界**：径向布局节点数增多时半径随 n 增长、坐标有限；世界观分列布局同列不重叠（Task 1 单测断言坐标有限性 + 两两不重合）。
3. **book:changed 刷新正确性**：在角色面板改一条关系→图重拉后边数变化，且卸载时取消订阅不泄漏（Task 2/3 静态走查 + 人工冒烟）。
4. **视图切换状态**：写作↔图谱来回切，编辑器滚动/光标不丢、图不重复挂载泄漏（Task 3 人工冒烟）。
5. **依赖边界**：@xyflow/react 的 CSS 只在图谱视图作用域引入生效，不污染全局 antd 样式（Task 2 冒烟：切回写作视图，工具栏/侧栏样式无变化）。

---

### Task 1: graphModel 纯函数 + 布局 + 单测

**Files:**
- Create: `src/renderer/components/Graph/graphModel.ts`
- Create: `src/renderer/components/Graph/graphModel.test.ts`
- Modify: `package.json` + `package-lock.json`（`npm i @xyflow/react`）

**Interfaces:**
- Produces（全部导出自 `graphModel.ts`）：
  - `import type { Node, Edge } from '@xyflow/react'`
  - `export type GraphKind = 'character' | 'world'`
  - `export interface GraphNodeData { label: string; sub?: string; color: string; kind: GraphKind; entityId: string }`
  - `export interface Graph { nodes: Node<GraphNodeData>[]; edges: Edge[] }`
  - `export function buildCharacterGraph(chars: CharacterV2[]): Graph`
  - `export function buildWorldGraph(entries: WorldEntryV2[]): Graph`
  - `export const ROLE_COLORS: Record<CharacterRole, string>`（protagonist/antagonist/supporting/minor → CSS 变量字符串如 `var(--color-primary)` 等，四色可区分）
  - `export const CATEGORY_COLORS: Record<SettingCategory, string>`（location/history/magic/culture/other → 五色）
- Consumes: `src/common/schema.ts` 的 `CharacterV2`/`WorldEntryV2`/`EntityLink`/`CharacterRole`/`SettingCategory`（type-only import via `@/common/schema`）。
- 语义钉死：
  - `buildCharacterGraph`：节点=每个角色，`id`=角色 id，`data.label`=name，`data.sub`=role 中文（主角/反派/配角/次要），`data.color`=ROLE_COLORS[role]，`data.entityId`=角色 id。边：遍历每个角色的 `relationships: EntityLink[]`，对每条 `link`：跳过 `link.targetId===char.id`（自环）；跳过 `link.targetId` 不在角色 id 集合中（悬挂，静默丢弃、不抛）；否则加边 `{ id: \`e-${char.id}-${link.targetId}-${idx}\`, source: char.id, target: link.targetId, label: link.kind }`（A→B 与 B→A 各成一条，不去重）。布局：径向——按节点度数（入+出边数）降序排序，度数最高者置圆心，其余均匀分布半径 `R = 120 + 40*n` 的圆周（n=外围节点数）；坐标 `position:{x,y}` 有限实数。
  - `buildWorldGraph`：节点=每个设定条目，`data.label`=title，`data.sub`=category 中文，`data.color`=CATEGORY_COLORS[category]。边：`parentId` 非空且指向存在的条目 → `{id: \`h-${child}-${parent}\`, source: parent, target: child}`（父→子）；悬挂 parentId 静默跳。布局：按 category 分列（列序固定 location,history,magic,culture,other,未知归最后），列内按 parentId 层级（根先、子随其后，深度递增 y）；`x = colIndex*260`，`y = rowInCol*120`。
  - 空输入 → `{nodes:[], edges:[]}`，绝不抛。

- [ ] Step 1: `npm i @xyflow/react`（确认解析到 v12.x，lockfile 同步）。
- [ ] Step 2: 写失败测试 `graphModel.test.ts`：
  - 空数组 → nodes/edges 均 []。
  - 3 角色 + A→B(kind=朋友)、B→C、C→A：nodes.length=3、edges.length=3、每条边 source/target 是合法角色 id。
  - 自环（A.relationships 含 targetId=A.id）→ 该边被丢，edges 不含自环。
  - 悬挂（targetId='ghost' 不在集合）→ 丢弃不抛。
  - A↔B 互设 → 两条有向边。
  - 布局不变量：所有 `position.x/y` `Number.isFinite` 为真；任意两节点坐标不重合（欧氏距离 > 1）。
  - buildWorldGraph：两层 parentId（根→子→孙）→ 2 条边、层级 y 递增；跨 category 分列 x 不同；空/单节点正常。
- [ ] Step 3: 运行确认 FAIL（模块不存在）。
- [ ] Step 4: 实现 graphModel.ts（径向 + 分列布局，度数计算，边界过滤）。
- [ ] Step 5: `npm run test` 全绿；typecheck 0。
- [ ] Step 6: Commit `feat(graph): pure graph-model builder with radial & category layouts`。

### Task 2: GraphView 组件 + 自定义节点 + 主题 CSS + useGraphData

**Files:**
- Create: `src/renderer/components/Graph/GraphView.tsx`
- Create: `src/renderer/components/Graph/CharacterNode.tsx`
- Create: `src/renderer/components/Graph/WorldNode.tsx`
- Create: `src/renderer/components/Graph/graph.css`
- Create: `src/renderer/pages/Workspace/hooks/useGraphData.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildCharacterGraph`/`buildWorldGraph`/`Graph`/`GraphNodeData`；现有 `useCharacter().getAllCharacters`、`useSetting().getAllSettings`；`window.novelWriter.on.bookChanged`（M2 提供，返回取消订阅函数）。
- Produces:
  - `useGraphData(projectPath: string | undefined): { characters: CharacterV2[]; worldEntries: WorldEntryV2[]; loading: boolean; refresh: () => void }`——挂载时拉两类实体；订阅 book:changed（paths 命中 characters/ 或 world/ 前缀）→ refresh；卸载取消订阅。projectPath 变化重拉。
  - `GraphView.tsx` props：`{ projectPath: string; kind: GraphKind; onNodeClick: (entityId: string, kind: GraphKind) => void }`——内部用 useGraphData + 对应 builder，渲染 `<ReactFlow>` + `<Background>` + `<Controls>`，注册 `character`/`world` 自定义节点类型；空数据显示空状态（`还没有${kind==='character'?'角色':'世界观设定'}，去侧栏「${'角色'|'设定'}」面板创建`）；节点点击回调 `onNodeClick(data.entityId, data.kind)`。
  - CharacterNode/WorldNode：React Flow 自定义节点，圆形/圆角卡片，`data.color` 作边框/标题底色，label 主文字、sub 副文字，深浅主题均可读（文字色走 `var(--color-text)`，不硬编码）。
  - graph.css：`@xyflow/react` 基础样式经 GraphView 内 `import '@xyflow/react/dist/style.css'` 引入；graph.css 只覆盖 `.react-flow__*` 到本应用配色（背景透明/跟随 `--color-paper`、边线 `--color-border`、控件按钮 `--color-bg-elevated`），**所有选择器以 `.graph-view` 作用域前缀限定**，不外溢污染 antd（Review Focus 5）。
  - **React Flow 两个必踩坑（务必处理，否则白屏/告警）**：(a) `<ReactFlow>` 的容器必须有**显式非零高度**——GraphView 根 `<div className="graph-view" style={{ position:'absolute', inset:0 }}>` 或 `height:'100%'` 且其 Workspace 父级有确定高度（renderMainView 主区是 flex:1 的 Layout，够用）；(b) `nodeTypes`（`{ character: CharacterNode, world: WorldNode }`）必须定义在组件**函数体外**或用 `useMemo` 固定引用，否则 React Flow 每次渲染告警 "nodeTypes not stable" 并可能重复挂载。`proOptions={{ hideAttribution: true }}` 可选（去水印，保留亦可）。
- [ ] Step 1: 实现 useGraphData（拉取 + 订阅 + 卸载清理 + projectPath 依赖）。
- [ ] Step 2: 实现自定义节点 + GraphView + graph.css（作用域前缀）。
- [ ] Step 3: typecheck 0 / lint 0 new / build ok（组件层无单测，逻辑已在 Task 1）；grep 确认 graph.css 所有规则带 `.graph-view` 前缀。
- [ ] Step 4: 人工冒烟项写入报告（本任务无宿主页面还看不到——Task 3 接入后可见；此步仅静态走查 + 构建产物无全局样式污染）。
- [ ] Step 5: Commit `feat(graph): React Flow graph view, custom nodes, scoped theming, live-refresh hook`。

### Task 3: 接入 Workspace（视图切换 + 点击联动 + 空/多态 + 文档）

**Files:**
- Modify: `src/renderer/pages/Workspace/index.tsx`（renderMainView 接缝处分流 + 顶部分段控件 + 节点点击→切侧栏 tab）
- Modify: `src/renderer/components/Workspace/SidebarPanel.tsx`（若需暴露"受控切 tab"能力，多数已由现有 tab prop 满足）
- Modify: `README.md`（特性列表加"图谱视图"一句）、`docs/BOOK_FORMAT.md`（可选：注明图谱消费 relationships/parentId）、`docs/DEVELOPMENT.md`（M3 完成行）

**Interfaces:**
- Consumes: Task 2 的 `GraphView`、`GraphKind`；现有 Workspace `sidebarTab`/`setSidebarTab`/`sidebarCollapsed`/`setSidebarCollapsed` state、`renderMainView()` 出口。
- Produces: Workspace 内新增 `const [viewMode, setViewMode] = useState<'write'|'graph'>('write')` 与 `const [graphKind, setGraphKind] = useState<GraphKind>('character')`；`renderMainView()` 改为：`viewMode==='graph'` 时返回 `<GraphView projectPath={projectPath} kind={graphKind} onNodeClick={handleGraphNodeClick} />`（含图谱内二级切换 `人物关系|世界观` 与顶部 `写作|图谱` 分段控件），否则返回现有编辑器 fragment。`handleGraphNodeClick(entityId, kind)`：`setSidebarTab(kind==='character'?'characters':'settings'); setSidebarCollapsed(false)`（打开对应面板并展开侧栏；选中/滚动到该实体为 stretch，见下）。
- [ ] Step 1: 加 viewMode/graphKind state + 顶部 `写作|图谱` Segmented（非 focusMode 时可见；图谱态下再放 `人物关系|世界观` 二级 Segmented）。
- [ ] Step 2: renderMainView 分流：graph→GraphView，write→现编辑器 fragment；保证切换不重复挂载 Graph（用条件渲染即可，React Flow 自身 memo）。
- [ ] Step 3: handleGraphNodeClick 接侧栏切换；若低成本可加"面板内高亮该实体"则加，否则记录为 stretch（不阻塞 M3）。
- [ ] Step 4: 空书（无角色）图谱态显示 GraphView 自带空状态；删光角色回空态不崩（人工冒烟）。
- [ ] Step 5: README/DEVELOPMENT 文档行；全门禁（typecheck/lint/test/build）绿。
- [ ] Step 6: 人工冒烟清单（写入报告，发起人真机执行）：开一本有关系的书→切图谱→人物关系图渲染→平移缩放拖拽→点节点侧栏跳角色面板→回写作视图编辑器状态不丢→切深浅主题图配色跟随。
- [ ] Step 7: Commit `feat(graph): wire graph view into workspace with write/graph toggle`。

---

## M3 完成定义（DoD）

- 三种视图态（写作 / 图谱-人物关系 / 图谱-世界观）可用；图谱从 M2 数据正确渲染，退化数据不崩（Task 1 单测覆盖）。
- 点节点联动侧栏对应面板；数据变更经 book:changed 刷新。
- 深/浅主题图均可读；React Flow 样式作用域隔离不污染 antd。
- 全门禁绿；graphModel 单测在套件内。
- 人工真机冒烟（Task 3 清单）由发起人补做。
- **明确不在 M3**：剧情线/选项/伏笔图、点击跳章节、图内编辑（均 M4+，见 spec §3）。
