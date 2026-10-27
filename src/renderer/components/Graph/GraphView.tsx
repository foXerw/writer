// M3 图谱视图渲染层（Task 2）：把 graphModel 的纯 {nodes, edges} 输出画到 React Flow 画布。
// React Flow 两个必踩坑的处置（计划复核点 4）：
//  (a) 容器必须有显式非零高度——本组件根为 position:absolute; inset:0，要求宿主父级
//      position:relative 且已有确定尺寸（Task 3 的 Workspace 主区 flex:1 Layout 满足）；
//  (b) nodeTypes 定义在模块作用域——引用跨渲染恒定，否则 React Flow 告警
//      "nodeTypes not stable" 且每次渲染重挂全部节点。
// 只读画布：nodesDraggable/nodesConnectable/elementsSelectable 全关——数据是唯一真源，
// 拖动会制造与 graphModel 布局打架的本地状态；平移/缩放/点选仍然可用。
import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Edge, type Node } from '@xyflow/react'
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

  const isEmpty = (kind === 'character' ? characters : worldEntries).length === 0

  return (
    <div className="graph-view" style={{ position: 'absolute', inset: 0 }}>
      {/* key=kind：切换图谱种类时整体重挂画布 → fitView 重新取景（数据刷新不重挂、不丢视角） */}
      <ReactFlow<Node<GraphNodeData>, Edge>
        key={kind}
        nodes={graph.nodes}
        edges={graph.edges}
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
