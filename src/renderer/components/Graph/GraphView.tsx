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
import { useEffect, useMemo } from 'react'
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
import {
  buildCharacterGraph,
  buildWorldGraph,
  type GraphKind,
  type GraphNodeData
} from './graphModel'
import { useGraphData } from '../../pages/Workspace/hooks/useGraphData'

// 坑 (b)：函数体外模块常量，引用永不重建
const nodeTypes = { character: CharacterNode, world: WorldNode }

interface GraphViewProps {
  projectPath: string
  kind: GraphKind
  onNodeClick: (entityId: string, kind: GraphKind) => void
}

function GraphView({ projectPath, kind, onNodeClick }: GraphViewProps) {
  const { characters, worldEntries, loading } = useGraphData(projectPath)

  const graph = useMemo(
    () => (kind === 'character' ? buildCharacterGraph(characters) : buildWorldGraph(worldEntries)),
    [kind, characters, worldEntries]
  )

  // 坑 (c)：见文件头注释——受控 nodes/edges 必须配 change 回写，否则测量丢失、图不渲染
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const isEmpty = (kind === 'character' ? characters : worldEntries).length === 0

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
        onNodeClick={(_event, node) => onNodeClick(node.data.entityId, node.data.kind)}
      >
        <Background gap={24} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {loading && <div className="graph-status">加载中…</div>}
      {!loading && isEmpty && (
        <div className="graph-status">
          {kind === 'character'
            ? '还没有角色，去侧栏「角色」面板创建'
            : '还没有世界观设定，去侧栏「设定」面板创建'}
        </div>
      )}
    </div>
  )
}

export default GraphView
