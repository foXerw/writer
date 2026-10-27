// React Flow 自定义节点（Task 2）：世界观条目 = 圆角矩形卡片（层级树自上而下生长，
// 文字量比角色大，矩形比圆形容纳率高）。data.color 为类目主题色（同 CharacterNode 纪律）。
// Handle：父→子边自上而下 → target 进顶、source 出底，与 graphModel 默认锚位一致。
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { GraphNodeData } from './graphModel'

function WorldNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className="graph-node graph-node--world" style={{ borderColor: data.color }}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <span className="graph-node__label">{data.label}</span>
      {data.sub && <span className="graph-node__sub">{data.sub}</span>}
    </div>
  )
}

export default WorldNode
