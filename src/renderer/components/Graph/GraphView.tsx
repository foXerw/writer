// M3 图谱视图渲染层（Task 2）：把 graphModel 的纯 {nodes, edges} 输出画到 React Flow 画布。
// React Flow 两个必踩坑的处置（计划复核点 4）：
//  (a) 容器必须有显式非零高度——本组件根为 position:absolute; inset:0，要求宿主父级
//      position:relative 且已有确定尺寸（Task 3 的 Workspace 主区 flex:1 Layout 满足）；
//  (b) nodeTypes 定义在模块作用域——引用跨渲染恒定，否则 React Flow 告警
//      "nodeTypes not stable" 且每次渲染重挂全部节点。
// 只读画布：nodesDraggable/nodesConnectable/elementsSelectable 全关——数据是唯一真源，
// 拖动会制造与 graphModel 布局打架的本地状态；平移/缩放/点选仍然可用。
// 坑 (c)（Task 3 真机实测抓出，v12 受控模式经典哑火）：直接把 useMemo 出的 nodes/edges 传给
// ReactFlow 而不给 onNodesChange，节点尺寸测量（ResizeObserver → dimensions change）会被静默
// 丢弃——边因 isNodeInitialized=false 全部不画、节点 visibility:hidden，画布只剩背景点，
// 而 typecheck/build 全绿。故用 useNodesState/useEdgesState 本地受控：数据图重算即整体 set，
// 测量类 change 经 hook 返回的 onNodesChange 落进本地 state，边得以渲染（只读交互下无其他 change）。
// M4c-2 Task 4 扩展：kind 五档分发五 builder（剧情走向/关键选项/角色成长）；arc 档浮出角色
// 选择器；节点点击先查「实体→章节」引用并集（entityRefs 纯函数，useMemo 每轮数据刷新算一次）：
// 有引用弹跳章菜单（第 N 章 = orderedChapterIds 位次 + 1），选中经 onJumpToChapter 交回
// Workspace（openChapter + 切回写作视图）；无引用回退 M3 的 onNodeClick（切侧栏面板）。
// arc stage 节点的 entityId 回指角色（graphModel 钉死），故其菜单列的是【该角色】的出场章。
import { useEffect, useMemo, useState } from 'react'
import { Button, Modal, Select, Space } from 'antd'
import {
  ReactFlow,
  Background,
  Controls,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './graph.css'
import CharacterNode from './CharacterNode'
import WorldNode from './WorldNode'
import CardNode from './CardNode'
import {
  buildArcGraph,
  buildCharacterGraph,
  buildChoiceGraph,
  buildPlotlineGraph,
  buildWorldGraph,
  type GraphKind,
  type GraphNodeData
} from './graphModel'
import { buildEntityChapterRefs } from '@/common/entityRefs'
import { useGraphData } from '../../pages/Workspace/hooks/useGraphData'
import type { Chapter } from '@/common/ipc'

// 坑 (b)：函数体外模块常量，引用永不重建。plotline/choice/arc 三个分发键对应
// graphModel 三 builder 钉死的节点 type（缺失即退化 default 矩形，见 graphModel 注释）。
const nodeTypes = {
  character: CharacterNode,
  world: WorldNode,
  plotline: CardNode,
  choice: CardNode,
  arc: CardNode
}

interface GraphViewProps {
  projectPath: string
  kind: GraphKind
  /** 书序章表（会话态）：跳章菜单的「第 N 章」编号与标题来源。 */
  chapters: Chapter[]
  /** 无章节引用时的回退（M3 行为：切侧栏面板）。 */
  onNodeClick: (entityId: string, kind: GraphKind) => void
  /** 有章节引用时菜单选中一章 → 跳编辑器（Workspace：openChapter + 切回写作视图）。 */
  onJumpToChapter: (chapterId: string) => void
}

function GraphView({ projectPath, kind, chapters, onNodeClick, onJumpToChapter }: GraphViewProps) {
  const { characters, worldEntries, plotlines, choices, ledger, entityIndex, loading } =
    useGraphData(projectPath)

  // 书序：按 order 升序（仓库 listChapters 本已升序，此处排序是对契约的防御性自持）。
  const orderedChapterIds = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order).map((c) => c.id),
    [chapters]
  )
  const chapterById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters])

  // arc 角色选择器（计划复核点 3：状态随 kind 重置）：离开 arc 档即清本地选择，回到
  // arc 重按默认——主角优先（同格按名字序），无主角则全书按名字序首个。选中角色被删时
  // find 脱靶自动回落默认，不留悬空 id。
  const [arcCharId, setArcCharId] = useState<string | null>(null)
  useEffect(() => {
    setArcCharId(null)
  }, [kind])
  const arcChar = useMemo(() => {
    const sorted = [...characters].sort((a, b) => a.name.localeCompare(b.name))
    const chosen = arcCharId ? sorted.find((c) => c.id === arcCharId) : undefined
    return chosen ?? sorted.find((c) => c.role === 'protagonist') ?? sorted[0] ?? null
  }, [characters, arcCharId])

  const graph = useMemo(() => {
    if (kind === 'character') return buildCharacterGraph(characters)
    if (kind === 'world') return buildWorldGraph(worldEntries)
    if (kind === 'plotline') return buildPlotlineGraph(plotlines)
    if (kind === 'choice') return buildChoiceGraph(choices, orderedChapterIds)
    return buildArcGraph(arcChar)
  }, [kind, characters, worldEntries, plotlines, choices, orderedChapterIds, arcChar])

  // 跳转数据（计划 §Task 4）：index ∪ 显式引用的并集，每轮数据刷新算一次。
  // 键域 = 全部实体 id（角色/词条/剧情线/选项/伏笔）；图节点 entityId 恒在其内
  //（arc stage 回指角色 id，故弹【角色】的出场章菜单）。
  const refs = useMemo(
    () =>
      buildEntityChapterRefs({
        index: entityIndex,
        characters,
        world: worldEntries,
        plotlines,
        choices,
        ledger,
        orderedChapterIds
      }),
    [entityIndex, characters, worldEntries, plotlines, choices, ledger, orderedChapterIds]
  )

  // 坑 (c)：见文件头注释——受控 nodes/edges 必须配 change 回写，否则测量丢失、图不渲染
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  // 跳章菜单：实体标签 + 该实体的章 id 清单（已由 refs 过滤悬挂、按书序排列）。
  // 标题取【实体】名而非节点标签：plotline/arc 的 stage 节点 data.entityId 回指父实体、
  // 章引用也记在父实体上——菜单答「这个角色/这条线出现在哪些章」，stage 名只做行内文案。
  const [jumpMenu, setJumpMenu] = useState<{ label: string; chapterIds: string[] } | null>(null)

  const entityLabelOf = (entityId: string, nodeKind: GraphKind, nodeLabel: string): string => {
    if (nodeKind === 'arc') return characters.find((c) => c.id === entityId)?.name ?? nodeLabel
    if (nodeKind === 'plotline') return plotlines.find((p) => p.id === entityId)?.title ?? nodeLabel
    return nodeLabel // character/world/choice：节点标签即实体名
  }

  const handleNodeActivate = (entityId: string, nodeKind: GraphKind, nodeLabel: string) => {
    const chaptersFor = refs[entityId] ?? []
    if (chaptersFor.length > 0) {
      setJumpMenu({ label: entityLabelOf(entityId, nodeKind, nodeLabel), chapterIds: chaptersFor })
    } else {
      onNodeClick(entityId, nodeKind) // 回退 M3：切侧栏面板
    }
  }

  // 五档空态（M4c-2 Task 4；「叙事」面板在 Task 5 落地，文案先行指向）：
  // null = 有数据不显示。剧情线档特例：有线但 0 stage → graphModel 出空图，另给成图提示。
  const emptyText = (() => {
    if (kind === 'character') {
      return characters.length === 0 ? '还没有角色，去侧栏「角色」面板创建' : null
    }
    if (kind === 'world') {
      return worldEntries.length === 0 ? '还没有世界观设定，去侧栏「设定」面板创建' : null
    }
    if (kind === 'plotline') {
      if (plotlines.length === 0) return '还没有剧情线，去侧栏「叙事」面板创建'
      if (graph.nodes.length === 0) return '剧情线还没有阶段，去侧栏「叙事」面板补充'
      return null
    }
    if (kind === 'choice') {
      return choices.length === 0 ? '还没有关键选项，去侧栏「叙事」面板创建' : null
    }
    // arc：无角色复用角色空态
    return characters.length === 0 ? '还没有角色，去侧栏「角色」面板创建' : null
  })()

  return (
    <div className="graph-view" style={{ position: 'absolute', inset: 0 }}>
      {/* key=kind：切换图谱种类时整体重挂画布 → fitView 重新取景（数据刷新不重挂、不丢视角） */}
      <ReactFlow<Node<GraphNodeData>, Edge>
        key={kind}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_event, node) =>
          handleNodeActivate(node.data.entityId, node.data.kind, node.data.label)
        }
      >
        <Background gap={24} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {kind === 'arc' && !loading && characters.length > 0 && (
        <div className="graph-arc-select">
          <span className="graph-arc-select__label">角色</span>
          <Select
            size="small"
            style={{ width: 160 }}
            value={arcChar ? arcChar.id : undefined}
            onChange={(v: string) => setArcCharId(v)}
            options={[...characters]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      )}
      {loading && <div className="graph-status">加载中…</div>}
      {!loading && emptyText && <div className="graph-status">{emptyText}</div>}
      <Modal
        open={jumpMenu !== null}
        title={jumpMenu ? `「${jumpMenu.label}」出现章节` : ''}
        footer={null}
        width={360}
        onCancel={() => setJumpMenu(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {(jumpMenu?.chapterIds ?? []).map((chapterId) => (
            <Button
              key={chapterId}
              block
              style={{ textAlign: 'left' }}
              onClick={() => {
                setJumpMenu(null)
                onJumpToChapter(chapterId)
              }}
            >
              {`第 ${orderedChapterIds.indexOf(chapterId) + 1} 章 ${
                chapterById.get(chapterId)?.title ?? chapterId
              }`}
            </Button>
          ))}
        </Space>
      </Modal>
    </div>
  )
}

export default GraphView
